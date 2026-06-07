module.exports = [
"[project]/src/config/permissions.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// src/config/permissions.ts
__turbopack_context__.s([
    "ADMIN_PERMISSIONS",
    ()=>ADMIN_PERMISSIONS,
    "APP_PAGES",
    ()=>APP_PAGES,
    "DEFAULT_PERMISSIONS",
    ()=>DEFAULT_PERMISSIONS,
    "HR_PERMISSIONS",
    ()=>HR_PERMISSIONS,
    "MANAGER_PERMISSIONS",
    ()=>MANAGER_PERMISSIONS
]);
const APP_PAGES = [
    {
        id: 'home',
        name: 'Home',
        nameAr: 'الرئيسية',
        path: 'home',
        icon: 'LayoutDashboard',
        order: 0
    },
    {
        id: 'employees',
        name: 'Employees',
        nameAr: 'الموظفين',
        path: 'employees',
        icon: 'Users',
        order: 1
    },
    {
        id: 'biometric',
        name: 'Biometric',
        nameAr: 'البصمة',
        path: 'biometric',
        icon: 'Fingerprint',
        order: 2
    },
    {
        id: 'attendance',
        name: 'Attendance',
        nameAr: 'الحضور',
        path: 'attendance',
        icon: 'Clock',
        order: 3
    },
    {
        id: 'requests',
        name: 'Requests',
        nameAr: 'الطلبات',
        path: 'requests',
        icon: 'FileText',
        order: 4
    },
    {
        id: 'rules',
        name: 'Deduction Rules',
        nameAr: 'قواعد الخصم',
        path: 'rules',
        icon: 'Scale',
        order: 5
    },
    {
        id: 'quality',
        name: 'Quality',
        nameAr: 'الجودة',
        path: 'quality',
        icon: 'Award',
        order: 6
    },
    {
        id: 'travel',
        name: 'Travel',
        nameAr: 'السفر',
        path: 'travel',
        icon: 'Plane',
        order: 7
    },
    {
        id: 'reports',
        name: 'Reports',
        nameAr: 'التقارير',
        path: 'reports',
        icon: 'BarChart3',
        order: 8
    },
    {
        id: 'dashboard',
        name: 'Dashboard',
        nameAr: 'لوحة التحكم',
        path: 'dashboard',
        icon: 'Settings',
        order: 9
    },
    {
        id: 'firebase',
        name: 'Firebase',
        nameAr: 'إعدادات Firebase',
        path: 'firebase',
        icon: 'Database',
        order: 10
    }
];
const DEFAULT_PERMISSIONS = {
    home: 'read',
    employees: 'read',
    biometric: 'read',
    attendance: 'read',
    requests: 'read',
    rules: 'none',
    quality: 'none',
    travel: 'read',
    reports: 'read',
    dashboard: 'none',
    firebase: 'none'
};
const ADMIN_PERMISSIONS = {
    home: 'edit',
    employees: 'edit',
    biometric: 'edit',
    attendance: 'edit',
    requests: 'edit',
    rules: 'edit',
    quality: 'edit',
    travel: 'edit',
    reports: 'edit',
    dashboard: 'edit',
    firebase: 'edit'
};
const HR_PERMISSIONS = {
    home: 'read',
    employees: 'edit',
    biometric: 'edit',
    attendance: 'edit',
    requests: 'edit',
    rules: 'read',
    quality: 'read',
    travel: 'read',
    reports: 'read',
    dashboard: 'none',
    firebase: 'none'
};
const MANAGER_PERMISSIONS = {
    home: 'read',
    employees: 'read',
    biometric: 'read',
    attendance: 'read',
    requests: 'edit',
    rules: 'none',
    quality: 'read',
    travel: 'read',
    reports: 'read',
    dashboard: 'none',
    firebase: 'none'
};
}),
"[project]/src/contexts/AuthContext.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AuthProvider",
    ()=>AuthProvider,
    "useAuth",
    ()=>useAuth
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$config$2f$permissions$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/config/permissions.ts [app-ssr] (ecmascript)");
// src/contexts/AuthContext.tsx
'use client';
;
;
;
const AuthContext = /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["createContext"])({
    user: null,
    loading: true,
    login: async ()=>false,
    logout: ()=>{},
    error: null,
    clearError: ()=>{}
});
function useAuth() {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useContext"])(AuthContext);
}
function getPermissionsForRole(role) {
    switch(role){
        case 'admin':
            return {
                ...__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$config$2f$permissions$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["ADMIN_PERMISSIONS"]
            };
        case 'hr':
            return {
                ...__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$config$2f$permissions$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["HR_PERMISSIONS"]
            };
        case 'manager':
            return {
                ...__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$config$2f$permissions$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["MANAGER_PERMISSIONS"]
            };
        default:
            return {
                ...__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$config$2f$permissions$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["DEFAULT_PERMISSIONS"]
            };
    }
}
function extractNameFromEmail(email) {
    const namePart = email.split('@')[0];
    return namePart.replace(/[._-]/g, ' ').replace(/\b\w/g, (c)=>c.toUpperCase());
}
function getRankForRole(role) {
    switch(role){
        case 'admin':
            return 'مدير النظام';
        case 'hr':
            return 'موارد بشرية';
        case 'manager':
            return 'مدير';
        default:
            return 'موظف';
    }
}
function AuthProvider({ children }) {
    const [user, setUser] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(null);
    const [loading, setLoading] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(true);
    const [error, setError] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(null);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        const stored = localStorage.getItem('erp_user');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                setUser(parsed);
            } catch  {
                localStorage.removeItem('erp_user');
            }
        }
        setLoading(false);
    }, []);
    const clearError = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(()=>{
        setError(null);
    }, []);
    const login = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(async (email, password)=>{
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email: email.trim().toLowerCase(),
                    password
                })
            });
            if (!res.ok) {
                const data = await res.json().catch(()=>({}));
                setError(data.error || 'البريد الإلكتروني أو كلمة المرور غير صحيحة');
                return false;
            }
            const data = await res.json();
            const userData = data.user;
            if (!userData || !userData.id) {
                setError('حدث خطأ في استجابة الخادم');
                return false;
            }
            let permissions = getPermissionsForRole(userData.role);
            if (userData.permissions) {
                try {
                    if (typeof userData.permissions === 'string') {
                        permissions = {
                            ...permissions,
                            ...JSON.parse(userData.permissions)
                        };
                    } else {
                        permissions = {
                            ...permissions,
                            ...userData.permissions
                        };
                    }
                } catch  {
                /* use role defaults */ }
            }
            const authUser = {
                id: userData.id,
                email: userData.email,
                name: userData.name || extractNameFromEmail(userData.email),
                role: userData.role,
                rank: userData.rank || getRankForRole(userData.role),
                permissions
            };
            setUser(authUser);
            localStorage.setItem('erp_user', JSON.stringify(authUser));
            return true;
        } catch  {
            setError('خطأ في الاتصال بالخادم');
            return false;
        } finally{
            setLoading(false);
        }
    }, []);
    const logout = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(()=>{
        setUser(null);
        localStorage.removeItem('erp_user');
        setError(null);
    }, []);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(AuthContext.Provider, {
        value: {
            user,
            loading,
            login,
            logout,
            error,
            clearError
        },
        children: children
    }, void 0, false, {
        fileName: "[project]/src/contexts/AuthContext.tsx",
        lineNumber: 139,
        columnNumber: 5
    }, this);
}
}),
"[project]/src/lib/store.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useAppStore",
    ()=>useAppStore
]);
// src/lib/store.ts
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zustand$2f$esm$2f$react$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/zustand/esm/react.mjs [app-ssr] (ecmascript)");
;
const useAppStore = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zustand$2f$esm$2f$react$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["create"])((set)=>({
        currentPage: 'home',
        sidebarOpen: false,
        sidebarCollapsed: false,
        highlightId: null,
        navParams: {},
        setCurrentPage: (page)=>set({
                currentPage: page,
                highlightId: null,
                navParams: {}
            }),
        toggleSidebar: ()=>set((s)=>({
                    sidebarOpen: !s.sidebarOpen
                })),
        setSidebarOpen: (open)=>set({
                sidebarOpen: open
            }),
        toggleSidebarCollapse: ()=>set((s)=>({
                    sidebarCollapsed: !s.sidebarCollapsed
                })),
        setSidebarCollapsed: (collapsed)=>set({
                sidebarCollapsed: collapsed
            }),
        setHighlightId: (id)=>set({
                highlightId: id
            }),
        navigateTo: (page, highlightId, params)=>set({
                currentPage: page,
                sidebarOpen: false,
                highlightId: highlightId || null,
                navParams: params || {}
            })
    }));
}),
"[project]/src/lib/utils.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "cn",
    ()=>cn
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/clsx/dist/clsx.mjs [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$tailwind$2d$merge$2f$dist$2f$bundle$2d$mjs$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/tailwind-merge/dist/bundle-mjs.mjs [app-ssr] (ecmascript)");
;
;
function cn(...inputs) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$tailwind$2d$merge$2f$dist$2f$bundle$2d$mjs$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["twMerge"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["clsx"])(inputs));
}
}),
"[project]/src/lib/date-utils.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// src/lib/date-utils.ts
// Shared date utility functions used across multiple pages
/**
 * Parse DD/MM/YYYY date string and calculate days remaining from today.
 */ __turbopack_context__.s([
    "generateMonthOptions",
    ()=>generateMonthOptions,
    "getDaysRemaining",
    ()=>getDaysRemaining,
    "getRequestTypeColor",
    ()=>getRequestTypeColor,
    "getRequestTypeLabel",
    ()=>getRequestTypeLabel,
    "isUrgent",
    ()=>isUrgent
]);
function getDaysRemaining(dateStr) {
    try {
        const parts = dateStr.split('/');
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        const target = new Date(year, month, day);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    } catch  {
        return 0;
    }
}
function isUrgent(dateStr) {
    const days = getDaysRemaining(dateStr);
    return days >= 0 && days < 3;
}
function getRequestTypeLabel(type) {
    switch(type){
        case 'leave':
            return 'إجازة';
        case 'permission':
            return 'استئذان';
        case 'excuse':
            return 'غياب';
        case 'tardiness':
            return 'تأخير';
        case 'remote':
            return 'ريموتلي';
        default:
            return type;
    }
}
function getRequestTypeColor(type) {
    switch(type){
        case 'leave':
            return 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20';
        case 'permission':
            return 'bg-violet-500/15 text-violet-400 border-violet-500/20';
        case 'excuse':
            return 'bg-rose-500/15 text-rose-400 border-rose-500/20';
        case 'tardiness':
            return 'bg-amber-500/15 text-amber-400 border-amber-500/20';
        case 'remote':
            return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
        default:
            return 'bg-slate-500/15 text-slate-400 border-slate-500/20';
    }
}
function generateMonthOptions(format = 'YYYY-MM') {
    const now = new Date();
    const months = [];
    for(let i = 0; i < 12; i++){
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        if (format === 'YYYY-MM') {
            months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        } else {
            months.push(`${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`);
        }
    }
    return months;
}
}),
"[project]/src/lib/sounds.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "playNotificationSound",
    ()=>playNotificationSound
]);
// src/lib/sounds.ts
// Play notification beep sound using Web Audio API (no external files needed)
// All sounds are soft and gentle — not annoying
let audioContext = null;
function getAudioContext() {
    if (!audioContext) {
        audioContext = new AudioContext();
    }
    return audioContext;
}
function playNotificationSound(type = 'request') {
    try {
        const ctx = getAudioContext();
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        switch(type){
            case 'travel':
                // Soft gentle chime: 2 light descending tones
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(660, ctx.currentTime);
                oscillator.frequency.exponentialRampToValueAtTime(520, ctx.currentTime + 0.25);
                gainNode.gain.setValueAtTime(0.08, ctx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
                oscillator.start(ctx.currentTime);
                oscillator.stop(ctx.currentTime + 0.35);
                // Second gentle tone
                const osc2 = ctx.createOscillator();
                const gain2 = ctx.createGain();
                osc2.connect(gain2);
                gain2.connect(ctx.destination);
                osc2.type = 'sine';
                osc2.frequency.setValueAtTime(520, ctx.currentTime + 0.4);
                osc2.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.7);
                gain2.gain.setValueAtTime(0.06, ctx.currentTime + 0.4);
                gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.75);
                osc2.start(ctx.currentTime + 0.4);
                osc2.stop(ctx.currentTime + 0.75);
                break;
            case 'request':
                // Soft gentle notification: 1 ascending tone, very quiet
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(520, ctx.currentTime);
                oscillator.frequency.setValueAtTime(659, ctx.currentTime + 0.12);
                gainNode.gain.setValueAtTime(0.06, ctx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
                oscillator.start(ctx.currentTime);
                oscillator.stop(ctx.currentTime + 0.3);
                break;
            case 'success':
                // Soft pleasant ascending chime
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(523, ctx.currentTime);
                oscillator.frequency.setValueAtTime(659, ctx.currentTime + 0.08);
                oscillator.frequency.setValueAtTime(784, ctx.currentTime + 0.16);
                gainNode.gain.setValueAtTime(0.06, ctx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
                oscillator.start(ctx.currentTime);
                oscillator.stop(ctx.currentTime + 0.35);
                break;
            case 'error':
                // Very soft low buzz
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(200, ctx.currentTime);
                gainNode.gain.setValueAtTime(0.05, ctx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
                oscillator.start(ctx.currentTime);
                oscillator.stop(ctx.currentTime + 0.25);
                break;
        }
    } catch  {
    // Audio not supported - silently ignore
    }
}
}),
"[project]/src/hooks/usePermissions.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "usePermissions",
    ()=>usePermissions
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$contexts$2f$AuthContext$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/contexts/AuthContext.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$config$2f$permissions$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/config/permissions.ts [app-ssr] (ecmascript)");
// src/hooks/usePermissions.ts
'use client';
;
;
;
function usePermissions(pageId) {
    const { user } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$contexts$2f$AuthContext$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useAuth"])();
    const isAdmin = user?.role === 'admin';
    const getPermission = (pid)=>{
        if (!user || isAdmin) return 'edit';
        return user.permissions?.[pid] || 'none';
    };
    const canView = (pid)=>{
        const id = pid || pageId;
        if (!id) return true;
        if (!user) return false;
        if (isAdmin) return true;
        return getPermission(id) !== 'none';
    };
    const canEdit = (pid)=>{
        const id = pid || pageId;
        if (!id) return true;
        if (!user) return false;
        if (isAdmin) return true;
        return getPermission(id) === 'edit';
    };
    const canRead = (pid)=>{
        const id = pid || pageId;
        if (!id) return true;
        if (!user) return false;
        if (isAdmin) return true;
        const perm = getPermission(id);
        return perm === 'read' || perm === 'edit';
    };
    const visiblePages = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useMemo"])(()=>{
        if (!user) return [];
        if (isAdmin) return __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$config$2f$permissions$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["APP_PAGES"];
        return __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$config$2f$permissions$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["APP_PAGES"].filter((p)=>{
            const perm = user.permissions?.[p.id];
            return perm && perm !== 'none';
        });
    }, [
        user,
        isAdmin
    ]);
    const currentPermission = pageId ? getPermission(pageId) : null;
    return {
        isAdmin,
        canView,
        canEdit,
        canRead,
        getPermission,
        visiblePages,
        currentPermission,
        permission: currentPermission
    };
}
}),
"[project]/src/hooks/use-mobile.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useIsMobile",
    ()=>useIsMobile,
    "useIsMobileSync",
    ()=>useIsMobileSync
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
'use client';
;
const MOBILE_BREAKPOINT = 768;
function getIsMobile() {
    if ("TURBOPACK compile-time truthy", 1) return false;
    //TURBOPACK unreachable
    ;
}
function useIsMobile() {
    const [isMobile, setIsMobile] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(getIsMobile);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
        const onChange = ()=>{
            setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
        };
        mql.addEventListener('change', onChange);
        return ()=>mql.removeEventListener('change', onChange);
    }, []);
    return !!isMobile;
}
function useIsMobileSync() {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useMemo"])(getIsMobile, []);
}
}),
"[project]/src/app/page.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>Home
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$contexts$2f$AuthContext$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/contexts/AuthContext.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$store$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/store.ts [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$layout$2f$AppLayout$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/layout/AppLayout.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$LoginPage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/pages/LoginPage.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$HomePage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/pages/HomePage.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$EmployeesPage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/pages/EmployeesPage.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$BiometricPage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/pages/BiometricPage.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$AttendancePage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/pages/AttendancePage.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$RequestsPage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/pages/RequestsPage.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$RulesPage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/pages/RulesPage.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$QualityPage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/pages/QualityPage.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$TravelPage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/pages/TravelPage.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$ReportsPage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/pages/ReportsPage.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$DashboardPage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/pages/DashboardPage.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$FirebaseSettingsPage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/pages/FirebaseSettingsPage.tsx [app-ssr] (ecmascript)");
'use client';
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
function PageRouter() {
    const currentPage = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$store$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useAppStore"])((s)=>s.currentPage);
    switch(currentPage){
        case 'home':
            return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$HomePage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {}, void 0, false, {
                fileName: "[project]/src/app/page.tsx",
                lineNumber: 25,
                columnNumber: 14
            }, this);
        case 'employees':
            return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$EmployeesPage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {}, void 0, false, {
                fileName: "[project]/src/app/page.tsx",
                lineNumber: 27,
                columnNumber: 14
            }, this);
        case 'biometric':
            return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$BiometricPage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {}, void 0, false, {
                fileName: "[project]/src/app/page.tsx",
                lineNumber: 29,
                columnNumber: 14
            }, this);
        case 'attendance':
            return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$AttendancePage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {}, void 0, false, {
                fileName: "[project]/src/app/page.tsx",
                lineNumber: 31,
                columnNumber: 14
            }, this);
        case 'requests':
            return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$RequestsPage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {}, void 0, false, {
                fileName: "[project]/src/app/page.tsx",
                lineNumber: 33,
                columnNumber: 14
            }, this);
        case 'rules':
            return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$RulesPage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {}, void 0, false, {
                fileName: "[project]/src/app/page.tsx",
                lineNumber: 35,
                columnNumber: 14
            }, this);
        case 'quality':
            return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$QualityPage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {}, void 0, false, {
                fileName: "[project]/src/app/page.tsx",
                lineNumber: 37,
                columnNumber: 14
            }, this);
        case 'travel':
            return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$TravelPage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {}, void 0, false, {
                fileName: "[project]/src/app/page.tsx",
                lineNumber: 39,
                columnNumber: 14
            }, this);
        case 'reports':
            return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$ReportsPage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {}, void 0, false, {
                fileName: "[project]/src/app/page.tsx",
                lineNumber: 41,
                columnNumber: 14
            }, this);
        case 'dashboard':
            return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$DashboardPage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {}, void 0, false, {
                fileName: "[project]/src/app/page.tsx",
                lineNumber: 43,
                columnNumber: 14
            }, this);
        case 'firebase':
            return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$FirebaseSettingsPage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {}, void 0, false, {
                fileName: "[project]/src/app/page.tsx",
                lineNumber: 45,
                columnNumber: 14
            }, this);
        default:
            return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$HomePage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {}, void 0, false, {
                fileName: "[project]/src/app/page.tsx",
                lineNumber: 47,
                columnNumber: 14
            }, this);
    }
}
function AppContent() {
    const { user, loading } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$contexts$2f$AuthContext$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useAuth"])();
    if (loading) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            className: "min-h-screen flex items-center justify-center bg-slate-900",
            children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex flex-col items-center gap-4",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "animate-spin rounded-full h-12 w-12 border-3 border-emerald-500 border-t-transparent"
                    }, void 0, false, {
                        fileName: "[project]/src/app/page.tsx",
                        lineNumber: 58,
                        columnNumber: 11
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                        className: "text-slate-400 text-sm",
                        children: "جاري التحميل..."
                    }, void 0, false, {
                        fileName: "[project]/src/app/page.tsx",
                        lineNumber: 59,
                        columnNumber: 11
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/src/app/page.tsx",
                lineNumber: 57,
                columnNumber: 9
            }, this)
        }, void 0, false, {
            fileName: "[project]/src/app/page.tsx",
            lineNumber: 56,
            columnNumber: 7
        }, this);
    }
    if (!user) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$pages$2f$LoginPage$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {}, void 0, false, {
            fileName: "[project]/src/app/page.tsx",
            lineNumber: 66,
            columnNumber: 12
        }, this);
    }
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$layout$2f$AppLayout$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["AppLayout"], {
        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(PageRouter, {}, void 0, false, {
            fileName: "[project]/src/app/page.tsx",
            lineNumber: 71,
            columnNumber: 7
        }, this)
    }, void 0, false, {
        fileName: "[project]/src/app/page.tsx",
        lineNumber: 70,
        columnNumber: 5
    }, this);
}
function Home() {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$contexts$2f$AuthContext$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["AuthProvider"], {
        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(AppContent, {}, void 0, false, {
            fileName: "[project]/src/app/page.tsx",
            lineNumber: 79,
            columnNumber: 7
        }, this)
    }, void 0, false, {
        fileName: "[project]/src/app/page.tsx",
        lineNumber: 78,
        columnNumber: 5
    }, this);
}
}),
];

//# sourceMappingURL=src_09m.9fy._.js.map