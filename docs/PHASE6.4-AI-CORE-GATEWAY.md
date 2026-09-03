# Phase 6.4 — ARM AI Core, Secure AI Gateway, Provider Management & Organizational Memory Foundation

> الحالة: مكتمل — البوابات الأربع خضراء (tsc 0 / lint نظيف / 1354 اختبار / build ناجح)
> التاريخ: 2026-09 · المرجع: مواصفة Phase 6.4 (45 قسمًا)

---

## 1. الغرض

هذه المرحلة **معمارية إنتاجية** وليست "زر ذكاء اصطناعي يعمل". الهدف: أساس دائم للذكاء الاصطناعي في ARM —

- المزود/الموديل قابلان للتغيير لاحقًا دون إعادة بناء النظام.
- ARM يملك ذاكرته التنظيمية (لا Gemini ولا غيره).
- الذكاء الاصطناعي لا يلمس قاعدة البيانات مباشرة ولا يتجاوز الصلاحيات.
- كل طلب AI يمر عبر بوابة واحدة تحفظ الهوية والصلاحيات والتصنيف والتدقيق.
- الحديثات والذاكرة جاهزتان للتخزين الدائم (Phase 6.5 Chat).
- Python ممنوع؛ كل شيء متوافق مع Vercel.

---

## 2. تشخيص عطل "التحليل الذكي غير متاح حاليًا" (§3)

**السلسلة الكاملة للعطل (مُثبتة لا مُخمَّنة):**

```
زر «تشغيل التحليل الذكي»
→ POST /api/ai/quality-analysis            (يعمل — auth/perm/scope سليمة)
→ runQualityAIAnalysis
→ readAIProviderConfig(): AI_ENABLED !== 'true' ⇒ null   ← نقطة الفشل
→ createAIProviderFromEnv() ⇒ null
→ {status: 'AI_UNAVAILABLE', message: 'التحليل الذكي غير مُهيأ…'}
→ UI: aiFailureHeading('AI_UNAVAILABLE') = «التحليل الذكي غير مُهيأ»
```

**السبب الجذري:** لا توجد أي متغيرات AI في بيئة التشغيل إطلاقًا (AI_ENABLED/AI_PROVIDER/AI_MODEL/AI_API_KEY كلها غير مضبوطة). التصميم السابق عمدًا يخفت إلى AI_UNAVAILABLE — والحقائق والتحليل الحتمي والأدلة بقيت تعمل، كما صممت Phase 6.2.

**اكتشافات إضافية:**
- `gemini` لم يكن نوع مزود مدعومًا أصلًا — المزود الأساسي الرسمي المطلوب غير موجود.
- كانت جميع الأعطال تُطوى في حالة واحدة AI_UNAVAILABLE دون تمييز DISABLED/MISCONFIGURED/UNAVAILABLE.
- لم تكن هناك أي واجهة تشخيصية آمنة للمدير.

**ما أُضيف:** تصنيف حالات §25 الكامل (9 حالات) + `readAISafeDiagnostics()` + `GET /api/ai/diagnostics` (للمدير فقط) + `GET /api/ai/health`. البروكبت الحي: `scripts/phase64-diagnose.ts` (آمن — قيم منطقية وأكواد فقط).

---

## 3. معمارية المزود (§4/§5/§7/§26)

| المكوّن | الملف | الدور |
|---|---|---|
| عقد المزود | `src/lib/ai/provider/types.ts` | واجهة `AIProvider.analyze` + `AIProviderError` (أُضيف كود `AI_MODEL_ERROR`) |
| الإعداد | `src/lib/ai/provider/config.ts` | قراءة البيئة + `readAISafeDiagnostics()` (قيم آمنة فقط) |
| السجل | `src/lib/ai/provider/registry.ts` | تعريف كل مزود: القدرات، متطلبات الإعداد، المصنع — **لا اختيار عشوائي ولا fallback خفي ولا راوتر تلقائي** |
| Gemini | `src/lib/ai/provider/gemini-adapter.ts` | المزود الأساسي الرسمي — fetch خادم فقط، المفتاح في header `x-goog-api-key` (لا يمر في URL)، مهلة عبر AbortController، retry واحد آمن للعطلات العابرة، 404/400→MODEL_ERROR، 401/403→AUTH، 429→RATE_LIMITED |
| فحص الصحة | `src/lib/ai/provider/health.ts` | بروب محايد مصغّر (لا بيانات ARM)، نتائج آمنة فقط |
| المصنع | `src/lib/ai/provider/index.ts` | `createAIProviderFromEnv` + `resolveAIProvider` (الطبقات) |

