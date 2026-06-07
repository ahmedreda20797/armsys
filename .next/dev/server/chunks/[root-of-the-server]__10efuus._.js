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
"[project]/src/app/api/biometric/upload/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "POST",
    ()=>POST
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$xlsx$2f$xlsx$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/xlsx/xlsx.mjs [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/db.ts [app-route] (ecmascript)");
;
;
;
// Column mapping for biometric Excel headers
const COLUMN_MAP = {
    'اسم': 'name',
    'الاسم': 'name',
    'اسم الموظف': 'name',
    'name': 'name',
    'كود': 'code',
    'كود الموظف': 'code',
    'code': 'code',
    'التاريخ': 'date',
    'تاريخ': 'date',
    'date': 'date',
    'الدخول': 'checkIn',
    'دخول': 'checkIn',
    'وقت الدخول': 'checkIn',
    'وقت الحضور': 'checkIn',
    'حضور': 'checkIn',
    'checkin': 'checkIn',
    'check_in': 'checkIn',
    'الخروج': 'checkOut',
    'خروج': 'checkOut',
    'وقت الخروج': 'checkOut',
    'وقت الانصراف': 'checkOut',
    'انصراف': 'checkOut',
    'checkout': 'checkOut',
    'check_out': 'checkOut',
    'time in': 'checkIn',
    'time out': 'checkOut'
};
function normalizeHeader(header) {
    const trimmed = String(header ?? '').trim();
    return COLUMN_MAP[trimmed] || COLUMN_MAP[trimmed.toLowerCase()] || trimmed;
}
// ✅ FIXED: handle empty string → return null
function toNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '' || trimmed === 'ـــ' || trimmed === '---' || trimmed === '-') return null;
        const n = Number(trimmed);
        return isNaN(n) ? null : n;
    }
    return null;
}
// ✅ FIXED: only convert if num > 30000 (valid Excel date serial)
function parseExcelDate(value) {
    const num = toNumber(value);
    if (num !== null && num > 30000 && num < 100000) {
        const excelEpoch = new Date(1899, 11, 30);
        const date = new Date(excelEpoch.getTime() + num * 86400000);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    }
    return String(value ?? '').trim();
}
// ✅ FIXED: only convert if num > 0 and num < 2 (valid time fraction)
function parseExcelTime(value) {
    const num = toNumber(value);
    if (num !== null && num > 0 && num < 2) {
        const totalMinutes = Math.round(num * 24 * 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
    const str = String(value ?? '').trim();
    if (!str || str === 'ـــ' || str === '---' || str === '-' || str === '/') return null;
    return str;
}
function parseExcelFile(buffer) {
    try {
        const workbook = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$xlsx$2f$xlsx$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["read"](new Uint8Array(buffer), {
            type: 'array'
        });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) return {
            rows: [],
            headers: [],
            rawHeaders: []
        };
        const sheet = workbook.Sheets[sheetName];
        // ✅ FIXED: add raw: true to preserve number types
        const rawData = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$xlsx$2f$xlsx$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["utils"].sheet_to_json(sheet, {
            header: 1,
            defval: '',
            raw: true
        });
        if (rawData.length < 2) return {
            rows: [],
            headers: [],
            rawHeaders: []
        };
        let headerRowIndex = 0;
        for(let i = 0; i < rawData.length; i++){
            const row = rawData[i];
            const nonEmpty = row.filter((c)=>String(c ?? '').trim() !== '');
            if (nonEmpty.length >= 2) {
                headerRowIndex = i;
                break;
            }
        }
        const rawHeaders = rawData[headerRowIndex].map((h)=>String(h ?? '').trim());
        const headers = rawHeaders.map(normalizeHeader);
        const rows = [];
        for(let i = headerRowIndex + 1; i < rawData.length; i++){
            const row = rawData[i];
            if (row.every((v)=>!v && v !== 0)) continue;
            rows.push(row);
        }
        return {
            rows,
            headers,
            rawHeaders
        };
    } catch (error) {
        console.error('Excel parse error:', error);
        return {
            rows: [],
            headers: [],
            rawHeaders: []
        };
    }
}
async function POST(request) {
    try {
        const formData = await request.formData();
        const file = formData.get('file');
        if (!file) {
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                error: 'لم يتم اختيار ملف'
            }, {
                status: 400
            });
        }
        const buffer = await file.arrayBuffer();
        const { rows, headers, rawHeaders } = parseExcelFile(buffer);
        if (rows.length === 0) {
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                error: 'لا توجد بيانات في الملف. الأعمدة: ' + rawHeaders.join(', ')
            }, {
                status: 400
            });
        }
        // Column index map
        const colIdx = {};
        headers.forEach((h, i)=>{
            colIdx[h] = i;
        });
        // Load all employees
        const allEmployees = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].employee.findMany({
            select: {
                id: true,
                name: true,
                code: true
            }
        });
        const empByName = new Map();
        allEmployees.forEach((e)=>{
            empByName.set(e.name.trim().toLowerCase().replace(/\s+/g, ' '), {
                id: e.id
            });
        });
        const empByCode = new Map();
        allEmployees.filter((e)=>e.code).forEach((e)=>{
            empByCode.set(e.code.trim().toLowerCase(), {
                id: e.id
            });
        });
        let imported = 0;
        let skipped = 0;
        const skippedNames = [];
        for (const row of rows){
            const getVal = (key)=>row[colIdx[key]] ?? '';
            const name = String(getVal('name')).trim();
            const code = String(getVal('code')).trim();
            const date = parseExcelDate(getVal('date'));
            const checkIn = parseExcelTime(getVal('checkIn'));
            const checkOut = parseExcelTime(getVal('checkOut'));
            // Debug log for first row
            if (row === rows[0]) {
                console.log('🔍 Biometric raw:', row);
                console.log('🔍 Biometric parsed:', {
                    name,
                    code,
                    date,
                    checkIn,
                    checkOut
                });
            }
            if (!date) {
                skipped++;
                continue;
            }
            let employee = name ? empByName.get(name.toLowerCase().replace(/\s+/g, ' ')) : null;
            if (!employee && code) employee = empByCode.get(code.toLowerCase());
            if (!employee) {
                skipped++;
                if (skippedNames.length < 10) skippedNames.push(name || code || 'بدون اسم');
                continue;
            }
            await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].biometric.create({
                data: {
                    employeeId: employee.id,
                    date,
                    checkIn,
                    checkOut
                }
            });
            imported++;
        }
        const skippedMsg = skippedNames.length > 0 ? ` (أمثلة: ${skippedNames.slice(0, 5).join(', ')})` : '';
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            message: `تم استيراد ${imported} سجل بنجاح${skipped > 0 ? ` — ${skipped} تم تخطيه${skippedMsg}` : ''}`,
            imported,
            skipped,
            dbEmployeeCount: allEmployees.length
        });
    } catch (error) {
        console.error('Upload biometric error:', error);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: 'خطأ في معالجة الملف: ' + String(error)
        }, {
            status: 500
        });
    }
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__10efuus._.js.map