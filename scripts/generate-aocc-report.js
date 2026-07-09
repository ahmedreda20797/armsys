// ═══════════════════════════════════════════════════════════════
//  AOCC Technical Architecture Report Generator
//  Generates a formal Arabic technical report (DOCX) documenting
//  the ARM Operations Command Center intelligence layer.
// ═══════════════════════════════════════════════════════════════

const {
  Document, Packer, Paragraph, TextRun, Header, Footer,
  AlignmentType, HeadingLevel, PageNumber, PageBreak,
  Table, TableRow, TableCell, TableLayoutType, WidthType,
  BorderStyle, ShadingType, SectionType, NumberFormat,
  TableOfContents, LevelFormat, convertInchesToTwip,
} = require("docx");
const fs = require("fs");

// ── Palette: Dawn Mist Tech (Cool + Light + Active) — tech/enterprise ──
const P = {
  primary: "0A1628",
  body: "1A2B40",
  secondary: "6878A0",
  accent: "5B8DB8",
  surface: "F4F8FC",
};

// Cover palette (R1 with CM-2 light variant for a clean tech look)
const COVER = {
  bg: "0B1C2C",       // deep sea dark
  titleColor: "FFFFFF",
  subtitleColor: "B0B8C0",
  metaColor: "90989F",
  footerColor: "687078",
  accent: "529286",   // teal accent
};

const c = (hex) => hex.replace("#", "");

// ── Border helpers ──
const NB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };

// ═══════════════════════════════════════════════════════════════
//  Title layout calculator (for cover)
// ═══════════════════════════════════════════════════════════════
function calcTitleLayout(title, maxWidthTwips, preferredPt = 36, minPt = 22) {
  const charWidth = (pt) => pt * 20;
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / charWidth(pt));
  let titlePt = preferredPt;
  let lines;
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt);
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = splitLines(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) {
    lines = splitLines(title, charsPerLine(minPt));
    titlePt = minPt;
  }
  return { titlePt, titleLines: lines };
}

function splitLines(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const breakAfter = new Set([..." \t-_/—–·،.؛:!؟"]);
  const lines = [];
  let remaining = title;
  while (remaining.length > charsPerLine) {
    let breakAt = -1;
    for (let i = charsPerLine; i >= Math.floor(charsPerLine * 0.6); i--) {
      if (i < remaining.length && breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
    }
    if (breakAt === -1) breakAt = charsPerLine;
    lines.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) lines.push(remaining);
  return lines;
}

// ═══════════════════════════════════════════════════════════════
//  COVER (Recipe R1 — Pure Paragraph Left, dark background)
// ═══════════════════════════════════════════════════════════════
function buildCover() {
  const padL = 1200, padR = 800;
  const title = "تقرير البنية التقنية — الطبقة الذكية لمركز عمليات ARM";
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayout(title, availableWidth, 32, 22);
  const titleSize = titlePt * 2;

  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: COVER.accent, space: 12 };
  const children = [];

  // Top whitespace
  children.push(new Paragraph({ spacing: { before: 3200 } }));

  // English label
  children.push(new Paragraph({
    indent: { left: padL, right: padR }, spacing: { after: 500 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COVER.accent, space: 8 } },
    children: [new TextRun({
      text: "A R M   E R P   ·   T E C H N I C A L   R E P O R T",
      size: 18, color: COVER.accent, font: { ascii: "Calibri" }, characterSpacing: 40,
    })],
  }));

  // Title (RTL Arabic)
  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      bidirectional: true,
      indent: { left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({
        text: titleLines[i], size: titleSize, bold: true,
        color: COVER.titleColor, font: { ascii: "Arial", eastAsia: "Arial" }, rtl: true,
      })],
    }));
  }

  // Subtitle
  children.push(new Paragraph({
    bidirectional: true,
    indent: { left: padL }, spacing: { after: 800 },
    children: [new TextRun({
      text: "وثيقة معمارية تنفيذية — طبقة الذكاء التشغيلي (AOCC)",
      size: 24, color: COVER.subtitleColor, rtl: true, font: { ascii: "Arial" },
    })],
  }));

  // Meta lines
  const metaLines = [
    "الإصدار: 1.0",
    "التاريخ: يوليو 2026",
    "التصنيف: معمارية الواجهة الأمامية للذكاء التشغيلي",
    "النطاق: Frontend Intelligence Layer فقط — بدون تعديلات خلفية",
  ];
  for (const line of metaLines) {
    children.push(new Paragraph({
      bidirectional: true,
      indent: { left: padL + 200 }, spacing: { after: 80 },
      border: { left: accentLeft },
      children: [new TextRun({
        text: line, size: 24, color: COVER.metaColor, rtl: true, font: { ascii: "Arial" },
      })],
    }));
  }

  // Bottom whitespace
  children.push(new Paragraph({ spacing: { before: 3800 } }));

  // Footer
  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: COVER.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: "ARM ERP  |  Operations Command Center", size: 16, color: COVER.footerColor, font: { ascii: "Arial" } }),
      new TextRun({ text: "                                              " }),
      new TextRun({ text: "Confidential", size: 16, color: COVER.footerColor, font: { ascii: "Arial" } }),
    ],
  }));

  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: COVER.bg },
        borders: noBorders,
        children,
      })],
    })],
  })];
}

// ═══════════════════════════════════════════════════════════════
//  Body component builders (RTL Arabic)
// ═══════════════════════════════════════════════════════════════

