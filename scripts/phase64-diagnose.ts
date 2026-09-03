// ══════════════════════════════════════════════════════════════
//  Phase 6.4 §3 — structured diagnostic of the reported AI failure
//  ("تشغيل التحليل الذكي" → "التحليل الذكي غير متاح حاليًا")
//
//  Prints SAFE diagnostics ONLY — boolean flags, stable problem
//  codes and status names. NEVER prints any secret value (keys,
//  passwords, Firebase creds). Run: npx tsx scripts/phase64-diagnose.ts
// ══════════════════════════════════════════════════════════════

import { readAISafeDiagnostics } from '../src/lib/ai/provider/config';
import { runProviderHealthCheck } from '../src/lib/ai/provider/health';
import { aiFailureHeading } from '../src/components/pages/quality-kpi/smart-report/ai-view';

const env = process.env;
const has = (name: string) => Boolean((env[name] ?? '').trim());

async function main(): Promise<void> {
  const diagnostics = readAISafeDiagnostics(env);
  const health = await runProviderHealthCheck(env);

  const result = {
    environment: {
      AI_ENABLED_set: has('AI_ENABLED'),
      AI_PROVIDER_set: has('AI_PROVIDER'),
      AI_MODEL_set: has('AI_MODEL'),
      AI_API_KEY_set: has('AI_API_KEY'),
      AI_TIMEOUT_MS_set: has('AI_TIMEOUT_MS'),
      JWT_SECRET_set: has('JWT_SECRET'),
      FIREBASE_PROJECT_ID_set: has('FIREBASE_PROJECT_ID'),
      FIREBASE_PRIVATE_KEY_set: has('FIREBASE_PRIVATE_KEY'),
      FIREBASE_DATABASE_URL_set: has('FIREBASE_DATABASE_URL'),
    },
    gatewayDiagnostics: {
      aiEnabled: diagnostics.aiEnabled,
      providerId: diagnostics.providerId,
      providerKnown: diagnostics.providerKnown,
      modelConfigured: diagnostics.modelConfigured,
      apiKeyConfigured: diagnostics.apiKeyConfigured,
      configurationState: diagnostics.configurationState,
      configurationProblems: diagnostics.configurationProblems,
    },
    health: {
      status: health.status,
      attempted: health.attempted,
      errorCategory: health.errorCategory,
    },
    uiMapping: {
      legacyStatusEnvelope: 'AI_UNAVAILABLE',
      userVisibleHeading: aiFailureHeading('AI_UNAVAILABLE'),
      gatewayCategoryBehindIt: diagnostics.aiEnabled ? 'MISCONFIGURED' : 'DISABLED',
    },
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch(() => process.exit(1));
