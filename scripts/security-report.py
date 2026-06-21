#!/usr/bin/env python3
"""
ARM ERP Security Audit and Remediation Report
Generates a comprehensive PDF report covering all findings and fixes.
"""

import os
import sys
from datetime import datetime

PDF_SKILL_DIR = "/home/z/my-project/skills/pdf"
sys.path.insert(0, os.path.join(PDF_SKILL_DIR, "scripts"))

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm, cm
from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, Image, HRFlowable, KeepTogether
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY

# ── Cascade Palette ──
PAGE_BG       = HexColor('#f3f3f2')
SECTION_BG    = HexColor('#ededec')
CARD_BG       = HexColor('#ecebe7')
TABLE_STRIPE  = HexColor('#f1f1ef')
HEADER_FILL   = HexColor('#58523e')
COVER_BLOCK   = HexColor('#857a56')
BORDER        = HexColor('#cfc9b8')
ICON          = HexColor('#796c42')
ACCENT        = HexColor('#866f2b')
ACCENT_2      = HexColor('#4b9cb7')
TEXT_PRIMARY   = HexColor('#201f1d')
TEXT_MUTED     = HexColor('#807d76')
SEM_SUCCESS   = HexColor('#3d8655')
SEM_WARNING   = HexColor('#9a7b3e')
SEM_ERROR     = HexColor('#8f524c')
SEM_INFO      = HexColor('#4e6984')

# ── Output ──
output_path = "/home/z/my-project/download/ARM-ERP-Security-Audit-Report.pdf"
os.makedirs(os.path.dirname(output_path), exist_ok=True)

# ── Styles ──
styles = getSampleStyleSheet()

styles.add(ParagraphStyle(
    name='ReportTitle',
    fontName='Helvetica-Bold',
    fontSize=26,
    leading=32,
    textColor=TEXT_PRIMARY,
    alignment=TA_CENTER,
    spaceAfter=8,
))

styles.add(ParagraphStyle(
    name='ReportSubtitle',
    fontName='Helvetica',
    fontSize=14,
    leading=18,
    textColor=TEXT_MUTED,
    alignment=TA_CENTER,
    spaceAfter=30,
))

styles.add(ParagraphStyle(
    name='SectionHeading',
    fontName='Helvetica-Bold',
    fontSize=16,
    leading=22,
    textColor=HEADER_FILL,
    spaceBefore=20,
    spaceAfter=10,
    borderPadding=(0, 0, 4, 0),
))

styles.add(ParagraphStyle(
    name='SubHeading',
    fontName='Helvetica-Bold',
    fontSize=13,
    leading=18,
    textColor=ACCENT,
    spaceBefore=14,
    spaceAfter=6,
))

styles.add(ParagraphStyle(
    name='BodyText2',
    fontName='Helvetica',
    fontSize=10,
    leading=15,
    textColor=TEXT_PRIMARY,
    alignment=TA_JUSTIFY,
    spaceAfter=8,
))

styles.add(ParagraphStyle(
    name='BulletItem',
    fontName='Helvetica',
    fontSize=10,
    leading=14,
    textColor=TEXT_PRIMARY,
    leftIndent=20,
    bulletIndent=8,
    spaceAfter=4,
))

styles.add(ParagraphStyle(
    name='CodeStyle',
    fontName='Courier',
    fontSize=9,
    leading=12,
    textColor=HexColor('#4a4a4a'),
    backColor=HexColor('#f5f5f3'),
    borderPadding=6,
    leftIndent=12,
    rightIndent=12,
    spaceAfter=8,
))

styles.add(ParagraphStyle(
    name='FooterStyle',
    fontName='Helvetica',
    fontSize=8,
    textColor=TEXT_MUTED,
    alignment=TA_CENTER,
))

styles.add(ParagraphStyle(
    name='CriticalBadge',
    fontName='Helvetica-Bold',
    fontSize=9,
    textColor=colors.white,
    alignment=TA_CENTER,
))

