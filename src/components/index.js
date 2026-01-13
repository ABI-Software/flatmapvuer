// The Vue build version to load with the `import` command
// (runtime-only or standalone) has been set in webpack.base.conf with an alias.
import FlatmapVuer from './FlatmapVuer.vue'
import MultiFlatmapVuer from './MultiFlatmapVuer.vue'
import { FlatmapQueries } from '../services/flatmapQueries.js'
import {
  getKnowledgeSource,
  getKnowledgeSourceFromProvenance,
  loadAndStoreKnowledge,
} from '../services/flatmapKnowledge.js'

export {
  FlatmapQueries,
  FlatmapVuer,
  getKnowledgeSource,
  getKnowledgeSourceFromProvenance,
  loadAndStoreKnowledge,
  MultiFlatmapVuer,
}
// export { FlatmapVuer, MultiFlatmapVuer };
