// ══════════════════════════════════════════════════════════════
//  Phase 6.5-A §7 — RAW provider response diagnostic (MANUAL ONLY)
//
//  Sends the REAL production payload through the EXACT request shape
//  the Gemini adapter uses (same endpoint, same headers, same
//  generationConfig — NO thinkingConfig, since the adapter does not
//  send one) and reports SAFE RESPONSE METADATA ONLY:
//    httpStatus · latency · finishReason · usage token counts ·
//    text length · JSON-parseability · masked structure markers ·
//    the strict-validator verdict.
//
//  It NEVER prints: the payload, the response text content, the API
//  key, or any credential. This is a diagnostic probe for the
//  maxOutputTokens/thinking-budget question — it changes nothing in
//  the production path.
//
//  Run: PHASE65_REAL_FIREBASE not required; needs AI_* + FIREBASE_*
//       (from .env/.env.local) and the real employee context:
//    npx tsx scripts/phase65-provider-diag.ts
//    (PHASE65_EMPLOYEE_CODE / PHASE65_EMPLOYEE_NAME / PHASE65_MONTH
//     overridable — same defaults as phase65-verify-gemini.ts)
// ══════════════════════════════════════════════════════════════

import * as fs from 'node:fs';
import * as path from 'node:path';

function loadLocalEnvFiles(): void {
  const projectRoot = typeof __dirname !== 'undefined'
    ? path.resolve(__dirname, '..')
    : process.cwd();
  for (const fileName of ['.env', '.env.local']) {
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(projectRoot, fileName), 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}
loadLocalEnvFiles();

function stage(label: string): void {
  console.error(`[phase65-diag] ${new Date().toISOString()} — ${label}`);
}

/** Masked structure preview: non-ASCII (Arabic content) → '□', so no
 *  ARM content is ever printed — only the JSON SKELETON is visible. */
function maskedStructure(text: string, head: number, tail: number): Record<string, unknown> {
  const mask = (s: string): string =>
    s.replace(/[^\x20-\x7E]/g, '□').replace(/[A-Za-z0-9+/=]{12,}/g, (m) => `${m.slice(0, 8)}…`);
  return {
    length: text.length,
    startsWithFence: text.trimStart().startsWith('```'),
    startsWithBrace: text.trimStart().startsWith('{'),
    endsWithBrace: text.trimEnd().endsWith('}'),
    head: mask(text.slice(0, head)),
    tail: mask(text.slice(-tail)),
  };
}

interface RawGenerationResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown }> };
    finishReason?: unknown;
  }>;
  usageMetadata?: {
    promptTokenCount?: unknown;
    candidatesTokenCount?: unknown;
    thoughtsTokenCount?: unknown;
    totalTokenCount?: unknown;
  };
  modelVersion?: unknown;
  responseId?: unknown;
  error?: { code?: unknown; status?: unknown; message?: unknown };
}

