/**
 * Universal Visual Builder Framework — Core Types
 * Reusable across: Workflow Designer, Rules Designer, Org Chart, Decision Tree, AI Agent Builder, etc.
 * The Workflow Designer is the first consumer.
 */

export type VBNodeStatus = 'idle' | 'active' | 'error' | 'warning' | 'success' | 'disabled';
export type VBConnectionType = 'default' | 'conditional' | 'error' | 'success' | 'loop';

export interface VBPosition { x: number; y: number; }

export interface VBNodePort {
  id: string;
  label: string;
  type: 'input' | 'output';
  connectionType?: VBConnectionType;
  maxConnections?: number;
}

export interface VBNodeDefinition {
  type: string;
  category: string;
  label: string;
  description: string;
  icon: string;
  color: string;          // tailwind bg class
  ports: VBNodePort[];
  defaultData?: Record<string, unknown>;
  isSingleton?: boolean;  // e.g. Start node — only one allowed
}

export interface VBNode {
  id: string;
  type: string;
  position: VBPosition;
  data: {
    definition: VBNodeDefinition;
    label: string;
    description?: string;
    status: VBNodeStatus;
    config: Record<string, unknown>;
    validationErrors: string[];
    executionCount?: number;
  };
  selected?: boolean;
}

export interface VBEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: VBConnectionType;
  label?: string;
  animated?: boolean;
  data?: Record<string, unknown>;
}

export interface VBValidationResult {
  valid: boolean;
  errors: VBValidationError[];
  warnings: VBValidationWarning[];
}

export interface VBValidationError {
  nodeId?: string;
  edgeId?: string;
  code: string;
  message: string;
}

export interface VBValidationWarning {
  nodeId?: string;
  code: string;
  message: string;
}

export interface VBHistoryEntry {
  nodes: VBNode[];
  edges: VBEdge[];
  timestamp: number;
}

export interface VBViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface VBCanvasConfig {
  snapToGrid: boolean;
  gridSize: number;
  showGrid: boolean;
  showMinimap: boolean;
  showBackground: 'dots' | 'lines' | 'none';
  darkMode: boolean;
}
