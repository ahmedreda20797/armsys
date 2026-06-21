#!/usr/bin/env python3
"""ARM ERP Full Database & Architecture Audit Report — PDF Generation"""
import sys, os
sys.path.insert(0, '/home/z/my-project/skills/pdf/scripts')

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, cm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT
from reportlab.lib.colors import HexColor
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, KeepTogether
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.lib import colors

# ── Font Registration ──
FONT_DIR = '/usr/share/fonts'
pdfmetrics.registerFont(TTFont('NotoSerifSC', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf'))
pdfmetrics.registerFont(TTFont('NotoSerifSC-Bold', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf'))
pdfmetrics.registerFont(TTFont('NotoSansSC', f'{FONT_DIR}/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('NotoSansSC-Bold', f'{FONT_DIR}/truetype/dejavu/DejaVuSans-Bold.ttf'))
registerFontFamily('NotoSerifSC', normal='NotoSerifSC', bold='NotoSerifSC-Bold')
registerFontFamily('NotoSansSC', normal='NotoSansSC', bold='NotoSansSC-Bold')

# ── Palette (from cascade generator) ──
C = {
    'page_bg':    '#0d0d0c',
    'section_bg': '#1a1917',
    'card_bg':    '#2b2822',
    'table_stripe':'#1f1e1b',
    'header_fill':'#564e35',
    'cover_block':'#353126',
    'border':     '#4e4838',
    'icon':       '#c0a85f',
    'accent':     '#d3bc7a',
    'accent2':    '#708bd9',
    'text':       '#f1f1f0',
    'muted':      '#8f8c85',
    'success':    '#71b989',
    'warning':    '#b9a57d',
    'error':      '#bf766f',
    'info':       '#779dc3',
}

PAGE_W, PAGE_H = A4
MARGIN = 2.2 * cm
avail = PAGE_W - 2 * MARGIN

# ── Styles ──
styles = getSampleStyleSheet()

styles.add(ParagraphStyle(
    'CoverTitle', fontName='NotoSansSC-Bold', fontSize=28, leading=36,
    textColor=HexColor(C['text']), alignment=TA_CENTER, spaceAfter=8*mm
))
styles.add(ParagraphStyle(
    'CoverSubtitle', fontName='NotoSansSC', fontSize=14, leading=20,
    textColor=HexColor(C['muted']), alignment=TA_CENTER, spaceAfter=4*mm
))
styles.add(ParagraphStyle(
    'SectionTitle', fontName='NotoSansSC-Bold', fontSize=16, leading=22,
    textColor=HexColor(C['accent']), spaceBefore=8*mm, spaceAfter=4*mm,
    borderPadding=(2, 0, 2, 0)
))
styles.add(ParagraphStyle(
    'SubTitle', fontName='NotoSansSC-Bold', fontSize=12, leading=17,
    textColor=HexColor(C['accent2']), spaceBefore=5*mm, spaceAfter=3*mm
))
styles.add(ParagraphStyle(
    'Body', fontName='NotoSansSC', fontSize=10, leading=16,
    textColor=HexColor(C['text']), spaceAfter=3*mm, alignment=TA_LEFT
))
styles.add(ParagraphStyle(
    'AuditBullet', fontName='NotoSansSC', fontSize=10, leading=15,
    textColor=HexColor(C['text']), spaceAfter=2*mm, leftIndent=12*mm, bulletIndent=5*mm
))
styles.add(ParagraphStyle(
    'SmallText', fontName='NotoSansSC', fontSize=8, leading=12,
    textColor=HexColor(C['muted']), spaceAfter=1*mm
))
styles.add(ParagraphStyle(
    'CriticalBadge', fontName='NotoSansSC-Bold', fontSize=10, leading=14,
    textColor=HexColor(C['error']), spaceBefore=1*mm, spaceAfter=1*mm
))
styles.add(ParagraphStyle(
    'HighBadge', fontName='NotoSansSC-Bold', fontSize=10, leading=14,
    textColor=HexColor('#f59e0b'), spaceBefore=1*mm, spaceAfter=1*mm
))
styles.add(ParagraphStyle(
    'MediumBadge', fontName='NotoSansSC-Bold', fontSize=10, leading=14,
    textColor=HexColor(C['accent2']), spaceBefore=1*mm, spaceAfter=1*mm
))
styles.add(ParagraphStyle(
    'TableCell', fontName='NotoSansSC', fontSize=9, leading=13,
    textColor=HexColor(C['text'])
))
styles.add(ParagraphStyle(
    'TableHeader', fontName='NotoSansSC-Bold', fontSize=9, leading=13,
    textColor=HexColor(C['text'])
))
styles.add(ParagraphStyle(
    'Footer', fontName='NotoSansSC', fontSize=7, leading=10,
    textColor=HexColor(C['muted']), alignment=TA_CENTER
))

# ── Helpers ──
def section(title):
    return [
        HRFlowable(width="100%", thickness=0.5, color=HexColor(C['border']), spaceAfter=3*mm),
        Paragraph(title, styles['SectionTitle']),
    ]

def sub(title):
    return Paragraph(title, styles['SubTitle'])

def body(text):
    return Paragraph(text, styles['Body'])

def bullet(text):
    return Paragraph(f'<bullet>&bull;</bullet>{text}', styles['AuditBullet'])

def badge(text, level='critical'):
    s = styles.get(f'{level.capitalize()}Badge', styles['Body'])
    prefix = {'critical': '[CRITICAL]', 'high': '[HIGH]', 'medium': '[MEDIUM]', 'low': '[LOW]'}.get(level, '')
    return Paragraph(f'{prefix} {text}', s)

def make_table(headers, rows, col_widths=None):
    """Build a styled table."""
    avail = PAGE_W - 2 * MARGIN
    if col_widths is None:
        n = len(headers)
        col_widths = [avail / n] * n

    header_row = [Paragraph(h, styles['TableHeader']) for h in headers]
    data = [header_row]
    for row in rows:
        data.append([Paragraph(str(c), styles['TableCell']) for c in row])

    t = Table(data, colWidths=col_widths, repeatRows=1)
    style_cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), HexColor(C['header_fill'])),
        ('TEXTCOLOR', (0, 0), (-1, 0), HexColor(C['text'])),
        ('FONTNAME', (0, 0), (-1, 0), 'NotoSansSC-Bold'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [HexColor(C['card_bg']), HexColor(C['table_stripe'])]),
        ('GRID', (0, 0), (-1, -1), 0.3, HexColor(C['border'])),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]
    t.setStyle(TableStyle(style_cmds))
    return t

# ── Page Background ──
def page_bg(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(HexColor(C['page_bg']))
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    # Footer line
    canvas.setStrokeColor(HexColor(C['border']))
    canvas.setLineWidth(0.3)
    canvas.line(MARGIN, 15*mm, PAGE_W - MARGIN, 15*mm)
    # Footer text
    canvas.setFont('NotoSansSC', 7)
    canvas.setFillColor(HexColor(C['muted']))
    canvas.drawCentredString(PAGE_W / 2, 10*mm, 'ARM ERP Architecture Audit Report - Confidential')
    canvas.drawRightString(PAGE_W - MARGIN, 10*mm, f'Page {doc.page}')
    canvas.restoreState()

# ── Build Document ──
OUTPUT = '/home/z/my-project/download/arm-erp-audit-report.pdf'
doc = SimpleDocTemplate(
    OUTPUT, pagesize=A4,
    leftMargin=MARGIN, rightMargin=MARGIN,
    topMargin=MARGIN, bottomMargin=20*mm,
)

story = []

# ═══════════════════════════════════════════════════════
# COVER PAGE
# ═══════════════════════════════════════════════════════
story.append(Spacer(1, 60*mm))
story.append(Paragraph('ARM ERP', ParagraphStyle(
    'BigTitle', fontName='NotoSansSC-Bold', fontSize=38, leading=46,
    textColor=HexColor(C['accent']), alignment=TA_CENTER
)))
story.append(Paragraph('Database & Architecture Audit', ParagraphStyle(
    'BigSub', fontName='NotoSansSC', fontSize=18, leading=24,
    textColor=HexColor(C['text']), alignment=TA_CENTER, spaceAfter=8*mm
)))
story.append(HRFlowable(width="40%", thickness=1, color=HexColor(C['accent']), spaceAfter=6*mm))
story.append(Paragraph('Comprehensive Security, Performance, and Data Integrity Assessment', styles['CoverSubtitle']))
story.append(Spacer(1, 15*mm))

cover_stats = [
    ['Audited Scope', '51 API routes, 24 pages, 15+ DB tables'],
    ['Date', '2026-06-21'],
    ['Modules', '21 modules across 7 groups'],
    ['Stack', 'Next.js 16 + Firebase RTDB + Zustand'],
    ['Classification', 'Confidential'],
]
story.append(make_table(['Item', 'Detail'], cover_stats, [avail * 0.35, avail * 0.65]))
story.append(Spacer(1, 20*mm))
story.append(Paragraph('Generated by ARM ERP Audit System', styles['SmallText']))
story.append(PageBreak())

# ═══════════════════════════════════════════════════════
# EXECUTIVE SUMMARY
# ═══════════════════════════════════════════════════════
story.extend(section('1. Executive Summary'))
story.append(body(
    'This report presents a comprehensive audit of the ARM ERP system, covering database architecture, '
    'API security, frontend architecture, and cross-module data integrity. The audit identified '
    'a total of 33 issues across 4 severity levels: 6 CRITICAL, 10 HIGH, 10 MEDIUM, and 7 LOW. '
    'The most urgent finding is that the authentication system relies on a client-supplied header '
    '(x-user-id) that can be trivially spoofed, effectively bypassing all permission checks across '
    'the entire application. Additionally, passwords are stored in plaintext, a debug endpoint '
    'exposes SSH private keys and Firebase secrets, and 23 out of 54 API routes have no '
    'authentication whatsoever.'
))
story.append(body(
    'On the positive side, the permission system design is well-structured with role-based presets, '
    'action-level granularity, and a migration helper for legacy formats. The React Query configuration '
    'is properly tuned with sensible stale times and retry policies. Code splitting is properly implemented '
    'with dynamic imports for all page components. The Firebase RTDB abstraction layer provides an '
    'elegant in-memory caching system with tiered TTL levels that reduce database load significantly.'
))

summary_data = [
    ['CRITICAL', '6', 'Exploitable vulnerabilities requiring immediate action'],
    ['HIGH', '10', 'Data integrity risks and missing permission checks'],
    ['MEDIUM', '10', 'Error handling gaps and validation issues'],
    ['LOW', '7', 'Code quality improvements and maintenance tasks'],
]
story.append(make_table(
    ['Severity', 'Count', 'Description'],
    summary_data,
    [avail * 0.15, avail * 0.1, avail * 0.75]
))
story.append(PageBreak())

# ═══════════════════════════════════════════════════════
# 2. DATABASE ARCHITECTURE
# ═══════════════════════════════════════════════════════
story.extend(section('2. Database Architecture'))
story.append(sub('2.1 Storage Layer'))
story.append(body(
    'The system uses Firebase Realtime Database (RTDB) as its primary data store, accessed through '
    'a custom abstraction layer in src/lib/db.ts. Data is organized under the path "arm_erp/{table}" '
    'with each record stored as a key-value pair where the key is a CUID2-generated ID. The Prisma '
    'schema file exists but contains only the default User/Post boilerplate models and is not used '
    'anywhere in the application. This means there is no ORM-level schema validation, no migration '
    'system, and no type-safe database queries. All data integrity checks must be done manually in '
    'the API route handlers.'
))

story.append(sub('2.2 Caching System'))
story.append(body(
    'The db.ts layer implements a sophisticated in-memory cache with 4 TTL tiers: DEFAULT (5s) for '
    'frequently changing data like attendance and requests, MEDIUM (15s) for moderate-change data '
    'like employees and quality records, LONG (30s) for rarely changing data like biometrics, and '
    'STATIC (60s) for almost-never-changing data like deduction rules. Cache is automatically '
    'invalidated on write operations (createRecord, updateRecord, deleteRecord). The getAllBatch '
    'function provides parallel fetching of multiple tables in a single pass, which is used by '
    'the home page stats endpoint and employee 360 aggregation. This design significantly reduces '
    'Firebase read operations and improves response times for aggregate queries.'
))

story.append(sub('2.3 Query Patterns'))
story.append(body(
    'The findWhere and countWhere functions load the entire table into memory and filter client-side, '
    'which is adequate for small to medium datasets but will become a performance bottleneck at '
    'scale. There is no pagination in the core db.ts layer, meaning routes that call getAll receive '
    'every record. The countByEmployeeId function provides an optimized single-pass counting mechanism '
    'that avoids creating intermediate arrays. However, the risk center route uses an O(n^2) algorithm '
    'for repeated issue detection, and the follow-ups POST handler loads all employees instead of using '
    'getById for a single lookup. These inefficiencies compound with larger datasets.'
))

story.append(sub('2.4 Data Model Assessment'))
story.append(body(
    'The TypeScript type definitions in types/index.ts define 15+ domain entities with proper interface '
    'structures. The Employee interface includes essential fields like shiftStart/shiftEnd for '
    'attendance calculation. The FollowUp interface is comprehensive with priority levels, status '
    'tracking, and related entity references (relatedDeductionId). The CAPACase interface supports '
    'the full CAPA lifecycle with root cause analysis, corrective and preventive actions, and '
    'effectiveness verification. However, there is no database-level enforcement of these types. Any '
    'record with missing or malformed fields can be written to the database without validation.'
))

# Data Tables Inventory
story.append(sub('2.5 Firebase Tables Inventory'))
tables_data = [
    ['employees', 'Employee profiles, departments, positions, shifts', 'YES', 'YES'],
    ['attendance', 'Daily attendance records per employee', 'YES', 'YES'],
    ['biometrics', 'Check-in/check-out fingerprint records', 'NO', 'YES'],
    ['requests', 'Leave/absence requests with approval workflow', 'YES', 'YES'],
    ['qualityDeductions', 'Quality-related deductions per employee', 'YES', 'YES'],
    ['hrDeductions', 'HR-related deductions with approval status', 'YES', 'YES'],
    ['deductionRules', 'Canonical deduction amounts (late15, late30, etc.)', 'YES', 'NO'],
    ['travelDeals', 'Travel operations with multi-service status', 'YES', 'YES'],
    ['followUps', 'Daily follow-up records with priority scoring', 'YES', 'YES'],
    ['capaCases', 'CAPA lifecycle management (corrective + preventive)', 'YES', 'YES'],
    ['complaints', 'Customer complaints with resolution tracking', 'YES', 'YES'],
    ['knowledgeBase', 'Knowledge articles by department', 'YES', 'YES'],
    ['users', 'System users with roles and permissions', 'YES', 'YES'],
    ['notifications', 'Cross-module notifications with routing', 'YES', 'YES'],
    ['automationRules', 'Rules engine automation configuration', 'YES', 'YES'],
    ['ruleExecutionLogs', 'Rules engine execution audit trail', 'YES', 'NO'],
    ['activityLogs', 'User activity audit logging', 'YES', 'NO'],
]
story.append(make_table(
    ['Table Name', 'Purpose', 'has employeeId', 'Used in Reports'],
    tables_data,
    [avail * 0.18, avail * 0.42, avail * 0.13, avail * 0.13]
))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════
# 3. CRITICAL SECURITY FINDINGS
# ═══════════════════════════════════════════════════════
story.extend(section('3. CRITICAL Security Findings'))

story.append(badge('C1. Authentication Bypass via Header Spoofing', 'critical'))
story.append(body(
    'The verifyPermission() function in src/lib/verify-permission.ts reads the user identity from '
    'the x-user-id HTTP header. This header is set client-side from localStorage, which is fully '
    'controlled by the end user. Any attacker can impersonate any user, including the system '
    'administrator, by setting x-user-id to any known user ID. This effectively bypasses the '
    'entire permission system that protects 32 API routes. The AuthContext sets up a global '
    'fetch override to inject this header, and the withAuth() helper provides an alternative injection '
    'mechanism, but both are trivially circumventable since they rely on client-trustable data.'
))
story.append(body(
    'Impact: Complete system compromise. An attacker can read all data, modify any record, '
    'execute automation rules, create admin users, and delete any entity in the system.'
))
story.append(bullet('Fix: Implement JWT-based authentication with cryptographically signed tokens'))
story.append(bullet('Fix: Verify JWT signature server-side on every authenticated request'))
story.append(bullet('Fix: Derive userId from the verified token, never from a client-supplied header'))

story.append(Spacer(1, 4*mm))

story.append(badge('C2. Plaintext Password Storage and Comparison', 'critical'))
story.append(body(
    'Passwords are stored in Firebase RTDB without any hashing. The login endpoint compares passwords '
    'using a direct string equality check (user.password !== password). User creation routes '
    '(dashboard/users POST and dashboard/users/[id] PUT) store passwords as-is. The seed route '
    'creates a default admin account with password "admin123". This means any database read exposure, '
    'whether through a compromised Firebase rule or a backup leak, exposes all user credentials '
    'in their original form. Combined with C1, any attacker can also read passwords directly.'
))
story.append(bullet('Fix: Hash all passwords with bcrypt (minimum 12 salt rounds)'))
story.append(bullet('Fix: Implement a migration script to hash existing plaintext passwords'))
story.append(bullet('Fix: Remove or gate the seed route behind NODE_ENV === development'))

story.append(Spacer(1, 4*mm))

story.append(badge('C3. Debug Endpoint Exposes SSH Keys and Firebase Secrets', 'critical'))
story.append(body(
    'The /api/debug-env route returns a JSON object containing the full RSA SSH private key in '
    'plaintext, Firebase service account credentials, database URL, storage URL, and a 64-character '
    'hex secret. This endpoint has no authentication whatsoever. Any unauthenticated HTTP GET request '
    'to /api/debug-env returns all secrets immediately. This is the most severe data exposure in '
    'the system because it provides direct access to infrastructure credentials, not just application data.'
))
story.append(bullet('Fix: DELETE /api/debug-env/route.ts immediately'))
story.append(bullet('Fix: Rotate the exposed SSH key since it may have been committed to version control'))

story.append(Spacer(1, 4*mm))

story.append(badge('C4. Unprotected Seed Routes Create/Modify Data Without Auth', 'critical'))
story.append(body(
    'The /api/auth/seed and /api/seed-test routes create records in the database without any '
    'authentication. The seed route creates an admin user with hardcoded credentials. The seed-test '
    'route can create employees, quality deductions, attendance records, and deduction rules. These '
    'routes can be called repeatedly by anyone to inject data into the production database or create '
    'admin accounts. They should only exist in development environments and must be gated by an '
    'environment variable check or removed entirely from production builds.'
))

story.append(Spacer(1, 4*mm))

story.append(badge('C5. Unauthenticated /api/auth/me Exposes Any User Data', 'critical'))
story.append(body(
    'The /api/auth/me endpoint accepts any userId as a URL query parameter and returns that user\'s '
    'email, name, role, permissions, and suspension status. There is no token validation or session '
    'check of any kind. An attacker can enumerate all system users by querying sequential IDs, '
    'obtaining email addresses, permission structures, and role assignments for the entire organization.'
))

story.append(Spacer(1, 4*mm))

story.append(badge('C6. 23 of 54 API Routes Have No Authentication', 'critical'))
story.append(body(
    'Twenty-three API routes across notifications, rules, biometric, Firebase configuration, '
    'deduction rules, home stats, risk center, and more have no verifyPermission() call. This means '
    'they are fully accessible to unauthenticated users. The affected routes include all notification '
    'CRUD operations, rules engine execution (which can create follow-ups and modify data), Firebase '
    'sync (which dumps the entire database), and the download route (which serves files from the '
    'server filesystem). Combined with C1, any user can execute these operations with admin privileges.'
))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════
# 4. HIGH SEVERITY FINDINGS
# ═════════════════════════════════════════════════════════
story.extend(section('4. HIGH Severity Findings'))

story.append(badge('H1. No Real Session Management', 'high'))
story.append(body(
    'Authentication state is stored entirely in localStorage as a JSON blob. There is no JWT, no '
    'session token, and no httpOnly cookie. The user object, including role and permissions, is '
    'fully controlled by the client. The setupAuthFetch function monkey-patches window.fetch globally '
    'to inject the x-user-id header, but since the source is localStorage, this provides zero security. '
    'This pattern also makes testing extremely difficult and can cause double-header issues when '
    'combined with other fetch wrappers. There are currently three separate mechanisms for injecting '
    'the x-user-id header (AuthContext global override, api-fetch.ts wrapper, verify-permission.ts '
    'withAuth helper), creating redundancy and confusion.'
))

story.append(badge('H2. Rules Engine Can Be Triggered by Anyone', 'high'))
story.append(body(
    'The /api/rules/execute/[id] and /api/rules/execute-all endpoints have no permission checks. '
    'The rules engine can create notifications, generate follow-up records, modify risk scores, create '
    'HR warnings, and trigger escalation workflows. Allowing unauthenticated execution of these rules '
    'means any external caller can automate arbitrary system actions. The rules engine also supports '
    'scheduled and threshold-based triggers that could be weaponized for denial-of-service attacks '
    'by creating rules with very short throttle intervals.'
))

story.append(badge('H3. No Input Field Whitelisting on Employee Update', 'high'))
story.append(body(
    'The employees/[id] PUT handler passes the entire request body directly to updateRecord() without '
    'filtering allowed fields. An attacker can overwrite internal fields like id, createdAt, '
    'or any other field. The same issue exists in hr-deductions/[id] PATCH handler. This allows '
    'privilege escalation through field injection, where an attacker could modify timestamps, IDs, '
    'or relationship fields that should be immutable.'
))

story.append(badge('H4. Cascading Delete Without Transactions', 'high'))
story.append(body(
    'The employees/[id] DELETE handler deletes records from 5 tables (attendance, requests, '
    'qualityDeductions, biometrics, travelDeals) sequentially. If any deletion fails mid-way, '
    'the database is left in an inconsistent state with some related records deleted and others '
    'remaining. Firebase RTDB does not support multi-path atomic transactions in the same way '
    'as a relational database, so implementing true rollback is difficult. A safer approach would '
    'be to use a soft-delete pattern or implement a cleanup job that runs after failed deletes.'
))

story.append(badge('H5. Missing Enum Validation on Multiple POST Routes', 'high'))
story.append(body(
    'Several API routes do not validate that incoming data matches expected enum values. The '
    'attendance POST accepts any string for the status field (should be present/late/absent/approved). '
    'The requests POST does not validate the type field. The quality POST does not validate '
    'deduction types. The follow-ups POST does not validate status, followUpType, or priorityLevel. '
    'This allows malformed data to enter the database, which can cause display errors, incorrect '
    'calculations in reports, and broken notification routing.'
))

story.append(badge('H6. No Rate Limiting on Login Endpoint', 'high'))
story.append(body(
    'The /api/auth/login endpoint has no brute-force protection. An attacker can attempt unlimited '
    'password guesses without being throttled or blocked. Given that passwords are stored in '
    'plaintext (C2), this makes credential stuffing attacks trivially effective. A rate limiter '
    'should be implemented to block IP addresses after a configurable number of failed attempts, '
    'with exponential backoff and optional account lockout.'
))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════
# 5. MEDIUM & LOW FINDINGS
# ═══════════════════════════════════════════════════════
story.extend(section('5. Medium Severity Findings'))

medium_findings = [
    ['M1', 'Excessive permission refresh: /api/auth/me called on every page navigation (AppLayout) plus every 10 seconds (AuthContext), creating unnecessary server load and potential DoS vector since the endpoint is unauthenticated'],
    ['M2', 'No pagination on 8+ bulk GET routes (employees, attendance, biometric, quality, complaints, follow-ups, hrDeductions). These load all records into memory, risking CPU/memory exhaustion with large datasets'],
    ['M3', 'Read-only report generation routes (reports/generate, reports/employee-detail) call syncRulesToCanonical() which mutates the deductionRules table as a side effect, violating separation of concerns'],
    ['M4', 'CAPA ID generation reads all existing cases to determine the next sequential number, creating a race condition under concurrent requests that can produce duplicate IDs'],
    ['M5', 'Missing Content-Type headers on multiple raw fetch POST/PUT calls in AttendancePage, QualityPage, and CAPAPage that bypass the apiFetch wrapper'],
    ['M6', 'Zustand full-store destructuring in AppLayout subscribes to ALL state changes instead of using individual selectors, causing unnecessary re-renders'],
    ['M7', 'Inconsistent data fetching: use-queries.ts defines 20+ React Query hooks, but most page components use raw fetch() calls instead, missing caching, deduplication, and stale-while-revalidate'],
    ['M8', 'safeParsePerms function duplicated in 4 files instead of being imported from a shared utility location'],
    ['M9', 'Activity logs POST uses home:view permission instead of a dedicated audit log permission'],
    ['M10', 'IP address in activity logs uses x-forwarded-for header which is client-supplied and trivially spoofable'],
]
story.append(make_table(
    ['ID', 'Description'],
    medium_findings,
    [avail * 0.07, avail * 0.93]
))

story.append(Spacer(1, 6*mm))
story.extend(section('6. Low Severity Findings'))

low_findings = [
    ['L1', '8 unused npm dependencies (next-auth, next-intl, uuid, react-syntax-highlighter, etc.) adding ~15-25MB to node_modules'],
    ['L2', '8 unused shadcn UI components (menubar, navigation-menu, carousel, etc.)'],
    ['L3', 'Prisma package listed in dependencies but never used anywhere (project uses Firebase RTDB)'],
    ['L4', 'React Query hooks use <any> type instead of proper TypeScript generics, negating type safety'],
    ['L5', 'Monolithic page components: RulesEnginePage (1,745 lines), TravelPage (1,571 lines), FollowUpsPage (1,435 lines) should be split'],
    ['L6', 'No security headers set on any route (CSP, X-Content-Type-Options, X-Frame-Options)'],
    ['L7', 'Inconsistent error message language mix of Arabic and English across routes'],
]
story.append(make_table(
    ['ID', 'Description'],
    low_findings,
    [avail * 0.07, avail * 0.93]
))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════
# 7. ROUTE PERMISSION MATRIX
# ═══════════════════════════════════════════════════════
story.extend(section('7. Route Permission Matrix'))
story.append(body(
    'The following matrix shows the authentication status of every API route. Routes marked with '
    'a red cross have NO verifyPermission() call and are fully accessible to unauthenticated callers. '
    'Routes marked with a green check have proper permission verification. Note that even routes '
    'with check marks are vulnerable due to the x-user-id spoofing issue (C1), which renders all '
    'permission checks ineffective until JWT-based authentication is implemented.'
))

perm_matrix = [
    ['employees', 'NO', 'YES', 'YES', 'YES'],
    ['attendance', 'NO', 'YES', 'YES', 'YES'],
    ['biometric', 'NO', '-', '-', 'YES'],
    ['requests', 'NO', 'YES', 'YES', 'YES'],
    ['travel', 'NO', 'YES', 'YES', 'YES'],
    ['quality', 'NO', 'YES', 'YES', 'YES'],
    ['hrDeductions', 'NO', 'YES', 'YES', 'YES'],
    ['follow-ups', 'NO', 'YES', 'YES', 'YES'],
    ['capa-cases', 'NO', 'YES', 'YES', 'YES'],
    ['complaints', 'NO', 'YES', 'YES', 'YES'],
    ['deduction-rules', 'NO', 'NO', 'NO', 'NO'],
    ['rules', 'NO', 'NO', '-', 'NO'],
    ['rules/execute', '-', 'NO', '-', '-'],
    ['notifications', 'NO', 'NO', 'YES', 'NO'],
    ['reports/export', '-', 'YES', '-', '-'],
    ['reports/generate', '-', 'YES', '-', '-'],
    ['auth/login', '-', 'YES', '-', '-'],
    ['auth/me', 'NO', '-', '-', '-'],
    ['auth/seed', '-', 'NO', '-', '-'],
    ['seed-test', '-', 'NO', '-', '-'],
    ['debug-env', 'NO', '-', '-', '-'],
    ['firebase/*', 'NO', 'NO', '-', '-'],
    ['home/stats', 'NO', '-', '-', '-'],
    ['risk-center', 'NO', '-', '-', '-'],
    ['download', 'NO', '-', '-', '-'],
    ['health', 'NO', '-', '-', '-'],
]
story.append(make_table(
    ['Route', 'GET', 'POST', 'PUT/PATCH', 'DELETE'],
    perm_matrix,
    [avail * 0.22, avail * 0.16, avail * 0.16, avail * 0.16, avail * 0.16]
))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════
# 8. PRIORITY ACTION PLAN
# ═══════════════════════════════════════════════════════
story.extend(section('8. Priority Action Plan'))

story.append(sub('Phase 1: Immediate (Today)'))
action_p1 = [
    ['DELETE /api/debug-env/route.ts', 'Removes SSH key and Firebase secret exposure'],
    ['DELETE or gate /api/seed-test and /api/auth/seed', 'Prevent unauthenticated data injection'],
    ['Rotate the exposed SSH key', 'Key may have been committed to version control'],
]
story.append(make_table(['Action', 'Reason'], action_p1, [avail * 0.45, avail * 0.55]))

story.append(sub('Phase 2: This Sprint'))
action_p2 = [
    ['Implement JWT-based authentication', 'Replace x-user-id header spoofing with signed tokens'],
    ['Hash all passwords with bcrypt', 'Migrate existing plaintext passwords with a transition period'],
    ['Add verifyPermission() to all 23 unprotected routes', 'Minimum: all write operations must be authenticated'],
    ['Add rate limiting to /api/auth/login', 'Block brute-force attacks with exponential backoff'],
    ['Remove window.fetch global override', 'Consolidate to single apiFetch wrapper'],
]
story.append(make_table(['Action', 'Reason'], action_p2, [avail * 0.45, avail * 0.55]))

story.append(sub('Phase 3: Next Sprint'))
action_p3 = [
    ['Add field whitelisting to update handlers', 'Prevent internal field overwriting on PUT/PATCH'],
    ['Add pagination to all bulk GET routes', 'Prevent memory exhaustion with large datasets'],
    ['Migrate pages from raw fetch to React Query hooks', 'Consistent caching and deduplication'],
    ['Add enum validation to all POST routes', 'Prevent malformed data from entering the database'],
    ['Remove unused dependencies', 'Reduce bundle size and attack surface'],
    ['Split monolithic page components', 'Improve maintainability and reduce cognitive load'],
]
story.append(make_table(['Action', 'Reason'], action_p3, [avail * 0.45, avail * 0.55]))

story.append(Spacer(1, 8*mm))
story.extend(section('9. Architecture Strengths'))
story.append(body(
    'Despite the critical security issues, the ARM ERP system demonstrates several strong architectural '
    'patterns. The Firebase RTDB abstraction layer with tiered caching is well-designed and '
    'effectively reduces database load. The permission system configuration with role-based presets, '
    'action-level granularity, and the migration helper for legacy formats provides a solid '
    'foundation for access control once the authentication mechanism is fixed. The React Query '
    'configuration uses sensible defaults with proper stale times, retry policies, and garbage collection. '
    'Code splitting is properly implemented with dynamic imports for all 24 page components, with '
    'intelligent idle preloading for the most commonly accessed pages.'
))
story.append(body(
    'The notification system is sophisticated, featuring real-time delivery via Firebase RTDB listeners, '
    'desktop notifications for critical alerts, sound effects for high-priority items, and intelligent '
    'routing that maps notifications to their source modules. The Employee 360 page aggregates data from '
    '9 different modules into a comprehensive employee profile with risk scoring and chronological '
    'timeline. The rules engine supports 9 action types and 10 trigger types with configurable throttle '
    'intervals and escalation chains. The operations center provides a unified dashboard that reads '
    'from 7 different modules simultaneously.'
))

# ── Build PDF ──
doc.build(story, onFirstPage=page_bg, onLaterPages=page_bg)
print(f'PDF generated: {OUTPUT}')
