/**
 * Universal Visual Builder — V2 Authoring Types
 * Extends V1 engine types for Enterprise Workflow Authoring Platform.
 * NON-DESTRUCTIVE: V1 types remain intact in ./types.ts.
 *
 * Covers: Documentation, Node Inspector V2, Dynamic Forms, Variable Picker,
 * Expression Builder, Edge Inspector, Templates, Versions, Validation V2,
 * Simulation, Execution Preview, Outline, Search, Analytics.
 */

import type {
  WorkflowModule,
  WorkflowStatus,
  VariableType,
  VariableScope,
  ActionType,
  TriggerType,
  ConditionOperator,
  ConditionLogic,
  WorkflowConditionNode,
  WorkflowVariable,
  WorkflowPermissions,
} from '@/workflow/types';
import type { VBNode, VBEdge, VBNodeDefinition, VBValidationResult } from './types';

// Re-export V1 types so consumers can import everything from v2-types
export type { VBNode, VBEdge, VBNodeDefinition, VBValidationResult } from './types';
export type { VariableType, VariableScope } from '@/workflow/types';

/* ════════════════════════════════════════════════════════════════════════
   PART 2 — WORKFLOW DOCUMENTATION
   ════════════════════════════════════════════════════════════════════════ */

export interface VBWorkflowDocumentation {
  purpose: string;
  description: string;
  ownerId: string;
  ownerName: string;
  businessUnit: string;
  department: string;
  tags: string[];
  versionNotes: string;
  relatedModules: WorkflowModule[];
  businessImpact: 'low' | 'medium' | 'high' | 'critical';
  estimatedRuntimeMs: number;
  complexity: 'low' | 'medium' | 'high' | 'very_high';
}

/* ════════════════════════════════════════════════════════════════════════
   PART 1 — WORKFLOW EXPLORER (Workflow metadata record)
   ════════════════════════════════════════════════════════════════════════ */

export type VBWorkflowFolder = 'draft' | 'published' | 'archived' | 'favorites' | 'recent';

export interface VBWorkflowRecord {
  id: string;
  name: string;
  description: string;
  module: WorkflowModule;
  category: string;
  ownerId: string;
  ownerName: string;
  status: WorkflowStatus;
  folder: VBWorkflowFolder;
  tags: string[];
  favorite: boolean;
  currentVersion: number;
  publishedVersion: number | null;
  nodeCount: number;
  documentation: VBWorkflowDocumentation;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 6 — EXPRESSION BUILDER
   ════════════════════════════════════════════════════════════════════════ */

export type VBExprNodeType = 'condition' | 'group';

export interface VBExprCondition {
  id: string;
  type: 'condition';
  field: string;          // variable path, e.g. "employee.name"
  operator: ConditionOperator;
  value: unknown;
  valueTo?: unknown;      // for "between"
}

export interface VBExprGroup {
  id: string;
  type: 'group';
  logic: ConditionLogic;  // and | or | not
  children: VBExprNode[];
}

export type VBExprNode = VBExprCondition | VBExprGroup;

/* ════════════════════════════════════════════════════════════════════════
   PART 7 — EDGE INSPECTOR (rich edge data)
   ════════════════════════════════════════════════════════════════════════ */

export type VBEdgeKind = 'default' | 'success' | 'error' | 'timeout' | 'conditional';

export interface VBEdgeData {
  label: string;
  description: string;
  documentation: string;
  kind: VBEdgeKind;
  condition?: VBExprNode;        // when this path is taken
  priority: number;              // execution order
  executionOrder: number;
  status: 'active' | 'disabled' | 'draft';
}

/* ════════════════════════════════════════════════════════════════════════
   PART 5 — VARIABLE PICKER (catalog of available variables)
   ════════════════════════════════════════════════════════════════════════ */

export interface VBVariableSource {
  id: string;
  label: string;
  labelAr: string;
  icon: string;
  variables: VBVariableEntry[];
}

export interface VBVariableEntry {
  id: string;
  name: string;           // dot path, e.g. "employee.department"
  label: string;
  labelAr: string;
  type: VariableType;
  scope: VariableScope;
  description?: string;
  source: string;         // source id
}

/* ════════════════════════════════════════════════════════════════════════
   PART 3 / 4 — NODE CONFIG (extended node data carrying full authoring)
   ════════════════════════════════════════════════════════════════════════ */

export interface VBNodeConfig {
  // General
  label: string;
  description: string;
  // Dynamic per-type configuration (PART 4)
  config: Record<string, unknown>;
  // Conditions / expressions (PART 6)
  condition?: VBExprNode;
  // Inputs / outputs mapping (PART 5)
  inputs: VBInputMapping[];
  outputVariable?: string;
  // Assignments
  assignment?: VBAssignment;
  // Permissions
  permissions?: VBNodePermissions;
  // Retry policy
  retryPolicy?: VBRetryPolicy;
  // Timeout
  timeoutMs?: number;
  // Error handling
  onError: VBErrorStrategy;
  // Metadata
  metadata: Record<string, unknown>;
  // Documentation
  documentation: string;
}

export interface VBInputMapping {
  id: string;
  field: string;            // target config field
  source: 'variable' | 'literal' | 'expression';
  variablePath?: string;    // when source === 'variable'
  literalValue?: unknown;   // when source === 'literal'
  expression?: VBExprNode;  // when source === 'expression'
}

export interface VBAssignment {
  type: 'user' | 'role' | 'department' | 'dynamic';
  value: string;
}

export interface VBNodePermissions {
  requiredRoles: string[];
  requiredPermissions: string[];
}

export interface VBRetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
}

