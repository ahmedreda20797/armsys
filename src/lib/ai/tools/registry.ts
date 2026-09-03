// ══════════════════════════════════════════════════════════════
//  AI Tool layer — registry (Phase 6.4, spec §12)
//
//  ONE declarative place listing every controlled ARM tool. Phase
//  6.4 implements ONLY the tools needed to verify this phase (§12:
//  "implement only the tools required to verify this phase"):
//
//    searchARM               — reuse the EXISTING global search (§34)
//    getEmployeeProfile      — minimal identity facts (scoped)
//    getQualityObservations  — scoped observation summary (minimal)
//    getCurrentPeriod        — current month + closure state
//
//  Every entry is READ_ONLY. Write categories are structurally
//  impossible to enable until ENABLED_TOOL_CATEGORIES changes AND
//  explicit human-confirmation flows exist (§13).
// ══════════════════════════════════════════════════════════════

import type { AIToolDefinition } from './types';
import { searchARMTool } from './definitions/search-arm';
import { getEmployeeProfileTool } from './definitions/get-employee-profile';
import { getQualityObservationsTool } from './definitions/get-quality-observations';
import { getCurrentPeriodTool } from './definitions/get-current-period';

export const AI_TOOLS: Record<string, AIToolDefinition<never, never>> = {
  searchARM: searchARMTool as unknown as AIToolDefinition<never, never>,
  getEmployeeProfile: getEmployeeProfileTool as unknown as AIToolDefinition<never, never>,
  getQualityObservations: getQualityObservationsTool as unknown as AIToolDefinition<never, never>,
  getCurrentPeriod: getCurrentPeriodTool as unknown as AIToolDefinition<never, never>,
};

export function getAITool(name: string): AIToolDefinition<never, never> | null {
  return AI_TOOLS[name] ?? null;
}

/** Safe tool catalog for planners/audit — names, categories, Arabic
 *  descriptions. Never any data or credentials. */
export function listAITools(): Array<{ name: string; category: string; description: string }> {
  return Object.values(AI_TOOLS).map((tool) => ({
    name: tool.name,
    category: tool.category,
    description: tool.description,
  }));
}