**سياسة الموديل:** gemini **يشترط** `AI_MODEL` صريحًا — لا افتراضي ولا اختيار آلي ولا تبديل صامت. z-ai يحتفظ بموديل المنصة الافتراضي (استثناء موثق). المفتاح دائمًا من البيئة على الخادم فقط — لا يُخزَّن في Firebase ولا يعود لأي متصفح (§7).

**تفعيل المزود دون إعادة نشر:** `aiProviderSettings` (عقدة RTDB إضافية) تحمل override **غير سري** للمزود/الموديل فقط؛ `AI_ENABLED` و`AI_API_KEY` يبقيان بيئيين دائمًا. ترتيب الحسم: settings → env. كل تغيير يُدقَّق في `configAuditLog` (إعادة استخدام — لا معمارية توازية).

---

## 4. بوابة AI (§8/§11) والطبقات المساندة

```
User → Authentication (route) → Authorization (route)
  → AI Gateway
      → Context Builder (مُصغَّر، مُصنَّف، مُسيَّج)
      → Tool/Memory access (READ_ONLY فقط في هذه المرحلة)
      → Provider Adapter (سجل صريح)
      → AI Provider (لا يرى بيانات Firebase أبدًا)
      → Response Validator (+ فحص أمني للمخرجات)
  → User + aiAuditLog
```

| الوحدة | الملف | الغرض |
|---|---|---|
| الحالات | `gateway/status.ts` | 9 حالات §25 + خرائط التحويل من أكواد المزود ومن أظرف quality القديمة |
| التصنيف | `gateway/classification.ts` | PUBLIC/INTERNAL/CONFIDENTIAL/RESTRICTED + `assertNoRestrictedData()` كبوابة أخيرة قبل أي نداء خارجي |
| التسييج | `gateway/fencing.ts` | تحييد `<<<ARM_DATA_*>>>` والأسوار الخلفية داخل النصوص غير الموثوقة + `sanitizeUntrustedPayload` عميق + إشارات الحقن للمراقبة فقط |
| أمن المخرجات | `gateway/output-security.ts` | رفض رد يحتوي مفتاحًا مُهيأً أو شكل اعتماد + `numericClaimsGrounded` |
| المعدل | `gateway/rate-limit.ts` | نافذة منزلقة لكل مستخدم+ميزة، افتراضات مجانية محافظة |
| التدقيق | `gateway/audit.ts` | سجل `aiAuditLog` بحقول آمنة صريحة — لا يمكن بنيويًا إدخال مفتاح أو حمولة خام |
| الحسم | `gateway/core.ts` | `resolveAIProvider` (نقي — بلا DB؛ الإعدادات تُحقن من الـroute) |

**Smart Quality Report (§29):** خط أنابيبه لم يُمس — نفس الحقائق/التحليل الحتمي/الأدلة/MTD/الاستمرارية. أُضيف حصريًا: بوابة التصنيف، التسييج، فحص أمن المخرجات، `diagnostic` إضافي اختياري في الأظرف الفاشلة، وسجل تدقيق. جميع اختبارات 6.2 تمر كما هي (عدا تحديث تعاقدي واحد موثق: استيراد المصنع → الحسم عبر البوابة).

---

## 5. طبقة الأدوات (§12/§13)