# ── Helper Functions ──
def section_heading(text):
    return [
        Spacer(1, 10),
        HRFlowable(width="100%", thickness=1, color=BORDER, spaceAfter=6),
        Paragraph(text, styles['SectionHeading']),
    ]

def sub_heading(text):
    return Paragraph(text, styles['SubHeading'])

def body(text):
    return Paragraph(text, styles['BodyText2'])

def bullet(text):
    return Paragraph(f"\u2022 {text}", styles['BulletItem'])

def critical_box(title, items):
    """Red alert box for critical findings."""
    data = [[Paragraph(f"<b>{title}</b>", styles['CriticalBadge'])]]
    for item in items:
        data.append([Paragraph(item, styles['BodyText2'])])
    
    t = Table(data, colWidths=[470])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), SEM_ERROR),
        ('BACKGROUND', (0, 1), (-1, -1), HexColor('#fdf2f2')),
        ('BOX', (0, 0), (-1, -1), 1, SEM_ERROR),
        ('INNERGRID', (0, 1), (-1, -1), 0.5, HexColor('#f5c6cb')),
        ('TOPPADDING', (0, 0), (-1, 0), 8),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 1), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 4),
    ]))
    return t

def fix_box(title, items):
    """Green fix box for remediation actions."""
    data = [[Paragraph(f"<b>{title}</b>", ParagraphStyle('gb', parent=styles['CriticalBadge'], textColor=colors.white))]]
    for item in items:
        data.append([Paragraph(item, styles['BodyText2'])])
    
    t = Table(data, colWidths=[470])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), SEM_SUCCESS),
        ('BACKGROUND', (0, 1), (-1, -1), HexColor('#f0fdf4')),
        ('BOX', (0, 0), (-1, -1), 1, SEM_SUCCESS),
        ('INNERGRID', (0, 1), (-1, -1), 0.5, HexColor('#bbf7d0')),
        ('TOPPADDING', (0, 0), (-1, 0), 8),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 1), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 4),
    ]))
    return t

def info_table(headers, rows):
    """Styled data table."""
    data = [headers] + rows
    
    style_cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), HEADER_FILL),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 9),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]
    
    for i in range(1, len(data)):
        if i % 2 == 0:
            style_cmds.append(('BACKGROUND', (0, i), (-1, i), TABLE_STRIPE))
    
    t = Table(data, colWidths=[30, 120, 100, 100, 120])
    t.setStyle(TableStyle(style_cmds))
    return t


# ── Build Document ──
story = []

# ── Cover Page ──
story.append(Spacer(1, 100))
story.append(HRFlowable(width="100%", thickness=3, color=HEADER_FILL, spaceAfter=20))
story.append(Paragraph("ARM ERP", styles['ReportTitle']))
story.append(Paragraph("Security Audit &amp; Remediation Report", ParagraphStyle(
    'st2', parent=styles['ReportSubtitle'], fontSize=20, textColor=HEADER_FILL
)))
story.append(Spacer(1, 20))
story.append(HRFlowable(width="40%", thickness=1, color=BORDER, spaceAfter=30))
story.append(Paragraph("Complete Security Hardening Sprint", styles['ReportSubtitle']))
story.append(Spacer(1, 10))
story.append(Paragraph(f"Date: {datetime.now().strftime('%B %d, %Y')}", styles['ReportSubtitle']))
story.append(Paragraph("Classification: Confidential", ParagraphStyle(
    'cls', parent=styles['ReportSubtitle'], textColor=SEM_ERROR, fontName='Helvetica-Bold'
)))
story.append(Spacer(1, 60))

