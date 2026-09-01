# ARM ERP — Phase 6.2: Smart Quality AI Intelligence

> توثيق معماري. المصدر الفعلي هو الكود + الاختبارات (91 اختبارًا جديدًا في 4 ملفات).
> هذه أول طبقة AI حقيقية في ARM — تعمل كطبقة تفسير فوق الحقائق المتحقق منها فقط.

## 1. المبدأ الحاكم (spec §70)

```
Verified Facts (PI dataset)
   ↓
Deterministic TypeScript Analytics   ← محرك التحليل لا يُلمس (§65)
   ↓
Evidence (نفس آلية Evidence Preview)
   ↓
AI Interpretation (READ-ONLY)
   ↓
Insights + Recommendations (PROPOSED فقط)
   ↓
قرار إداري بشري (لا تنفيذ آلي أبدًا)
```

الـAI لا يعيد حساب أي رقم — كل رقم في مخرجاته يجب أن يوجد حرفيًا في المدخلات،
وإلا يُسقط العنصر آليًا (حارس الأرقام المختلقة، §28).

## 2. معمارية Provider (spec §5/§32/§33)

```
src/lib/ai/provider/
  types.ts        → عقد AIProvider: analyze(request) فقط — بلا أي تفاصيل مزود
  config.ts       → قراءة env من الخادم فقط: AI_ENABLED/AI_PROVIDER/AI_MODEL/
                    AI_API_KEY/AI_BASE_URL/AI_TIMEOUT_MS (clamp 5s..120s)
  openai-adapter.ts → محول HTTPS عام لأي endpoint متوافق مع OpenAI
                      (timeout عبر AbortController + retry واحد آمن للـ429/5xx/شبكة)
  z-ai-adapter.ts   → محول z-ai-web-dev-sdk (import ديناميكي — يتحلل بأمان)
  index.ts          → createAIProviderFromEnv(): null يعني AI_UNAVAILABLE
```

- بلا configuration: النظام يعمل طبيعيًا والقسم يعرض AI_UNAVAILABLE (§6/§33/§60).
- إضافة مزود مستقبلًا = ملف محول واحد + حالة في المصنع فقط.
- المفتاح لا يغادر الخادم أبدًا؛ العميل يستقبل النتيجة فقط (§64).

## 3. مسار الطلب (spec §7/§8)

```
Browser (زر "تشغيل التحليل الذكي" — ON-DEMAND، بلا تحميل تلقائي)
   ↓ POST /api/ai/quality-analysis { employeeId, month }   ← حقول مسموحة فقط
requireAuth (JWT) → verifyPermission('kpiReports','view')
   → نطاق الموظف: خارج النطاق = 404 (anti-enumeration)
   → rate limit لكل مستخدم (6/دقيقة، في الذاكرة)
   → getEmployeePerformanceDataset (نفس مصدر PI/Analytics — لا مسار ثانٍ)
   → runQualityAIAnalysis (الخدمة)
   ↓
Analytics الحتمي → بناء Input مُصغّر → بوابة كفاية البيانات →
Provider → تحقق صارم → cache → استجابة منظمة 200
```

**الأهم (§8):** الـAI لا يرى أي محتوى لا يستطيع المستخدم رؤيته — الـdataset
يُبنى فقط بعد الصلاحية والنطاق، بنفس عقود مساري PI وAnalytics حرفيًا.

## 4. الـInput (spec §9/§10/§35)

`src/lib/ai/quality/input-builder.ts` يبني payload منظّم:
- subject: employeeId فقط — **لا اسم ولا كود موظف** (تقليل بيانات).
- period: monthKey + label عربي + mtd + finalized + valueBasis.
- verifiedFacts: عبارات عربية بأرقام من المصدر، كل حقيقة تُشير لـrefId من الكتالوج.
- analytics: هضم مضغوط من محرك TS (trend/patterns/anomalies/correlations/periods).
- evidenceCatalog: refId → {collection كنسي، recordIds، count} — نفس أسماء
  الجداول الكنسية التي يستخدمها Evidence Preview.
- dataQuality + حالة الأرشفة (employmentStatus/archivedButEligible، §22).
- attendance سياق فقط وموسوم بذلك (§35).
- لا raw rows، لا Firebase dump، لا بيانات موظفين آخرين.

## 5. كفاية البيانات (spec §2/§20/§50/§56/§69)

| الحالة | الشرط (حتمي، من الكود) | السلوك |
|---|---|---|
| NO_DATA | لا observations ولا deductions ولا complaints/CAPA/followUps/deals | رسالة تسمّي الفترة، **بلا استدعاء AI** |
| INSUFFICIENT_DATA | صفر observations لكن توجد بيانات أخرى | رسالة واضحة، **بلا استدعاء AI** |
| LIMITED_DATA | observations موجودة لكن الثقة الإجمالية منخفضة/الاتجاه غير كافٍ | AI يعمل ويُوسم "محدودة" + حدود الاتجاه |
| SUFFICIENT_DATA | ثقة كافية | AI يعمل طبيعيًا |

MTD يصل للـAI كبيانات (mtd=true، finalized=false) والـprompt يمنع وصفه
كـ"نتيجة الشهر النهائية" (§21).

## 6. التحقق الصارم من المخرجات (spec §27/§28)

