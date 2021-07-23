<template>
  <div class="multi-container">
    <div style="position:absolute;z-index:10;">
      <div class="species-display-text">
        Species
      </div>
      <el-popover
        ref="selectPopover"
        v-model="helpMode" 
        content="Select a species"
        placement="right"
        :append-to-body="false"
        trigger="manual"
        popper-class="flatmap-popper right-popper"
      />
      <el-select
        id="flatmap-select"
        v-model="activeSpecies"
        v-popover:selectPopover
        :popper-append-to-body="appendToBody"
        placeholder="Select"
        class="select-box"
        popper-class="flatmap_dropdown"
        @change="flatmapChanged"
      >
        <el-option
          v-for="(item, key) in speciesList"
          :key="key"
          :label="key"
          :value="key"
        >
          <el-row>
            <el-col :span="8">
              <i :class="item.iconClass" />
            </el-col>
            <el-col :span="12">
              {{ key }}
            </el-col>
          </el-row>
        </el-option>
      </el-select>
    </div>
    <FlatmapVuer
      v-for="(item, key) in speciesList"
      v-show="activeSpecies==key"
      :key="key"
      :ref="key"
      :show-layer="showLayer"
      :entry="item.taxo"
      :display-warning="item.displayWarning"
      :warning-message="warningMessage"
      :feature-info="featureInfo"
      :min-zoom="minZoom"
      :path-controls="pathControls"
      :searchable="searchable"
      :help-mode="helpMode"
      :render-at-mounted="renderAtMounted"
      :display-minimap="displayMinimap"
      style="height:100%"
      :flatmap-a-p-i="flatmapAPI"
      @resource-selected="FlatmapSelected"
      @ready="FlatmapReady"
    />
  </div>
</template>


<script>
/* eslint-disable no-alert, no-console */
import Vue from "vue";
import FlatmapVuer from "./FlatmapVuer.vue";
import { Col, Option, Select, Row, Popover } from "element-ui";  
import lang from "element-ui/lib/locale/lang/en";
import locale from "element-ui/lib/locale";
locale.use(lang);
Vue.use(Col);
Vue.use(Row);
Vue.use(Option);
Vue.use(Select);
Vue.use(Popover)