async function rawGenerateContent(args: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userContent: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
}): Promise<{
  httpStatus: number | null;
  latencyMs: number;
  finishReason: string | null;
  text: string | null;
  usage: Record<string, number | null>;
  modelVersion: string | null;
  errorStatus: string | null;
  errorSafeReason: string | null;
}> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': args.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: args.systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: args.userContent }] }],
          generationConfig: {
            temperature: args.temperature,
            maxOutputTokens: args.maxOutputTokens,
          },
        }),
        signal: controller.signal,
      },
    );
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      let errorStatus: string | null = null;
      let errorSafeReason: string | null = null;
      try {
        const body = (await response.json()) as RawGenerationResponse;
        errorStatus = typeof body.error?.status === 'string' ? body.error.status : null;
        const msg = typeof body.error?.message === 'string' ? body.error.message : '';
        errorSafeReason = msg ? msg.slice(0, 160) : null;
      } catch { /* safe degradation */ }
      return { httpStatus: response.status, latencyMs, finishReason: null, text: null, usage: {}, modelVersion: null, errorStatus, errorSafeReason };
    }
    const body = (await response.json()) as RawGenerationResponse;
    const parts = body.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
      ? parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('') || null
      : null;
    const usage = body.usageMetadata ?? {};
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
      httpStatus: response.status,
      latencyMs,
      finishReason: typeof body.candidates?.[0]?.finishReason === 'string' ? body.candidates[0].finishReason : null,
      text,
      usage: {
        promptTokenCount: num(usage.promptTokenCount),
        candidatesTokenCount: num(usage.candidatesTokenCount),
        thoughtsTokenCount: num(usage.thoughtsTokenCount),
        totalTokenCount: num(usage.totalTokenCount),
      },
      modelVersion: typeof body.modelVersion === 'string' ? body.modelVersion : null,
      errorStatus: null,
      errorSafeReason: null,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      httpStatus: null,
      latencyMs: Date.now() - startedAt,
      finishReason: aborted ? 'CLIENT_TIMEOUT' : null,
      text: null,
      usage: {},
      modelVersion: null,
      errorStatus: aborted ? 'CLIENT_TIMEOUT' : 'NETWORK',
      errorSafeReason: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const { isValidMonthKey } = await import('../src/lib/month-utils');
  const { getAll } = await import('../src/lib/db');
  const { getEmployeePerformanceDataset } = await import('../src/lib/performance-intelligence');
  const { runEmployeeAnalytics } = await import('../src/lib/analytics/service');
  const { buildQualityAIAnalysisInput } = await import('../src/lib/ai/quality/input-builder');
  const { QUALITY_AI_SYSTEM_PROMPT, buildQualityAIUserContent } = await import('../src/lib/ai/quality/prompt');
  const { validateQualityAIOutput } = await import('../src/lib/ai/quality/validate');
  const { QUALITY_AI_MAX_OUTPUT_TOKENS } = await import('../src/lib/ai/quality');
  const { resolveRealEmployee } = await import('../src/lib/ai/quality/verification');

  const UI_CODE = process.env.PHASE65_EMPLOYEE_CODE?.trim() || 'EMP-040';
  const UI_NAME = process.env.PHASE65_EMPLOYEE_NAME?.trim() || 'أحمد الطبيبي';
  const UI_MONTH = process.env.PHASE65_MONTH?.trim() || '2026-08';
  const MODEL = process.env.AI_MODEL?.trim() || 'gemini-3.6-flash';
  const API_KEY = (process.env.AI_API_KEY ?? '').trim();
  if (!API_KEY) throw new Error('AI_API_KEY missing');

  stage('building the REAL production payload (Firebase + analytics + input builder)');
  const employees = await getAll<{ id: string; code?: string; name?: string }>('employees');
  const resolved = resolveRealEmployee(employees, { code: UI_CODE, name: UI_NAME });
  if (!resolved) throw new Error(`employee not found for ${UI_CODE}/${UI_NAME}`);
  if (!isValidMonthKey(UI_MONTH)) throw new Error(`invalid month ${UI_MONTH}`);
  const dataset = await getEmployeePerformanceDataset({
    employeeId: resolved.employeeId,
    monthKey: UI_MONTH,
    windowMonths: 6,
    minOccurrences: 2,
  });
  if (!dataset) throw new Error('dataset null');
  const analyticsOutcome = await runEmployeeAnalytics(dataset);
  if (!analyticsOutcome.ok) throw new Error(`analytics ${analyticsOutcome.reason}`);
  const built = buildQualityAIAnalysisInput(dataset, analyticsOutcome.result, null);
  if (built.kind !== 'READY') throw new Error(`input builder ${built.kind}`);
  const payloadJson = JSON.stringify(built.payload);
  const userContent = buildQualityAIUserContent(payloadJson);
  stage(`payload ready (${Buffer.byteLength(payloadJson, 'utf8')} bytes) — calling RAW generateContent at identical config`);

  const report: Record<string, unknown> = {
    diag: 'phase65-provider-response-diagnostic',
    employee: { canonicalEmployeeId: resolved.employeeId, code: resolved.code, matchedBy: resolved.matchedBy },
    month: UI_MONTH,
    model: MODEL,
    request: {
      systemPromptChars: QUALITY_AI_SYSTEM_PROMPT.length,
      userContentBytes: Buffer.byteLength(userContent, 'utf8'),
      temperature: 0.2,
      // NO thinkingConfig — byte-identical to the production adapter body.
      thinkingConfigSent: false,
    },
    variants: [] as unknown[],
  };

  // Same validation gate the service applies, applied to each raw text.
  for (const maxOutputTokens of [1600, 4096, QUALITY_AI_MAX_OUTPUT_TOKENS]) {
    stage(`variant maxOutputTokens=${maxOutputTokens} — calling provider (bounded 90s)`);
    const result = await rawGenerateContent({
      apiKey: API_KEY,
      model: MODEL,
      systemPrompt: QUALITY_AI_SYSTEM_PROMPT,
      userContent,
      temperature: 0.2,
      maxOutputTokens,
      timeoutMs: 90_000,
    });
    let jsonParses: boolean | null = null;
    let parseErrorName: string | null = null;
    let validationReason: string | null = null;
    let validationOk: boolean | null = null;
    if (result.text !== null && result.text.length > 0) {
      try {
        JSON.parse(result.text);
        jsonParses = true;
      } catch (error) {
        jsonParses = false;
        parseErrorName = error instanceof Error ? error.name : 'unknown';
      }
      const validated = validateQualityAIOutput(result.text, built.payload);
      validationOk = validated.ok;
      validationReason = validated.ok ? null : validated.reason;
    }
    (report.variants as unknown[]).push({
      maxOutputTokens,
      httpStatus: result.httpStatus,
      latencyMs: result.latencyMs,
      finishReason: result.finishReason,
      usage: result.usage,
      textStats: result.text === null ? null : maskedStructure(result.text, 24, 24),
      jsonParses,
      parseErrorName,
      strictValidation: { ok: validationOk, reason: validationReason },
      errorStatus: result.errorStatus,
      errorSafeReason: result.errorSafeReason,
    });
    if (result.text === null || result.text.length === 0) {
      stage(`variant maxOutputTokens=${maxOutputTokens} — EMPTY text (finishReason=${result.finishReason})`);
    } else {
      stage(`variant maxOutputTokens=${maxOutputTokens} — done (${result.latencyMs}ms, json=${jsonParses})`);
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ diag: 'phase65-provider-response-diagnostic', crashed: true, error: error instanceof Error ? error.message : 'unknown' }));
  process.exit(1);
});
