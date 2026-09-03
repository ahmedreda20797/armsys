// ══════════════════════════════════════════════════════════════
//  GET /api/ai/diagnostics — SAFE AI diagnostics (Phase 6.4, §3/§6)
//
//  Admin-only (role === 'admin' — the existing ARM administrator
//  definition, §6). Answers "WHY is the AI not working?" with SAFE
//  fields ONLY (§3):
//    providerConfigured / modelConfigured / apiKeyConfigured /
//    configurationState / configurationProblems / registry metadata.
//  NEVER returns: key values, endpoints with credentials, raw env.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/verify-permission';
import { forbiddenError, internalError, logServerFailure, unauthorizedError } from '@/lib/api-error';
import { readAISafeDiagnostics } from '@/lib/ai/provider/config';
import { listProviderDefinitions } from '@/lib/ai/provider/registry';
import { getAIProviderSettings, isAdminRole, type AIProviderSettings } from '@/lib/ai/gateway/provider-settings';
import { listAITools } from '@/lib/ai/tools/registry';
import { AI_READ_ONLY } from '@/lib/ai/governance';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();
    if (!isAdminRole(auth.role)) return forbiddenError('هذه الصلاحية للمدير النظامي فقط');

    const diagnostics = readAISafeDiagnostics();
    let settings: AIProviderSettings | null = null;
    try {
      settings = await getAIProviderSettings();
    } catch {
      settings = null; // settings store unavailable — env-only diagnostics remain valid
    }

    return Response.json({
      status: 'OK',
      diagnostics: {
        aiEnabled: diagnostics.aiEnabled,
        providerConfigured: diagnostics.providerKnown && diagnostics.providerId !== null,
        providerId: diagnostics.providerId,
        providerKnown: diagnostics.providerKnown,
        modelConfigured: diagnostics.modelConfigured,
        apiKeyConfigured: diagnostics.apiKeyConfigured,
        baseUrlOverridden: diagnostics.baseUrlOverridden,
        timeoutMs: diagnostics.timeoutMs,
        configurationState: diagnostics.configurationState,
        configurationProblems: diagnostics.configurationProblems,
      },
      settings: {
        provider: settings?.provider ?? null,
        model: settings?.model ?? null,
        updatedAt: settings?.updatedAt ?? null,
        updatedByName: settings?.updatedByName ?? null,
      },
      registry: listProviderDefinitions().map((definition) => ({
        id: definition.id,
        displayName: definition.displayName,
        capabilities: definition.capabilities,
        requirements: {
          credentialEnvVars: definition.requirements.credentialEnvVars,
          requiresApiKey: definition.requirements.requiresApiKey,
          requiresExplicitModel: definition.requirements.requiresExplicitModel,
          modelSource: definition.requirements.modelSource,
          supportsBaseUrlOverride: definition.requirements.supportsBaseUrlOverride,
        },
      })),
      tools: listAITools(),
      governance: { readOnly: AI_READ_ONLY },
    });
  } catch (error) {
    logServerFailure('ai-diagnostics', 'GET', error);
    return internalError();
  }
}
