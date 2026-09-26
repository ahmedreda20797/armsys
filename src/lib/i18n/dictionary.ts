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
  // §I18N-SIDEBAR — the remaining sidebar-owned strings as typed keys
  // (shared component → real i18n, not runtime-DOM translation).
  'sidebar.directOrder': { ar: 'ترتيب مباشر (سحب وإفلات)', en: 'Direct order (drag & drop)' },
  'sidebar.currentPageSection': { ar: 'إدارة الصفحة الحالية', en: 'Current page' },
  'sidebar.orderSaved': { ar: 'تم حفظ ترتيب القائمة', en: 'Menu order saved' },
  'sidebar.orderSaveFailed': { ar: 'تعذر حفظ ترتيب القائمة', en: 'Failed to save menu order' },
  'sidebar.orderReset': { ar: 'تمت إعادة القائمة للوضع الافتراضي', en: 'Menu reset to default' },
  'sidebar.orderResetFailed': { ar: 'تعذر إعادة الترتيب الافتراضي', en: 'Failed to reset menu order' },
  'sidebar.prefSaveFailed': { ar: 'تعذر حفظ تفضيل القائمة', en: 'Failed to save menu preference' },
  'sidebar.editOrderAria': { ar: 'مساحة التنقل — وضع التحرير', en: 'Navigation workspace — edit mode' },
  // §SIDEBAR-WORKSPACE — the old order-only hint is replaced by the
  // workspace edit hint (the old text claimed "order only", which is
  // no longer true).
  'sidebar.editHint': { ar: 'اسحب العناصر من المقبض لإعادة الترتيب أو النقل بين المجموعات — التغييرات تُطبّق عند الحفظ.', en: 'Drag items by the handle to reorder or move them between groups — changes apply when you save.' },
  'sidebar.moveUp': { ar: 'نقل لأعلى', en: 'Move up' },
  'sidebar.moveDown': { ar: 'نقل لأسفل', en: 'Move down' },
  'sidebar.awaitingApproval': { ar: 'بانتظار الاعتماد', en: 'awaiting approval' },
  'sidebar.newItems': { ar: 'عنصر جديد', en: 'new item(s)' },
  'sidebar.newItemsHint': { ar: 'عنصر جديد لم تشاهده بعد', en: 'new item(s) you have not seen yet' },
  'sidebar.qualityDeductionPending': { ar: 'خصم جودة بانتظار الاعتماد', en: 'quality deduction(s) awaiting approval' },
  // ── §SIDEBAR-WORKSPACE — the Personalizable Navigation Workspace ──
  // The system-generated MAIN group carries a localized UI label;
  // user-created group names are USER CONTENT and never pass through
  // localization (§32).
  'sidebar.mainGroup': { ar: 'الرئيسية', en: 'Main' },
  'sidebar.editSidebar': { ar: 'تحرير القائمة', en: 'Edit sidebar' },
  'sidebar.editDone': { ar: 'تم', en: 'Done' },
  'sidebar.newGroup': { ar: 'مجموعة جديدة', en: 'New group' },
  'sidebar.groupNameLabel': { ar: 'اسم المجموعة', en: 'Group name' },
  'sidebar.groupNamePlaceholder': { ar: 'اسم المجموعة الجديدة', en: 'Name of the new group' },
  'sidebar.groupNameEmpty': { ar: 'أدخل اسماً للمجموعة', en: 'Enter a group name' },
  'sidebar.groupNameTooLong': { ar: 'الاسم طويل جداً', en: 'The name is too long' },
  'sidebar.groupNameDuplicate': { ar: 'توجد مجموعة بنفس الاسم', en: 'A group with this name already exists' },
  'sidebar.renameGroup': { ar: 'إعادة تسمية المجموعة', en: 'Rename group' },
  'sidebar.deleteGroup': { ar: 'حذف المجموعة', en: 'Delete group' },
  'sidebar.deleteGroupDescription': { ar: 'سيتم حذف المجموعة فقط — تنتقل صفحاتها إلى مجموعة الرئيسية تلقائياً ولن يُفقد أي عنصر.', en: 'Only the group is deleted — its pages move to the Main group automatically; no navigation item is lost.' },
  'sidebar.resetLayout': { ar: 'إعادة ضبط القائمة', en: 'Reset sidebar layout' },
  'sidebar.resetLayoutDescription': { ar: 'تعود القائمة إلى التنظيم الافتراضي (مجموعة رئيسية واحدة). لا تتأثر صلاحياتك أو تفضيلاتك الأخرى.', en: 'The sidebar returns to the default organization (one Main group). Your permissions and other preferences are unaffected.' },
  'sidebar.layoutSaved': { ar: 'تم حفظ تنظيم القائمة', en: 'Sidebar layout saved' },
  'sidebar.layoutSaveFailed': { ar: 'تعذر حفظ تنظيم القائمة', en: 'Failed to save sidebar layout' },
  'sidebar.itemHandle': { ar: 'سحب العنصر — Alt مع الأسهم للترتيب بلوحة المفاتيح', en: 'Drag item — Alt+Arrow keys to reorder' },
  'sidebar.groupHandle': { ar: 'سحب المجموعة — Alt مع الأسهم للترتيب بلوحة المفاتيح', en: 'Drag group — Alt+Arrow keys to reorder' },
  'sidebar.groupActions': { ar: 'إجراءات المجموعة', en: 'Group actions' },
  'sidebar.emptyGroup': { ar: 'مجموعة فارغة — أفلت عنصراً هنا', en: 'Empty group — drop items here' },
  'sidebar.moveGroupUp': { ar: 'نقل المجموعة لأعلى', en: 'Move group up' },
  'sidebar.moveGroupDown': { ar: 'نقل المجموعة لأسفل', en: 'Move group down' },
  'sidebar.announceItemMoved': { ar: 'تم نقل العنصر', en: 'Item moved' },
  'sidebar.announceGroupMoved': { ar: 'تم نقل المجموعة', en: 'Group moved' },
  'sidebar.announceGroupCreated': { ar: 'تم إنشاء المجموعة', en: 'Group created' },
  'sidebar.announceGroupRenamed': { ar: 'تمت إعادة تسمية المجموعة', en: 'Group renamed' },
  'sidebar.announceGroupDeleted': { ar: 'تم حذف المجموعة ونقل عناصرها إلى الرئيسية', en: 'Group deleted and its items moved to Main' },
  'sidebar.announceLayoutReset': { ar: 'أُعيد ضبط تنظيم القائمة — يُحفظ عند الحفظ', en: 'Sidebar layout reset — saved on Done' },
  // §27 SHOW-ALL — the navigation overflow control (both surfaces).
  'sidebar.showAll': { ar: 'عرض الكل', en: 'Show all' },
  'sidebar.showLess': { ar: 'عرض أقل', en: 'Show less' },

  // ── §I18N-ORG-TREE — organization tree workspace (shared surface) ──
  'org.tree.empty': { ar: 'لا يوجد هيكل تنظيمي لعرضه', en: 'No organization structure to display' },
  'org.tree.hint': { ar: 'مساحة العمل: السحب بالزر الأيسر للتحريك · الزر الأوسط (البكره) للتقريب الحر · عجلة الفأرة أيضاً · نقرة مزدوجة للتفاصيل', en: 'Workspace: left-drag to pan · middle button for free zoom · mouse wheel works too · double-click for details' },
  'org.tree.zoomOut': { ar: 'تصغير', en: 'Zoom out' },
  'org.tree.zoomIn': { ar: 'تكبير', en: 'Zoom in' },
  'org.tree.fit': { ar: 'ملاءمة العرض', en: 'Fit to view' },
  'org.tree.employees': { ar: 'موظف', en: 'employee(s)' },
  'org.tree.manager': { ar: 'مدير', en: 'Manager' },
  'org.tree.expand': { ar: 'توسيع', en: 'Expand' },
  'org.tree.collapse': { ar: 'طي', en: 'Collapse' },
  'org.tree.showEmployees': { ar: 'عرض الموظفين', en: 'Show employees' },
  'org.tree.hideEmployees': { ar: 'إخفاء الموظفين', en: 'Hide employees' },
  'org.tree.rosterMore': { ar: 'مرر للأسفل لعرض الجميع', en: 'scroll to see all' },
  'org.tree.unknownInitial': { ar: '؟', en: '?' },

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
  // §Home-CC work-queue inline actions
  'action.open': { ar: 'فتح', en: 'Open' },
  'action.review': { ar: 'مراجعة', en: 'Review' },
  'action.followUp': { ar: 'متابعة', en: 'Follow up' },

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
  'smart.section.dealsSub': { ar: 'مصنّفة بتاريخها المرجعي — الإغلاق للمبيعات والمغادرة للسفر', en: 'Classified by canonical date — closures for sales, departure for travel' },
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

  // ── Home / Command Center (§Home-CC) ──
  'home.title': { ar: 'مركز القيادة', en: 'Command Center' },
  'home.subtitle': { ar: 'ماذا يحدث؟ / ماذا يحتاج انتباهي؟ / ماذا أفعل الآن؟', en: 'What happened? / What needs attention? / What should I do now?' },
  'home.lastUpdated': { ar: 'آخر تحديث', en: 'Last updated' },
  'home.dataFreshness': { ar: 'جدة البيانات', en: 'Data freshness' },
  'home.needsAttention': { ar: 'يحتاج انتباهك', en: 'Needs Attention' },
  'home.today': { ar: 'اليوم', en: 'Today' },
  'home.todaysFollowUpsLabel': { ar: 'متابعات اليوم', en: 'Follow-ups due today' },
  'home.matrix.activity': { ar: 'النشاط', en: 'Activity' },
  'home.matrix.attention': { ar: 'تنبيهات', en: 'Attention' },
  'home.kpiScore': { ar: 'جودة KPI', en: 'Quality KPI' },
  'home.viewKpiReports': { ar: 'عرض تقارير KPI', en: 'View KPI reports' },
  'home.todayAtGlance': { ar: 'اليوم في لمحة', en: 'Today at a Glance' },
  'home.operationalTimeline': { ar: 'الجدول الزمني التشغيلي', en: 'Operational Timeline' },
  'home.departmentPulse': { ar: 'نبض الأقسام', en: 'Department Pulse' },
  'home.performancePulse': { ar: 'نبض الأداء', en: 'Performance Pulse' },
  'home.recentActivity': { ar: 'النشاط الأخير', en: 'Recent Activity' },
  'home.closedDeals': { ar: 'صفقات مغلقة', en: 'Closed Deals' },
  'home.closedDealsThisMonth': { ar: 'مغلقة هذا الشهر', en: 'Closed This Month' },
  'home.closedUnknown': { ar: 'تاريخ الإغلاق غير معروف', en: 'Close date unknown' },
  'home.attendanceRate': { ar: 'نسبة الحضور', en: 'Attendance Rate' },
  'home.lateToday': { ar: 'متأخرون اليوم', en: 'Late Today' },
  'home.pendingApprovals': { ar: 'موافقات معلقة', en: 'Pending Approvals' },
  'home.overdueFollowUps': { ar: 'متابعات متأخرة', en: 'Overdue Follow-ups' },
  'home.upcomingTravel': { ar: 'سفر قادم', en: 'Upcoming Travel' },
  'home.qualityCases': { ar: 'حالات جودة', en: 'Quality Cases' },
  'home.department': { ar: 'القسم', en: 'Department' },
  'home.employees': { ar: 'الموظفون', en: 'Employees' },
  'home.openFollowUps': { ar: 'متابعات مفتوحة', en: 'Open Follow-ups' },
  'home.activeTravel': { ar: 'سفر نشط', en: 'Active Travel' },
  'home.trendUp': { ar: 'صاعد', en: 'Trending up' },
  'home.trendDown': { ar: 'هابط', en: 'Trending down' },
  'home.trendFlat': { ar: 'مستقر', en: 'Flat' },
  'home.currentScore': { ar: 'النتيجة الحالية', en: 'Current Score' },
  'home.targetScore': { ar: 'النتيجة المستهدفة', en: 'Target Score' },
  'home.progress': { ar: 'التقدم', en: 'Progress' },
  'home.followUpCompletion': { ar: 'إكمال المتابعات', en: 'Follow-up Completion' },
  'home.qualityPerEmployee': { ar: 'خصومات جودة لكل موظف', en: 'Quality Deductions per Employee' },
  'home.completedWork': { ar: 'العمل المكتمل', en: 'Completed Work' },
  'home.viewRecords': { ar: 'عرض السجلات', en: 'View Records' },
  'home.insightDetails': { ar: 'تفاصيل المؤشر', en: 'Insight Details' },
  'home.metricDefinition': { ar: 'تعريف المؤشر', en: 'Metric Definition' },
  'home.businessRule': { ar: 'قاعدة العمل', en: 'Business Rule' },
  'home.period': { ar: 'الفترة', en: 'Period' },
  'home.scope': { ar: 'النطاق', en: 'Scope' },
  'home.source': { ar: 'المصدر', en: 'Source' },
  'home.freshness': { ar: 'الجدة', en: 'Freshness' },
  'home.breakdown': { ar: 'التفصيل', en: 'Breakdown' },
  'home.noData': { ar: 'لا توجد بيانات', en: 'No data' },
  'home.partialData': { ar: 'بيانات جزئية', en: 'Partial data' },
  'home.unavailable': { ar: 'غير متاح', en: 'Unavailable' },
  'home.zero': { ar: 'صفر', en: 'Zero' },
  'home.event.dealCompleted': { ar: 'صفقة مكتملة', en: 'Deal Completed' },
  'home.event.qualityObservation': { ar: 'ملاحظة جودة', en: 'Quality Observation' },
  'home.event.followUpCompleted': { ar: 'متابعة مكتملة', en: 'Follow-up Completed' },
  'home.event.approval': { ar: 'موافقة', en: 'Approval' },
  'home.event.complaint': { ar: 'شكوى', en: 'Complaint' },
  'home.event.capaUpdate': { ar: 'تحديث CAPA', en: 'CAPA Update' },
  'home.event.travelMilestone': { ar: 'مرحلة سفر', en: 'Travel Milestone' },
  'home.dealDimension.closed': { ar: 'تاريخ الإغلاق', en: 'Close Date' },
  'home.dealDimension.travel': { ar: 'تاريخ السفر', en: 'Travel Date' },
  'home.dealDimension.created': { ar: 'تاريخ الإنشاء', en: 'Created Date' },
} as const;

export type TranslationKey = keyof typeof DICTIONARY;

/** Look up a key in a locale with Arabic fallback (never renders a raw key if avoidable). */
export function translate(key: TranslationKey, locale: Locale): string {
  const entry = DICTIONARY[key];
  if (!entry) return key;
  return entry[locale] ?? entry.ar;
}