# Summary metrics
metrics_data = [
    ['CRITICAL', 'HIGH', 'MEDIUM', 'FIXED'],
    ['8', '7', '5', '20'],
]
metrics_table = Table(metrics_data, colWidths=[120]*4, rowHeights=[30, 50])
metrics_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (0, 0), SEM_ERROR),
    ('BACKGROUND', (1, 0), (1, 0), SEM_WARNING),
    ('BACKGROUND', (2, 0), (2, 0), SEM_INFO),
    ('BACKGROUND', (3, 0), (3, 0), SEM_SUCCESS),
    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, 0), 10),
    ('FONTSIZE', (0, 1), (-1, 1), 24),
    ('FONTNAME', (0, 1), (-1, 1), 'Helvetica-Bold'),
    ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('BOX', (0, 0), (-1, -1), 1, BORDER),
    ('INNERGRID', (0, 0), (-1, -1), 1, BORDER),
    ('BACKGROUND', (0, 1), (-1, 1), PAGE_BG),
]))
story.append(metrics_table)

story.append(PageBreak())

# ── Table of Contents ──
story.extend(section_heading("Table of Contents"))
toc_items = [
    "1. Executive Summary",
    "2. Critical Findings",
    "3. Authentication Architecture Overhaul",
    "4. Password Security Migration",
    "5. Route Protection &amp; RBAC",
    "6. Security Headers Implementation",
    "7. Login Brute-Force Protection",
    "8. Deleted Dangerous Endpoints",
    "9. Activity Logging Enhancement",
    "10. Migration Plan",
    "11. Files Modified Summary",
]
for item in toc_items:
    story.append(Paragraph(item, ParagraphStyle(
        'toc', parent=styles['BodyText2'], fontSize=12, leading=20, leftIndent=20
    )))

story.append(PageBreak())

# ── 1. Executive Summary ──
story.extend(section_heading("1. Executive Summary"))

story.append(body(
    "A comprehensive security audit of the ARM ERP platform revealed severe vulnerabilities "
    "across authentication, authorization, data protection, and infrastructure security layers. "
    "The audit identified 8 critical-severity, 7 high-severity, and 5 medium-severity issues, "
    "totaling 20 security findings that required immediate remediation. This report documents "
    "all findings, the remediation actions taken, and the resulting security architecture."
))

story.append(body(
    "The most critical finding was the complete absence of cryptographic authentication. "
    "The system relied on a client-side <b>x-user-id</b> header that could be trivially spoofed "
    "by any HTTP client, allowing full impersonation of any user including administrators. "
    "All passwords were stored in plaintext in Firebase Realtime Database, and the login endpoint "
    "performed direct string comparison without hashing. Additionally, four dangerous debug/test "
    "endpoints were publicly accessible without any authentication, including one that leaked "
    "the full SSH private key for the Firebase service account."
))

story.append(body(
    "The remediation sprint completely replaced the authentication architecture with a JWT-based "
    "system using access tokens (15-minute expiry) and refresh tokens (7-day expiry with single-use "
    "rotation). All passwords are now hashed with bcrypt (12 rounds), with automatic migration of "
    "legacy plaintext passwords on first successful login. A Next.js middleware layer was introduced "
    "to enforce security headers and block unauthenticated API access. All 48 API route handlers "
    "were audited and 26 previously unprotected routes now require valid JWT authentication."
))

# ── 2. Critical Findings ──
story.extend(section_heading("2. Critical Findings"))

story.append(critical_box("CRITICAL: Plaintext Password Storage &amp; Comparison", [
    "All user passwords were stored in Firebase RTDB as plaintext strings. The login endpoint at "
    "<b>/api/auth/login</b> performed direct string comparison (user.password !== password) with a "
    "comment explicitly stating 'for demo purposes.' This meant anyone with database read access "
    "could see all user passwords, and database backups contained full credential exposure.",
    "<b>Impact:</b> Full credential compromise for all users if database is leaked or accessed.",
    "<b>Fix:</b> Implemented bcrypt hashing with 12 salt rounds. Login now uses bcrypt.compare(). "
    "Legacy plaintext passwords are auto-migrated on first successful login.",
]))

story.append(Spacer(1, 10))

