---
status: pending
priority: p2
issue_id: SEC-001
tags: [security, electron, code-review, configuration]
dependencies: []
---

# Disable Remote Debugging in Production Builds

## Problem Statement

Remote debugging is permanently enabled on port 9222 for both development and production builds of the Electron app. This exposes the Chrome DevTools Protocol to any process on the user's system, creating a potential security vulnerability.

**Why it matters:**
- Malware on user's system could connect to port 9222
- Full Chrome DevTools Protocol access allows data extraction and code execution
- This debugging port is intended for MCP tools during development, not production use

## Findings

**Location:** `apps/electron/electron/main/index.ts`

**Current Code (Lines 157, 164):**
```typescript
// Duplicate on line 164
app.commandLine.appendSwitch('remote-debugging-port', '9222')
```

**Security Analysis:**
- Remote debugging enabled unconditionally in all builds
- Port 9222 listens on localhost (local attack surface only)
- Intended for Electron MCP tools but broader access granted
- **Risk Level:** MEDIUM (local privilege escalation possible)

**Attack Scenario:**
1. User installs HiDock app from distribution
2. Malware on system detects port 9222 listening
3. Malware connects via Chrome DevTools Protocol
4. Malware extracts sensitive data or executes code in app context

## Proposed Solutions

### Solution 1: Environment Variable Opt-In (Recommended)
**Approach:** Enable remote debugging only in development or with explicit flag

```typescript
// apps/electron/electron/main/index.ts
import { is } from '@electron-toolkit/utils'

// Only enable in development or with explicit opt-in
if (is.dev || process.env.ENABLE_REMOTE_DEBUGGING === 'true') {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
  console.warn('[SECURITY] Remote debugging enabled on port 9222')
}
```

**Pros:**
- Zero security risk in production by default
- Developers automatically get debugging in dev mode
- Users can opt-in if needed for troubleshooting
- Simple implementation (5 lines of code)

**Cons:**
- Users need to know environment variable name
- Support team needs documentation for opt-in process

**Effort:** Small (15 minutes)
**Risk:** Low (well-tested pattern)

### Solution 2: Dynamic Port Allocation
**Approach:** Use random port and write to file for MCP tools to discover

```typescript
import { app } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'

if (is.dev || process.env.ENABLE_REMOTE_DEBUGGING === 'true') {
  const port = Math.floor(Math.random() * 10000) + 10000
  app.commandLine.appendSwitch('remote-debugging-port', port.toString())

  // Write port to file for MCP tools
  const portFile = join(app.getPath('userData'), 'debug-port.txt')
  writeFileSync(portFile, port.toString())

  console.warn(`[SECURITY] Remote debugging enabled on port ${port}`)
}
```

**Pros:**
- Port not predictable by malware
- Still discoverable by legitimate tools
- Better defense-in-depth

**Cons:**
- More complex implementation
- MCP tools need to read port file
- May break existing tool integrations

**Effort:** Medium (2 hours, includes MCP tool testing)
**Risk:** Medium (requires coordination with MCP tooling)

### Solution 3: Authentication Layer
**Approach:** Add authentication to Chrome DevTools Protocol

**Pros:**
- Strongest security
- Could enable remote debugging safely

**Cons:**
- Significant complexity
- CDP doesn't have built-in auth
- Requires proxy layer

**Effort:** Large (1-2 days)
**Risk:** High (complex, error-prone)

## Recommended Action

**Solution 1** is recommended:
- Simplest and most secure
- Follows principle of "secure by default, opt-in for special cases"
- Minimal code change, low risk
- Standard pattern used by many Electron apps

## Technical Details

**Affected Files:**
- `apps/electron/electron/main/index.ts` (lines 157, 164)

**Components:**
- Electron main process initialization
- Chrome DevTools Protocol configuration

**Database Changes:** None

## Acceptance Criteria

- [ ] Remote debugging disabled in production builds by default
- [ ] Remote debugging enabled in development mode (is.dev === true)
- [ ] Environment variable `ENABLE_REMOTE_DEBUGGING=true` enables in production
- [ ] Warning logged when remote debugging is enabled
- [ ] Duplicate line 164 removed (consolidate with line 157)
- [ ] Documentation updated with opt-in instructions for support team
- [ ] Electron app builds and runs correctly in both modes
- [ ] MCP tools still work in development mode

## Work Log

**2026-01-14:** Issue identified during security review of Electron main process configuration. Remote debugging found to be permanently enabled, creating medium-severity security risk.

## Resources

- **Security Advisory:** OWASP A05: Security Misconfiguration
- **Electron Docs:** [Debugging Main Process](https://www.electronjs.org/docs/latest/tutorial/debugging-main-process)
- **Chrome DevTools Protocol:** [Security Considerations](https://chromedevtools.github.io/devtools-protocol/)
- **Similar Pattern:** VS Code's `--inspect` flag implementation
- **Related Issue:** SEC-001 from security audit report
