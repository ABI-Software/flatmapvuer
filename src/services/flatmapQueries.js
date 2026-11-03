import { querySingleConnectivityList } from '@abi-software/map-utilities';

// remove duplicates by comparing the stringified objects, keeping the original elements
const removeDuplicates = function (arrayOfAnything) {
  if (!arrayOfAnything) return [];
  const seen = new Set();
  return arrayOfAnything.filter((e) => {
    const key = JSON.stringify(e);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// set of stringified elements for exact matching of nodes
const toKeySet = function (arrayOfAnything) {
  return new Set((arrayOfAnything || []).map((e) => JSON.stringify(e)));
};

// remove duplicates for terms with id (UBERON or ILX) and name properties
const removeDuplicateTerms = function (arrayOfTerms) {
  if (!arrayOfTerms) return [];
  const seen = new Set();
  const filteredTerms = [];
  arrayOfTerms.forEach((term) => {
    const { id, name } = term;
    const identifier = `${id.toLowerCase()}:${name.toLowerCase()}`;
    if (!seen.has(identifier)) {
      seen.add(identifier);
      filteredTerms.push(term);
    }
  });
  return filteredTerms;
};

const cachedLabels = {};
// taxon => label
const cachedTaxonLabels = new Map();
// taxon => in-flight queryLabels promise, shared by concurrent callers
const pendingTaxonLabels = new Map();

// Cache of raw connectivity responses (as promises, so concurrent requests are shared).
// Flatmaps are immutable per uuid, so responses can be reused. Least recently used are evicted.
const MAX_CACHED_RESPONSES = 100;
const cachedResponses = new Map();

const cachedRequest = function (key, request) {
  if (cachedResponses.has(key)) {
    const cached = cachedResponses.get(key);
    // move to the end to mark as most recently used
    cachedResponses.delete(key);
    cachedResponses.set(key, cached);
    return cached;
  }
  const promise = request().catch((error) => {
    if (cachedResponses.get(key) === promise) cachedResponses.delete(key);
    throw error;
  });
  cachedResponses.set(key, promise);
  if (cachedResponses.size > MAX_CACHED_RESPONSES) {
    cachedResponses.delete(cachedResponses.keys().next().value);
  }
  return promise;
};

const findTaxonomyLabel = async function (flatmapAPI, taxonomy) {
  if (cachedLabels && Object.hasOwn(cachedLabels, taxonomy)) {
    return cachedLabels[taxonomy];
  }

  return new Promise((resolve) => {
    fetch(`${flatmapAPI}knowledge/label/${taxonomy}`, {
      method: 'GET',
    })
      .then((response) => response.json())
      .then((data) => {
        let label = data.label;
        if (label === 'Mammalia') {
          label = 'Mammalia not otherwise specified';
        }
        cachedLabels[taxonomy] = label;
        resolve(label);
      })
      .catch((error) => {
        console.error('Error:', error);
        cachedLabels[taxonomy] = taxonomy;
        resolve(taxonomy);
      });
  });
};

const findTaxonomyLabels = async function (mapImp, taxonomies) {
  const uniqueTaxonomies = [...new Set(taxonomies)];
  const leftoverTaxonomies = uniqueTaxonomies.filter(
    (taxonomy) => !cachedTaxonLabels.has(taxonomy) && !pendingTaxonLabels.has(taxonomy),
  );

  if (leftoverTaxonomies.length) {
    const request = mapImp
      .queryLabels(leftoverTaxonomies)
      .then((entityLabels) => {
        (entityLabels || []).forEach((entityLabel) => {
          let { entity: taxon, label } = entityLabel;
          if (label === 'Mammalia') {
            label = 'Mammalia not otherwise specified';
          }
          cachedTaxonLabels.set(taxon, label);
        });
      })
      .finally(() => {
        leftoverTaxonomies.forEach((taxonomy) => pendingTaxonLabels.delete(taxonomy));
      });
    leftoverTaxonomies.forEach((taxonomy) => pendingTaxonLabels.set(taxonomy, request));
  }

  const pending = new Set(
    uniqueTaxonomies.map((taxonomy) => pendingTaxonLabels.get(taxonomy)).filter(Boolean),
  );
  await Promise.all(pending);

  return uniqueTaxonomies
    .filter((taxonomy) => cachedTaxonLabels.has(taxonomy))
    .map((taxon) => ({ taxon, label: cachedTaxonLabels.get(taxon) }));
};

const compareNames = (a, b) => {
  // to make it work for both string name and obj.name
  const _nameA = a.name ?? a;
  const _nameB = b.name ?? b;
  const nameA = _nameA.toUpperCase();
  const nameB = _nameB.toUpperCase();

  if (nameA < nameB) {
    return -1;
  }

  if (nameA > nameB) {
    return 1;
  }

  return 0;
};

// The per path data which is reset for every connectivity query
const createConnectivityState = function () {
  return {
    destinations: [],
    origins: [],
    components: [],
    destinationsWithDatasets: [],
    originsWithDatasets: [],
    componentsWithDatasets: [],
    destinationsCombinations: [],
    originsCombinations: [],
    componentsCombinations: [],
    singleConnectivityList: [],
    rawURLs: [],
    expertConsultants: [],
  };
};

// Add the SCKAN and Map combination and its map nodes for searching datasets
const addCombination = function (combinations, withDatasets, value, mapNodeLabels) {
  const { sckanNodeId, sckanNodeLabel, mapNodeId, mapNodeLabel } = value;
  combinations.push({
    sckanId: sckanNodeId,
    sckanLabel: sckanNodeLabel,
    mapId: mapNodeId,
    mapLabel: mapNodeLabel,
  });
  mapNodeId.forEach((id, i) => {
    const stringId = typeof id === 'string' ? id : id[0];
    if (stringId) {
      withDatasets.push({
        id: stringId,
        name: mapNodeLabels[i],
      });
    }
  });
};

let FlatmapQueries = function () {
  this.initialise = function (flatmapAPI) {
    this.flatmapAPI = flatmapAPI;
    Object.assign(this, createConnectivityState());
    this.hasSingleConnectivityList = false;
    this.controller = undefined;
    this.uberons = [];
    this.lookUp = [];
    this.connectivitySource = 'map'; // 'sckan'
    this.noMapConnectivity = false;
    this._requestId = 0;
  };

  this._buildTooltipData = async function (data, mapImp, eventData) {
    let hyperlinks;
    if (eventData.feature?.hyperlinks && eventData.feature.hyperlinks.length > 0) {
      hyperlinks = eventData.feature.hyperlinks;
    } else {
      hyperlinks = data.rawURLs;
    }
    let taxonomyLabel = undefined;
    if (eventData.provenanceTaxonomy) {
      taxonomyLabel = [];
      try {
        const entityLabels = await findTaxonomyLabels(mapImp, eventData.provenanceTaxonomy);
        entityLabels.forEach((entityLabel) => {
          taxonomyLabel.push(entityLabel.label);
        });
      } catch (error) {
        console.log(error);
      }
    }

    let tooltipData = {
      destinations: data.destinations,
      origins: data.origins,
      components: data.components,
      destinationsWithDatasets: removeDuplicateTerms(data.destinationsWithDatasets),
      originsWithDatasets: removeDuplicateTerms(data.originsWithDatasets),
      componentsWithDatasets: removeDuplicateTerms(data.componentsWithDatasets),
      destinationsCombinations: data.destinationsCombinations,
      originsCombinations: data.originsCombinations,
      componentsCombinations: data.componentsCombinations,
      hasSingleConnectivityList: data.singleConnectivityList.length > 0,
      title: eventData.label,
      featureId: eventData.resource,
      hyperlinks: hyperlinks,
      'expert-consultants': data.expertConsultants,
      provenanceTaxonomy: eventData.provenanceTaxonomy,
      provenanceTaxonomyLabel: taxonomyLabel,
      connectivitySource: data.connectivitySource,
      noMapConnectivity: data.noMapConnectivity,
    };
    return tooltipData;
  };

  this.createTooltipData = async function (mapImp, eventData) {
    return this._buildTooltipData(this, mapImp, eventData);
  };

  // Query the knowledge and create the tooltip data without using the instance state,
  // so tooltips for multiple paths can be created in parallel.
  this.queryTooltipData = async function (mapImp, eventData) {
    const keastIds = eventData.resource;
    let data = {
      ...createConnectivityState(),
      connectivitySource: 'map',
      noMapConnectivity: false,
    };
    if (keastIds && keastIds.length > 0 && keastIds[0]) {
      const { state } = await this._fetchConnectivity(mapImp, keastIds[0], 'map', true);
      data = { ...data, ...state };
    }
    return this._buildTooltipData(data, mapImp, eventData);
  };

  this.updateTooltipData = function (tooltipEntry) {
    return {
      ...tooltipEntry,
      origins: this.origins,
      originsWithDatasets: removeDuplicateTerms(this.originsWithDatasets),
      components: this.components,
      componentsWithDatasets: removeDuplicateTerms(this.componentsWithDatasets),
      destinations: this.destinations,
      destinationsWithDatasets: removeDuplicateTerms(this.destinationsWithDatasets),
      destinationsCombinations: this.destinationsCombinations,
      originsCombinations: this.originsCombinations,
      componentsCombinations: this.componentsCombinations,
      connectivitySource: this.connectivitySource,
      noMapConnectivity: this.noMapConnectivity,
    };
  };

  this.createComponentsLabelList = function (components, lookUp) {
    let labelList = [];
    components.forEach((n) => {
      labelList.push(this.createLabelFromNeuralNode(n[0]), lookUp);
      if (n.length === 2) {
        labelList.push(this.createLabelFromNeuralNode(n[1]), lookUp);
      }
    });
    return labelList;
  };

  this._buildLabelLookup = async function (mapImp, uberons) {
    const lookUp = {};
    const uberonList = [];
    const entityLabels = await findTaxonomyLabels(mapImp, uberons);
    entityLabels.forEach((entityLabel) => {
      const { taxon: entity, label } = entityLabel;
      lookUp[entity] = label;
      uberonList.push({
        id: entity,
        name: label,
      });
    });
    return { lookUp, uberons: uberonList };
  };

  this.createLabelLookup = async function (mapImp, uberons) {
    const { lookUp, uberons: uberonList } = await this._buildLabelLookup(mapImp, uberons);
    this.uberons = uberonList;
    return lookUp;
  };

  this.buildConnectivitySqlStatement = function (keastIds) {
    let sql = 'select knowledge from knowledge where entity in (';
    if (keastIds.length === 1) {
      sql += `'${keastIds[0]}')`;
    } else if (keastIds.length > 1) {
      for (let i in keastIds) {
        sql += `'${keastIds[i]}'${i >= keastIds.length - 1 ? ')' : ','} `;
      }
    }
    return sql;
  };

  this.buildLabelSqlStatement = function (uberons) {
    let sql = 'select entity, label from labels where entity in (';
    if (uberons.length === 1) {
      sql += `'${uberons[0]}')`;
    } else if (uberons.length > 1) {
      for (let i in uberons) {
        sql += `'${uberons[i]}'${i >= uberons.length - 1 ? ')' : ','} `;
      }
    }
    return sql;
  };

  this.findAllIdsFromConnectivity = function (connectivity) {
    // edges => nodes => [id, [ids]] => ids
    return [...new Set(connectivity.connectivity.flat(3))];
  };

  this.flattenConnectivity = function (connectivity) {
    // nodes => [id, [ids]] => ids
    return connectivity.flat(3);
  };

  this.findComponents = function (connectivity, axons, dendrites, somas) {
    let dnodes = connectivity.connectivity.flat(); // get nodes from edgelist
    let nodes = removeDuplicates(dnodes);

    // Stringify the terminals once instead of for every node, then match the node as a substring
    const terminals = [axons, somas, dendrites]
      .filter((terminal) => terminal)
      .map((terminal) => JSON.stringify(terminal));

    // Keep the nodes which are not destinations or origins
    // (note that they are labelled dendrite and axon as opposed to origin and destination)
    return nodes.filter((node) => {
      const nodeKey = JSON.stringify(node);
      return !terminals.some((terminal) => terminal.indexOf(nodeKey) !== -1);
    });
  };

  this.retrieveFlatmapKnowledgeForEvent = async function (mapImp, eventData) {
    // check if there is an existing query
    if (this.controller) this.controller.abort();

    // set up the abort controller
    this.controller = new AbortController();
    // invalidate any query in progress
    this._requestId++;

    const keastIds = eventData.resource;
    Object.assign(this, createConnectivityState());
    if (!keastIds || keastIds.length === 0 || !keastIds[0]) return;

    return [await this.queryForConnectivityNew(mapImp, keastIds[0])];
  };

  this.queryForConnectivityNew = async function (
    mapImp,
    keastId,
    connectivitySource = 'map',
    processConnectivity = true,
  ) {
    const requestId = ++this._requestId;
    const { state, value } = await this._fetchConnectivity(
      mapImp,
      keastId,
      connectivitySource,
      processConnectivity,
    );
    // Only update the instance state if no newer query has started meanwhile
    if (requestId === this._requestId) {
      Object.assign(this, state);
    }
    return value;
  };

  // Query and process the connectivity of a path without changing the instance state.
  // Returns the state to apply and the value returned by queryForConnectivityNew.
  this._fetchConnectivity = async function (
    mapImp,
    keastId,
    connectivitySource,
    processConnectivity,
  ) {
    // The new service, CQ27, is available for SCKAN knowledge sources from 2026 onward.
    const sourceMatch = /^sckan-(\d{4})/.exec(mapImp.knowledgeSource || '');
    const sourceYear = sourceMatch ? Number(sourceMatch[1]) : 0;
    const isCq27ServiceAvailable = sourceYear >= 2026;
    const mapUUID = mapImp.mapMetadata.uuid;
    const flatmapAPI = this.flatmapAPI;
    const state = createConnectivityState();
    state.connectivitySource = isCq27ServiceAvailable ? 'sckan' : connectivitySource;

    // Start both queries together as they are independent
    const singleConnectivityListRequest = isCq27ServiceAvailable
      ? cachedRequest(`cq27|${flatmapAPI}|${mapUUID}|${keastId}`, () =>
          querySingleConnectivityList(flatmapAPI, mapUUID, keastId),
        ).catch(() => [])
      : Promise.resolve([]);
    const querySckanKnowledge = () =>
      cachedRequest(`sckan|${flatmapAPI}|${mapUUID}|${keastId}`, () =>
        mapImp.queryKnowledge(keastId),
      );
    const connectivityRequest =
      state.connectivitySource === 'map'
        ? cachedRequest(`map|${flatmapAPI}|${mapUUID}|${keastId}`, () =>
            this.queryMapConnectivity(mapUUID, keastId),
          )
        : querySckanKnowledge();

    let value = false;
    try {
      let response = await connectivityRequest;
      state.singleConnectivityList = await singleConnectivityListRequest;
      if (this.checkConnectivityExists(response)) {
        if (state.connectivitySource === 'map') {
          state.noMapConnectivity = false;
        }
      } else if (state.connectivitySource === 'map') {
        // switch to SCKAN
        // when there has no connectivity data from Map
        // and add the noMapConnectivity flag to disable the option
        state.connectivitySource = 'sckan';
        state.noMapConnectivity = true;
        response = await querySckanKnowledge().catch(() => undefined);
      } else {
        response = undefined;
      }

      if (this.checkConnectivityExists(response)) {
        value = response;
        if (processConnectivity) {
          const processed = await this._processConnectivity(
            mapImp,
            response,
            state.singleConnectivityList,
          );
          Object.assign(state, processed.state);
          value = processed.value;
          // response.references is publication urls
          if (response.references) {
            // with publications from both PubMed and Others
            state.rawURLs = [...response.references];
          }
          if (response['expert-consultants']) {
            state.expertConsultants = [...response['expert-consultants']];
          }
        }
      }
    } catch (error) {
      state.singleConnectivityList = await singleConnectivityListRequest;
      if (error.name === 'AbortError') {
        // This error is from AbortController's abort method.
      } else {
        // console.error('Error:', error)
        // TODO: to update after queryKnowledge method update
        console.warn(`Unable to get the knowledge for the entity ${keastId}.`);
      }
      value = false;
    }
    return { state, value };
  };

  this.queryMapConnectivity = async function (mapuuid, pathId) {
    const url = this.flatmapAPI + `flatmap/${mapuuid}/connectivity/${pathId}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Response status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      throw new Error(error, { cause: error });
    }
  };

  this.queryForConnectivity = function (mapImp, keastIds, signal, processConnectivity = true) {
    const data = { sql: this.buildConnectivitySqlStatement(keastIds) };
    const headers = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
      ...(signal ? { signal: signal } : {}), // add signal to header if it exists
    };
    return new Promise((resolve) => {
      fetch(`${this.flatmapAPI}knowledge/query/`, headers)
        .then((response) => response.json())
        .then((data) => {
          if (this.connectivityExists(data)) {
            let connectivity = JSON.parse(data.values[0][0]);
            if (processConnectivity) {
              this.processConnectivity(mapImp, connectivity)
                .then((processedConnectivity) => {
                  resolve(processedConnectivity);
                })
                .catch(() => resolve(false));
            } else resolve(connectivity);
          } else {
            resolve(false);
          }
        })
        .catch((error) => {
          if (error.name === 'AbortError') {
            // This error is from AbortController's abort method.
          } else {
            console.error('Error:', error);
          }
          resolve(false);
        });
    });
  };

  this.checkConnectivityExists = function (data) {
    return data && data.connectivity?.length;
  };

  this.connectivityExists = function (data) {
    if (data.values && data.values.length > 0) {
      const connectivity = JSON.parse(data.values[0][0]).connectivity;
      return !!(connectivity && connectivity.length > 0);
    }
    return false;
  };

  // This function is used to determine if a node is a single node or a node with multiple children
  //  Returns the id of the node if it is a single node, otherwise returns false
  this.findIfNodeIsSingle = function (node) {
    if (node.length === 1) {
      // If the node is in the form [id]
      console.error('Server returns a single node', node);
      return node[0];
    } else {
      if (node.length === 2 && node[1].length === 0) {
        // If the node is in the form [id, []]
        return node[0];
      } else {
        return false; // If the node is in the form [id, [id1, id2]]
      }
    }
  };

  this.createLabelFromNeuralNode = function (node, lookUp) {
    // Check if the node is a single node or a node with multiple children
    let nodeIsSingle = this.findIfNodeIsSingle(node);

    // Case where node is in the form [id]
    if (nodeIsSingle) {
      return lookUp[nodeIsSingle];
    }

    // Case where node is in the form [id, [id1 (,id2)]]
    let label = lookUp[node[0]];
    if (node.length === 2 && node[1].length > 0) {
      node[1].forEach((n) => {
        if (lookUp[n] == undefined) {
          label += `, ${n}`;
        } else {
          label += `, ${lookUp[n]}`;
        }
      });
    }
    return label;
  };

  // Returns the anatomy with datasets and the SCKAN and Map combinations
  this._findDatasets = function (dendrites, components, axons, uberons, singleConnectivityList) {
    // process the nodes for finding datasets (Note this is not critical to the tooltip, only for the 'search on components' button)
    const dendritesFlat = new Set(this.flattenConnectivity(dendrites));
    const componentsFlat = new Set(this.flattenConnectivity(components));
    const axonsFlat = new Set(this.flattenConnectivity(axons));

    // Filter for the anatomy which is annotated on datasets
    const result = {
      originsWithDatasets: uberons.filter((ub) => dendritesFlat.has(ub.id)).sort(compareNames),
      componentsWithDatasets: uberons.filter((ub) => componentsFlat.has(ub.id)).sort(compareNames),
      destinationsWithDatasets: uberons.filter((ub) => axonsFlat.has(ub.id)).sort(compareNames),
      destinationsCombinations: [],
      originsCombinations: [],
      componentsCombinations: [],
    };

    // Get combinations of SCKAN and Map
    if (singleConnectivityList.length > 0) {
      const axonKeys = toKeySet(axons);
      const dendriteKeys = toKeySet(dendrites);
      const componentKeys = toKeySet(components);
      singleConnectivityList.forEach((value) => {
        // The base ID is SCKAN ID
        const sckanKey = JSON.stringify(value.sckanNodeId);
        const mapNodeLabels = value.mapNodeLabel.split(',');
        if (axonKeys.has(sckanKey)) {
          addCombination(
            result.destinationsCombinations,
            result.destinationsWithDatasets,
            value,
            mapNodeLabels,
          );
        }
        if (dendriteKeys.has(sckanKey)) {
          addCombination(
            result.originsCombinations,
            result.originsWithDatasets,
            value,
            mapNodeLabels,
          );
        }
        if (componentKeys.has(sckanKey)) {
          addCombination(
            result.componentsCombinations,
            result.componentsWithDatasets,
            value,
            mapNodeLabels,
          );
        }
      });
    }
    return result;
  };

  this.flattenAndFindDatasets = function (dendrites, components, axons) {
    Object.assign(
      this,
      this._findDatasets(dendrites, components, axons, this.uberons, this.singleConnectivityList),
    );
  };

  // Process the connectivity without changing the instance state.
  // Returns the state to apply and the processed connectivity.
  this._processConnectivity = async function (mapImp, connectivity, singleConnectivityList) {
    let dendrites = [];
    let axons = [];
    let somas = undefined;
    if (connectivity && connectivity['node-phenotypes']) {
      const sourceKey = ['ilxtr:hasSomaLocatedIn'];
      const destinationKey = [
        'ilxtr:hasAxonPresynapticElementIn',
        'ilxtr:hasAxonSensorySubcellularElementIn',
      ];
      sourceKey.forEach((key) => {
        if (key in connectivity['node-phenotypes']) {
          dendrites.push(...connectivity['node-phenotypes'][key]);
        }
      });
      dendrites = removeDuplicates(dendrites);
      destinationKey.forEach((key) => {
        if (key in connectivity['node-phenotypes']) {
          axons.push(...connectivity['node-phenotypes'][key]);
        }
      });
      axons = removeDuplicates(axons);
    } else {
      // Remove duplicates
      axons = removeDuplicates(connectivity.axons);
      //Somas will become part of origins, support this for future proof
      if (connectivity.somas && connectivity.somas.length > 0) {
        dendrites.push(...connectivity.somas);
      }
      if (connectivity.dendrites && connectivity.dendrites.length > 0) {
        dendrites.push(...connectivity.dendrites);
      }
      dendrites = removeDuplicates(dendrites);
      somas = connectivity.somas;
    }

    const components = this.findComponents(connectivity, axons, dendrites, somas);
    // Create list of ids to get labels for
    const conIds = this.findAllIdsFromConnectivity(connectivity);
    // Create readable labels from the nodes. Setting this to 'this.origins' updates the display
    const { lookUp, uberons } = await this._buildLabelLookup(mapImp, conIds);
    const origins = dendrites
      .map((d) => this.createLabelFromNeuralNode(d, lookUp))
      .sort(compareNames);
    const componentLabels = components
      .map((c) => this.createLabelFromNeuralNode(c, lookUp))
      .sort(compareNames);
    const destinations = axons
      .map((a) => this.createLabelFromNeuralNode(a, lookUp))
      .sort(compareNames);
    return {
      state: {
        uberons,
        origins,
        components: componentLabels,
        destinations,
        ...this._findDatasets(dendrites, components, axons, uberons, singleConnectivityList),
      },
      value: {
        ids: {
          dendrites: dendrites,
          components: components,
          axons: axons,
        },
        labels: {
          origins,
          components: componentLabels,
          destinations,
        },
      },
    };
  };

  this.processConnectivity = async function (mapImp, connectivity) {
    const { state, value } = await this._processConnectivity(
      mapImp,
      connectivity,
      this.singleConnectivityList,
    );
    Object.assign(this, state);
    return value;
  };

  this.buildPubmedSqlStatement = function (keastIds) {
    let sql = 'select distinct publication from publications where entity in (';
    if (keastIds.length === 1) {
      sql += `'${keastIds[0]}')`;
    } else if (keastIds.length > 1) {
      for (let i in keastIds) {
        sql += `'${keastIds[i]}'${i >= keastIds.length - 1 ? ')' : ','} `;
      }
    }
    return sql;
  };

  this.buildPubmedSqlStatementForModels = function (model) {
    return `select distinct publication from publications where entity = '${model}'`;
  };

  this.queryKnowledge = async (sql, params) => {
    const url = `${this.flatmapAPI}knowledge/query/`;
    const query = { sql, params };
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
      body: JSON.stringify(query),
    });
    if (!response.ok) {
      throw new Error(`Cannot access ${url}`);
    }
    const data = await response.json();
    if ('error' in data) {
      throw new TypeError(data.error);
    }
    return data.values;
  };
};

export { FlatmapQueries, findTaxonomyLabel, findTaxonomyLabels };
