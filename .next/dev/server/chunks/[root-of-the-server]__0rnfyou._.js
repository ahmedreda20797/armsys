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
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[project]/src/app/api/home/stats/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GET",
    ()=>GET
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/db.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
;
;
async function GET() {
    try {
        const today = new Date();
        const dd = String(today.getDate()).padStart(2, '0');
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const yyyy = today.getFullYear();
        const todayStr = `${dd}/${mm}/${yyyy}`;
        const totalEmployees = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].employee.count();
        const todayAttendance = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].attendance.count({
            where: {
                date: todayStr
            }
        });
        const pendingRequests = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].request.count({
            where: {
                status: 'pending'
            }
        });
        const activeTravel = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].travelDeal.count({
            where: {
                status: {
                    in: [
                        'upcoming',
                        'in_progress'
                    ]
                }
            }
        });
        const presentCount = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].attendance.count({
            where: {
                date: todayStr,
                status: 'present'
            }
        });
        const absentCount = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].attendance.count({
            where: {
                date: todayStr,
                status: 'absent'
            }
        });
        // Late employees for today
        const lateAttendance = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].attendance.findMany({
            where: {
                date: todayStr,
                status: 'late'
            },
            include: {
                employee: {
                    select: {
                        name: true
                    }
                }
            },
            take: 20
        });
        const lateEmployees = lateAttendance.map((a)=>({
                ...a,
                employeeName: a.employee.name
            }));
        // Upcoming travel with all statuses
        const upcomingTravel = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].travelDeal.findMany({
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
                        name: true
                    }
                }
            },
            orderBy: {
                departureDate: 'asc'
            },
            take: 20
        });
        const upcomingTravelWithName = upcomingTravel.map((t)=>({
                ...t,
                employeeName: t.employee.name
            }));
        // Pending requests with details
        const pendingRequestsDetails = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].request.findMany({
            where: {
                status: 'pending'
            },
            include: {
                employee: {
                    select: {
                        name: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: 20
        });
        const pendingRequestsWithName = pendingRequestsDetails.map((r)=>({
                ...r,
                employeeName: r.employee.name
            }));
        // Employees grouped by department
        const allEmployees = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].employee.findMany({
            select: {
                id: true,
                department: true,
                name: true
            }
        });
        const deptMap = {};
        for (const emp of allEmployees){
            const dept = emp.department || 'بدون قسم';
            if (!deptMap[dept]) {
                deptMap[dept] = {
                    name: dept,
                    count: 0,
                    employees: []
                };
            }
            deptMap[dept].count += 1;
            deptMap[dept].employees.push({
                name: emp.name,
                id: emp.id
            });
        }
        const departments = Object.values(deptMap);
        // Booking data summary: count missing items per category
        const travelDeals = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].travelDeal.findMany({
            where: {
                status: {
                    in: [
                        'upcoming',
                        'in_progress'
                    ]
                }
            }
        });
        const bookingSummary = {
            missingFlights: travelDeals.filter((t)=>!t.hasFlight).length,
            missingHotels: travelDeals.filter((t)=>!t.hasHotel).length,
            missingVisas: travelDeals.filter((t)=>!t.hasVisa).length,
            missingTours: travelDeals.filter((t)=>!t.hasTours).length,
            missingTransportation: travelDeals.filter((t)=>!t.hasTransportation).length,
            totalBookings: travelDeals.length
        };
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            totalEmployees,
            todayAttendance,
            pendingRequests,
            activeTravel,
            lateEmployees,
            upcomingTravel: upcomingTravelWithName,
            presentCount,
            absentCount,
            pendingRequestsDetails: pendingRequestsWithName,
            departments,
            bookingSummary
        });
    } catch (error) {
        console.error('Home stats error:', error);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            totalEmployees: 0,
            todayAttendance: 0,
            pendingRequests: 0,
            activeTravel: 0,
            lateEmployees: [],
            upcomingTravel: [],
            presentCount: 0,
            absentCount: 0,
            pendingRequestsDetails: [],
            departments: [],
            bookingSummary: {
                missingFlights: 0,
                missingHotels: 0,
                missingVisas: 0,
                missingTours: 0,
                missingTransportation: 0,
                totalBookings: 0
            }
        }, {
            status: 200
        });
    }
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__0rnfyou._.js.map