function h1(text) {
  return new Paragraph({
    bidirectional: true,
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.RIGHT,
    spacing: { before: 400, after: 160, line: 312 },
    children: [new TextRun({
      text, bold: true, size: 32, color: P.primary,
      font: { ascii: "Arial", eastAsia: "Arial" }, rtl: true,
    })],
  });
}

function h2(text) {
  return new Paragraph({
    bidirectional: true,
    heading: HeadingLevel.HEADING_2,
    alignment: AlignmentType.RIGHT,
    spacing: { before: 280, after: 120, line: 312 },
    children: [new TextRun({
      text, bold: true, size: 28, color: P.primary,
      font: { ascii: "Arial", eastAsia: "Arial" }, rtl: true,
    })],
  });
}

function h3(text) {
  return new Paragraph({
    bidirectional: true,
    heading: HeadingLevel.HEADING_3,
    alignment: AlignmentType.RIGHT,
    spacing: { before: 220, after: 100, line: 312 },
    children: [new TextRun({
      text, bold: true, size: 26, color: P.accent,
      font: { ascii: "Arial", eastAsia: "Arial" }, rtl: true,
    })],
  });
}

/** Body paragraph */
function p(text) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: 360 },
    spacing: { line: 312, after: 80 },
    children: [new TextRun({
      text, size: 24, color: P.body,
      font: { ascii: "Arial", eastAsia: "Arial" }, rtl: true,
    })],
  });
}

/** Bullet list item (RTL — uses Arabic-indented list) */
function bullet(text) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    indent: { right: 400, hanging: 200 },
    spacing: { line: 300, after: 60 },
    children: [
      new TextRun({ text: "•  ", size: 24, color: P.accent, rtl: true }),
      new TextRun({ text, size: 24, color: P.body, font: { ascii: "Arial", eastAsia: "Arial" }, rtl: true }),
    ],
  });
}

/** Bold-led paragraph: label + value (e.g. "الحقل: القيمة") */
function kv(label, value) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: 360 },
    spacing: { line: 312, after: 80 },
    children: [
      new TextRun({ text: label + ": ", bold: true, size: 24, color: P.primary, rtl: true, font: { ascii: "Arial" } }),
      new TextRun({ text: value, size: 24, color: P.body, rtl: true, font: { ascii: "Arial", eastAsia: "Arial" } }),
    ],
  });
}

/** Inline code / path styled run */
function codeRun(text) {
  return new TextRun({
    text, size: 21, color: P.accent, font: { ascii: "Courier New", eastAsia: "Arial" },
    shading: { type: ShadingType.CLEAR, fill: P.surface },
  });
}

/** Monospace bullet — for file paths */
function fileBullet(path, desc) {
  return new Paragraph({
    bidirectional: false,
    indent: { left: 400, hanging: 200 },
    spacing: { line: 300, after: 60 },
    children: [
      new TextRun({ text: "•  ", size: 21, color: P.accent }),
      codeRun(path),
      new TextRun({ text: "  —  " + desc, size: 24, color: P.body, font: { ascii: "Arial" } }),
    ],
  });
}

// ═══════════════════════════════════════════════════════════════
//  Table builder (Horizontal-only style)
// ═══════════════════════════════════════════════════════════════
function buildTable(headers, rows) {
  const headerCells = headers.map((text) => new TableCell({
    shading: { type: ShadingType.CLEAR, fill: P.accent },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold: true, size: 21, color: "FFFFFF", rtl: true, font: { ascii: "Arial" } })],
    })],
  }));

  const dataRows = rows.map((cells, idx) => new TableRow({
    cantSplit: true,
    children: cells.map((text) => new TableCell({
      shading: idx % 2 === 0 ? { type: ShadingType.CLEAR, fill: P.surface } : { type: ShadingType.CLEAR, fill: "FFFFFF" },
      margins: { top: 70, bottom: 70, left: 120, right: 120 },
      children: [new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: String(text), size: 20, color: P.body, rtl: true, font: { ascii: "Arial", eastAsia: "Arial" } })],
      })],
    })),
  }));

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: P.accent },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: P.accent },
      left: NB, right: NB,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "D0D0D0" },
      insideVertical: NB,
    },
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: headerCells }),
      ...dataRows,
    ],
  });
}

