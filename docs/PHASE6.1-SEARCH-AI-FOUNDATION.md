# ARM ERP — Phase 6.1: AI Foundation + Global Search

> توثيق معماري مختصر. المصدر الفعلي للأهمية هو الكود + الاختبارات.

## 1. معمارية البحث العالمي

```
Browser (GlobalSearch palette)
   ↓  POST /api/search  { query, domain?, limit? }      ← لا شيء آخر يُقبل
src/app/api/search/route.ts          (قشرة رقيقة)
   ↓ requireAuth (JWT Bearer)
src/lib/search/search-service.ts
   ↓ canViewDomain  — صلاحية كل domain عبر permissionKey الرسمي (APP_PAGES doctrine)
   ↓ resolveEmployeeScopeFromDb — نطاق الموظف يُحسب مرة واحدة لكل طلب
   ↓ getAll/getEmployeeMap — قراءة عبر طبقة db المخزّنة الحالية (لا فهرس منفصل)
   ↓ مطابقة معجمية (record-matcher) + إسقاط خفيف (adapters)
   ↓ SearchApiResponse — إسقاطات عرض فقط، لا سجلات خام أبداً
Browser
```

طبقات مستقلة (spec §18):

| الطبقة | الملف | المسؤولية |
|---|---|---|
| Contract | `src/lib/search/types.ts` | SearchResult/SearchGroup/Response — خفيف، ثابت |
| Registry | `search-domains.ts` | 14 domain: الجدول، الصلاحية، الصفحة، استراتيجية التنقل، النطاق |
| Normalization | `search-normalize.ts` | تطبيع عربي/إنجليزي للبحث فقط — لا يمس المخزن |
| Matching | `record-matcher.ts` | exact-id > exact > prefix > contains + AND متعدد الكلمات |
| Adapters | `adapters.ts` | حقول البحث + الإسقاط العربي لكل domain |
| Request | `search-request.ts` | تحقق صارم: query (2..100)، domain معروف، limit ≤ 50 |
| Service | `search-service.ts` | التنسيق الخادمي + الصلاحيات + النطاق + الحدود |
| Navigation | `search-navigation.ts` | buildSearchNavigation → intent (عميل آمن) |
| UI | `components/search/GlobalSearch.tsx` | Trigger بالهيدر + Command palette (cmdk) + debounced 250ms |

## 2. النطاقات المدعومة (من SYSTEM INVENTORY فعلي)

| Domain | الجدول | permissionKey | الصفحة | التنقل | النطاق |
|---|---|---|---|---|---|
| employees | employees | employees | employees | exact (highlight + status seeding) | employees scope |
| qualityObservations | qualityObservations | observations | observations | exact (highlight + month) | rows |
| qualityDeductions | qualityDeductions | quality | quality | generic | rows |
| hrDeductions | hrDeductions | hrDeductions | hrDeductions | exact (highlight) | rows |
| complaints | complaints | complaints | complaints | exact (highlight) | optionalLink |
| capaCases | capaCases | capa | capa | exact (detailParam `id`) | optionalLink + relatedEmployeeIds |
| followUps | followUps | followUps | followUps | exact (highlight + expand المجموعة) | rows |
| travelDeals | travelDeals | travel | travel | exact (highlight + month) | rows |
| attendance | attendance | attendance | attendance | exact (highlight) | rows |
| requests | requests | requests | requests | exact (highlight) | rows |
| knowledgeBase | knowledgeBase | knowledgeBase | knowledgeBase | generic | — |
| monthSnapshots | monthSnapshots | monthClose | monthClose | generic | — |
| orgNodes | orgNodes | organization | organization | generic | — |
| users | users | controlPanel | controlPanel | generic | — |

## 3. تدفق الصلاحيات (CRITICAL)

1. **Authentication**: JWT Bearer عبر `requireAuth` — نفس عقيدة كل المسارات.
2. **Permission لكل domain**: `canViewDomain` يحاكي دلالة `verifyPermission('view')` (تجاوز admin + `level !== 'none'`) على الخريطة الفعالة المحسوبة مسبقاً — بدون إعادة مصادقة لكل domain.
3. **domain غير مصرّح = لا يُستعلم أصلاً**: لا أسماء، لا عدّاد، لا إشارة على الوجود (anti-enumeration). حتى على مستوى IO: `getAll` لجدول غير مصرّح لا يُستدعى (مثبت باختبار).
4. **Employee Scope**: `resolveEmployeeScopeFromDb` مرة واحدة → `filterRowsByEmployeeScope` / `filterEmployeesInScope` مع خيارات كل domain (optionalLink للشكاوى، relatedEmployeeIds لـCAPA). خارج النطاق = غير موجود.
5. **لا تجاوز من العميل**: الجسم المقبول `{ query, domain?, limit? }` فقط — لا حقول صلاحيات أو نطاق.
6. **middleware + route**: طبقتا 401 (الحماية الحالية للمشروع) قبل خدمة البحث.

