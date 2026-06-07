module.exports = [
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[project]/src/lib/db.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "db",
    ()=>db
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__ = __turbopack_context__.i("[externals]/@prisma/client [external] (@prisma/client, cjs, [project]/node_modules/@prisma/client)");
;
const globalForPrisma = globalThis;
const db = globalForPrisma.prisma ?? new __TURBOPACK__imported__module__$5b$externals$5d2f40$prisma$2f$client__$5b$external$5d$__$2840$prisma$2f$client$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f40$prisma$2f$client$29$__["PrismaClient"]();
if ("TURBOPACK compile-time truthy", 1) globalForPrisma.prisma = db;
}),
"[project]/src/app/api/reports/generate/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "POST",
    ()=>POST
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/db.ts [app-route] (ecmascript)");
;
;
async function POST(request) {
    try {
        const { month } = await request.json();
        if (!month) {
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                error: 'Month is required (YYYY-MM)'
            }, {
                status: 400
            });
        }
        const [year, mon] = month.split('-');
        const datePattern = `/${mon.padStart(2, '0')}/${year}`;
        const employees = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].employee.findMany({
            select: {
                id: true,
                name: true,
                department: true,
                shiftStart: true
            }
        });
        const deductionRules = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].deductionRule.findMany();
        const biometricRecords = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].biometric.findMany({
            where: {
                date: {
                    contains: datePattern
                }
            }
        });
        const attendanceRecords = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].attendance.findMany({
            where: {
                date: {
                    contains: datePattern
                }
            }
        });
        const allRequests = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].request.findMany({
            where: {
                date: {
                    contains: datePattern
                }
            }
        });
        const qualityDeductions = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].qualityDeduction.findMany({
            where: {
                month
            }
        });
        const bioByEmp = new Map();
        for (const b of biometricRecords){
            if (!bioByEmp.has(b.employeeId)) bioByEmp.set(b.employeeId, new Map());
            bioByEmp.get(b.employeeId).set(b.date, b);
        }
        const attByEmp = new Map();
        for (const a of attendanceRecords){
            if (!attByEmp.has(a.employeeId)) attByEmp.set(a.employeeId, new Map());
            attByEmp.get(a.employeeId).set(a.date, a);
        }
        const approvedDates = new Map();
        for (const r of allRequests){
            if (r.status === 'approved') {
                if (!approvedDates.has(r.employeeId)) approvedDates.set(r.employeeId, new Set());
                approvedDates.get(r.employeeId).add(r.date);
            }
        }
        const qualityByEmp = new Map();
        for (const q of qualityDeductions){
            if (!qualityByEmp.has(q.employeeId)) qualityByEmp.set(q.employeeId, []);
            qualityByEmp.get(q.employeeId).push(q);
        }
        const rulesMap = new Map();
        for (const rule of deductionRules){
            rulesMap.set(rule.key, rule);
        }
        function calcLateMinutes(checkIn, shiftStart) {
            const [cH, cM] = checkIn.split(':').map(Number);
            const [sH, sM] = shiftStart.split(':').map(Number);
            return Math.max(0, cH * 60 + cM - (sH * 60 + sM));
        }
        function getLateRuleKey(minutesLate) {
            if (minutesLate <= 0) return '';
            if (minutesLate <= 15) return 'late15';
            if (minutesLate <= 30) return 'late30';
            if (minutesLate <= 60) return 'late60';
            return 'late60plus';
        }
        const rows = employees.map((emp)=>{
            const empBio = bioByEmp.get(emp.id) || new Map();
            const empAtt = attByEmp.get(emp.id) || new Map();
            const empApproved = approvedDates.get(emp.id) || new Set();
            const empQuality = qualityByEmp.get(emp.id) || [];
            const allDates = new Set([
                ...empBio.keys(),
                ...empAtt.keys()
            ]);
            let totalPresent = 0;
            let totalLate = 0;
            let totalAbsent = 0;
            let totalExempt = 0;
            let totalMinutesLate = 0;
            let lateDeductionDays = 0;
            let absenceDeductionDays = 0;
            for (const date of allDates){
                if (empApproved.has(date)) {
                    totalExempt++;
                    continue;
                }
                const bio = empBio.get(date);
                const att = empAtt.get(date);
                const shiftStart = emp.shiftStart;
                const checkIn = bio?.checkIn || att?.checkIn || null;
                if (checkIn && shiftStart) {
                    const minutesLate = calcLateMinutes(checkIn, shiftStart);
                    if (minutesLate > 0) {
                        totalLate++;
                        totalMinutesLate += minutesLate;
                        const ruleKey = getLateRuleKey(minutesLate);
                        const rule = ruleKey ? rulesMap.get(ruleKey) : null;
                        if (rule) {
                            lateDeductionDays += rule.amount;
                        }
                    } else {
                        totalPresent++;
                    }
                } else if (checkIn && !shiftStart) {
                    totalPresent++;
                } else if (att && att.status === 'absent') {
                    totalAbsent++;
                    const absenceRule = rulesMap.get('absence');
                    if (absenceRule) {
                        absenceDeductionDays += absenceRule.amount;
                    }
                } else if (att && (att.status === 'late' || att.minutesLate > 0)) {
                    totalLate++;
                    totalMinutesLate += att.minutesLate;
                    const ruleKey = getLateRuleKey(att.minutesLate);
                    const rule = ruleKey ? rulesMap.get(ruleKey) : null;
                    if (rule) {
                        lateDeductionDays += rule.amount;
                    }
                } else if (att && att.status === 'present') {
                    totalPresent++;
                }
            }
            const totalDeductionDays = lateDeductionDays + absenceDeductionDays;
            const totalQualityDeductions = empQuality.reduce((sum, q)=>sum + q.deductionAmount, 0);
            const activeDays = allDates.size - totalExempt;
            const attendanceCompliance = activeDays > 0 ? Math.round((totalPresent + totalLate) / activeDays * 100) : 0;
            return {
                employeeName: emp.name,
                department: emp.department || '—',
                totalPresent,
                totalLate,
                totalAbsent,
                totalExempt,
                totalMinutesLate,
                totalDelays: totalLate,
                lateDeductionDays: Math.round(lateDeductionDays * 100) / 100,
                absenceDeductionDays: Math.round(absenceDeductionDays * 100) / 100,
                totalDeductionDays: Math.round(totalDeductionDays * 100) / 100,
                totalQualityDeductions: Math.round(totalQualityDeductions * 100) / 100,
                totalDeductions: Math.round(totalDeductionDays * 100) / 100,
                totalAmount: Math.round((totalDeductionDays + totalQualityDeductions) * 100) / 100,
                attendanceCompliance,
                workDays: activeDays
            };
        });
        const sorted = [
            ...rows
        ].sort((a, b)=>b.attendanceCompliance - a.attendanceCompliance);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            rows: sorted
        });
    } catch (error) {
        console.error('Generate report error:', error);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: 'Internal server error'
        }, {
            status: 500
        });
    }
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__0ho.zn.._.js.map