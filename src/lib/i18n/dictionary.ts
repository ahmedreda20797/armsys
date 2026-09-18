// src/lib/i18n/dictionary.ts
// ══════════════════════════════════════════════════════════════
//  §20.1 Qnlys translation dictionary — THE coherent translation
//  architecture (no ad-hoc conditional text in components).
//
//  Flat key dictionary (namespace:key). Arabic is the SOURCE language
//  (the app's origin); English is the secondary locale. Keys are
//  grouped by namespace for review but stored flat for O(1) lookup.
//
//  COVERAGE (this milestone): shell chrome, navigation groups, common
//  actions, dialogs, filters, empty states, settings, login, loading.
//  Domain pages keep their inline Arabic strings until they migrate to
//  `t()` — the dictionary is additive, so each page can adopt keys at
//  its own pace without a breaking switch.
// ══════════════════════════════════════════════════════════════

export type Locale = 'ar' | 'en';

export const DICTIONARY = {
  // ── Shell / loading ──
  'app.name': { ar: 'Qnlys', en: 'Qnlys' },
  // §LOGIN-DESCRIPTOR — the official Arabic application descriptor for
  // the login presentation (the English tagline under the logo is the
  // FIXED brand statement and is never translated).
  'app.tagline': { ar: 'منصة الذكاء التشغيلي وإدارة الجودة', en: 'Operational Intelligence Platform' },
  'loading.text': { ar: 'جاري التحميل...', en: 'Loading...' },
  'loading.brand': { ar: 'جاري التحميل...', en: 'Loading...' },

  // ── Login ──
  'login.title': { ar: 'تسجيل الدخول', en: 'Sign in' },
  'login.subtitle': { ar: 'أدخل بياناتك للوصول إلى النظام', en: 'Enter your credentials to access the system' },
  'login.email': { ar: 'البريد الإلكتروني', en: 'Email' },
  'login.password': { ar: 'كلمة المرور', en: 'Password' },
  'login.submit': { ar: 'تسجيل الدخول', en: 'Sign in' },
  'login.submitting': { ar: 'جاري تسجيل الدخول...', en: 'Signing in...' },
  'login.footer': { ar: 'منصة الذكاء التشغيلي وإدارة الجودة', en: 'Operational Intelligence Platform' },
  'login.success': { ar: 'تم تسجيل الدخول بنجاح!', en: 'Signed in successfully!' },
  // §BRAND — the official Qnlys tagline is a FIXED identity element:
  // the exact approved English wording in BOTH locales (never translated
  // or rewritten); only the surrounding interface follows the language.
  'login.tagline': {
    ar: 'Analyze Data. Assure Quality. Optimize Operations.',
    en: 'Analyze Data. Assure Quality. Optimize Operations.',
  },

  // ── Navigation groups ──
  'nav.daily_ops': { ar: 'العمليات اليومية', en: 'Daily Operations' },
  'nav.employee_mgmt': { ar: 'إدارة الموظفين', en: 'Employee Management' },
  'nav.quality_ctrl': { ar: 'الجودة والرقابة', en: 'Quality & Control' },
  'nav.hr': { ar: 'الموارد البشرية', en: 'Human Resources' },
  'nav.travel_ops': { ar: 'العمليات والسفر', en: 'Operations & Travel' },
  'nav.reports': { ar: 'التقارير والتحليلات', en: 'Reports & Analytics' },
  'nav.settings': { ar: 'الإدارة والإعدادات', en: 'Administration & Settings' },

  // ── Sidebar / shell actions ──
  'sidebar.pin': { ar: 'تثبيت القائمة', en: 'Pin menu' },
  'sidebar.unpin': { ar: 'إلغاء تثبيت القائمة', en: 'Unpin menu' },
  'sidebar.expand': { ar: 'توسيع القائمة', en: 'Expand menu' },
  'sidebar.collapse': { ar: 'تصغير القائمة', en: 'Collapse menu' },
  'sidebar.close': { ar: 'إغلاق القائمة', en: 'Close menu' },
  'sidebar.open': { ar: 'فتح القائمة', en: 'Open menu' },
  'sidebar.customize': { ar: 'تخصيص القائمة', en: 'Customize menu' },
  'sidebar.resetOrder': { ar: 'إعادة للوضع الافتراضي', en: 'Reset to default' },
  'sidebar.pinnedPages': { ar: 'المثبتة', en: 'Pinned' },
  'sidebar.favoritePages': { ar: 'المفضلة', en: 'Favorites' },
  'sidebar.menuSettings': { ar: 'إعدادات القائمة', en: 'Menu settings' },
  'sidebar.logout': { ar: 'تسجيل الخروج', en: 'Sign out' },
  'sidebar.mainNav': { ar: 'التنقل الرئيسي', en: 'Main navigation' },
  'sidebar.addFavorite': { ar: 'إضافة للمفضلة ⭐', en: 'Add to favorites ⭐' },
  'sidebar.removeFavorite': { ar: 'إزالة الصفحة من المفضلة', en: 'Remove from favorites' },
  'sidebar.pinPage': { ar: 'تثبيت 📌', en: 'Pin 📌' },
  'sidebar.unpinPage': { ar: 'إزالة تثبيت الصفحة', en: 'Unpin page' },
  'sidebar.removeEntry': { ar: 'إزالة', en: 'Remove' },
  'sidebar.pagesNav': { ar: 'الصفحات', en: 'Pages' },
  'sidebar.groupsNav': { ar: 'مجموعات التنقل', en: 'Navigation groups' },
  'sidebar.escHint': { ar: 'اضغط Esc للإغلاق', en: 'Press Esc to close' },

  // ── Common actions ──
  'action.save': { ar: 'حفظ', en: 'Save' },
  'action.cancel': { ar: 'إلغاء', en: 'Cancel' },
  'action.close': { ar: 'إغلاق', en: 'Close' },
  'action.delete': { ar: 'حذف', en: 'Delete' },
  'action.edit': { ar: 'تعديل', en: 'Edit' },
  'action.add': { ar: 'إضافة', en: 'Add' },
  'action.approve': { ar: 'اعتماد', en: 'Approve' },
  'action.reject': { ar: 'رفض', en: 'Reject' },
  'action.confirm': { ar: 'تأكيد', en: 'Confirm' },
  'action.refresh': { ar: 'تحديث', en: 'Refresh' },
  'action.search': { ar: 'بحث', en: 'Search' },
  'action.clear': { ar: 'مسح', en: 'Clear' },
  'action.print': { ar: 'طباعة', en: 'Print' },
  'action.export': { ar: 'تصدير', en: 'Export' },
  'action.retry': { ar: 'إعادة المحاولة', en: 'Retry' },

  // ── Common states ──
  'state.empty': { ar: 'لا توجد بيانات', en: 'No data' },
  'state.noResults': { ar: 'لا توجد نتائج', en: 'No results' },
  'state.loading': { ar: 'جاري التحميل...', en: 'Loading...' },
  'state.saving': { ar: 'جاري الحفظ...', en: 'Saving...' },
  'state.insufficientData': { ar: 'بيانات غير كافية', en: 'Insufficient data' },
  'state.unavailable': { ar: 'غير متاح', en: 'Unavailable' },

  // ── Search ──
  'search.placeholder': { ar: 'ابحث في Qnlys...', en: 'Search Qnlys...' },

  // ── Settings ──
  'settings.title': { ar: 'الإعدادات', en: 'Settings' },
  'settings.description': { ar: 'الملف الشخصي والتفضيلات السريعة — اللغة والمظهر', en: 'Profile and quick preferences — language and appearance' },
  'settings.quick': { ar: 'الإعدادات السريعة', en: 'Quick settings' },
  'settings.profile': { ar: 'الملف الشخصي', en: 'Profile' },
  'settings.appearance': { ar: 'المظهر', en: 'Appearance' },
  'settings.language': { ar: 'اللغة', en: 'Language' },
  'settings.theme': { ar: 'النمط', en: 'Theme' },
  'settings.theme.dark': { ar: 'داكن', en: 'Dark' },
  'settings.theme.light': { ar: 'فاتح', en: 'Light' },
  'settings.theme.system': { ar: 'النظام', en: 'System' },
  'settings.systemLink': { ar: 'إعدادات النظام (مركز التحكم)', en: 'System settings (Control Panel)' },
  'settings.systemHint': { ar: 'إدارة المستخدمين والصلاحيات — متاحة لمدير النظام', en: 'Users and permissions administration — system owner only' },
  'settings.name': { ar: 'الاسم', en: 'Name' },
  'settings.email': { ar: 'البريد الإلكتروني', en: 'Email' },
  'settings.role': { ar: 'الدور', en: 'Role' },
  'settings.saved': { ar: 'تم حفظ الإعدادات', en: 'Settings saved' },
  'settings.saveFailed': { ar: 'تعذر حفظ الإعدادات', en: 'Failed to save settings' },

  // ── Notifications ──
  'notifications.title': { ar: 'الإشعارات', en: 'Notifications' },

  // ── Access ──
  'access.denied.title': { ar: 'صلاحية غير كافية', en: 'Insufficient permission' },
  'access.denied.body': { ar: 'ليس لديك صلاحية للوصول إلى هذه الصفحة. يرجى التواصل مع مدير النظام إذا كنت تعتقد أن هذا خطأ.', en: 'You do not have permission to access this page. Contact the system owner if you believe this is a mistake.' },

  // ── Confirm dialog ──
  'confirm.deleteTitle': { ar: 'تأكيد الحذف', en: 'Confirm deletion' },
  'confirm.deleteBody': { ar: 'هل أنت متأكد من تنفيذ هذه العملية؟ لا يمكن التراجع عنها بعد التنفيذ.', en: 'Are you sure? This action cannot be undone.' },

  // ── §I18N-BILINGUAL — Header ──
  'header.openMenu': { ar: 'فتح القائمة', en: 'Open menu' },
  'header.quickActions': { ar: 'إجراءات سريعة', en: 'Quick actions' },
  'header.notifications': { ar: 'الإشعارات', en: 'Notifications' },
  'header.account': { ar: 'الحساب', en: 'Account' },
  'header.profile': { ar: 'الملف الشخصي', en: 'Profile' },
  'header.profileFallbackUser': { ar: 'المستخدم', en: 'User' },
  'header.logout': { ar: 'تسجيل الخروج', en: 'Sign out' },

  // ── §I18N-BILINGUAL — Global search ──
  'search.label': { ar: 'البحث في Qnlys', en: 'Search Qnlys' },
  'search.expandedPlaceholder': { ar: 'ابحث في Qnlys... موظف، عميل، رقم، ملاحظة، صفقة', en: 'Search Qnlys... employee, customer, number, note, deal' },
  'search.searching': { ar: 'جارٍ البحث...', en: 'Searching...' },
  'search.idle': { ar: 'اكتب حرفين على الأقل للبحث في النظام بالكامل', en: 'Type at least 2 characters to search the whole system' },
  'search.recents': { ar: 'أحدث عمليات البحث', en: 'Recent searches' },
  'search.clearRecents': { ar: 'مسح سجل البحث', en: 'Clear search history' },
  'search.noResults': { ar: 'لا توجد نتائج مطابقة ضمن صلاحياتك', en: 'No results match your permissions' },
  'search.viewAll': { ar: 'عرض كل النتائج', en: 'View all results' },
  'search.showAllDomains': { ar: 'عرض النتائج في كل الأقسام', en: 'Show results across all sections' },
  'search.openRecord': { ar: 'فتح السجل', en: 'Open record' },
  'search.goToPage': { ar: 'الانتقال إلى الصفحة', en: 'Go to page' },
  'search.hintsBar': { ar: '↑↓ للتنقل · Enter للفتح · Esc للإغلاق', en: '↑↓ to navigate · Enter to open · Esc to close' },
  'search.close': { ar: 'إغلاق', en: 'Close' },
  'search.error': { ar: 'تعذر إتمام البحث. حاول مرة أخرى.', en: 'Search failed. Try again.' },
  'search.errorOffline': { ar: 'تعذر إتمام البحث. تحقق من الاتصال وحاول مرة أخرى.', en: 'Search failed. Check your connection and try again.' },

  // ── §I18N-BILINGUAL — Loading ──
  'loading.aria': { ar: 'جاري التحميل', en: 'Loading' },

  // ── §I18N-BILINGUAL — Settings extras ──
  'settings.displayName': { ar: 'الاسم المعروض', en: 'Display name' },
  'settings.profileTitle': { ar: 'معلومات الحساب', en: 'Account information' },

  // ── §I18N-BILINGUAL — Smart Quality Report ──
  'smart.print': { ar: 'طباعة / PDF', en: 'Print / PDF' },
  'smart.printTitle': { ar: 'تقرير الجودة الذكي', en: 'Smart Quality Report' },
  'smart.identityDescription': { ar: 'تقرير أداء الموظف فوق بيانات ذكاء الأداء المتحقق منها — حقائق منظمة قابلة للتتبع، بلا أي سرد أو تفسير.', en: 'Employee performance over verified performance-intelligence data — organized, traceable facts with no narrative.' },
  'smart.employee': { ar: 'الموظف', en: 'Employee' },
  'smart.employeePlaceholder': { ar: 'ابحث بالاسم أو الرقم الوظيفي...', en: 'Search by name or employee ID...' },
  'smart.mtd': { ar: 'MTD — الشهر الحالي', en: 'MTD — Current month' },
  'smart.mtdButton': { ar: 'حتى تاريخه', en: 'Month to date' },
  'smart.lastMonth': { ar: 'الشهر السابق', en: 'Last month' },
  'smart.historical': { ar: 'فترة تاريخية', en: 'Historical period' },
  'smart.pickEmployee': { ar: 'ابحث عن موظف لعرض تقرير الجودة الذكي للفترة المختارة', en: 'Search for an employee to view the Smart Quality Report for the selected period' },
  'smart.pickEmployeeHint': { ar: 'يدعم التقرير الشهر الحالي (MTD) والأشهر التاريخية', en: 'Supports the current month (MTD) and historical months' },
  'smart.loadFailed': { ar: 'تعذر تحميل بيانات تقرير الجودة الذكي', en: 'Failed to load Smart Quality Report data' },
  'smart.loadFailedNote': { ar: 'لم يتم عرض أي قيم — لن تُعرض أصفار بديلة. أعد المحاولة أو تواصل مع مدير النظام إن استمر الخطأ.', en: 'No values were rendered — no substitute zeros. Retry, or contact the system administrator if the error persists.' },
  'smart.retry': { ar: 'إعادة المحاولة', en: 'Retry' },
  'smart.unknownError': { ar: 'خطأ غير معروف', en: 'Unknown error' },
  'smart.section.kpi': { ar: 'موقع جودة KPI', en: 'KPI Quality Position' },
  'smart.section.kpiSub': { ar: 'درجة الجودة مقابل المساهمة الموزونة', en: 'Quality score vs weighted contribution' },
  'smart.section.components': { ar: 'مكونات مخطط KPI', en: 'KPI Scheme Components' },
  'smart.section.componentsSub': { ar: 'عرض معلوماتي — لا يُحسب أي مكون ناقص هنا', en: 'Informational — no missing component is computed here' },
  'smart.section.trend': { ar: 'اتجاه الأداء', en: 'Performance Trend' },
  'smart.section.trendSub': { ar: 'أشهر نافذة التحليل — الأشهر بلا نتيجة تبقى غير متاحة', en: 'Analysis-window months — months without results stay unavailable' },
  'smart.section.observations': { ar: 'ملاحظات الجودة', en: 'Quality Observations' },
  'smart.section.observationsSub': { ar: 'تجميعات المحرك التحليلي كما هي', en: 'Analytical engine aggregations, verbatim' },
  'smart.section.repeated': { ar: 'المشكلات المتكررة', en: 'Repeated Issues' },
  'smart.section.repeatedSub': { ar: 'تجميع حتمي حسب الفئة/النوع', en: 'Deterministic grouping by category/type' },
  'smart.section.deductions': { ar: 'خصومات الجودة', en: 'Quality Deductions' },
  'smart.section.deductionsSub': { ar: 'الأيام والمبالغ وحدات منفصلة — لا دمج', en: 'Days and amounts are separate units — never merged' },
  'smart.section.complaints': { ar: 'شكاوى العملاء', en: 'Customer Complaints' },
  'smart.section.complaintsSub': { ar: 'الارتباط المخزن فقط — لا ارتباط مخترع', en: 'Stored attribution only — never invented' },
  'smart.section.capa': { ar: 'حالات CAPA', en: 'CAPA Cases' },
  'smart.section.capaSub': { ar: 'حالة سير العمل المخزنة كما هي', en: 'Stored workflow state, verbatim' },
  'smart.section.followUps': { ar: 'المتابعات', en: 'Follow-ups' },
  'smart.section.followUpsSub': { ar: 'تعريفات التوقيت القانونية فقط', en: 'Canonical timing definitions only' },
  'smart.section.deals': { ar: 'صفقات السفر', en: 'Travel Deals' },
  'smart.section.dealsSub': { ar: 'سياق تشغيلي — لا مؤشرات مبيعات مخترعة', en: 'Operational context — no invented sales metrics' },
  'smart.section.attendance': { ar: 'سياق الحضور', en: 'Attendance Context' },
  'smart.section.attendanceSub': { ar: 'النتيجة الشهرية المخزنة فقط — ليست جزءاً من جودة KPI', en: 'Stored monthly result only — never part of Quality KPI' },
  'smart.section.evidence': { ar: 'الأدلة والتتبع', en: 'Evidence & Traceability' },
  'smart.section.evidenceSub': { ar: 'كل رقم في هذا التقرير يرجع لسجلات مصدره', en: 'Every number traces back to its source records' },
  'smart.section.dataQuality': { ar: 'جودة البيانات وحدود التحليل', en: 'Data Quality & Analysis Limits' },
  'smart.section.dataQualitySub': { ar: 'القيود معلنة — لا تخفي', en: 'Limitations declared, never hidden' },
  'smart.col.total': { ar: 'الإجمالي', en: 'Total' },
  'smart.col.approved': { ar: 'معتمدة', en: 'Approved' },
  'smart.col.pending': { ar: 'معلّقة', en: 'Pending' },
  'smart.col.rejected': { ar: 'مرفوضة', en: 'Rejected' },
  'smart.empty': { ar: 'لا توجد بيانات لهذا القسم في الفترة المحددة.', en: 'No data for this section in the selected period.' },
  'smart.unavailable': { ar: 'غير متاح', en: 'Unavailable' },
} as const;

export type TranslationKey = keyof typeof DICTIONARY;

/** Look up a key in a locale with Arabic fallback (never renders a raw key if avoidable). */
export function translate(key: TranslationKey, locale: Locale): string {
  const entry = DICTIONARY[key];
  if (!entry) return key;
  return entry[locale] ?? entry.ar;
}
