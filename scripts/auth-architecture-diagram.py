import asyncio
from playwright.async_api import async_playwright
import os

output_path = "/home/z/my-project/download/arm-erp-auth-architecture.png"
os.makedirs(os.path.dirname(output_path), exist_ok=True)

html_content = """
<!DOCTYPE html>
<html dir="ltr">
<head>
<meta charset="UTF-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  background: #F8FAFC;
  color: #1E293B;
  padding: 40px;
  width: 1400px;
  height: 960px;
}

.title {
  text-align: center;
  margin-bottom: 30px;
}
.title h1 {
  font-size: 28px;
  font-weight: 700;
  color: #0F172A;
  margin-bottom: 4px;
}
.title p {
  font-size: 14px;
  color: #64748B;
}

.arch-container {
  display: grid;
  grid-template-columns: 280px 1fr 280px;
  gap: 20px;
  height: 800px;
}

/* Left Panel — Client */
.panel {
  background: white;
  border-radius: 12px;
  padding: 20px;
  border: 1px solid #E2E8F0;
}
.panel-title {
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 8px 14px;
  border-radius: 8px;
  margin-bottom: 16px;
  text-align: center;
}
.panel-title.client { background: #EFF6FF; color: #2563EB; }
.panel-title.server { background: #F0FDF4; color: #16A34A; }
.panel-title.security { background: #FEF2F2; color: #DC2626; }

.flow-item {
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 8px;
  font-size: 12px;
  line-height: 1.5;
}
.flow-item strong {
  display: block;
  color: #0F172A;
  font-size: 13px;
  margin-bottom: 2px;
}
.flow-item .desc {
  color: #64748B;
  font-size: 11px;
}

/* Center — Flow Diagram */
.center-flow {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
}

.flow-row {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
}

.flow-node {
  background: white;
  border: 2px solid #E2E8F0;
  border-radius: 10px;
  padding: 12px 18px;
  text-align: center;
  min-width: 160px;
  position: relative;
}
.flow-node.highlight {
  border-color: #3B82F6;
  background: #EFF6FF;
}
.flow-node.success {
  border-color: #22C55E;
  background: #F0FDF4;
}
.flow-node.warning {
  border-color: #F59E0B;
  background: #FFFBEB;
}
.flow-node.danger {
  border-color: #EF4444;
  background: #FEF2F2;
}
.flow-node .node-icon {
  font-size: 20px;
  margin-bottom: 4px;
}
.flow-node .node-title {
  font-size: 14px;
  font-weight: 600;
  color: #0F172A;
}
.flow-node .node-desc {
  font-size: 11px;
  color: #64748B;
  margin-top: 2px;
}

.arrow-down {
  font-size: 24px;
  color: #94A3B8;
  line-height: 1;
}

.arrow-right {
  font-size: 20px;
  color: #94A3B8;
}

.label-badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 10px;
  font-weight: 600;
  margin-top: 4px;
}
.badge-new { background: #DBEAFE; color: #1D4ED8; }
.badge-removed { background: #FEE2E2; color: #DC2626; }
.badge-updated { background: #FEF3C7; color: #92400E; }

/* Legend */
.legend {
  margin-top: 10px;
  display: flex;
  gap: 20px;
  justify-content: center;
  flex-wrap: wrap;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #64748B;
}
.legend-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

/* Security Headers List */
.header-list {
  list-style: none;
  padding: 0;
}
.header-list li {
  padding: 6px 10px;
  margin-bottom: 4px;
  background: #FEF2F2;
  border-radius: 6px;
  font-size: 11px;
  font-family: 'Courier New', monospace;
  color: #991B1B;
  border-left: 3px solid #EF4444;
}

.phase-label {
  font-size: 11px;
  font-weight: 700;
  color: #94A3B8;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 4px 0;
}
</style>
</head>
<body>

<div class="title">
  <h1>ARM ERP — Authentication Architecture</h1>
  <p>JWT-Based Security Architecture | Before &amp; After Migration</p>
</div>

<div class="arch-container">
  <!-- LEFT PANEL — Client Side -->
  <div class="panel">
    <div class="panel-title client">Client Side</div>

    <div class="phase-label">Login Flow</div>
    <div class="flow-item">
      <strong>User enters credentials</strong>
      <div class="desc">Email + Password form</div>
    </div>
    <div class="flow-item">
      <strong>POST /api/auth/login</strong>
      <div class="desc">Sends plaintext password over HTTPS</div>
    </div>
    <div class="flow-item highlight">
      <strong>Receives JWT Tokens</strong>
      <div class="desc">accessToken (15m) + refreshToken (7d)</div>
      <span class="label-badge badge-new">NEW</span>
    </div>
    <div class="flow-item highlight">
      <strong>Token Storage</strong>
      <div class="desc">localStorage: erp_access_token, erp_refresh_token</div>
      <span class="label-badge badge-new">NEW</span>
    </div>

    <div class="phase-label" style="margin-top: 12px;">API Requests</div>
    <div class="flow-item highlight">
      <strong>Authorization Header</strong>
      <div class="desc">Bearer {accessToken}</div>
      <span class="label-badge badge-new">REPLACES x-user-id</span>
    </div>
    <div class="flow-item highlight">
      <strong>Auto Token Refresh</strong>
      <div class="desc">Silent refresh at 12m + on 401</div>
      <span class="label-badge badge-new">NEW</span>
    </div>

    <div class="phase-label" style="margin-top: 12px;">Logout</div>
    <div class="flow-item">
      <strong>POST /api/auth/logout</strong>
      <div class="desc">Revokes refresh token server-side</div>
    </div>
    <div class="flow-item">
      <strong>Clear local storage</strong>
      <div class="desc">Remove all tokens + user data</div>
    </div>
  </div>

  <!-- CENTER — Flow -->
  <div class="center-flow">

    <div class="flow-row" style="justify-content: center;">
      <div class="flow-node">
        <div class="node-title">Client Request</div>
        <div class="node-desc">Browser / API Consumer</div>
      </div>
      <span class="arrow-right">&#8594;</span>
      <div class="flow-node highlight">
        <div class="node-title">Next.js Middleware</div>
        <div class="node-desc">Security Headers + Auth Gate</div>
      </div>
    </div>

    <div class="arrow-down">&#8595;</div>

    <div class="flow-row" style="justify-content: center;">
      <div class="flow-node danger">
        <div class="node-title">No Bearer Token?</div>
        <div class="node-desc">Return 401 Unauthorized</div>
      </div>
      <span class="arrow-right">&#8594;</span>
      <div class="flow-node success">
        <div class="node-title">Token Present</div>
        <div class="node-desc">Pass to Route Handler</div>
      </div>
    </div>

    <div class="arrow-down">&#8595;</div>

    <div class="flow-row" style="justify-content: center;">
      <div class="flow-node highlight">
        <div class="node-title">verifyPermission() / requireAuth()</div>
        <div class="node-desc">Extract user from JWT via jose library</div>
      </div>
    </div>

    <div class="arrow-down">&#8595;</div>

    <div class="flow-row">
      <div class="flow-node warning">
        <div class="node-title">JWT Verification</div>
        <div class="node-desc">HS256 signature check + expiry</div>
      </div>
      <span class="arrow-right">&#8594;</span>
      <div class="flow-node">
        <div class="node-title">Fetch User from DB</div>
        <div class="node-desc">Firebase RTDB — fresh permissions</div>
      </div>
      <span class="arrow-right">&#8594;</span>
      <div class="flow-node">
        <div class="node-title">RBAC Check</div>
        <div class="node-desc">pageId + action permissions</div>
      </div>
    </div>

    <div class="arrow-down">&#8595;</div>

    <div class="flow-row" style="justify-content: center;">
      <div class="flow-node success">
        <div class="node-title">Access Granted</div>
        <div class="node-desc">Execute route handler</div>
      </div>
    </div>

    <div class="arrow-down">&#8595;</div>

    <div style="display: flex; gap: 16px; width: 100%; justify-content: center;">
      <div class="flow-node highlight" style="min-width: 200px;">
        <div class="node-title">Login — Brute Force Guard</div>
        <div class="node-desc">5 attempts / 15min = 30min lockout</div>
        <span class="label-badge badge-new">NEW</span>
      </div>
      <div class="flow-node highlight" style="min-width: 200px;">
        <div class="node-title">Password — bcrypt 12 rounds</div>
        <div class="node-desc">Auto-migrate plaintext on login</div>
        <span class="label-badge badge-new">NEW</span>
      </div>
    </div>

    <div class="arrow-down">&#8595;</div>

    <div style="display: flex; gap: 16px; width: 100%; justify-content: center;">
      <div class="flow-node" style="min-width: 140px;">
        <div class="node-title">Access Token</div>
        <div class="node-desc">15 min expiry, HS256</div>
      </div>
      <div class="flow-node" style="min-width: 140px;">
        <div class="node-title">Refresh Token</div>
        <div class="node-desc">7 day expiry, single-use rotation</div>
      </div>
      <div class="flow-node" style="min-width: 140px;">
        <div class="node-title">Password Change</div>
        <div class="node-desc">Revokes ALL sessions</div>
      </div>
    </div>

    <div class="legend">
      <div class="legend-item"><div class="legend-dot" style="background:#3B82F6;"></div> New Component</div>
      <div class="legend-item"><div class="legend-dot" style="background:#22C55E;"></div> Secure Path</div>
      <div class="legend-item"><div class="legend-dot" style="background:#EF4444;"></div> Blocked / Rejected</div>
      <div class="legend-item"><div class="legend-dot" style="background:#F59E0B;"></div> Verification Step</div>
    </div>
  </div>

  <!-- RIGHT PANEL — Server Side -->
  <div class="panel">
    <div class="panel-title server">Server Side</div>

    <div class="phase-label">Security Headers</div>
    <ul class="header-list">
      <li>Content-Security-Policy</li>
      <li>X-Frame-Options: DENY</li>
      <li>X-Content-Type-Options: nosniff</li>
      <li>Referrer-Policy: strict-origin</li>
      <li>Permissions-Policy</li>
      <li>Strict-Transport-Security</li>
    </ul>

    <div class="phase-label" style="margin-top: 12px;">Deleted Endpoints</div>
    <div class="flow-item danger">
      <strong>/api/debug-env</strong>
      <span class="label-badge badge-removed">DELETED</span>
      <div class="desc">Leaked SSH key + env vars</div>
    </div>
    <div class="flow-item danger">
      <strong>/api/seed-test</strong>
      <span class="label-badge badge-removed">DELETED</span>
      <div class="desc">Unauthenticated data creation</div>
    </div>
    <div class="flow-item danger">
      <strong>/api/auth/seed</strong>
      <span class="label-badge badge-removed">DELETED</span>
      <div class="desc">Hardcoded admin password</div>
    </div>
    <div class="flow-item danger">
      <strong>/api/download</strong>
      <span class="label-badge badge-removed">DELETED</span>
      <div class="desc">Source code exfiltration</div>
    </div>

    <div class="phase-label" style="margin-top: 12px;">Protected Routes</div>
    <div class="flow-item">
      <strong>26 GET routes</strong>
      <span class="label-badge badge-updated">FIXED</span>
      <div class="desc">Added requireAuth() checks</div>
    </div>
    <div class="flow-item">
      <strong>Rules execution</strong>
      <span class="label-badge badge-updated">FIXED</span>
      <div class="desc">Admin-only enforcement</div>
    </div>
    <div class="flow-item">
      <strong>Firebase sync</strong>
      <span class="label-badge badge-updated">FIXED</span>
      <div class="desc">Auth required</div>
    </div>
  </div>
</div>

</body>
</html>
"""

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1400, "height": 960})
        await page.set_content(html_content, wait_until="networkidle")
        await page.screenshot(path=output_path, full_page=True)
        await browser.close()
        print(f"Architecture diagram saved to: {output_path}")

asyncio.run(main())