// ═══════════════════════════════════════════════════════════════
//  BODY CONTENT
// ═══════════════════════════════════════════════════════════════
function buildBody() {
  const children = [];

  // ── Executive Summary ──
  children.push(h1("الملخص التنفيذي"));
  children.push(p(
    "يوثّق هذا التقرير بناء الطبقة الذكية لمركز عمليات ARM (ARM Operations Command Center — AOCC)، " +
    "وهي طبقة ذكاء تشغيلي على مستوى الواجهة الأمامية تحوّل نظام المراقبة السلبي إلى مركز قيادة تشغيلي فعّال. " +
    "تعمل هذه الطبقة كمخ تشغيلي يُجمع، يُقيّم، ويُربط الأحداث من جميع الوحدات، ويُجيب عن سؤال واحد: ما الذي يتطلب إجراءً الآن؟"
  ));
  children.push(p(
    "تم بناء النظام بالكامل على مستوى الواجهة الأمامية (Frontend Intelligence Layer)، " +
    "دون أي تعديل على قاعدة بيانات Firebase Realtime Database، أو مسارات الـ API، أو منطق الأعمال، أو المصادقة، أو الصلاحيات، أو محرك القواعد، أو التقارير. " +
    "النظام يعيد استخدام جميع مصادر البيانات والخطّافات (hooks) والمنطق القائم، ويبني فوقها طبقة تجميع وتقييم وربط وتوصية."
  ));
  children.push(p(
    "تنقسم البنية إلى ثلاث طبقات نقيّة (Pure Layers): طبقة الأنواع (types)، طبقة المحرّك (engine — دوال نقيّة بلا آثار جانبية)، " +
    "وطبقة العرض (widgets — مُحفّظة بـ memo وموجَّهة بالصلاحيات). " +
    "يُغذّى كل ذلك عبر خطّاف مركزي واحد يملك جلب البيانات، ويمرّرها عبر خط أنابيب ذكاء (intelligence pipeline) " +
    "ينتهي بعشر ويدجتات متخصصة، كل منها تُعرض كمعلومة قابلة للتنفيذ لا كإحصائية سلبية."
  ));

  // ── 1. New Architecture ──
  children.push(h1("1. البنية الجديدة"));
  children.push(p(
    "البنية الجديدة لـ AOCC تعتمد على فصل صارم بين البيانات الخام، ومعالجة الذكاء، والعرض. " +
    "هذا الفصل يضمن قابلية الاختبار، الأداء، وإعادة الاستخدام، ويمنع أي اقتران (coupling) بين الواجهة وقاعدة البيانات."
  ));

  children.push(h2("1.1 الطبقات الثلاث"));
  children.push(buildTable(
    ["الطبقة", "الملف", "المسؤولية"],
    [
      ["الأنواع", "src/lib/aocc/types.ts", "تعريفات TypeScript نقيّة لكل الأنواع — بلا React أو API"],
      ["المحرّك", "src/lib/aocc/priority-engine.ts", "دوال نقية لتقييم الأولوية والترتيب والأنظمة البصرية"],
      ["المحرّك", "src/lib/aocc/event-collector.ts", "تجميع الأحداث وتوليد الإجراءات والارتباطات والتوصيات"],
      ["الخطّاف", "src/hooks/use-aocc.ts", "جلب البيانات عبر React Query مع polling كل 30 ثانية"],
      ["العرض", "src/components/aocc/AoccWidgets.tsx", "عشر ويدجتات مُحفّظة بـ memo وموجَّهة بالصلاحيات"],
      ["التنسيق", "src/components/aocc/AoccLayout.tsx", "يملك الذكاء ويُمرّر النتائج المشتقّة للويدجتات"],
    ]
  ));

  children.push(h2("1.2 مبدأ التصميم الأساسي"));
  children.push(p(
    "كل ما يُعرض في AOCC يجب أن يتطلّب اهتماماً أو تحقيقاً أو تعييناً أو اعتماداً أو تصعيداً أو قراراً. " +
    "لا تُعرض معلومات سلبية مطلقاً، ولا تُكرَّر الوحدات القائمة، ولا تُعرَّض أرقام خام دون سياق تشغيلي. " +
    "بدل عرض الأرقام نُظهر الأولويات، وبدل القوائم نُظهر الإجراءات، وبدل الإحصائيات نُظهر القرارات."
  ));

  // ── 2. Components Modified ──
  children.push(h1("2. المكوّنات المعدّلة والجديدة"));
  children.push(p(
    "لم تُحذف أي وحدة قائمة ولم تُعدّل واجهاتها. جميع التغييرات هي إضافات بنائية فوق البنية الحالية. " +
    "الجدول التالي يلخّص حالة كل ملف."
  ));
  children.push(buildTable(
    ["الملف", "النوع", "الحالة"],
    [
      ["src/lib/aocc/types.ts", "جديد", "تعريفات أنواع كاملة (9 مجموعات أنواع)"],
      ["src/lib/aocc/priority-engine.ts", "جديد", "محرّك تقييم + نظام بصري + دوال ترتيب"],
      ["src/lib/aocc/event-collector.ts", "جديد", "جامع أحداث + مولّد إجراءات + مُرتبط + توصيات"],
      ["src/hooks/use-aocc.ts", "جديد", "useRiskCenter, useNotificationStats, useOnlineUsers"],
      ["src/components/aocc/AoccWidgets.tsx", "تحسين", "عشر ويدجتات (تم استبدال القواميس السلبية)"],
      ["src/components/aocc/AoccLayout.tsx", "تحسين", "تغليف خط أنابيب الذكاء"],
      ["src/components/pages/OperationsCenterPage.tsx", "محافظ", "re-export فقط — بلا تغيير منطق"],
    ]
  ));
  children.push(p(
    "الويدجتات العشر المُحسَّنة هي: رأس المهمة، المؤشرات التشغيلية، طابور الإجراءات، صحة الأقسام، " +
    "قائمة المتابعة الذكية، التغذية المباشرة، مركز الذكاء، الإجراءات السريعة، حالة النظام، والملخص التنفيذي."
  ));

  // ── 3. New Reusable Hooks ──
  children.push(h1("3. الخطّافات الجديدة القابلة لإعادة الاستخدام"));
  children.push(p("أُضيفت ثلاث خطّافات في src/hooks/use-aocc.ts، جميعها تعتمد على React Query مع تحديث تلقائي كل 30 ثانية:"));
  children.push(fileBullet("useRiskCenter(params?)", "يجلب مركز المخاطر مع فلترة حسب القسم/المستوى؛ staleTime 15 ثانية"));
  children.push(fileBullet("useNotificationStats()", "إحصائيات الإشعارات الكلية (غير مقروءة، حرجة، اليوم، متأخرة)"));
  children.push(fileBullet("useOnlineUsers(minutes=2)", "المستخدمون النشطون — مُبوّب بصلاحية controlPanel فقط"));
  children.push(p(
    "بالإضافة إلى خطّاف داخلي useActivityLogs() في AoccLayout يجلب سجلات النشاط اليومية للمشرفين فقط، " +
    "وينخفض تلقائياً (disabled) للمستخدمين بدون صلاحية controlPanel. " +
    "كل خطّاف يحترم نظام الصلاحيات القائم عبر usePermissions، فلا يُجلب أي بيانات لا يملك المستخدم حق رؤيتها."
  ));

  // ── 4. New Utility Functions ──
  children.push(h1("4. الدوال المساعدة الجديدة"));
  children.push(h2("4.1 محرّك الأولوية (priority-engine.ts)"));
  children.push(buildTable(
    ["الدالة", "الوصف"],
    [
      ["calculatePriorityScore(event)", "تقييم حدث على مقياس 0–100 واستخراج العوامل المؤثرة"],
      ["getPriorityLevel(score)", "تحويل الدرجة الرقمية إلى مستوى (critical/high/medium/low)"],
      ["getPriorityVisual(level)", "إرجاع الإعداد البصري (حدود/توهج/شارة) لكل مستوى"],
      ["comparePriority(a, b)", "مقارنة ترتيبية: المستوى ثم الدرجة ثم تاريخ الاستحقاق"],
      ["sortByPriority(items)", "ترتيب مصفوفة بالكامل حسب الأولوية"],
      ["scoreAndSortEvents(events)", "تقييم وترتيب دفعة أحداث دفعة واحدة"],
      ["countByPriority(items)", "عدّ العناصر حسب كل مستوى أولوية"],
    ]
  ));

  children.push(h2("4.2 جامع الأحداث (event-collector.ts)"));
  children.push(buildTable(
    ["الدالة", "الوصف"],
    [
      ["collectEvents(data)", "تطبيع كل البيانات إلى بنية OperationalEvent موحّدة"],
      ["generateActions(events)", "توليد طابور إجراءات موحّد مُرتّب بالإلحاح"],
      ["correlateEmployee(id, data)", "ربط كل بيانات موظف عبر الوحدات في بطاقة واحدة"],
      ["correlAllEmployees(data)", "ربط كل الموظفين عالي/حرج المخاطر"],
      ["analyzeDepartmentHealth(name, data)", "تحليل صحة قسم متعدد العوامل"],
      ["analyzeAllDepartments(data)", "تحليل كل الأقسام وترتيبها من الأسوأ"],
      ["generateRecommendations(...)", "توليد توصيات ذكية مبنية على الأنماط لا عشوائية"],
      ["buildActivityFeed(notifs, logs)", "بناء تغذية مباشرة مرتّبة بالأحدث أولاً (50 كحد أقصى)"],
      ["generateExecutiveIntelligence(...)", "ملخّص تنفيذي: ما حدث اليوم، التصعيد، الأقسام"],
    ]
  ));

  // ── 5. Event Aggregation Flow ──
  children.push(h1("5. مسار تجميع الأحداث"));
  children.push(p(
    "يتدفّق النظام في خط أنابيب أحادي الاتجاه (unidirectional pipeline). " +
    "كل مرحلة دالة نقيّة تأخذ مدخلاً وتُنتج مُخرجاً قابلاً للتحسين التلقائي عبر useMemo، " +
    "مما يضمن عدم إعادة الحساب إلا عند تغيّر البيانات الفعلية."
  ));

  children.push(h2("5.1 مراحل خط الأنابيب"));
  children.push(bullet("المرحلة 1 — جلب البيانات الخام: عبر الخطّافات القائمة (useHomeStats, useCAPACases, useComplaints, useFollowUps) وخطّافات AOCC الجديدة."));
  children.push(bullet("المرحلة 2 — بناء الحزمة: تجميع كل البيانات في RawDataBundle واحد عبر useMemo."));
  children.push(bullet("المرحلة 3 — التجميع والتطبيع: collectEvents() يحوّل كل سجل إلى OperationalEvent ببنية موحّدة."));
  children.push(bullet("المرحلة 4 — التقييم: scoreAndSortEvents() يمنح كل حدث درجة ومستوى وعوامل."));
  children.push(bullet("المرحلة 5 — التوليد: generateActions() يحوّل الأحداث المُقيَّمة إلى عناصر طابور قابلة للتنفيذ."));
  children.push(bullet("المرحلة 6 — الربط: correlateAllEmployees() و analyzeAllDepartments() ينتجان الصورة الشاملة."));
  children.push(bullet("المرحلة 7 — التوصيات: generateRecommendations() يكتشف الأنماط عبر الوحدات."));
  children.push(bullet("المرحلة 8 — العرض: كل ويدجت تتلقّى نتائجها المُحضَّرة وتعرضها بصرياً."));

  children.push(h2("5.2 مصادر الأحداث المُجمَّعة"));
  children.push(p("يجمع collectEvents() أحداثاً من المصادر التالية، ويُطبعها جميعاً إلى بنية OperationalEvent واحدة:"));
  children.push(buildTable(
    ["المصدر", "نوع الحدث المُولَّد"],
    [
      ["CAPA", "كابا متأخرة / حرجة / عالية / تحذير SLA"],
      ["Complaints", "شكوى حرجة / عالية"],
      ["Follow-Ups", "متابعة مستحقة / مجدولة اليوم"],
      ["Risk Center", "مخاطر حرجة / عالية لكل موظف"],
      ["Travel", "سفر عاجل خلال يومين"],
      ["Requests", "طلب معلّق أكثر من 12 ساعة"],
      ["Notifications", "إشعارات حرجة/عالية غير مقروءة"],
    ]
  ));

  // ── 6. Priority Calculation Logic ──
  children.push(h1("6. منطق حساب الأولوية"));
  children.push(p(
    "يستخدم النظام محرّك تقييم متعدد العوامل. كل حدث يُحلَّل لاستخراج العوامل المؤثرة، " +
    "كل عامل يمنح نقاطاً محدودة السقف، ثم يُجمَع المجموع ويُقالَب على 100. " +
    "هذا يضمن أن الحدث الواحد لا يهيمن بسبب عامل واحد فقط، بل يعكس خطورة شاملة."
  ));

  children.push(h2("6.1 عوامل التقييم"));
  children.push(buildTable(
    ["العامل", "المُضاعف", "أقصى نقاط", "المنطق"],
    [
      ["مخاطر حرجة/عالية", "1.5", "15", "critical كاملة، high × 0.6"],
      ["كابا متأخرة", "1.4", "14", "حسب عدد أيام التأخير (حتى 10)"],
      ["كابا بأولوية حرجة", "1.3", "13", "نقاط كاملة ثابتة"],
      ["شكوى حرجة", "1.3", "13", "نقاط كاملة ثابتة"],
      ["تجاوز SLA", "1.2", "12", "حسب الأيام المتبقية"],
      ["مشاكل متكررة (3+)", "1.2", "12", "حسب عدد المشاكل (حتى 6)"],
      ["متابعة مستحقة", "1.1", "11", "نقاط كاملة ثابتة"],
      ["درجة مخاطر عالية (≥36)", "1.0", "10", "حسب الدرجة"],
      ["موافقة معلّقة (>24س)", "0.8", "8", "حسب ساعات الانتظار"],
    ]
  ));

  children.push(h2("6.2 عتبات المستويات"));
  children.push(buildTable(
    ["المستوى", "الدرجة", "الدلالة"],
    [
      ["حرج (Critical)", "≥ 70", "يتطلب تدخلاً فورياً وتصعيداً"],
      ["عالي (High)", "≥ 40", "أولوية عالية، تعيين ومتابعة"],
      ["متوسط (Medium)", "≥ 20", "متابعة ضمن الخطة"],
      ["منخفض (Low)", "< 20", "سياق تشغيلي عام"],
    ]
  ));

  children.push(p(
    "يوجد أيضاً سجل درجات أساسية (getBaseScoreForType) كاحتياطي عندما لا تُستخرج عوامل محددة، " +
    "بقيم تتراوح بين 5 و 60 حسب نوع الحدث، مما يضمن أن كل حدث يحصل على درجة معقولة حتى بدون metadata غنية."
  ));

  // ── 7. Correlation Logic ──
  children.push(h1("7. منطق الربط بين الوحدات"));
  children.push(p(
    "الربط هو قلب الذكاء التشغيلي. بدل إظهار خمس بطاقات غير مرتبطة لنفس الموظف، " +
    "يجمع correlateEmployee() كل البيانات في بطاقة تشغيلية واحدة متماسكة."
  ));

  children.push(h2("7.1 مسار الربط لكل موظف"));
  children.push(bullet("البحث عن الموظف في بيانات مركز المخاطر (riskEmployees)."));
  children.push(bullet("تجميع كابا الخاص به: filter capaItems حسب employeeId."));
  children.push(bullet("تجميع الشكاوى: filter complaintItems حسب employeeId."));
  children.push(bullet("تجميع المتابعات: filter followUpItems حسب employeeId."));
  children.push(bullet("حساب المتأخرة (overdue) والحرجة (critical) لكل وحدة عبر الدوال القائمة."));
  children.push(bullet("استخراج بيانات الحضور من إحصائيات home (lateEmployees, topOffenders)."));
  children.push(bullet("حساب الحالة التشغيلية (determineOperationalStatus) من مستوى المخاطر + الإجراءات المفتوحة + عدد الوحدات المتأثرة."));
  children.push(bullet("توليد توصيات مستهدفة حسب نمط الموظف (generateEmployeeRecommendations)."));

  children.push(h2("7.2 أنماط التوصيات المكتشَفة"));
  children.push(buildTable(
    ["النمط", "الفئة", "الشرط"],
    [
      ["تحقيق شامل", "investigation", "موظف متأثر في 3+ وحدات"],
      ["سبب جذر مشترك", "correlation", "كابا متأخرة + شكاوى لنفس الموظف"],
      ["مراجعة قسم", "review", "صحة قسم < 70% أو قضايا حرجة"],
      ["توجيه/تدريب", "coaching", "3+ مشاكل حضور + اتجاه متدهور"],
      ["تعيين مسؤول", "assignment", "إجراءات حرجة غير معيَّنة"],
      ["تصعيد SLA", "escalation", "3+ قضايا تتجاوز SLA"],
    ]
  ));

  // ── 8. Performance ──
  children.push(h1("8. تحسينات الأداء"));
  children.push(p("الأداء مُصمَّم في بنية النظام نفسها عبر عدة طبقات حماية:"));

  children.push(h2("8.1 الحفظ التلقائي (Memoization)"));
  children.push(p(
    "كل مرحلة في خط الأنابيب ملفوفة بـ useMemo مع تبعيات دقيقة. " +
    "لا تُعاد الحسابات إلا عند تغيّر البيانات الفعلية. " +
    "الحزمة الخام (rawData) نفسها ملفوفة بـ useMemo، فيتدلّى الحفظ تلقائياً عبر كل المراحل التابعة لها."
  ));

  children.push(h2("8.2 مُحفّظات الويدجت (Memoized Widgets)"));
  children.push(p(
    "جميع الويدجتات العشر مغلَّفة بـ React.memo (10 استخدامات memo موثّقة). " +
    "هذا يمنع إعادة العرض (re-render) عندما تتغيّر خاصيّة لا تخصّ الويدجت. " +
    "الويدجت لا يُعاد رسمها إلا عند تغيّر بياناتها المحدّدة."
  ));

  children.push(h2("8.3 التحديث الزمني الانتقائي"));
  children.push(p(
    "التحديث التلقائي (polling) مضبوط على 30 ثانية لخطّافات AOCC، مع staleTime 15 ثانية، " +
    "مما يمنع الطلبات المتكررة غير الضرورية. " +
    "الخطّافات الإدارية (onlineUsers, activityLogs) مُبوّبة بصلاحية controlPanel فتنخفض تلقائياً للمستخدمين العاديين — لا تُجلب بيانات لا تُعرض."
  ));

  children.push(h2("8.4 تحديد القوائم الطويلة"));
  children.push(p(
    "طابور الإجراءات يُعرِض أول 50 عنصراً مع زر 'عرض الكل' للباقي (displayItems = visibleItems.slice(0, 50)). " +
    "التغذية المباشرة محدودة بـ 50 إدخالاً أحدث أولاً. " +
    "قائمة المتابعة محدودة بـ 12 موظفاً، والتوصيات بـ 8. هذا يمنع تضخّم الـ DOM ويحافظ على استجابة الواجهة."
  ));

  children.push(h2("8.5 التحميل الكسول للصفحات"));
  children.push(p(
    "صفحة AOCC مُحمَّلة كسولاً عبر dynamic(() => ..., { ssr: false }) في app/page.tsx، " +
    "فيُنزَّل كودها فقط عند الحاجة، مما يسرّع التحميل الأولي للتطبيق."
  ));

  // ── 9. Permission Validation ──
  children.push(h1("9. التحقق من الصلاحيات"));
  children.push(p(
    "يحترم النظام نظام الصلاحيات القائم بالكامل عبر usePermissions و canViewPage. " +
    "إذا لم يملك المستخدم صلاحية وحدة ما، تُخفى ذكاء تلك الوحدة تلقائياً — لا تظهر أي بيانات لا يحق له رؤيتها."
  ));

  children.push(h2("9.1 نقاط تطبيق الصلاحيات"));
  children.push(buildTable(
    ["الموقع", "المنطق"],
    [
      ["AoccLayout (الحارس الرئيسي)", "usePermissions('operationsCenter') — يمنع الدخول كلياً بدونها"],
      ["AoccOperationalOverview", "canViewPage(tile.permission) — يصفّي كل بلاطة KPI"],
      ["AoccActionQueue", "canViewPage(item.sourceModule) — يخفي الإجراءات المحظورة"],
      ["AoccEmployeeWatchlist", "canViewPage('riskCenter') — يُخفي الويدجت كاملة"],
      ["AoccQuickActions", "canViewPage(action.targetPage) — يصفّي الإجراءات السريعة"],
      ["useOnlineUsers / useActivityLogs", "canViewPage('controlPanel') — يجعل الطلب disabled"],
    ]
  ));

  children.push(p(
    "مفاتيح الصلاحيات المستخدمة (operationsCenter, riskCenter, capa, complaints, followUps, quality, biometric, requests, notifications, travel, hrDeductions, controlPanel) " +
    "جميعها مطابقة تماماً للتعريفات في src/config/permissions.ts — لم تُضَف أو تُعدَّل أي صلاحية جديدة."
  ));

  // ── 10. Responsive Validation ──
  children.push(h1("10. التحقق من التجاوب"));
  children.push(p("صُمِّم النظام ليعمل بسلاسة على جميع الأحجام بدون تمرير أفقي أو كسر تخطيط:"));

  children.push(h2("10.1 الشبكة الرئيسية"));
  children.push(bullet("السطح المكتب/اللابتوب: شبكة عمودين (DashboardGrid columns={2}) للأقسام المتجاورة."));
  children.push(bullet("الجوال/اللوحي: تنهار إلى عمود واحد تلقائياً عبر grid-cols-1 lg:grid-cols-2."));
  children.push(bullet("الحشو (padding): p-4 على الجوال، p-4 md:p-6 على الأكبر — يضيف مساحة عند الحاجة."));

  children.push(h2("10.2 بلاطات KPI"));
  children.push(p(
    "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 — بلاطتان على الجوال، ثلاث على اللوحي، خمس على السطح المكتب. " +
    "هذا يضمن ملاءمة الشاشات الصغيرة دون أشرطة تمرير."
  ));

  children.push(h2("10.3 دعم RTL"));
  children.push(p(
    "المسار الرئيسي dir=\"rtl\" على الحاوية. كل النصوص والتخطيطات محاذاة لليمين. " +
    "العناصر الزمنية (الساعة، التواريخ) محمية بـ dir=\"ltr\" لعرض صحيح. " +
    "الأيقونات والأسهم معكوسة الاتجاه منطقياً (ChevronLeft للتنقّل في RTL)."
  ));

  children.push(h2("10.4 الالتفاف المرن"));
  children.push(p(
    "استخدام flex-wrap واسع في رأس المهمة والإجراءات السريعة وبطاقات الأقسام، " +
    "فيتراجع المحتوى أنيقاً على الشاشات الضيقة بدل تجاوز حدود الحاوية. " +
    "إخفاء عناصر ثانوية على الجوال عبر hidden sm:block (مثل نص 'آخر مزامنة')."
  ));

  // ── 11. Confirmation: No Regressions ──
  children.push(h1("11. تأكيد عدم الانتكاسات"));
  children.push(p(
    "تم التحقق من أن البناء لا يكسر أي وظيفة قائمة. " +
    "فحص TypeScript على ملفات AOCC نظيف تماماً (الخطأ الوحيد في المشروع هو وحدة input-otp غير المتعلقة بـ AOCC)، " +
    "وفحص ESLint على src/lib/aocc/ و src/components/aocc/ و src/hooks/use-aocc.ts يعود برمز خروج 0 — بلا تحذيرات."
  ));

  children.push(h2("11.1 بنود التأكيد"));
  children.push(buildTable(
    ["البند", "الحالة"],
    [
      ["لم تُغيَّر بنية Firebase Realtime Database", "مُؤكَّد — لا توجد كتابة/مخطط جديد"],
      ["لم تُغيَّر أي مسار API", "مُؤكَّد — استهلاك للقائم فقط"],
      ["لم تُغيَّر نظام المصادقة", "مُؤكَّد — AuthContext كما هو"],
      ["لم تُغيَّر نظام الصلاحيات", "مُؤكَّد — استخدام usePermissions القائم"],
      ["لم يُغيَّر منطق الأعمال", "مُؤكَّد — طبقة عرض/ذكاء فقط"],
      ["لم تُكسَر أي وحدة قائمة", "مُؤكَّد — عمليات قراءة/إعادة استخدام فقط"],
      ["لم تُعدَّل الـ hooks القائمة", "مُؤكَّد — استخدام لا تعديل"],
      ["لم يُغيَّر محرك القواعد", "مُؤكَّد — استهلاك إشعاراته فقط"],
      ["لم تُغيَّر تكامل Employee360", "مُؤكَّد — استدعاء openEmployee360 كما هو"],
      ["لم تُغيَّر Risk Center / CAPA / Complaints / Attendance / Follow-Ups", "مُؤكَّد — قراءة فقط"],
    ]
  ));

  children.push(h2("11.2 طريقة الإطلاق الآمن"));
  children.push(p(
    "نقطة الدخول الوحيدة (OperationsCenterPage.tsx) هي re-export بسيط بلا منطق، " +
    "فتغيير AoccLayout إلى النسخة الذكية شفّاف تماماً للمسار القائم. " +
    "إذا لزم التراجع، يكفي إعادة استيراد التصميم القديم من نقطة واحدة دون لمس أي ملف آخر."
  ));

  // ── 12. The Visual Priority System ──
  children.push(h1("12. النظام البصري للأولوية"));
  children.push(p(
    "كل بطاقة تشغيلية تُوصل الإلحاح بصرياً قبل النص. النظام يعتمد أربع مستويات، " +
    "لكل منها حدود، لون تمييز، توهج، وشارة مميّزة. لا يُترك التواصل للنص وحده."
  ));
  children.push(buildTable(
    ["المستوى", "اللون", "الحدود", "التوهج", "الشارة"],
    [
      ["حرج", "أحمر (red-500)", "border-red-500/50", "shadow توهج أحمر", "خلفية حمراء شفافة"],
      ["عالي", "كهرماني (amber-500)", "border-amber-500/40", "توهج خفيف كهرماني", "خلفية كهرمانية شفافة"],
      ["متوسط", "أزرق (blue-500)", "border-blue-500/30", "بلا توهج", "خلفية زرقاء شفافة"],
      ["منخفض", "رمادي (slate-600)", "border-slate-600/30", "بلا توهج", "خلفية رمادية شفافة"],
    ]
  ));
  children.push(p(
    "تُستخدم البطاقات الحرجة مع class للتوهج و bgTint، بينما رأس المهمة نفسه يتغيّر لون إطاره وتوهجه عند وجود عناصر حرجة (hasCritical)، " +
    "مما يُوصل حالة الطوارئ فور تحميل الصفحة."
  ));

  // ── 13. Empty States ──
  children.push(h1("13. الحالات الفارغة"));
  children.push(p(
    "عند غياب الإجراءات، لا تُعرض بطاقات فارغة. بدل ذلك تُعرض رسالة واضحة: " +
    "'لا توجد إجراءات تشغيلية تتطلب اهتمامك حالياً — النظام تحت السيطرة' مع أيقونة تأكيد خضراء. " +
    "هذا يحوّل غياب البيانات إلى طمأنة تشغيلية بدل الارتباك البصري. " +
    "يوجد 10 نقاط empty state موثّقة عبر DashboardCard و NoActionsEmpty."
  ));

  // ── 14. Executive Summary ──
  children.push(h1("14. الذكاء التنفيذي"));
  children.push(p(
    "الملخص التنفيذي يُجيب عن خمسة أسئلة محورية عبر generateExecutiveIntelligence: " +
    "ماذا حدث اليوم؟ (عدّ أحداث اليوم/المحلولة/الحرجة)، ماذا يتطلب اهتماماً تنفيذياً؟ (أعلى 5 أولويات)، " +
    "أي قسم تدهور؟ (القسم الأقل صحة)، مَن يحتاج تصعيداً؟ (أعلى 3 مرشّحين)، وأي مؤشر تحسّن؟ (تغيّرات الشهر)."
  ));
  children.push(p(
    "كل عنصر قابل للنقر — يفتح الصفحة ذات الصلة أو ملف الموظف360. " +
    "مؤشرات الاتجاه (TrendIndicator) تعكس بطريقة ذكية طبيعة المؤشر: " +
    "زيادة التأخيرات تُعرض بالأحمر (سيئ)، بينما زيادة الحضور بالأخضر (جيد) عبر invertColor."
  ));

  // ── 15. Department Health Engine ──
  children.push(h1("15. محرّك صحة الأقسام"));
  children.push(p(
    "تحلّل analyzeDepartmentHealth صحة كل قسم عبر عوامل متعدّدة، تبدأ من 100 وتُخصم تدريجياً: " +
    "الغياب حتى -40، عدد الكابا حتى -20، الكابا المتأخرة حتى -15، الشكاوى حتى -15، والموظفون عاليو المخاطر حتى -10. " +
    "النتيجة نسبة مئوية مصاحبة لاتجاه، عدد حرج، تحذيرات، وإجراء موصى به. " +
    "بطاقات الأقسام أصبحت قابلة للنقر — تنقل مباشرة إلى صفحة الحضور/القسم."
  ));

  // ── Conclusion ──
  children.push(h1("الخلاصة"));
  children.push(p(
    "تحوّل AOCC من صفحة مراقبة سلبية إلى مركز قيادة تشغيلي حقيقي. " +
    "النظام لا يعرض ما حدث فحسب، بل يُجيب عن ما يتطلّب إجراءً الآن، ويُرتّب الأولويات، " +
    "ويربط بين الوحدات، ويُولّد توصيات مبنية على أنماط حقيقية لا عشوائية، ويُكيّف نفسه مع صلاحيات كل مستخدم."
  ));
  children.push(p(
    "كل ذلك أُنجِز بالكامل على مستوى الواجهة الأمامية، دون لمس العمود الفقري للنظام — " +
    "قاعدة البيانات، الـ APIs، المصادقة، الصلاحيات، ومنطق الأعمال جميعها محفوظة كما هي، " +
    "وقد تأكّد نظافة TypeScript و ESLint، وتم توثيق كل نقطة تطبيق للصلاحية والتجاوب."
  ));

  return children;
}

