// Shared mutable state for the Annotate2DSpaces frontend (ES module friendly)
export const S = {
  projects: [],
  cur: null,
  mode: 'select',
  zoom: 1,
  panX: 0,
  panY: 0,
  selId: null,
  spaces: {},
  dirty: false,
  undoStack: [],
  redoStack: [],
  _skipSnapshot: false,
  panelFocus: false,
  propertyPanelMode: false,  // When true, only selected space is interactable (Ctrl+P)
};

export const AI = {
  open: false,
  messages: [],
  focusSpaceId: null,
  sending: false,
  currentProjectName: null,
  contextMode: 'file',
  chatMode: 'local',
  ggufModel: '',     // relative key of the selected GGUF model (e.g. "qwen/qwen.gguf")
};

export const SQ = { open: false, presets: [], contextMode: 'file' };

export let ENVS = {};
export let RESOURCES = [];
export let selectedEnvId = null;
export const selectedFileIds = new Set();
export let lastClickedFileId = null;
export let _renderedFileOrder = [];
export const collapsedEnvs = new Set();

export function setEnvs(val) {
  ENVS = val || {};
}

export function setResources(val) {
  RESOURCES = val || [];
}

export function setSelectedEnvId(val) {
  selectedEnvId = val;
}

export function setLastClickedFileId(val) {
  lastClickedFileId = val;
}

export function setRenderedFileOrder(val) {
  _renderedFileOrder = Array.isArray(val) ? val : [];
}
