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
"[project]/src/app/api/home/stats/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GET",
    ()=>GET
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/db.ts [app-route] (ecmascript)");
;
;
function getTodayStr() {
    const now = new Date();
    return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}
/** Parse DD/MM/YYYY to a comparable number YYYYMMDD for sorting */ function parseDateToSortable(dateStr) {
    const parts = dateStr.split('/');
    if (parts.length !== 3) return 0;
    const year = parseInt(parts[2], 10) || 0;
    const month = parseInt(parts[1], 10) || 0;
    const day = parseInt(parts[0], 10) || 0;
    return year * 10000 + month * 100 + day;
}
/** Generate date strings for a given month range in DD/MM/YYYY format */ function getMonthDateRange(monthsAgo) {
    const now = new Date();
    const targetMonth = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
    const year = targetMonth.getFullYear();
    const month = targetMonth.getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();
    const monthNames = [
        'يناير',
        'فبراير',
        'مارس',
        'أبريل',
        'مايو',
        'يونيو',
        'يوليو',
        'أغسطس',
        'سبتمبر',
        'أكتوبر',
        'نوفمبر',
        'ديسمبر'
    ];
    const monthLabel = `${monthNames[month - 1]} ${year}`;
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const startStr = `01/${String(month).padStart(2, '0')}/${year}`;
    const endStr = `${String(daysInMonth).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
    return {
        startStr,
        endStr,
        monthLabel,
        monthKey
    };
}
/* ── Monthly Performance Builder ── */ async function getMonthlyPerformance(monthsAgo) {
    const { startStr, endStr, monthLabel, monthKey } = getMonthDateRange(monthsAgo);
    const startDateNum = parseDateToSortable(startStr);
    const endDateNum = parseDateToSortable(endStr);
    // All attendance records (not just late)
    const attendanceRecords = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].attendance.findMany({
        where: {},
        include: {
            employee: {
                select: {
                    id: true,
                    name: true,
                    department: true
                }
            }
        }
    });
    const monthRecords = attendanceRecords.filter((r)=>{
        const dateNum = parseDateToSortable(r.date);
        return dateNum >= startDateNum && dateNum <= endDateNum;
    });
    // Quality deductions
    const qualityDeductions = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].qualityDeduction.findMany({
        where: {
            month: monthKey
        },
        include: {
            employee: {
                select: {
                    id: true,
                    name: true,
                    department: true
                }
            }
        }
    });
    // Calculate working days (unique dates in attendance for this month)
    const workingDaysSet = new Set(monthRecords.map((r)=>r.date));
    const totalWorkingDays = workingDaysSet.size || 22; // fallback to 22
    const empMap = new Map();
    for (const rec of monthRecords){
        const empId = rec.employee.id;
        if (!empMap.has(empId)) {
            empMap.set(empId, {
                employeeId: empId,
                employeeName: rec.employee.name,
                department: rec.employee.department || 'بدون قسم',
                delayCount: 0,
                totalDelayMinutes: 0,
                deductionAmount: 0,
                deductionDays: 0,
                presentDays: 0,
                absentDays: 0
            });
        }
        const item = empMap.get(empId);
        if (rec.status === 'present') item.presentDays += 1;
        else if (rec.status === 'late') {
            item.delayCount += 1;
            item.totalDelayMinutes += rec.minutesLate;
        } else if (rec.status === 'absent') item.absentDays += 1;
    }
    for (const qd of qualityDeductions){
        const empId = qd.employee.id;
        if (!empMap.has(empId)) {
            empMap.set(empId, {
                employeeId: empId,
                employeeName: qd.employee.name,
                department: qd.employee.department || 'بدون قسم',
                delayCount: 0,
                totalDelayMinutes: 0,
                deductionAmount: 0,
                deductionDays: 0,
                presentDays: 0,
                absentDays: 0
            });
        }
        const item = empMap.get(empId);
        item.deductionAmount += qd.deductionAmount;
        item.deductionDays += qd.deductionDays;
    }
    const deptMap = new Map();
    let totalDelays = 0, totalDelayMinutes = 0, totalDeductionAmount = 0, totalDeductionDays = 0, totalPresent = 0, totalAbsent = 0;
    for (const item of empMap.values()){
        if (!deptMap.has(item.department)) {
            deptMap.set(item.department, {
                departmentName: item.department,
                employeeCount: 0,
                totalDelays: 0,
                totalDelayMinutes: 0,
                totalDeductionAmount: 0,
                totalDeductionDays: 0,
                presentDays: 0,
                absentDays: 0,
                employees: []
            });
        }
        const dept = deptMap.get(item.department);
        dept.employeeCount += 1;
        dept.totalDelays += item.delayCount;
        dept.totalDelayMinutes += item.totalDelayMinutes;
        dept.totalDeductionAmount += item.deductionAmount;
        dept.totalDeductionDays += item.deductionDays;
        dept.presentDays += item.presentDays;
        dept.absentDays += item.absentDays;
        dept.employees.push(item);
        totalDelays += item.delayCount;
        totalDelayMinutes += item.totalDelayMinutes;
        totalDeductionAmount += item.deductionAmount;
        totalDeductionDays += item.deductionDays;
        totalPresent += item.presentDays;
        totalAbsent += item.absentDays;
    }
    const departments = Array.from(deptMap.values()).sort((a, b)=>b.totalDelays - a.totalDelays);
    for (const dept of departments)dept.employees.sort((a, b)=>b.totalDelayMinutes - a.totalDelayMinutes);
    return {
        monthLabel,
        monthKey,
        totalDelays,
        totalDelayMinutes,
        totalDeductionAmount,
        totalDeductionDays,
        totalPresent,
        totalAbsent,
        totalWorkingDays,
        departments
    };
}
async function GET() {
    try {
        const todayStr = getTodayStr();
        /* ── 1. Employee Count ── */ const totalEmployees = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].employee.count();
        /* ── 2. All Departments ── */ const allDepts = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].employee.groupBy({
            by: [
                'department'
            ],
            _count: {
                id: true
            },
            where: {
                department: {
                    not: null
                }
            },
            orderBy: {
                _count: {
                    id: 'desc'
                }
            }
        });
        const departmentList = allDepts.map((d)=>({
                name: d.department || 'بدون قسم',
                count: d._count.id
            }));
        /* ── 3. Today's Attendance ── */ const [todayRecords, presentCount, absentCount, lateCount] = await Promise.all([
            __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].attendance.findMany({
                where: {
                    date: todayStr
                },
                include: {
                    employee: {
                        select: {
                            id: true,
                            name: true,
                            department: true
                        }
                    }
                }
            }),
            __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].attendance.count({
                where: {
                    date: todayStr,
                    status: 'present'
                }
            }),
            __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].attendance.count({
                where: {
                    date: todayStr,
                    status: 'absent'
                }
            }),
            __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].attendance.count({
                where: {
                    date: todayStr,
                    status: 'late'
                }
            })
        ]);
        const todayAttendance = todayRecords.length;
        /* ── 4. Department-level Today Stats ── */ const deptTodayStats = allDepts.map((d)=>{
            const deptRecords = todayRecords.filter((r)=>r.employee.department === d.department);
            return {
                name: d.department || 'بدون قسم',
                employeeCount: d._count.id,
                presentToday: deptRecords.filter((r)=>r.status === 'present').length,
                lateToday: deptRecords.filter((r)=>r.status === 'late').length,
                absentToday: deptRecords.filter((r)=>r.status === 'absent').length
            };
        });
        /* ── 5. Pending Requests ── */ const pendingRequests = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].request.findMany({
            where: {
                status: 'pending'
            },
            include: {
                employee: {
                    select: {
                        id: true,
                        name: true,
                        department: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        const pendingRequestsDetails = pendingRequests.map((req)=>({
                id: req.id,
                employeeId: req.employeeId,
                type: req.type,
                date: req.date,
                reason: req.reason,
                status: req.status,
                employeeName: req.employee.name,
                employeeDepartment: req.employee.department || '',
                createdAt: req.createdAt.toISOString()
            }));
        /* ── 6. Request Type Breakdown ── */ const allRequests = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].request.findMany();
        const typeMap = new Map();
        for (const r of allRequests){
            if (!typeMap.has(r.type)) typeMap.set(r.type, {
                pending: 0,
                approved: 0,
                rejected: 0
            });
            const entry = typeMap.get(r.type);
            if (r.status === 'pending') entry.pending++;
            else if (r.status === 'approved') entry.approved++;
            else entry.rejected++;
        }
        const requestTypeLabels = {
            leave: 'إجازة',
            permission: 'استئذان',
            excuse: 'غياب',
            tardiness: 'تأخير',
            remote: 'ريموتلي'
        };
        const requestTypeSummary = Array.from(typeMap.entries()).map(([type, counts])=>({
                type,
                label: requestTypeLabels[type] || type,
                ...counts
            }));
        /* ── 7. Travel ── */ const activeTravelDeals = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].travelDeal.findMany({
            where: {
                status: {
                    in: [
                        'upcoming',
                        'in_progress'
                    ]
                }
            },
            include: {
                employee: {
                    select: {
                        id: true,
                        name: true,
                        department: true
                    }
                }
            }
        });
        const upcomingTravel = activeTravelDeals.map((deal)=>({
                id: deal.id,
                employeeId: deal.employeeId,
                employeeName: deal.employee.name,
                employeeDepartment: deal.employee.department || '',
                destination: deal.destination,
                departureDate: deal.departureDate,
                returnDate: deal.returnDate,
                dealerName: deal.dealerName,
                customerNames: deal.customerNames,
                hasFlight: deal.hasFlight,
                hasHotel: deal.hasHotel,
                hasVisa: deal.hasVisa,
                hasTours: deal.hasTours,
                hasTransportation: deal.hasTransportation,
                flightStatus: deal.flightStatus,
                hotelStatus: deal.hotelStatus,
                visaStatus: deal.visaStatus,
                toursStatus: deal.toursStatus,
                transportationStatus: deal.transportationStatus,
                notes: deal.notes,
                status: deal.status
            })).sort((a, b)=>parseDateToSortable(a.departureDate) - parseDateToSortable(b.departureDate));
        // Completed travel stats
        const completedTravelCount = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].travelDeal.count({
            where: {
                status: 'completed'
            }
        });
        const inProgressTravelCount = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].travelDeal.count({
            where: {
                status: 'in_progress'
            }
        });
        /* ── 8. Late Employees Today ── */ const lateEmployeesRaw = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].attendance.findMany({
            where: {
                date: todayStr,
                status: 'late'
            },
            include: {
                employee: {
                    select: {
                        id: true,
                        name: true,
                        department: true
                    }
                }
            },
            orderBy: {
                minutesLate: 'desc'
            },
            take: 10
        });
        const lateEmployees = lateEmployeesRaw.map((att)=>({
                id: att.employee.id,
                employeeName: att.employee.name,
                department: att.employee.department || '',
                checkIn: att.checkIn,
                minutesLate: att.minutesLate
            }));
        /* ── 9. Monthly Performance ── */ const [lastMonthPerformance, currentMonthPerformance] = await Promise.all([
            getMonthlyPerformance(1),
            getMonthlyPerformance(0)
        ]);
        /* ── 10. Top Offenders (current month) ── */ const topOffenders = [];
        for (const dept of currentMonthPerformance.departments){
            for (const emp of dept.employees){
                if (emp.delayCount > 0) {
                    topOffenders.push({
                        employeeId: emp.employeeId,
                        employeeName: emp.employeeName,
                        department: emp.department,
                        delayCount: emp.delayCount,
                        totalDelayMinutes: emp.totalDelayMinutes,
                        deductionAmount: emp.deductionAmount
                    });
                }
            }
        }
        topOffenders.sort((a, b)=>b.totalDelayMinutes - a.totalDelayMinutes);
        const top5Offenders = topOffenders.slice(0, 5);
        /* ── 11. Deduction Rules Summary ── */ const deductionRules = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].deductionRule.findMany({
            orderBy: {
                amount: 'desc'
            }
        });
        const rulesSummary = deductionRules.map((r)=>({
                key: r.key,
                label: r.label,
                amount: r.amount,
                unit: r.unit
            }));
        /* ── 12. Quality Deductions Summary (current month) ── */ const { monthKey: currentMonthKey } = getMonthDateRange(0);
        const qualityThisMonth = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].qualityDeduction.findMany({
            where: {
                month: currentMonthKey
            }
        });
        const qualitySummary = {
            totalCases: qualityThisMonth.length,
            totalAmount: qualityThisMonth.reduce((s, q)=>s + q.deductionAmount, 0),
            totalDays: qualityThisMonth.reduce((s, q)=>s + q.deductionDays, 0),
            byType: {
                quality_issue: qualityThisMonth.filter((q)=>q.type === 'quality_issue').length,
                safety: qualityThisMonth.filter((q)=>q.type === 'safety').length,
                compliance: qualityThisMonth.filter((q)=>q.type === 'compliance').length
            }
        };
        /* ── 13. Biometric Sync Status ── */ const latestBiometric = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].biometric.findFirst({
            orderBy: {
                createdAt: 'desc'
            }
        });
        const biometricLastSync = latestBiometric?.createdAt?.toISOString() || null;
        const biometricRecordCount = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].biometric.count();
        /* ── Build Response ── */ return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            // Summary KPIs
            totalEmployees,
            todayAttendance,
            presentCount,
            absentCount,
            lateCount,
            attendanceRate: totalEmployees > 0 ? Math.round(presentCount / totalEmployees * 100) : 0,
            // Departments
            departmentList,
            deptTodayStats,
            // Requests
            pendingRequests: pendingRequestsDetails.length,
            pendingRequestsDetails,
            requestTypeSummary,
            // Travel
            activeTravel: upcomingTravel.length,
            completedTravelCount,
            inProgressTravelCount,
            upcomingTravel,
            // Late employees today
            lateEmployees,
            // Monthly performance
            lastMonthPerformance,
            currentMonthPerformance,
            // Top offenders
            topOffenders: top5Offenders,
            // Deduction rules
            rulesSummary,
            // Quality
            qualitySummary,
            // Biometric
            biometricLastSync,
            biometricRecordCount
        });
    } catch (error) {
        console.error('[GET /api/home/stats] Error:', error);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: 'Failed to load home stats'
        }, {
            status: 500
        });
    }
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__0z2pkcr._.js.map