export type VBErrorStrategy = 'retry' | 'recover' | 'rollback' | 'skip' | 'abort' | 'escalate';

/* ════════════════════════════════════════════════════════════════════════
   PART 8 — NODE TEMPLATES
   ════════════════════════════════════════════════════════════════════════ */

export interface VBNodeTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  nodeType: string;
  config: VBNodeConfig;
  tags: string[];
  favorite: boolean;
  createdAt: string;
  createdBy: string;
  usageCount: number;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 9 — WORKFLOW TEMPLATES
   ════════════════════════════════════════════════════════════════════════ */

export interface VBWorkflowTemplate {
  id: string;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  category: string;
  module: WorkflowModule;
  icon: string;
  tags: string[];
  nodes: VBNode[];
  edges: VBEdge[];
  variables: WorkflowVariable[];
  documentation: Partial<VBWorkflowDocumentation>;
  popularity: number;
  builtIn: boolean;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 10 — VERSION MANAGER
   ════════════════════════════════════════════════════════════════════════ */

export type VBVersionStatus = 'draft' | 'published' | 'archived';

export interface VBWorkflowVersion {
  id: string;
  workflowId: string;
  version: number;
  label: string;
  status: VBVersionStatus;
  nodes: VBNode[];
  edges: VBEdge[];
  variables: WorkflowVariable[];
  changelog: string;
  nodeCount: number;
  edgeCount: number;
  createdAt: string;
  createdBy: string;
  publishedAt: string | null;
  publishedBy: string | null;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 11 — VALIDATION V2 (extended checks)
   ════════════════════════════════════════════════════════════════════════ */

export type VBValidationSeverity = 'error' | 'warning' | 'info';

export interface VBValidationIssue {
  id: string;
  severity: VBValidationSeverity;
  code: VBValidationCode;
  message: string;
  messageAr: string;
  nodeId?: string;
  edgeId?: string;
  category: 'structure' | 'variables' | 'conditions' | 'permissions' | 'performance' | 'configuration';
  fixable: boolean;
}

export type VBValidationCode =
  | 'NO_START' | 'MULTI_START' | 'NO_END' | 'DEAD_END' | 'CYCLE' | 'DISCONNECTED'
  // V2 additions
  | 'UNUSED_VARIABLE' | 'DUPLICATE_VARIABLE' | 'INVALID_MAPPING'
  | 'INFINITE_LOOP' | 'BROKEN_REFERENCE' | 'MISSING_REQUIRED_CONFIG'
  | 'INVALID_PERMISSIONS' | 'ORPHAN_NODE' | 'CIRCULAR_DEPENDENCY'
  | 'MISSING_TRIGGER' | 'MISSING_OUTPUT' | 'RETRY_WITHOUT_TIMEOUT'
  | 'UNREACHABLE_BRANCH' | 'OVERCOMPLEX';

export interface VBValidationReport extends VBValidationResult {
  issues: VBValidationIssue[];
  score: number;            // 0-100 workflow health score
  metrics: VBWorkflowMetrics;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 16 — ANALYTICS / METRICS
   ════════════════════════════════════════════════════════════════════════ */

export interface VBWorkflowMetrics {
  nodeCount: number;
  edgeCount: number;
  depth: number;             // longest path from start to end
  decisionCount: number;     // condition + switch + compare nodes
  variableCount: number;
  actionCount: number;
  estimatedComplexity: 'low' | 'medium' | 'high' | 'very_high';
  estimatedExecutionMs: number;
  validationScore: number;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 12 — SIMULATION (deterministic step-walk, no real execution)
   ════════════════════════════════════════════════════════════════════════ */

export type VBSimulationStatus = 'idle' | 'running' | 'paused' | 'stepping' | 'completed' | 'error';

export interface VBSimulationFrame {
  stepIndex: number;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: 'pending' | 'active' | 'completed' | 'skipped' | 'failed';
  edgeTaken?: string;       // edge id that was followed
  variablesSnapshot: Record<string, unknown>;
  decision?: string;        // human-readable decision made at this step
  timestamp: number;
  notes: string;
}

export interface VBSimulationState {
  status: VBSimulationStatus;
  frames: VBSimulationFrame[];
  currentFrame: number;
  executionPath: string[];  // ordered node ids
  variables: Record<string, unknown>;
  startedAt: number | null;
  finishedAt: number | null;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 13 — EXECUTION PREVIEW (static topological order)
   ════════════════════════════════════════════════════════════════════════ */

export interface VBExecutionStep {
  order: number;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  branchLabel?: string;
  isDecision: boolean;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 15 — SEARCH EVERYWHERE
   ════════════════════════════════════════════════════════════════════════ */

export type VBSearchKind =
  | 'workflow' | 'node' | 'variable' | 'condition' | 'action' | 'template' | 'version';

export interface VBSearchResult {
  id: string;
  kind: VBSearchKind;
  title: string;
  subtitle: string;
  icon: string;
  nodeId?: string;
  workflowId?: string;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 4 — DYNAMIC FORM FIELD SCHEMA
   ════════════════════════════════════════════════════════════════════════ */

export type VBFieldType =
  | 'text' | 'textarea' | 'number' | 'boolean' | 'select'
  | 'multiselect' | 'variable' | 'expression' | 'duration' | 'user' | 'role' | 'tag';

export interface VBFormField {
  key: string;
  label: string;
  labelAr: string;
  type: VBFieldType;
  required?: boolean;
  placeholder?: string;
  options?: { label: string; value: string }[];
  defaultValue?: unknown;
  helperText?: string;
  group?: string;
}

export interface VBConfigSchema {
  nodeType: string;
  title: string;
  titleAr: string;
  icon: string;
  groups: {
    id: string;
    label: string;
    labelAr: string;
    fields: VBFormField[];
  }[];
}

/* ════════════════════════════════════════════════════════════════════════
   TYPE GUARDS — Expression tree
   ════════════════════════════════════════════════════════════════════════ */

export function isExprGroup(node: VBExprNode): node is VBExprGroup {
  return node.type === 'group';
}

export function isExprCondition(node: VBExprNode): node is VBExprCondition {
  return node.type === 'condition';
}

/* ════════════════════════════════════════════════════════════════════════
   DEFAULT FACTORIES
   ════════════════════════════════════════════════════════════════════════ */

export function emptyExprGroup(logic: ConditionLogic = 'and'): VBExprGroup {
  return { id: `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, type: 'group', logic, children: [] };
}

export function emptyExprCondition(): VBExprCondition {
  return {
    id: `cnd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    type: 'condition',
    field: '',
    operator: 'equals',
    value: '',
  };
}

export function defaultNodeConfig(definition: VBNodeDefinition): VBNodeConfig {
  return {
    label: definition.label,
    description: definition.description,
    config: { ...(definition.defaultData ?? {}) },
    inputs: [],
    onError: 'abort',
    metadata: {},
    documentation: '',
  };
}
