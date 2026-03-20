# Implementation Plan

## Phase 0: Validation Spike (Do first — ~1 session)

### 0.1 Project Setup
- [ ] `npm init` + TypeScript + Playwright dependency
- [ ] tsconfig.json (strict mode, ESM)
- [ ] Create `spike/ax-tree-quality.ts`

### 0.2 Spike Script
- [ ] Connect to Chrome via CDP (`chromium.connectOverCDP('http://localhost:9222')`)
- [ ] Navigate to ServiceNow PDI form page (e.g., incident form)
- [ ] Extract full AX tree via `cdpSession.send('Accessibility.getFullAXTree')`
- [ ] Count total nodes, interactive nodes (button/textbox/link/combobox), named vs unnamed
- [ ] Resolve 3-5 `backendDOMNodeId` values to DOM elements via `DOM.resolveNode`
- [ ] Execute a click on a resolved element to verify the chain works
- [ ] Repeat for: list view page, Flow Designer page
- [ ] Write findings to `spike/RESULTS.md`

### 0.3 Go/No-Go
- If >70% of interactive elements have useful role+name → proceed to Phase 1
- If 30-70% → proceed but plan supplementary DOM injection for gaps
- If <30% → pivot to DOM injection as primary approach

---

## Phase 1: MVP (~2-3 sessions)

### 1.1 Types & Error Model
- [ ] `src/types.ts` — SemanticModel, SemanticNode, ToolResponse, error codes
- [ ] All types from DESIGN.md schema section

### 1.2 Browser Connection
- [ ] `src/browser/connection.ts` — connect to Chrome via CDP endpoint
- [ ] Accept endpoint URL as env var or MCP config (`SWE_CDP_ENDPOINT`)
- [ ] Return `{ browser, page, cdpSession }` tuple
- [ ] Handle connection failure gracefully

### 1.3 Session Monitoring
- [ ] `src/browser/session.ts` — detect session expiry
- [ ] Monitor for login page patterns (URL contains `/login`, AX tree has "Log in" heading)
- [ ] Detect page crashes (`page.on('crash')`)
- [ ] Expose `getPageStatus()`: idle | loading | dialog_open | session_expired | crashed

### 1.4 AX Tree Extraction
- [ ] `src/engine/ax-tree.ts` — extract AX tree via CDP
- [ ] `cdpSession.send('Accessibility.getFullAXTree')` → parse response
- [ ] Map CDP AX nodes to our `SemanticNode` type
- [ ] Preserve `backendDOMNodeId` as `nodeId` on each node
- [ ] Handle frames (if ServiceNow uses iframes)

### 1.5 Model Builder
- [ ] `src/engine/model-builder.ts` — build SemanticModel from raw AX tree
- [ ] Extract page context (url, title) from page object
- [ ] Attach nodeCount to response
- [ ] Attach extractedAt timestamp

### 1.6 Tree Pruning
- [ ] `src/engine/pruner.ts`
- [ ] Scoped extraction: find subtree matching `{ role, name }` scope parameter
- [ ] Collapse decorative nodes (role "generic"/"none" with single child)
- [ ] Depth limit (default 15, configurable)
- [ ] Node count warning (>200 nodes → include `warning` in response)

### 1.7 Action Targeting
- [ ] `src/actions/targeting.ts`
- [ ] Primary: `DOM.resolveNode({ backendNodeId })` → RemoteObjectId → action
- [ ] Fallback: construct `page.getByRole(role, { name })` locator
- [ ] Cache resolved elements for reuse within same extraction cycle
- [ ] Detect stale nodeIds and trigger re-extraction

### 1.8 Action Executor
- [ ] `src/actions/executor.ts`
- [ ] Supported actions: `click`, `type`, `select`, `clear`, `press_key`
- [ ] Action queue mutex (one action at a time)
- [ ] Return error if action already in progress

### 1.9 DOM Settle Detection
- [ ] `src/actions/wait.ts`
- [ ] Inject MutationObserver, wait for 150ms of no mutations
- [ ] Configurable timeout (default 5s)
- [ ] Return settled state or timeout error

### 1.10 MCP Server
- [ ] `src/mcp/tools.ts` — tool definitions for page_extract, page_action, page_navigate, page_status
- [ ] `src/mcp/server.ts` — register tools, wire to engine
- [ ] `src/index.ts` — entry point, parse config, start server

### 1.11 Integration Test
- [ ] `tests/integration/servicenow-form.test.ts`
- [ ] Connect to ServiceNow PDI (requires Chrome running with remote debugging)
- [ ] Extract AX tree from incident form
- [ ] Verify nodeCount, key fields present (Short description, Category, etc.)
- [ ] Fill in a field, verify value changed
- [ ] Extract again, verify updated value in model

---

## Phase 1.5: ServiceNow Handler (only if Phase 1 reveals gaps)

### 1.5.1 Detection
- [ ] `src/handlers/servicenow/index.ts` — detect ServiceNow by URL pattern
- [ ] Detect UI context: Workspace (Polaris) vs Classic (UI16) vs Flow Designer

### 1.5.2 Form Enrichment
- [ ] Identify reference fields, choice lists, journal fields
- [ ] Add field types to SemanticNode.meta

### 1.5.3 List View Enrichment
- [ ] Identify columns, sort state, filter bar
- [ ] Add list metadata to model

---

## Phase 2: Flow Designer (future)
See DESIGN.md Phase 2 section.

## Phase 3: Generalization (future)
See DESIGN.md Phase 3 section.