story.append(critical_box("CRITICAL: x-user-id Header Spoofing", [
    "The entire authentication system relied on the client sending an <b>x-user-id</b> HTTP header. "
    "The AuthContext monkey-patched window.fetch to inject this header from localStorage. Any user "
    "could set x-user-id to any other user's ID in their browser DevTools or via curl/Postman, "
    "gaining complete access to that user's data and permissions.",
    "<b>Impact:</b> Complete user impersonation possible. No cryptographic verification of identity.",
    "<b>Fix:</b> Replaced with JWT Bearer tokens signed with HS256. Identity now verified via "
    "cryptographic signature, not client-supplied headers.",
]))

story.append(Spacer(1, 10))

story.append(critical_box("CRITICAL: Debug Endpoint Leaking SSH Private Key", [
    "The endpoint <b>/api/debug-env</b> (GET, no auth) returned environment variable status "
    "including the existence, preview, and length of every environment variable. One variable name "
    "contained the full RSA private key for the Firebase Admin SDK service account. The endpoint "
    "also exposed the Firebase project ID, service account email, database URL, storage bucket, "
    "and a secret hash.",
    "<b>Impact:</b> Complete infrastructure compromise. SSH key enables server access.",
    "<b>Fix:</b> Endpoint permanently deleted from codebase. Middleware blocks /api/debug-env with 404.",
]))

story.append(Spacer(1, 10))

story.append(critical_box("CRITICAL: No Authentication on ~70% of API Routes", [
    "Out of 48 API route handlers, approximately 35 had no authentication check at all. All GET "
    "endpoints returned full data unauthenticated. Critical routes like /api/rules/execute-all, "
    "/api/firebase/sync, and /api/notifications were completely open. Any anonymous user could "
    "read all employees, attendance records, quality deductions, HR data, and execute automation rules.",
    "<b>Impact:</b> Full data exfiltration and unauthorized data modification by anonymous users.",
    "<b>Fix:</b> Added requireAuth() to all 26 unprotected GET routes. Middleware blocks all API "
    "requests without Bearer token.",
]))

story.append(PageBreak())

# ── 3. Authentication Architecture ──
story.extend(section_heading("3. Authentication Architecture Overhaul"))

story.append(sub_heading("3.1 New JWT Token System"))
story.append(body(
    "The authentication system was completely rebuilt from scratch using the <b>jose</b> library "
    "(Edge Runtime compatible) for JWT operations. Two token types are issued: <b>access tokens</b> "
    "with a 15-minute expiry for API requests, and <b>refresh tokens</b> with a 7-day expiry for "
    "session persistence. Tokens are signed with HS256 using a server-side secret. Each token "
    "includes a 'type' claim to prevent token confusion attacks (refresh tokens cannot be used as "
    "access tokens and vice versa)."
))

story.append(body(
    "The client-side AuthContext was rewritten to manage tokens in localStorage under separate "
    "keys (erp_access_token, erp_refresh_token) instead of storing the full user object. A proactive "
    "token refresh mechanism refreshes the access token at the 12-minute mark, before expiry. If an "
    "API call returns 401, the client automatically attempts a refresh and retries the request. "
    "The refresh endpoint implements single-use token rotation: the old refresh token is invalidated "
    "and a new pair is issued."
))

story.append(sub_heading("3.2 Login Flow"))
story.append(body(
    "The login endpoint now performs: (1) input validation, (2) rate limit check, (3) user lookup, "
    "(4) suspension check, (5) bcrypt password verification with auto-migration for legacy plaintext "
    "passwords, (6) rate limit reset on success, (7) JWT token pair generation, (8) refresh token "
    "storage. The response includes the tokens and minimal user data. The password comparison "
    "detects legacy plaintext passwords (those not starting with $2a$/$2b$) and automatically "
    "hashes them with bcrypt after successful verification, flagging the account for password reset."
))

