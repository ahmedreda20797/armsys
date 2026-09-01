// Real-provider E2E probe (dev sandbox ONLY — in-memory db, zero writes).
// Proves/disproves: the full pipeline (dataset → analytics → input →
// provider HTTPS call → validation) works against a REAL LLM endpoint.
import '../src/lib/__tests__/m01-test-support';
import { resetTestData, registerFixtures, setTable } from '../src/lib/__tests__/m01-test-support';
import { getEmployeePerformanceDataset } from '../src/lib/performance-intelligence';
import { runQualityAIAnalysis } from '../src/lib/ai/quality/service';
import { ZaiProvider } from '../src/lib/ai/provider';

async function main() {
  process.env.AI_ENABLED = 'true';
  process.env.AI_PROVIDER = 'z-ai';

  resetTestData();
  await registerFixtures();
  setTable('employees', [
    { id: 'emp-real', code: 'EMP-100', name: 'موظف تجريبي', department: 'العمليات', position: 'موظف حجوزات', status: 'active' },
  ]);
  const rows = [0, 1, 2, 3, 4, 5].map((i) => ({
    id: `obs-${i + 1}`,
    employeeId: 'emp-real',
    employeeName: 'موظف تجريبي',
    categoryName: i % 2 === 0 ? 'متابعة العملاء' : 'دقة الحجز',
    categoryId: i % 2 === 0 ? 'cat-1' : 'cat-2',
    type: 'تأخير المتابعة',
    notes: `ملاحظة رقم ${i + 1}`,
    severity: i % 3 === 0 ? 'high' : 'medium',
    status: 'open',
    approvalStatus: i % 2 === 0 ? 'approved' : 'pending',
    observationDate: `${5 + i}/09/2026`,
    month: '2026-09',
  }));
  setTable('qualityObservations', rows);

  const dataset = await getEmployeePerformanceDataset({ employeeId: 'emp-real', monthKey: '2026-09', windowMonths: 6, minOccurrences: 2 });
  if (!dataset) { console.log('NO DATASET'); process.exit(1); }

  const provider = new ZaiProvider(null);
  const response = await runQualityAIAnalysis({ dataset, userId: 'probe-user', provider });
  console.log('STATUS:', response.status);
  if (response.status === 'OK') {
    console.log('CACHED:', response.cached);
    console.log('DATA SUFFICIENCY:', response.result.dataSufficiency);
    console.log('CONFIDENCE:', response.result.confidence);
    console.log('PROVIDER/MODEL:', response.result.provider, '/', response.result.model);
    console.log('PROMPT VERSION:', response.result.promptVersion);
    console.log('INSIGHTS:', response.result.insights.length);
    for (const ins of response.result.insights) {
      console.log(`  - [${ins.type}/${ins.severity}/${ins.confidence}] ${ins.title}`);
      console.log(`    facts: ${ins.factBasis.slice(0, 90)}`);
      console.log(`    interp: ${ins.interpretation.slice(0, 90)}`);
      console.log(`    evidence: ${ins.supportingEvidence.map((e) => `${e.collection}(${e.recordIds.length})`).join(', ')}`);
    }
    console.log('RECOMMENDATIONS:', response.result.recommendations.length);
    for (const rec of response.result.recommendations) {
      console.log(`  - [${rec.category}/${rec.priority}/${rec.status}] ${rec.title}`);
    }
    console.log('LIMITATIONS:', response.result.limitations.length);
  } else {
    console.log('MESSAGE:', response.message);
  }
}

main().catch((e) => { console.error('PROBE CRASH:', e instanceof Error ? e.message : e); process.exit(1); });