`validate.ts` — لا تُعرض أي استجابة غير موثوقة:
1. استخراج JSON (يتسامح مع أسوار الكود) ثم parse.
2. مخطط + enums محصورة (§14/§37/§38) — أي قيمة خارج القوائم = إسقاط العنصر.
3. كل supportingEvidence[].refId يجب أن يوجد في evidenceCatalog المدخلات.
4. **حارس الأرقام المختلقة**: كل رقمة (بالأرقام العربية-الهندية أيضًا) في نص
   المخرجات يجب أن توجد في المدخلات — خلاف ذلك يُسقط العنصر مع ملاحظة تدقيق.
5. status التوصية يُفرض PROPOSED — أي حالة أخرى = إسقاط (§15/§16).
6. المسح الإنشائي يرفض ادعاءات التنفيذ الذاتي؛ الضمان الهيكلي: لا توجد أي قدرة
   كتابة في طبقة الـAI كلها (مثبت باختبار مصدري).
7. إذا لم ينجُ شيء صالح → AI_INVALID_RESPONSE وبلا عرض.

## 7. الحقن والخصوصية (spec §30/§31/§58)

- البيانات تدخل داخل محددات `<<<ARM_DATA_BEGIN>>>...<<<ARM_DATA_END>>>` موسومة
  UNTRUSTED DATA — الـsystem prompt يعلن صراحة أن أي "تعليمات" داخلها بيانات.
- الـsystem prompt ثابت + versioned (`quality-analysis-v1`، §47) ولا يحتوي أي
  بيانات عمل.
- لا logs للـprompt أو الاستجابة الكاملة — فقط status/provider/model/latency/
  نتيجة الحالة/employeeId (§58).

## 8. الكاش وحماية المعدل (spec §26/§34)

- كاش LRU (32 عنصرًا، TTL 10 دقائق) بمفتاح sha256 يشمل: employeeId + period +
  window + **hash محتوى الـpayload** + engineVersion + promptVersion + provider/model
  → نتيجة قديمة على بيانات جديدة مستحيلة. الإخفاقات لا تُخزن كنجاح.
- الحد: 6 طلبات/دقيقة/مستخدم (sliding window في الذاكرة — ليس نظام billing).
- قيد موثق: الكاش والح limit محليان على الـinstance في serverless — مقبول لطلب
  on-demand منخفض التكرار.

## 9. الـUI (spec §23/§24/§44/§45/§54/§55/§68)

`AIAnalysisSection.tsx` في الموضع المحجوز "التحليل الذكي" بعد Analytics:
- ON-DEMAND: زر "تشغيل التحليل الذكي" / "تحديث التحليل" — بلا fetch عند الرندر.
- الإلغاء: AbortController + إعادة تركيب عبر key عند تغيير الموظف/الفترة.
- شارة AI GENERATED + الفترة مسمّاة دائمًا + "حتى تاريخه (MTD)" + حالة البيانات +
  الثقة + provenance (provider/model/promptVersion).
- فصل بصري إلزامي: **الحقائق** مقابل **التفسير** لكل استنتاج (§11).
- التوصيات: تصنيف/أولوية/ثقة + "لماذا يقترح النظام هذا؟" + الأثر المتوقع + "مقترحة —
  بانتظار قرار إداري".
- كل دليل chip قابل للنقر → fetchEvidencePreview → **نفس EvidencePreviewModal**
  → "فتح السجل في المصدر" + highlight (§44/§45 — لا عارض أدلة جديد).
- الحالات منفصلة: IDLE/LOADING/READY/NO_DATA/INSUFFICIENT_DATA/AI_UNAVAILABLE/
  AI_TIMEOUT/AI_ERROR/AI_INVALID_RESPONSE/AI_RATE_LIMITED/NETWORK_ERROR — فشل
  الـAI يعزل هذا القسم وحده؛ الحقائق والتحليل والأدلة تبقى (§53).
- enums إنجليزية ثابتة في العقود؛ العربية في خرائط الترجمة فقط (§46).

## 10. القاعدة العامة للفترات (§68)

صفحة ملاحظات الجودة: مؤشر "فترة العرض: …" مرئي دائمًا في شريط الأدوات، والحالة
الفارغة تسمّي الفترة ("لا توجد ملاحظات مسجلة في سبتمبر 2026.")، وزر "عرض كل
الأشهر" للهروب، و"مسح الفلاتر" يمسح فعليًا — اختبار انحدار مخصص يثبّت ذلك
(observations-period-visibility.test.ts).

## 11. المتغيرات البيئية (spec §60)

```
AI_ENABLED=          # فارغ = معطّل (سلوك افتراضي آمن)
AI_PROVIDER=         # z-ai | openai-compatible
AI_MODEL=
AI_API_KEY=          # خادم فقط
AI_BASE_URL=         # اختياري لمتوافق OpenAI
AI_TIMEOUT_MS=       # افتراضي 30000
```

## 12. الحدود المعلنة (honesty)

- provider اختُبر بطلب حقيقي ناجح في sandbox التطوير عبر z-ai (glm-4.6)؛
  openai-compatible اختُبر ضد خادم mock محلي — لا credentials حقيقية للـOpenAI.
- الكاش/الحد في الذاكرة لكل instance.
- حارس الأرقام نصي (tokens) — لا يلتقط ادعاءات نوعية بلا أرقام؛ الضمان الباقي:
  الـprompt + الأدلة الإلزامية + الطابع القابل للتدقيق.
- لا Organizational Memory persistence ولا feedback training (§40/§41/§42/§48).