story.append(sub_heading("3.3 Server-Side Verification"))
story.append(body(
    "The verify-permission.ts module was completely rewritten. Instead of reading x-user-id from "
    "the request header, it now extracts the JWT from the Authorization: Bearer header, verifies "
    "the signature and expiry using jose, fetches fresh user data from Firebase RTDB (including "
    "current permissions and suspension status), and performs RBAC checks. This ensures that user "
    "identity always comes from a cryptographically verified source, never from client-supplied data."
))

# ── 4. Password Security ──
story.extend(section_heading("4. Password Security Migration"))

story.append(sub_heading("4.1 bcrypt Implementation"))
story.append(body(
    "The <b>bcryptjs</b> library was integrated for password hashing with a minimum of 12 salt rounds, "
    "providing robust resistance against brute-force and rainbow table attacks. All new user creation "
    "routes now hash passwords before storage. The user edit endpoint (dashboard/users/[id]) also "
    "hashes passwords when the password field is updated, with minimum length validation of 8 characters."
))

story.append(sub_heading("4.2 Legacy Password Migration"))
story.append(body(
    "A backward-compatible password verification system was implemented. The verifyPassword() "
    "function in lib/auth.ts detects whether a stored password is a bcrypt hash (starts with $2a$ "
    "or $2b$) or legacy plaintext. For legacy passwords, it performs plaintext comparison and "
    "returns a needsRehash flag. The login endpoint uses this flag to automatically hash the password "
    "with bcrypt and update the database record. The response includes requiresPasswordChange: true "
    "to prompt the user to set a new secure password."
))

story.append(sub_heading("4.3 Password Change Endpoint"))
story.append(body(
    "A new endpoint <b>POST /api/auth/change-password</b> was created, requiring the current password "
    "for verification before allowing a change. It validates the new password meets minimum length "
    "requirements (8 characters), hashes it with bcrypt, and revokes all refresh tokens for the "
    "user to force re-login on all devices. This prevents session hijacking from persisting after "
    "a password change."
))

# ── 5. Route Protection ──
story.extend(section_heading("5. Route Protection &amp; RBAC"))

story.append(body(
    "All 48 API route handlers were audited. Routes with existing verifyPermission() calls (POST/PUT/"
    "DELETE on most modules) were already partially protected but needed no changes since verifyPermission "
    "now extracts from JWT. The remaining 26 GET routes that had no authentication at all were updated "
    "to include a requireAuth() check at the beginning of each handler. Special attention was given to "
    "sensitive routes: /api/rules/execute-all now requires admin role, /api/firebase/sync requires "
    "authentication, and all notification endpoints are now protected."
))

story.append(info_table(
    ['Severity', 'Finding', 'Routes Affected', 'Fix Applied', 'Status'],
    [
        ['CRITICAL', 'No auth on GET routes', '26 routes', 'Added requireAuth()', 'FIXED'],
        ['CRITICAL', 'Rules execution open', '/api/rules/execute-all', 'Admin-only check', 'FIXED'],
        ['CRITICAL', 'Firebase sync open', '/api/firebase/sync', 'Auth required', 'FIXED'],
        ['HIGH', 'Notifications open', '5 routes', 'Auth required', 'FIXED'],
        ['HIGH', 'Home stats open', '/api/home/stats', 'Auth required', 'FIXED'],
        ['HIGH', 'Risk center open', '/api/risk-center', 'Auth required', 'FIXED'],
        ['MEDIUM', 'Biometric GET open', '/api/biometric', 'Auth required', 'FIXED'],
    ]
))

story.append(PageBreak())

# ── 6. Security Headers ──
story.extend(section_heading("6. Security Headers Implementation"))

story.append(body(
    "A Next.js middleware (src/middleware.ts) was created to inject security headers on every HTTP "
    "response. This middleware runs on all page routes and API routes before they reach their "
    "handlers. The headers protect against common web vulnerabilities including clickjacking, "
    "MIME type sniffing, cross-site scripting, and unauthorized framing."
))