- **العقد:** `src/lib/ai/tools/types.ts` — فئات الحوكمة `READ_ONLY | SAFE_WRITE | SENSITIVE_WRITE | ADMIN_ONLY`؛ **المفعّل الآن: READ_ONLY فقط**.
- **التنفيذ:** `runtime.ts` — حارسات مستقلة متتابعة: TOOL_UNKNOWN → TOOL_DISABLED → PERMISSION_DENIED (نفس دلالات verifyPermission — `permission-check.ts` مرآة نقية) → INVALID_ARGS → OUT_OF_SCOPE (فشل مغلق، رفض عام ضد الاستطلاع) → تنفيذ محاصر.
- **الأدوات المنفذة (4، بالحد الأدنى للتحقق):**
  - `searchARM` — يعيد استخدام البحث الموحد (`runGlobalSearch`) بصلاحيات المستخدم ونطاقه المحسوم — **لا محرك بحث ثانٍ** (§34).
  - `getEmployeeProfile` — حقائق هوية مُصغَّرة من مجموعة PI الموجودة (بلا هاتف/بريد/راتب).
  - `getQualityObservations` — ملخص مجتزأ داخل النطاق؛ النصوص بيانات غير موثوقة.
  - `getCurrentPeriod` — الشهر الحالي وحالة الإقفال (إعادة استخدام monthKeyOf/isMonthClosed).

---

## 6. الذاكرة التنظيمية (§14-§17)

- **العقد:** `src/lib/ai/memory/types.ts` — يمدّد مصطلحات `OrganizationalMemoryEntry` (Phase 6.1) دون إعادة تصميم: + `status` (PROPOSED/VALIDATED/APPROVED/REJECTED/ARCHIVED) + `confidence` + `outcome` + `learning` + `version` + `organizationId` + `source`.
- **الحوكمة:** مدخلات AI تُنشأ **PROPOSED إجباريًا** (مفروض في `createMemoryEntry` لا بالتأديب)؛ الانتقالات فقط عبر `transitionMemoryStatus` مع جدول انتقالات وقفل إصدار تفاؤلي؛ **فقط VALIDATED/APPROVED معرفة موثوقة**.
- **التخزين:** عقدة إضافية `arm_erp/organizationalMemory` عبر طبقة db الموجودة — صفر migration وصفر حذف (§38). التخزين قابل للحقن للاختبارات بلا Firebase.
- **الاسترجاع:** `retrieval.ts` — دالة نقية مستقلة عن المزود: ثقة + موضوع (تطبيع عربي) + إدارة + فترة + حداثة + ثقة + أدلة، حد افتراضي 5 — **لا إغراقًا للذاكرة في أي prompt**. مدخلات المؤسسات الأخرى والمرفوضة/المؤرشفة لا تظهر أبدًا.
- **استقلالية الموديل (§17):** لا تدريب على مزود ولا تعلم في prompts ولا ذاكرة داخل المزود — المعرفة = ARM Data + Analytics + Evidence + Memory، وتبقى عبر أي تبديل مزود (مُثبت باختبار §36-R + لا دالة حذف في المخازن بنيويًا).

---

## 7. أساس المحادثات (§18/§19)

- **العقد:** `conversation/types.ts` — Conversation (conversationId/userId/title/archived/lastMessageAt/provider/model/summary/organizationId…) و Message (messageId/role/content/timestamp/toolCalls/toolResultsMeta/validationState).
- **المخزن:** `conversation/store.ts` — عقدتان إضافيتان `aiConversations` + `aiMessages`؛ كل قراءة/كتابة تمر بفلتر userId المشتوم من الخادم؛ محادثة مستخدم آخر = NOT_FOUND (لا FORBIDDEN — لا كشف وجود)؛ الأرشفة/الاستعادة لا تلمس عمود الملكية بنيويًا؛ عرض المدير فقط عبر `listConversationsForAdmin` ببوابة role==='admin' صريحة (§33 — لا مراقبة افتراضية).
- **الفصل (§19):** ممنوع بنيويًا (مُختبر بمصادر الملفات) أن تكتب المحادثات في الذاكرة أو العكس — كلام المستخدم ليس حقيقة تنظيمية دون دورة التحقق.

