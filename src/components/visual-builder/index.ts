/**
 * Universal Visual Builder Framework — Public API (V1 + V2)
 * Reusable across: Workflow Designer, Rules Designer, Org Chart, Decision Tree, AI Agent Builder, etc.
 */

// ── V1 Engine ───────────────────────────────────────────────────────────
export type {
  VBNodeStatus, VBConnectionType, VBPosition, VBNodePort,
  VBNodeDefinition, VBNode, VBEdge, VBValidationResult,
  VBValidationError, VBValidationWarning, VBHistoryEntry, VBViewport, VBCanvasConfig,
} from './engine/types';
export { validateGraph, getNodeValidationErrors } from './engine/validationEngine';
export { useHistoryManager } from './engine/historyManager';
export { autoLayout } from './engine/layoutEngine';

// ── V2 Engine (authoring) ───────────────────────────────────────────────
export type {
  VBWorkflowDocumentation, VBWorkflowRecord, VBWorkflowFolder,
  VBExprNode, VBExprCondition, VBExprGroup,
  VBEdgeKind, VBEdgeData,
  VBVariableSource, VBVariableEntry,
  VBNodeConfig, VBInputMapping, VBAssignment, VBNodePermissions, VBRetryPolicy,
  VBErrorStrategy,
  VBNodeTemplate, VBWorkflowTemplate,
  VBWorkflowVersion, VBVersionStatus,
  VBValidationIssue, VBValidationCode, VBValidationSeverity,
  VBValidationReport, VBWorkflowMetrics,
  VBSimulationState, VBSimulationFrame, VBSimulationStatus,
  VBExecutionStep,
  VBSearchKind, VBSearchResult,
  VBFieldType, VBFormField, VBConfigSchema,
} from './engine/v2-types';
export {
  isExprGroup, isExprCondition, emptyExprGroup, emptyExprCondition, defaultNodeConfig,
} from './engine/v2-types';

export {
  validateGraphV2, computeExecutionOrder, computeMetrics, computeDepth,
} from './engine/v2-validation';

export {
  buildSimulation, evalExpression, initialSimState,
  stepForward, stepBack, restartSim, runSim, pauseSim,
} from './engine/v2-simulation';

export {
  VARIABLE_SOURCES, NODE_TEMPLATES, WORKFLOW_TEMPLATES, SAMPLE_WORKFLOWS,
} from './engine/v2-catalogs';

export { CONFIG_SCHEMAS, getConfigSchema } from './engine/v2-config-schemas';

// ── Nodes ───────────────────────────────────────────────────────────────
export { WORKFLOW_NODE_DEFINITIONS, NODE_CATEGORIES, NODE_DEF_MAP } from './nodes/nodeDefinitions';
export { WorkflowNodeRenderer, nodeTypes } from './nodes/WorkflowNodeRenderer';

// ── Canvas ──────────────────────────────────────────────────────────────
export { WorkflowCanvas } from './canvas/WorkflowCanvas';

// ── Toolbar ──────────────────────────────────────────────────────────────
export { DesignerToolbar } from './toolbar/DesignerToolbar';

// ── Panels (V1) ──────────────────────────────────────────────────────────
export { NodeLibraryPanel } from './panels/NodeLibraryPanel';
export { PropertiesPanel } from './panels/PropertiesPanel';

// ── Panels (V2) ──────────────────────────────────────────────────────────
export { DynamicConfigForm } from './panels/DynamicConfigForm';
export { ExpressionBuilder } from './panels/ExpressionBuilder';
export { VariablePicker } from './panels/VariablePicker';
export { NodeInspectorV2 } from './panels/NodeInspectorV2';
export { EdgeInspector } from './panels/EdgeInspector';
export { WorkflowExplorer } from './panels/WorkflowExplorer';
export { WorkflowOutline } from './panels/WorkflowOutline';
export { SearchEverywhere } from './panels/SearchEverywhere';
export { VersionManager } from './panels/VersionManager';
export { TemplateLibrary } from './panels/TemplateLibrary';
export { NodeTemplateLibrary } from './panels/NodeTemplateLibrary';
export { SaveNodeTemplateDialog } from './panels/SaveNodeTemplateDialog';
export { DocumentationPanel } from './panels/DocumentationPanel';
export { SimulationPanel } from './panels/SimulationPanel';