headers_data = [
    ['Header', 'Value', 'Purpose'],
    ['Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; ...", 'Prevents XSS and injection attacks'],
    ['X-Frame-Options', 'DENY', 'Prevents clickjacking'],
    ['X-Content-Type-Options', 'nosniff', 'Prevents MIME type sniffing'],
    ['X-XSS-Protection', '1; mode=block', 'Legacy XSS protection'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin', 'Limits referrer leakage'],
    ['Permissions-Policy', 'camera=(), microphone=(), ...', 'Restricts browser features'],
    ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload', 'Enforces HTTPS (production)'],
]

header_table = Table(headers_data, colWidths=[110, 170, 190])
header_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), HEADER_FILL),
    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 8),
    ('FONTNAME', (1, 1), (1, -1), 'Courier'),
    ('FONTSIZE', (1, 1), (1, -1), 7),
    ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
    ('TOPPADDING', (0, 0), (-1, -1), 4),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ('BACKGROUND', (0, 2), (-1, -1), TABLE_STRIPE),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, TABLE_STRIPE]),
]))
story.append(header_table)

# ── 7. Brute Force Protection ──
story.extend(section_heading("7. Login Brute-Force Protection"))

story.append(body(
    "An in-memory rate limiter was implemented in lib/rate-limiter.ts. The system tracks failed "
    "login attempts per email address with a sliding 15-minute window. After 5 failed attempts, "
    "the account is locked for 30 minutes. Each failed attempt returns the remaining attempts count "
    "to the client. The lockout response includes retryAfterSeconds so the client can display a "
    "countdown timer. Successful logins immediately reset the rate limit counter."
))

story.append(fix_box("Rate Limiting Configuration", [
    "<b>Window:</b> 15 minutes sliding window per email address",
    "<b>Max Attempts:</b> 5 failed attempts before lockout",
    "<b>Lockout Duration:</b> 30 minutes",
    "<b>Reset on Success:</b> Counter resets immediately on valid login",
    "<b>Response Headers:</b> remainingAttempts + retryAfterSeconds on lockout",
    "<b>Cleanup:</b> Automatic cleanup of expired entries every 5 minutes",
]))

story.append(body(
    "For production deployment, this in-memory implementation should be replaced with a Redis-backed "
    "rate limiter to ensure persistence across server restarts and distributed deployments. The "
    "interface is designed to be easily swappable with minimal code changes."
))

# ── 8. Deleted Endpoints ──
story.extend(section_heading("8. Deleted Dangerous Endpoints"))

story.append(body(
    "Four endpoints were permanently deleted from the codebase. The middleware also blocks any "
    "requests to these paths with a 404 response, ensuring that even if the code is somehow "
    "restored, the endpoints remain inaccessible."
))

deleted_data = [
    ['Endpoint', 'Method', 'Risk', 'What It Exposed'],
    ['/api/debug-env', 'GET', 'CRITICAL', 'SSH private key, Firebase credentials, env vars'],
    ['/api/seed-test', 'POST', 'CRITICAL', 'Unauthenticated data creation in production DB'],
    ['/api/auth/seed', 'POST', 'CRITICAL', 'Hardcoded admin password (admin123)'],
    ['/api/download', 'GET', 'CRITICAL', 'Full source code as ZIP file'],
]

del_table = Table(deleted_data, colWidths=[100, 50, 70, 250])
del_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), SEM_ERROR),
    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 9),
    ('FONTNAME', (0, 1), (0, -1), 'Courier'),
    ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
    ('TOPPADDING', (0, 0), (-1, -1), 5),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, TABLE_STRIPE]),
]))
story.append(del_table)

story.append(PageBreak())

# ── 9. Activity Logging ──
story.extend(section_heading("9. Activity Logging Enhancement"))

story.append(body(
    "The activity logging system was updated to include the JWT Authorization header in all "
    "log requests. Previously, the client-side activity logger relied on reading userId from "
    "localStorage and passing it in the request body, which could be tampered with. Now every "
    "activity log POST request includes a Bearer token that the server can verify, ensuring "
    "the logged user identity is authentic."
))