---

## 8. الهوية والملف الشخصي وكلمة المرور (§30/§31/§32 — فحص معماري)

- **§30:** كل مسارات AI مشتقة من `requireAuth` (JWT + تحميل المستخدم من RTDB + فحص الإيقاف) — لا يوجد مسار يقبل userId من العميل. JWT payload لا يحمل الصلاحيات — تُحل من RTDB كل طلب.
- **§31:** نموذج المستخدم الحالي يدعم: name/email/role/permissions/linkedEmployeeId/positionId/isSuspended + عقدة `userPreferences` موجودة — جاهز للتفضيلات (عربي/إنجليزي، فاتح/داكن) في Phase 6.8 دون ازدواج هوية.
- **§32:** بنية الجلسات تدعم الإبطال فعلًا (`storeRefreshToken/validateRefreshToken/revokeRefreshToken/revokeAllUserRefreshTokens` في `src/lib/auth.ts`) — أساس session invalidation جاهز. كلمات المرور bcrypt (12 دورة) مع إعادة تلقيم تلقائي. **قاعدة Phase 6.9 الموثقة:** أي استرداد كلمة مرور مستقبلي يجب أن يجيب ردًا موحدًا لا يكشف وجود البريد (anti-enumeration) — لم يُبنَ مسار استرداد في هذه المرحلة (خارج النطاق).

---

## 9. متغيرات البيئة (§26) والتوافق مع Vercel (§27/§28)

- `.env.example` أُعيد إنشاؤه (كان مفقودًا من القرص وغير مُسجل في git أبدًا) بتوثيق كامل: JWT_SECRET (32+ إجباري)، FIREBASE_*، AI_ENABLED/AI_PROVIDER=gemini/AI_MODEL (إجباري لـgemini)/AI_API_KEY/AI_TIMEOUT_MS/AI_BASE_URL + تعليمات dev/preview/production.
- لا Python، لا عمليات خلفية، لا ملفات، لا حالة ذاكرة كمصدر حقيقة — مسارات Next.js قياسية + Firebase + fetch خادمي (نفس نمط 6.2).
- تحسين الصفحة المجانية: تشغيل عند الطلب فقط (لا AI مع تحميل صفحة)، سياق مصغر، بوابة كفاية بيانات قبل أي نداء، كاش للمحتوى، rate limit، بلا retry لانهائي، بلا نداءات متعددة المزودين.

---

## 10. الاختبارات (§36/§37)

**1354/1354 تمر** (أساس 6.3: 1279 + **75 جديد** في 4 ملفات):

| الملف | التغطية |
|---|---|
| `phase64-provider.test.ts` (25) | السجل، التشخيص الآمن، محول Gemini ضد خادم mock محلي (نجاح/404/400 مفتاح/429/استجابة فاسدة/شبكة)، الحسم الطبقي، فحص الصحة، «المفتاح لا يظهر أبدًا» |
| `phase64-gateway.test.ts` (22) | الحالات 9، التصنيف (بما فيها لا إيجابيات كاذبة لمحتوى quality الحقيقي)، التسييج (حقن عربي/إنجليزي داخل السوار)، أمن المخرجات، المعدل، سجل التدقيق الآمن |
| `phase64-memory-conversation.test.ts` (15) | دورة حياة الذاكرة، منع المعرفة الموثوقة من AI، الاسترجاع المحدود والنطاق، عزل المحادثات (§36-B)، الأرشفة تحفظ الملكية (§36-O)، بوابة المدير، فصل المحادثات عن الذاكرة، بقاء المعرفة عبر تبديل المزود (§36-R) |
| `phase64-security-matrix.test.ts` (13) | مصفوفة §36 A/D/F/G/M/N على مستوى المسارات عبر harness m01 (JWT حقيقي + صلاحيات حقيقية + db في الذاكرة) |

