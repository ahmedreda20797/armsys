/**
 * Universal Visual Builder — Engine barrel export (V1 + V2)
 */

// V1
export * from './types';
export { validateGraph, getNodeValidationErrors } from './validationEngine';
export { useHistoryManager } from './historyManager';
export { autoLayout } from './layoutEngine';

// V2 Authoring types
export * from './v2-types';
// V2 engines
export {
  validateGraphV2, computeExecutionOrder, computeMetrics, computeDepth,
} from './v2-validation';
export {
  buildSimulation, evalExpression, initialSimState,
  stepForward, stepBack, restartSim, runSim, pauseSim,
} from './v2-simulation';
export {
  VARIABLE_SOURCES, NODE_TEMPLATES, WORKFLOW_TEMPLATES, SAMPLE_WORKFLOWS,
} from './v2-catalogs';
export { CONFIG_SCHEMAS, getConfigSchema } from './v2-config-schemas';
export {
  subscribe, getAllTemplates, getFavorites, isFavorite, toggleFavorite,
  saveTemplate, cloneTemplate, incrementUsage, deleteTemplate,
  searchTemplates, getCategories,
} from './v2-node-template-store';