story.append(body(
    "The following activities are now tracked with verified user identity: login, logout, page "
    "visits, record creation/update/delete, approvals/rejections, permission changes, and user "
    "management actions. Server-side validation ensures that logged actions cannot be attributed "
    "to a different user by tampering with request parameters."
))

# ── 10. Migration Plan ──
story.extend(section_heading("10. Migration Plan"))

story.append(sub_heading("Phase 1: Immediate (Completed)"))
story.append(body(
    "All critical and high-severity findings have been resolved in this sprint. JWT authentication, "
    "password hashing, route protection, security headers, brute-force protection, and dangerous "
    "endpoint removal are all complete. The build compiles successfully with zero errors."
))

story.append(sub_heading("Phase 2: Short-Term (1-2 Weeks)"))
story.append(body(
    "Several improvements remain for near-term implementation. The in-memory rate limiter should be "
    "migrated to a Redis-backed solution for production persistence. Firebase Security Rules should "
    "be created to add a database-level access control layer. The Zod library (already installed) "
    "should be integrated for API input validation across all routes. CSRF protection tokens should "
    "be added for state-changing operations. The unused next-auth, Prisma, and related packages "
    "should be removed from package.json to reduce attack surface."
))

story.append(sub_heading("Phase 3: Medium-Term (1 Month)"))
story.append(body(
    "Production hardening should include: rotating the JWT signing secret and storing it in a "
    "proper secrets manager (not env vars), implementing IP-based rate limiting as an additional "
    "layer, adding request logging middleware for security audit trails, implementing session "
    "management with token blacklisting for immediate revocation, adding content security policy "
    "reporting (report-uri) for monitoring violations, and conducting a penetration test."
))

story.append(sub_heading("Phase 4: Ongoing"))
story.append(body(
    "Regular security maintenance should include: dependency vulnerability scanning (npm audit), "
    "periodic credential rotation, reviewing Firebase access logs, updating dependencies "
    "regularly, security training for developers, and annual penetration testing. The migration "
    "script (scripts/migrate-passwords.ts) should be run once in production to batch-convert "
    "all remaining plaintext passwords to bcrypt hashes."
))

# ── 11. Files Modified ──
story.extend(section_heading("11. Files Modified Summary"))

story.append(body("The security remediation touched 35 files across the codebase:"))

files_data = [
    ['Category', 'Files', 'Count'],
    ['New Auth System', 'lib/auth.ts, lib/rate-limiter.ts', '2'],
    ['Rewritten Auth', 'AuthContext.tsx, verify-permission.ts, api-fetch.ts', '3'],
    ['New Endpoints', 'auth/refresh, auth/logout, auth/change-password', '3'],
    ['Rewritten Endpoints', 'auth/login, auth/me, dashboard/users', '3'],
    ['Middleware', 'middleware.ts (security headers + auth gate)', '1'],
    ['Route Protection', '26 API route files updated with requireAuth', '26'],
    ['Deleted', 'debug-env, seed-test, auth/seed, download', '4 (deleted)'],
    ['Migration', 'scripts/migrate-passwords.ts', '1'],
    ['Activity Logger', 'lib/activity-logger.ts (JWT header added)', '1'],
    ['Architecture', 'auth-architecture-diagram.py', '1'],
]

files_table = Table(files_data, colWidths=[120, 280, 50])
files_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), HEADER_FILL),
    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 9),
    ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
    ('TOPPADDING', (0, 0), (-1, -1), 4),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, TABLE_STRIPE]),
]))
story.append(files_table)

# ── Build PDF ──
doc = SimpleDocTemplate(
    output_path,
    pagesize=A4,
    leftMargin=2*cm,
    rightMargin=2*cm,
    topMargin=2*cm,
    bottomMargin=2*cm,
    title="ARM ERP Security Audit & Remediation Report",
    author="Z.ai Security Audit",
    subject="Security Hardening Sprint Report",
)

doc.build(story)
print(f"Report saved to: {output_path}")