**مصفوفة §36 A–S:** A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S — كل السيناريوهات مغطاة عبر الملفات الأربعة (كل حالة موثقة باسمها في الاختبار).

**تحديث تعاقدي واحد (مسبق بمبرر Phase 6.4):** `quality-ai-ui-contract.test.ts` — «service يستورد المصنع» أصبحت «service يحسم عبر البوابة resolveAIProvider». كل اختبارات AI الحالية الأخرى تمر دون تعديل (§36-S ✓).

---

## 11. بوابات التحقق (§42)

| البوابة | النتيجة |
|---|---|
| TypeScript | 0 أخطاء |
| ESLint | نظيف |
| الاختبارات | 1354/1354 (JWT_SECRET 32+) |
| Build | ناجح — ƒ /api/ai/diagnostics · /api/ai/health · /api/ai/provider-settings · /api/ai/quality-analysis |
| Standalone smoke | / 200 · المسارات الأربعة 401 بدون توثيق (فشل مغلق) |
| E2E بمزود حقيقي | **OPERATIONAL_END_TO_END** عبر harness: JWT→صلاحية→نطاق→PI→تحليل حتمي→تصنيف→تسييج→**z-ai حقيقي (glm-4.6، 29.6s)**→تحقق صارم (4 insights+2 توصيات)→أمن مخرجات→OK |
| تشخيص حي | DISABLED + أكواد مشاكل مستقرة (كان «غير متاح» مطويًا) |

### تحقق الإنتاج المعلّق (بصدق — §42/§44)

1. **Gemini حي بمفتاح حقيقي:** المحول مُختبر ضد mock transport (شكل الطلب/الأخطاء/المهلة) + البنية مطابقة لـGenerative Language API — النداء الحي الأول يتطلب مفتاح AI_API_KEY حقيقي من المدير (غير متاح في بيئة التطوير هذه).
2. **Firebase RTDB حقيقية:** عقد aiAuditLog/organizationalMemory/aiConversations/aiProviderSettings تُختبَر عبر stubs في الذاكرة + التخزين يمر بطبقة db الإنتاجية نفسها؛ الكتابة الأولى على قاعدة حقيقية تتطلب FIREBASE_* مُهيأة.
3. **Vercel production:** التهيئة قياسية (vercel.json بلا تعديل — مسارات API قياسية + env vars). مطلوب من المدير: إضافة JWT_SECRET/FIREBASE_*/AI_* في Project Settings ثم إعادة نشر، ثم `GET /api/ai/diagnostics` و`/api/ai/health` بصلاحية المدير.

---

## 12. حدود معروفة

- فحص الصحة/الإعدادات **للمدير النظامي فقط** — لا واجهة إعدادات بعد (Phase 6.10).
- بروب الصحة يستدعي المزود حقيقيًا (10s مهلة، 16 توكن) — محدود بمعدل 10/دقيقة.
- audit actorName = userId مؤقتًا (الإثراء في Phase 6.10).
- rate limit في الذاكرة لكل instance (نفس حدود 6.2 الموثقة) — كافٍ للاستهلاك اليدوي عند الطلب.
- لا Chat UI في هذه المرحلة (§18/§39) — العقد والمخازن جاهزة لـ6.5.

## 13. خارطة الطريق التالية (دون تنفيذ مسبق)

- **6.5 Chat UI** فوق عقد المحادثات + بوابة المعدل.
- **6.6 أدوات + تقارير + وكيل** فوق طبقة الأدوات (تفعيل تدريجي لفئات الكتابة مع تأكيد بشري صريح).
- **6.7 الذكاء التنظيمي** فوق دورة VALIDATED→APPROVED والاسترجاع.
- **6.8 الملف الشخصي** فوق userPreferences الموجودة.
- **6.9 استرداد كلمة المرور** مع anti-enumeration الإجباري.
- **6.10 مركز تحكم المدير** فوق /api/ai/diagnostics + /api/ai/health + aiAuditLog.