## 4. تدفق التنقل الدقيق + الإبراز

- `buildSearchNavigation(result)` يعيد استخدام registry الدليل (Phase 5.2) — **لا نظام موازٍ**:
  - observations/complaints/followUps/travel → `highlight` (نفس `navigateTo(page, highlightId, navParams)`)
  - capa → `detailParam` عبر `navParams.id` (وضع التفاصيل الحالي)
  - observations/travel → إضافة `month` من تاريخ السجل (عقود Phase 5.3)
  - employees → `highlightId` + `navParams.status` عند أرشفة/تعطيل (حتى تظهر الصف، عقود الأرشفة M0.6 محفوظة)
  - requests → آلية highlightId المرجعية الموجودة بالصفحة
  - hrDeductions/attendance → أسلاك جديدة بنفس الآلية المشتركة (`data-record-id` + `useRecordHighlight`)
  - generic domains → `exact:false` وتسمية صادقة «الانتقال إلى الصفحة»
- العميل يتحقق أيضاً من `canViewPage(intent.page)` قبل التنقل (الخادم هو المرجع).
- الإبراز: `useRecordHighlight` الحالي (polling 200ms حتى 15s + إبراز 4s + `.evidence-highlight`).

## 5. تكامل AI Foundation (المستقبلي)

- `src/lib/ai/types.ts`: عقود `AIAnalysisInput` (Verified Facts + Analytics + Evidence + Confidence — **لا dump خام**)، `AIInsight`، `AIRecommendation`، `AIAnalysisRequest/Response`، `OrganizationalMemoryEntry` (سلسلة Problem→…→Learning)، `RecommendationOutcome`.
- `src/lib/ai/governance.ts`: `AI_READ_ONLY = true`، `AI_FORBIDDEN_MUTATIONS`، `AI_ALLOWED_DATA_SOURCES`، حارس `isEvidenceBacked`، مدقّقات الهيكل، حارس `isSerializableContract`.
- **لا استدعاءات LLM، لا مزودات، لا Python، لا إرسال بيانات خارجياً** — مثبت باختبارات ساكنة.
- العلاقة بالبحث (§26): Search → نتائج موثوقة → سجلات دقيقة → Analytics → (مستقبلاً) فهم AI — لا يُنفذ الآن.

## 6. نقاط التمديد

1. **domain جديد**: descriptor في `search-domains.ts` + adapter في `adapters.ts` (+ استراتيجية تنقل إن دعمتها صفحته) — الخدمة والواجهة لا تتغيران.
2. **فهرس حقيقي مستقبلاً**: يستبدل `deps.getAll` داخل `SearchDeps` — نفس العقد والواجهة (spec §17/§33).
3. **AI layer**: ينفذ خلف عقود `src/lib/ai` — قراءة من Verified Facts/PI/Analytics/Evidence فقط.
4. **Feedback loop**: `RecommendationOutcome` جاهز لتسجيل القبول/التنفيذ/الأثر عبر workflow صريح مستقبلي.

## 7. القيود المعروفة

- **مطابقة معجمية فقط** (exact/prefix/contains + تطبيع) — لا دلالية (متعمّدة في هذه المرحلة).
- **قراءة عبر getAll لكل جدول مؤهل** مع الكاش الحالي (TTL 5-60s): كافية لأحجام البيانات الحالية؛ عند الحاجة لفهرس يُضاف خلف `SearchDeps` دون تغيير العقد.
- **الصفحات بدون عقد تنقل دقيق** (qualityDeductions/knowledgeBase/monthSnapshots/orgNodes/users): تسمية صادقة «الانتقال إلى الصفحة» بدل ادعاء فتح السجل.
- **Ctrl+K معطّل داخل workflowDesigner** فقط (يملك اختصاره المحلي)؛ داخل مركز القرارات قد يتعايش اختصارا Ctrl+K (أغلق إحداهما).
- **أحدث عمليات البحث** محلية (localStorage) ولا تُرسل للخادم — قابلة للمسح من الواجهة.
- **users domain**: يظهر فقط لمصرّحهم `controlPanel` (نفس بوابة الصفحة) — البريد ظاهر في الإسقاط كما في الصفحة نفسها.
