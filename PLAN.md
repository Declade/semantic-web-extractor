# Implementation Plan

## Phase 0: Validation Spike — COMPLETED (2026-03-20)

- [x] Project setup (TypeScript, Playwright, MCP SDK)
- [x] Spike scripts testing AX tree on ServiceNow PDI
- [x] Tested: Home, Workspace, Workflow Studio, Flow Editor, Classic UI forms/lists
- [x] **Result: GO** — 100% naming ratio, all nodeIds resolve, 2-97ms extraction
- [x] Discovered two-path extraction needed (CDP + ariaSnapshot for iframes)
- [x] Findings documented in `spike/RESULTS.md`

---

## Phase 1: MVP (~2-3 sessions)

### 1.1 Types & Error Model
- [x] `src/types.ts` — SemanticModel, SemanticNode, ToolResponse, error codes (done in setup)
- [ ] Update types to include `frameIndex` on SemanticNode
- [ ] Add `LocatorDescriptor` type for Path B targeting

### 1.2 Browser Management
- [ ] `src/browser/connection.ts` — launch Playwright Chromium (headed mode)
- [ ] Auto-login to ServiceNow (username/password from env vars)
- [ ] Return `{ browser, context, page }` tuple
- [ ] Handle connection/launch failure gracefully

### 1.3 Session Monitoring
- [ ] `src/browser/session.ts` — detect session expiry
- [ ] Monitor for login page patterns (URL contains `/login`)
- [ ] Detect page crashes (`page.on('crash')`)
- [ ] Expose `getPageStatus()`: idle | loading | dialog_open | session_expired | crashed

### 1.4 Two-Path Extraction Engine
- [ ] `src/engine/extractor.ts` — orchestrator that picks the right path
- [ ] Detect iframes on page via `page.frames()`
- [ ] If iframe with content found → use Path B (ariaSnapshot)
- [ ] Otherwise → use Path A (CDP getFullAXTree)

#### Path A: CDP Extraction
- [ ] `src/engine/ax-tree.ts` — extract AX tree via CDP
- [ ] `cdpSession.send('Accessibility.getFullAXTree')` → parse response
- [ ] Map CDP AX nodes to `SemanticNode` type with `nodeId` (backendDOMNodeId)
- [ ] Build parent/child tree from flat node list + childIds

#### Path B: ariaSnapshot Extraction
- [ ] `src/engine/aria-snapshot.ts` — extract via Playwright ariaSnapshot
- [ ] `frame.locator("body").ariaSnapshot()` → YAML string
- [ ] Parse YAML into `SemanticNode` tree
- [ ] Set `frameIndex` on each node for action targeting
- [ ] Handle multiple frames (pick the one with most content)

### 1.5 Model Builder
- [ ] `src/engine/model-builder.ts` — build SemanticModel from either extraction path
- [ ] Extract page context (url, title) from page/frame
- [ ] Attach nodeCount, extractedAt timestamp
- [ ] Merge top-level + iframe extraction results into unified model

### 1.6 Tree Pruning
- [ ] `src/engine/pruner.ts`
- [ ] Scoped extraction: find subtree matching `{ role, name }` scope parameter
- [ ] Collapse decorative nodes (role "generic"/"none" with single child)
- [ ] Depth limit (default 15, configurable)
- [ ] Node count warning (>200 nodes → `warning` in response)

### 1.7 Two-Path Action Targeting
- [ ] `src/actions/targeting.ts`
- [ ] Path A: `DOM.resolveNode({ backendNodeId })` → RemoteObjectId → execute via CDP
- [ ] Path B: construct `frame.getByRole(role, { name })` locator → Playwright actions
- [ ] `{ force: true }` option for shadow DOM click interception
- [ ] Detect stale nodeIds → fall back to role-based locator → if fail, re-extract

### 1.8 Action Executor
- [ ] `src/actions/executor.ts`
- [ ] Supported actions: `click`, `type`, `select`, `clear`, `press_key`
- [ ] Action queue mutex (one action at a time)
- [ ] Return error if action already in progress
- [ ] Auto re-extract after action completes (return fresh model)

### 1.9 DOM Settle Detection
- [ ] `src/actions/wait.ts`
- [ ] Inject MutationObserver, wait for 150ms of no mutations
- [ ] Configurable timeout (default 5s)
- [ ] Return settled state or timeout error

### 1.10 MCP Server
- [ ] `src/mcp/tools.ts` — tool definitions:
  - `page_extract` — extract semantic model (with optional scope param)
  - `page_action` — click/type/select on a target element
  - `page_navigate` — go to a URL
  - `page_status` — return page state, node count, current URL
- [ ] `src/mcp/server.ts` — register tools, wire to engine
- [ ] `src/index.ts` — entry point, parse config, start server

### 1.11 Integration Tests
- [ ] `tests/integration/workspace.test.ts`
  - Launch browser, login to ServiceNow PDI
  - Extract SOW Home — verify tabs, buttons, widgets present
  - Navigate to Workflow Studio — verify flow list extracted
- [ ] `tests/integration/flow-editor.test.ts`
  - Open a flow in Workflow Studio
  - Extract flow editor (iframe) — verify trigger, actions, data pills present
  - Click a button (e.g., expand action) — verify model updates
- [ ] `tests/integration/classic-ui.test.ts`
  - Navigate to incident form (direct URL)
  - Extract — verify form fields present
  - Fill a field, verify value in re-extracted model

---

## Phase 1.5: ServiceNow Handler (only if Phase 1 reveals gaps)

### 1.5.1 Detection
- [ ] `src/handlers/servicenow/index.ts` — detect ServiceNow by URL pattern
- [ ] Detect UI context: Workspace vs Classic vs Workflow Studio

### 1.5.2 Form Enrichment
- [ ] Identify reference fields, choice lists, journal fields
- [ ] Add field types to SemanticNode.meta

### 1.5.3 List View Enrichment
- [ ] Identify columns, sort state, filter bar
- [ ] Add list metadata to model

---

## Phase 2: Flow Designer Deep Integration (future)

- [ ] Tier 2 extraction (DOM snapshot for bounding boxes)
- [ ] Drag-drop research spike (HTML5 drag API vs mouse events in Workflow Studio)
- [ ] Drag-drop via CDP mouse events
- [ ] Data pill connection (drag pill to input field)
- [ ] Flow creation workflow (trigger selection, action addition)
- [ ] Delta updates (benchmark full re-extraction first)

## Phase 3: Generalization (future)

- [ ] Vision fallback (Tier 3 — targeted screenshots)
- [ ] Handler plugin system (dynamic loading)
- [ ] Salesforce handler
- [ ] App model caching
- [ ] Developer guide for writing handlers
