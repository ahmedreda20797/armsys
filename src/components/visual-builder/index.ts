/**
 * Universal Visual Builder Framework — Public API
 * Reusable across: Workflow Designer, Rules Designer, Org Chart, Decision Tree, AI Agent Builder, etc.
 */

// Engine
export type {
  VBNodeStatus,
  VBConnectionType,
  VBPosition,
  VBNodePort,
  VBNodeDefinition,
  VBNode,
  VBEdge,
  VBValidationResult,
  VBValidationError,
  VBValidationWarning,
  VBHistoryEntry,
  VBViewport,
  VBCanvasConfig,
} from './engine/types';

export { validateGraph, getNodeValidationErrors } from './engine/validationEngine';
export { useHistoryManager } from './engine/historyManager';
export { autoLayout } from './engine/layoutEngine';

// Nodes
export { WORKFLOW_NODE_DEFINITIONS, NODE_CATEGORIES, NODE_DEF_MAP } from './nodes/nodeDefinitions';
export { WorkflowNodeRenderer, nodeTypes } from './nodes/WorkflowNodeRenderer';

// Canvas
export { WorkflowCanvas } from './canvas/WorkflowCanvas';

// Toolbar
export { DesignerToolbar } from './toolbar/DesignerToolbar';

// Panels
export { NodeLibraryPanel } from './panels/NodeLibraryPanel';
export { PropertiesPanel } from './panels/PropertiesPanel';