export default {
  name: "MultiFlatmapVuer",
  components: {
    FlatmapVuer
  },
  props: {
    showLayer: {
      type: Boolean,
      default: false
    },
    featureInfo: {
      type: Boolean,
      default: false
    },
    pathControls: {
      type: Boolean,
      default: true
    },
    searchable: {
      type: Boolean,
      default: false
    },
    /**
     * Initial species for the flatmap.
     * This value will be ignored if a valid state object is provided.
     */
    initial: {
      type: String,
      default: ""
    },
    minZoom: {
      type: Number,
      default: 4
    },
    renderAtMounted: {
      type: Boolean,
      default: false
    },
    helpMode: {
      type: Boolean,
      default: false
    },
    displayMinimap: {
      type: Boolean,
      default: false
    },
    warningMessage: {
      type: String,
      default: "Beta feature - under active development"
    },
    availableSpecies: {
      type: Object,
      default: function() { return {} }
    },
    /**
     * State containing state of the flatmap.
     */
    state: {
      type: Object,
      default: undefined,
    },
    /**
     * Specify the endpoint of the flatmap server.
     */
    flatmapAPI: {
      type: String,
      default: "https://mapcore-demo.org/flatmaps/"
    },
  },
  data: function() {
    return {
      activeSpecies: undefined,
      appendToBody: false,
      speciesList: {}
    };
  },
  watch: {
    state: {
      handler: function(state) {
        this.setState(state);
      },
      immediate: true,
      deep: true,
    }
  },
  mounted: function() {
    fetch(this.flatmapAPI)
    .then(response => response.json())
    .then(data => {
      Object.keys(this.availableSpecies).forEach(key => {
        for (let i = 0; i < data.length; i++) {
          if (data[i].describes == this.availableSpecies[key].taxo) {
            this.speciesList[key] = this.availableSpecies[key];
            break;
          }
        }
      });
      if (!this.state) {
        if (this.initial && this.speciesList[this.initial] !== undefined) {
          this.activeSpecies = this.initial;
        } else {
          this.activeSpecies = Object.keys(this.speciesList)[0];
        }
        Vue.nextTick(() => {
          this.$refs[this.activeSpecies][0].createFlatmap();
        });
      }
    });
  },
  methods: {
    FlatmapSelected: function(resource) {
      this.$emit("resource-selected", resource);
    },
    FlatmapReady: function(component) {
      this.$emit("ready", component);
    },
    getCoordinatesOfLastClick: function() {
      const flatmap = this.$refs[this.activeSpecies];
      if (flatmap && flatmap[0]) {
        return flatmap[0].getCoordinatesOfLastClick();
      }
      return undefined;
    },
    getCurrentFlatmap: function() {
      return this.$refs[this.activeSpecies][0];
    },
    showPopup: function(featureId, node, options) {
      let map = this.getCurrentFlatmap();
      map.showPopup(featureId, node, options);
    },
    showMarkerPopup: function(featureId, node, options) {
      let map = this.getCurrentFlatmap();
      map.showMarkerPopup(featureId, node, options);
    },
    flatmapChanged: function(species){
      if (this.activeSpecies != species) 
        this.activeSpecies = species;
      this.$refs[this.activeSpecies][0].createFlatmap();
      this.$emit('flatmapChanged', this.activeSpecies);
    },
        /**
     * Function used for getting the current states of the scene. This exported states 
     * can be imported using the importStates method.
     * 
     * @public
     */
    getState: function() {
      let state = {
        species: this.activeSpecies,
        state: undefined,
      };
      let map = this.getCurrentFlatmap();
      state.state = map.getState();
      return state;
    },
    /**
     * Function used for importing the states of the scene. This exported states 
     * can be imported using the read states method.
     * 
     * @public
     */
    setState: function(state) {
      if (state) {
        if (state.species && state.species !== this.activeSpecies) {
          this.activeSpecies = state.species;
          if (state.state) {
            //Wait for next tick when the refs are ready for rendering
            this.$nextTick(() => {
              this.$refs[this.activeSpecies][0].createFlatmap(state.state);
              this.$emit('flatmapChanged', this.activeSpecies);
            })
          }
        } else if (state.state) {
          let map = this.getCurrentFlatmap();
          map.setState(state.state);
        }
      }
    },
  }
};
</script>

<style scoped src="../styles/purple/select.css">
</style>
<style scoped src="../styles/purple/option.css">
</style>

<style scoped>
.multi-container {
  height: 100%;
  width: 100%;
}

.species-display-text {
  width: 47px;
  height: 20px;
  color: rgb(48, 49, 51);
  font-size: 14px;
  font-weight: normal;
  line-height: 20px;
  left:24px;
  top:16px;
  position: absolute;
}

.select-box {
  width: 120px;
  border-radius: 4px;
  border: 1px solid rgb(144, 147, 153);
  background-color: var(--white);
  font-weight: 500;
  color:rgb(48, 49, 51);;
  left: 16px;
  top: 44px;
  position: absolute;
}

.select-box >>> .el-input__inner {
  color: rgb(48, 49, 51);
  padding-top: 0.25em;
}

.select-box >>> .is-focus .el-input__inner {
  border: 1px solid #8300bf;
}

.flatmap_dropdown .el-select-dropdown__item {
  white-space: nowrap;
  text-align: left;

}

.flatmap_dropdown .el-select-dropdown__item.selected {
  color: #8300bf;
  font-weight: normal;
}

>>>.flatmap-popper {
  padding: 6px 4px;
  font-size:12px;
  color: rgb(48, 49, 51);
  background-color: #f3ecf6;
  border: 1px solid rgb(131, 0, 191);
  white-space: nowrap;
  min-width: unset;
}
>>> .flatmap-popper.right-popper .popper__arrow{
  border-right-color: #8300bf !important;
}

>>> .flatmap-popper.right-popper .popper__arrow:after{
  border-right-color: #f3ecf6 !important;
}
</style>