// ═══════════════════════════════════════════════════════════════
//  ASSEMBLY
// ═══════════════════════════════════════════════════════════════

const pageMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };

const footer = new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({ text: "ARM ERP — AOCC Technical Report  ·  Page ", size: 18, color: "808080", font: { ascii: "Arial" } }),
      new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: { ascii: "Arial" } }),
    ],
  })],
});

const header = new Header({
  children: [new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    children: [new TextRun({
      text: "تقرير البنية التقنية — مركز عمليات ARM",
      size: 18, color: "808080", rtl: true, font: { ascii: "Arial" },
    })],
  })],
});

const doc = new Document({
  creator: "ARM ERP",
  title: "AOCC Technical Architecture Report",
  description: "Technical report for the ARM Operations Command Center intelligence layer",
  styles: {
    default: {
      document: {
        run: {
          font: { ascii: "Arial", eastAsia: "Arial" },
          size: 24,
          color: P.body,
        },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: { ascii: "Arial", eastAsia: "Arial" }, size: 32, bold: true, color: P.primary },
        paragraph: { spacing: { before: 400, after: 160, line: 312 }, outlineLevel: 0 },
      },
      heading2: {
        run: { font: { ascii: "Arial", eastAsia: "Arial" }, size: 28, bold: true, color: P.primary },
        paragraph: { spacing: { before: 280, after: 120, line: 312 }, outlineLevel: 1 },
      },
      heading3: {
        run: { font: { ascii: "Arial", eastAsia: "Arial" }, size: 26, bold: true, color: P.accent },
        paragraph: { spacing: { before: 220, after: 100, line: 312 }, outlineLevel: 2 },
      },
    },
  },
  sections: [
    // ── Cover section ──
    {
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 0, bottom: 0, left: 0, right: 0 },
        },
      },
      children: buildCover(),
    },
    // ── Body section ──
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          size: { width: 11906, height: 16838 },
          margin: pageMargin,
          pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL },
        },
      },
      headers: { default: header },
      footers: { default: footer },
      children: buildBody(),
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  const outPath = "AOCC-Technical-Report.docx";
  fs.writeFileSync(outPath, buf);
  console.log("✓ Report generated: " + outPath + " (" + buf.length + " bytes)");
}).catch((err) => {
  console.error("✗ Generation failed:", err);
  process.exit(1);
});
