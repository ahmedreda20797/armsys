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
"[project]/src/app/api/employees/upload/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
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
// Column mapping for Arabic/English Excel headers
const COLUMN_MAP = {
    'كود': 'code',
    'كود الموظف': 'code',
    'الكود': 'code',
    'code': 'code',
    'اسم': 'name',
    'الاسم': 'name',
    'اسم الموظف': 'name',
    'name': 'name',
    'القسم': 'department',
    'قسم': 'department',
    'department': 'department',
    'الوظيفة': 'position',
    'وظيفة': 'position',
    'position': 'position',
    'المسمى الوظيفي': 'position',
    'بداية الدوام': 'shiftStart',
    'بداية': 'shiftStart',
    'من': 'shiftStart',
    'shiftStart': 'shiftStart',
    'نهاية الدوام': 'shiftEnd',
    'نهاية': 'shiftEnd',
    'إلى': 'shiftEnd',
    'shiftEnd': 'shiftEnd',
    'تاريخ التعيين': 'hireDate',
    'تاريخ': 'hireDate',
    'hireDate': 'hireDate',
    'رقم الموبايل': 'mobile',
    'موبايل': 'mobile',
    'تليفون': 'mobile',
    'هاتف': 'mobile',
    'mobile': 'mobile',
    'رقم الهاتف': 'mobile',
    'رقم التليفون': 'mobile'
};
function normalizeHeader(header) {
    const trimmed = String(header ?? '').trim();
    return COLUMN_MAP[trimmed] || COLUMN_MAP[trimmed.toLowerCase()] || trimmed;
}
// ✅ FIXED: handle empty string → return null (Number('') === 0, not NaN!)
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
    const str = String(value ?? '').trim();
    if (!str || str === 'ـــ' || str === '---' || str === '-') return null;
    return str;
}
// ✅ FIXED: only convert if num > 0 and num < 2 (valid time fraction 0-24h)
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
function cleanText(value) {
    const str = String(value ?? '').trim();
    if (!str || str === 'ـــ' || str === '---' || str === '-') return null;
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
        // Find header row
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
        // Keep rows as raw values (numbers stay as numbers)
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
                error: `لا توجد بيانات في الملف. الأعمدة: ${rawHeaders.join(', ')}`
            }, {
                status: 400
            });
        }
        // Build column index map
        const colIdx = {};
        headers.forEach((h, i)=>{
            colIdx[h] = i;
        });
        // Map rows using raw values (numbers preserved!)
        const employees = rows.map((row)=>{
            const getVal = (key)=>row[colIdx[key]] ?? '';
            const code = cleanText(getVal('code'));
            const name = cleanText(getVal('name')) || '';
            const department = cleanText(getVal('department'));
            const position = cleanText(getVal('position'));
            const shiftStart = parseExcelTime(getVal('shiftStart'));
            const shiftEnd = parseExcelTime(getVal('shiftEnd'));
            const hireDate = parseExcelDate(getVal('hireDate'));
            const mobile = cleanText(getVal('mobile'));
            // Debug log for first row
            if (row === rows[0]) {
                console.log('🔍 Raw values:', row);
                console.log('🔍 Parsed:', {
                    code,
                    name,
                    department,
                    position,
                    shiftStart,
                    shiftEnd,
                    hireDate,
                    mobile
                });
            }
            return {
                code,
                name,
                department,
                position,
                shiftStart,
                shiftEnd,
                hireDate,
                mobile
            };
        }).filter((emp)=>emp.name !== '');
        if (employees.length === 0) {
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                error: 'لم يتم العثور على عمود "الاسم". الأعمدة: ' + rawHeaders.join(', ')
            }, {
                status: 400
            });
        }
        console.log('✅ Sample parsed employee:', employees[0]);
        // Insert one by one (SQLite doesn't support skipDuplicates)
        let imported = 0;
        let duplicates = 0;
        for (const emp of employees){
            try {
                if (emp.code) {
                    const existing = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].employee.findFirst({
                        where: {
                            code: emp.code
                        }
                    });
                    if (existing) {
                        await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].employee.update({
                            where: {
                                id: existing.id
                            },
                            data: emp
                        });
                        imported++;
                        duplicates++;
                        continue;
                    }
                }
                await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$db$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["db"].employee.create({
                    data: emp
                });
                imported++;
            } catch  {
                duplicates++;
            }
        }
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            message: `تم استيراد ${imported} موظف بنجاح${duplicates > 0 ? ` (${duplicates} تم تحديثهم/تخطيهم)` : ''}`,
            imported,
            updated: duplicates,
            total: employees.length
        });
    } catch (error) {
        console.error('Upload employees error:', error);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: 'خطأ في معالجة الملف: ' + String(error)
        }, {
            status: 500
        });
    }
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__0b_x8qt._.js.map