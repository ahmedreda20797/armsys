// ══════════════════════════════════════════════════════════════
//  AI Tool layer — public barrel (Phase 6.4, spec §12/§13)
// ══════════════════════════════════════════════════════════════

export type {
  AIToolCategory,
  AIToolCaller,
  AIToolDefinition,
  AIToolArgsValidation,
  AIToolPermissionRequirement,
  AIToolExecutionOutcome,
} from './types';
export { ENABLED_TOOL_CATEGORIES } from './types';
export { AI_TOOLS, getAITool, listAITools } from './registry';
export { executeAITool } from './runtime';
export { verifyPermissionForUser, type ToolPermissionCheck } from './permission-check';
