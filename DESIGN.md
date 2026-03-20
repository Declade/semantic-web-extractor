# Semantic Web Extractor — Design Specification

## Problem

AI agents operating on complex enterprise web apps (ServiceNow, Salesforce, SAP) via browser automation are fundamentally bottlenecked by the screenshot→vision→click loop:

- **Latency**: Each action requires screenshot capture (~200ms) + vision model inference (~1-3s) + coordinate mapping + click + wait for DOM settle. A 10-step workflow takes 15-30 seconds.
- **Accuracy**: Vision models guess click coordinates on pixel grids. Nested UIs, overlapping elements, and dynamic panels cause frequent mis-clicks and retries.
- **Depth**: Enterprise UIs have deep navigation paths (click→panel opens→sub-panel→drag-drop). Each step compounds latency and error probability.
- **Cost**: Vision model calls for every interaction are expensive at scale.

**Target**: 10-100x faster per-action execution with >95% first-attempt accuracy.

---

## Core Insight

The browser already maintains a **semantic model** of every page — the accessibility tree. It contains element roles, labels, states, relationships, and available actions. This is what screen readers use. It:

- Automatically **flattens Shadow DOM** (critical for ServiceNow's deeply nested web components)
- Provides **semantic labels** (button "Save", textbox "Description", tree item "Flow Logic")
- Excludes **invisible/decorative elements** (no noise)
- Is **token-efficient** (~2-5KB YAML vs ~500KB screenshot)

Instead of "look at pixels and guess where to click", AI receives structured data and issues precise actions.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    AI Agent (LLM)                     │
│  Receives: Semantic Action Model (JSON/YAML)          │
│  Returns:  Action intent (click, type, drag, select)  │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│              Semantic Extraction Engine               │
│                                                       │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │  Tier 1:    │  │  Tier 2:     │  │  Tier 3:    │ │
│  │  AX Tree    │  │  DOM+Layout  │  │  Vision     │ │
│  │  (Primary)  │  │  (Secondary) │  │  (Fallback) │ │
│  └──────┬──────┘  └──────┬───────┘  └──────┬──────┘ │
│         │                │                  │         │
│  ┌──────▼────────────────▼──────────────────▼──────┐ │
│  │           Semantic Model Builder                 │ │
│  │  Merges AX tree + layout + app-specific logic    │ │
│  └──────────────────────┬──────────────────────────┘ │
│                         │                             │
│  ┌──────────────────────▼──────────────────────────┐ │
│  │           App Handler Registry                   │ │
│  │  ServiceNow | Salesforce | Generic (pluggable)   │ │
│  └─────────────────────────────────────────────────┘ │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│              Action Execution Layer                   │
│  Playwright CDP session (shared, persistent)          │
│  - Direct selector-based actions (no coordinate guess)│
│  - Shadow DOM piercing via Playwright >>> operator     │
│  - Drag-drop via CDP Input.dispatchDragEvent           │
└─────────────────────────────────────────────────────┘
```

---

## Extraction Tiers

### Tier 1: Accessibility Tree (Primary — used for ~80% of interactions)

**Source**: CDP `Accessibility.getFullAXTree` via Playwright's `page.context().newCDPSession(page)`.

> **Note**: Playwright's `page.accessibility.snapshot()` is deprecated as of v1.50. We use CDP directly, which also gives us `backendDOMNodeId` for each AX node — solving the element targeting problem (see Action Targeting below).

**What it provides**:
- Element roles (button, textbox, link, tree, treeitem, dialog, menu, menuitem, etc.)
- Labels (aria-label, aria-labelledby, visible text)
- States (disabled, expanded, checked, selected, required)
- Value (current input value, selected option)
- Parent/child relationships (hierarchy)
- `backendDOMNodeId` — unique DOM node reference for action targeting

**Output format** (compact JSON):
```json
{
  "role": "dialog",
  "name": "Create New Flow",
  "children": [
    { "role": "textbox", "name": "Flow Name", "value": "", "required": true, "nodeId": 142 },
    { "role": "combobox", "name": "Application", "value": "Global", "expanded": false, "nodeId": 156 },
    { "role": "button", "name": "Cancel", "nodeId": 170 },
    { "role": "button", "name": "Create", "disabled": true, "nodeId": 174 }
  ]
}
```

**Why this works for ServiceNow**: ServiceNow's `now-*` web components use Shadow DOM extensively, but the browser's accessibility tree **automatically flattens** all shadow boundaries. The AI never needs to know about shadow roots.

**Limitations**: No visual positioning. No information about canvas-rendered elements. Some custom widgets may lack proper ARIA markup.

### Action Targeting (AX Node → DOM Element)

The AX tree does not contain CSS selectors. We use a two-strategy approach:

1. **Primary: CDP `backendDOMNodeId`** — Each AX node from `getFullAXTree` includes a `backendDOMNodeId`. To act on it:
   - `DOM.resolveNode({ backendNodeId })` → returns a `Runtime.RemoteObjectId`
   - `Runtime.callFunctionOn({ objectId, functionDeclaration: 'function() { this.click() }' })` for direct execution
   - Or resolve to a Playwright `ElementHandle` via `page.evaluateHandle()` for Playwright-native actions

2. **Fallback: Playwright role-based locators** — Construct `page.getByRole(role, { name })` chains from the AX node's role and name. This is the same approach used by Playwright's own MCP server. Works well when role+name combinations are unique on the page.

The AI never sees selectors. Internally, the engine maps each `SemanticNode` to an action target via its `nodeId` (backendDOMNodeId). If the nodeId is stale (element was removed/recreated), we fall back to role-based locator matching.

### Tier 2: DOM Snapshot + Layout (Secondary — used for spatial context)

**Source**: `DOMSnapshot.captureSnapshot` via CDP, or injected JS for targeted extraction.

**When needed**:
- Determining element positions for drag-drop operations
- Understanding visual grouping (what's in a panel vs. sidebar)
- Detecting elements that lack accessibility markup
- Providing bounding boxes for Tier 3 fallback

**What it adds on top of Tier 1**:
- Bounding rectangles (x, y, width, height) for every element
- Computed styles (visibility, display, opacity, z-index)
- Scroll positions and overflow state

**Output**: Merged into the Tier 1 model as optional `bounds` and `style` properties:
```json
{
  "role": "button",
  "name": "Create",
  "disabled": true,
  "bounds": { "x": 450, "y": 320, "width": 80, "height": 36 },
  "visible": true
}
```

### Tier 3: Targeted Vision (Fallback — used for ~5% of interactions)

**Source**: Playwright `page.screenshot({ clip: { ... } })` — screenshot of a specific region only, not the full page.

**When needed**:
- Flow Designer canvas (SVG/canvas-rendered nodes and connections)
- Drag-drop positioning that requires spatial precision
- Elements with no DOM representation (canvas-drawn graphics)
- Verification of ambiguous states ("is this visually highlighted?")

**Key optimization**: Only capture the relevant region (e.g., 400x300px of the canvas area), not the full viewport. This reduces screenshot size from ~500KB to ~30KB and vision model tokens proportionally.

---

## App Handler System

App handlers provide application-specific intelligence layered on top of the generic extraction engine. They are the key to handling enterprise-app-specific patterns.

### Handler Interface

```typescript
interface AppHandler {
  /** Unique identifier */
  id: string;

  /** Detect if this handler applies to the current page */
  detect(url: string, axTree: SemanticNode): boolean;

  /** Enrich the generic semantic model with app-specific knowledge */
  enrich(model: SemanticModel, page: Page): Promise<SemanticModel>;

  /** Translate high-level intents into action sequences */
  resolveAction(intent: ActionIntent, model: SemanticModel): ActionStep[];

  /** App-specific interaction patterns (drag-drop, custom widgets) */
  customActions: Record<string, CustomActionHandler>;
}
```

### ServiceNow Handler (First Implementation)

```typescript
const servicenowHandler: AppHandler = {
  id: "servicenow",
  detect: (url) => url.includes(".service-now.com"),

  enrich: async (model, page) => {
    // 1. Detect which ServiceNow UI context we're in
    //    (Workspace, Flow Designer, Classic UI, Service Portal)
    // 2. Add ServiceNow-specific semantics:
    //    - Form field types (reference, journal, choice list)
    //    - List view column definitions
    //    - Flow Designer node types and connections
    //    - Data pill availability and types
    // 3. Add navigation context:
    //    - Current application scope
    //    - Current module/table
    //    - Breadcrumb path
    return enrichedModel;
  },

  customActions: {
    // Flow Designer: drag action from toolbox to canvas
    "flow.addAction": async (params, model, page) => { ... },

    // Flow Designer: connect data pill to input field
    "flow.connectDataPill": async (params, model, page) => { ... },

    // Flow Designer: configure action properties
    "flow.configureAction": async (params, model, page) => { ... },

    // List view: filter, sort, group
    "list.filter": async (params, model, page) => { ... },

    // Form: set reference field (lookup + select)
    "form.setReference": async (params, model, page) => { ... },
  }
};
```

### Flow Designer Specific Challenges

The Flow Designer canvas is the hardest part of ServiceNow to automate. Here's how each component maps to extraction tiers:

| Component | Extraction Tier | Approach |
|-----------|----------------|----------|
| **Toolbox panel** (action list) | Tier 1 (AX tree) | Standard tree/list structure with labels |
| **Canvas nodes** (workflow steps) | Tier 2+3 (DOM+Vision) | SVG/canvas elements — extract positions via DOM, verify via screenshot |
| **Node connections** (arrows) | Tier 3 (Vision) | Canvas-rendered lines — vision needed for topology |
| **Data pills** (drag sources) | Tier 1+2 (AX+DOM) | Have ARIA labels but need position for drag |
| **Input fields** (in property panels) | Tier 1 (AX tree) | Standard form controls |
| **Drag-drop operations** | Tier 2 (DOM layout) | Need source/target bounding boxes, execute via CDP drag events |

### Handling Drag-Drop Without Vision

For data pills and flow actions, we can often avoid vision entirely:

1. Extract source element position from Tier 2 (DOMSnapshot bounds)
2. Extract target element position from Tier 2
3. Execute drag via CDP mouse events:
   ```
   Input.dispatchMouseEvent(type: 'mousePressed', x: sourceX, y: sourceY, button: 'left')
   Input.dispatchMouseEvent(type: 'mouseMoved',   x: targetX, y: targetY, button: 'left')
   Input.dispatchMouseEvent(type: 'mouseReleased', x: targetX, y: targetY, button: 'left')
   ```
   Or, if the app uses HTML5 Drag API:
   ```
   Input.dispatchDragEvent(type: 'dragEnter', x: targetX, y: targetY)
   Input.dispatchDragEvent(type: 'dragOver',  x: targetX, y: targetY)
   Input.dispatchDragEvent(type: 'drop',      x: targetX, y: targetY)
   ```
   > **Note**: Which mechanism ServiceNow Flow Designer uses (HTML5 drag or mouse-event-based) needs to be validated in Phase 2 before implementing.
4. Re-extract AX tree to verify the connection was made

---

## Delta Updates (Incremental Extraction)

Full AX tree extraction on every action is wasteful. After the initial extraction, we use delta updates:

### Approach: MutationObserver + CDP Events

1. **Before first action**: Full AX tree extraction (Tier 1). Cache the model.
2. **Inject MutationObserver**: Watch for DOM changes in the relevant subtree.
3. **After each action**:
   - Wait for DOM to settle (MutationObserver reports no changes for 100ms)
   - Re-extract only the changed subtree via `Accessibility.getPartialAXTree` (scoped to changed node)
   - Merge delta into cached model
4. **Periodic full refresh**: Every N actions or on navigation, do a full re-extraction to prevent drift.

### Performance Target

| Operation | Screenshot Loop | Semantic Extraction |
|-----------|----------------|---------------------|
| Initial page load | 2-3s (screenshot + vision) | 200-500ms (AX tree) |
| Per action (simple click) | 3-5s (screenshot + vision + click) | 50-200ms (action + delta) |
| Per action (drag-drop) | 5-10s (multiple screenshots) | 300-800ms (bounds + CDP drag + delta) |
| 10-step workflow | 30-50s | 2-5s |

---

## Semantic Model Schema

The unified model that AI receives:

```typescript
interface SemanticModel {
  /** Page-level context */
  page: {
    url: string;
    title: string;
    app?: string;           // e.g., "servicenow"
    context?: string;       // e.g., "flow-designer", "list-view", "form"
    breadcrumb?: string[];  // navigation path
  };

  /** Root of the semantic tree */
  root: SemanticNode;

  /** Available high-level actions (from app handler) */
  actions?: AvailableAction[];

  /** Timestamp for staleness detection */
  extractedAt: number;
}

interface SemanticNode {
  /** Accessibility role */
  role: string;

  /** Human-readable label */
  name: string;

  /** Current value (for inputs, selects, etc.) */
  value?: string;

  /** Interaction states */
  states?: {
    disabled?: boolean;
    expanded?: boolean;
    checked?: boolean;
    selected?: boolean;
    required?: boolean;
    readonly?: boolean;
    busy?: boolean;
  };

  /** Backend DOM node ID for action targeting (from CDP) */
  nodeId?: number;

  /** Visual bounds (Tier 2, optional) */
  bounds?: { x: number; y: number; width: number; height: number };

  /** Child elements */
  children?: SemanticNode[];

  /** App-specific metadata (from handler enrichment) */
  meta?: Record<string, unknown>;
}

interface AvailableAction {
  /** Action identifier */
  id: string;

  /** Human-readable description for the LLM */
  description: string;

  /** Required parameters */
  params: { name: string; type: string; description: string; required: boolean }[];
}
```

---

## MCP Integration

The extraction engine exposes itself as an **MCP server** with these tools:

### Core Tools

| Tool | Description |
|------|-------------|
| `page_extract` | Extract full semantic model of current page |
| `page_action` | Execute an action on the page (click, type, select, drag) |
| `page_navigate` | Navigate to a URL or named destination |
| `page_wait` | Wait for a specific condition (element appears, text changes) |
| `page_status` | Returns page state: idle, loading, has dialog/modal, node count |

### App-Specific Tools (registered by handlers)

| Tool | Description |
|------|-------------|
| `servicenow_flow_add_action` | Add an action to a Flow Designer flow |
| `servicenow_flow_connect_pill` | Connect a data pill to an input |
| `servicenow_flow_configure` | Configure a flow action's properties |
| `servicenow_list_filter` | Apply filters to a list view |
| `servicenow_form_fill` | Fill a form with provided values |

### Example MCP Interaction

**AI sends**:
```json
{ "tool": "page_extract" }
```

**Engine returns**:
```json
{
  "page": { "url": "https://dev12345.service-now.com/now/nav/ui/classic/params/target/x_flow_designer...", "title": "Flow Designer", "app": "servicenow", "context": "flow-designer" },
  "root": {
    "role": "main",
    "name": "Flow Designer",
    "children": [
      {
        "role": "tree", "name": "Flow Outline",
        "children": [
          { "role": "treeitem", "name": "Trigger: Record Created", "states": { "selected": true } },
          { "role": "treeitem", "name": "Action 1: Look Up Record" },
          { "role": "treeitem", "name": "Action 2: Send Email" }
        ]
      },
      {
        "role": "region", "name": "Action Properties",
        "children": [
          { "role": "textbox", "name": "Table", "value": "incident", "nodeId": 342 },
          { "role": "combobox", "name": "Condition", "value": "Active is true", "nodeId": 358 }
        ]
      }
    ]
  },
  "actions": [
    { "id": "servicenow_flow_add_action", "description": "Add a new action step to the flow", "params": [{ "name": "action_type", "type": "string", "description": "Type of action (e.g., 'Look Up Record', 'Update Record')", "required": true }] },
    { "id": "servicenow_flow_connect_pill", "description": "Connect a data pill from a previous step to an input field", "params": [{ "name": "source_step", "type": "string", "description": "Step containing the data pill", "required": true }, { "name": "source_field", "type": "string", "description": "Field name on the source step", "required": true }, { "name": "target_field", "type": "string", "description": "Input field to connect the pill to", "required": true }] }
  ]
}
```

**AI decides**:
```json
{ "tool": "servicenow_flow_add_action", "params": { "action_type": "Create Record" } }
```

**Engine executes**: Clicks "Add Action" in toolbox → searches "Create Record" → clicks result → waits for DOM settle → returns updated semantic model.

---

## Browser & Session Management

### Browser Lifecycle

The MCP server supports two modes:

1. **Connect mode (recommended for Phase 1)**: Connect to an existing Chrome/Chromium session via `browserType.connectOverCDP(endpointUrl)`. The user launches Chrome with `--remote-debugging-port=9222`, logs into ServiceNow manually, then the MCP server connects to the authenticated session.
   - Advantages: No auth automation needed. User can watch/intervene. Works with SSO/MFA.
   - The MCP server receives a pre-authenticated browser context.

2. **Launch mode (Phase 2+)**: The MCP server launches its own browser via Playwright, handles login, and manages the lifecycle.
   - Uses Playwright's `storageState` to persist cookies/localStorage between sessions (avoids re-login).
   - Detects session expiry by monitoring for login page URL patterns or AX tree patterns (e.g., a "Log in" heading appearing).

### Session Monitoring

- **Expiry detection**: The ServiceNow handler checks the URL and AX tree after each action. If a login page is detected, the engine pauses and notifies the AI agent that re-authentication is needed.
- **Crash recovery**: If `page.evaluate()` throws a "Target closed" error, the engine attempts to reconnect once. If that fails, it returns an error to the agent.

### Action Queue

Actions are serialized: one action at a time. If the AI sends an action while another is in flight, the engine returns an error:
```json
{ "error": "action_in_progress", "message": "Another action is currently executing. Wait for it to complete." }
```

The engine waits for DOM settle (no mutations for 150ms) after each action before accepting the next.

---

## Scoped Extraction & Tree Pruning

Complex enterprise pages can produce AX trees with 500+ nodes. To keep token costs manageable:

### Scoped Extraction

The `page_extract` tool accepts an optional `scope` parameter:
```json
{ "tool": "page_extract", "params": { "scope": { "role": "dialog", "name": "Create New Flow" } } }
```

When `scope` is provided, extraction starts from the first AX node matching that role+name, returning only that subtree. This is critical for pages with multiple panels, sidebars, and overlays.

### Automatic Pruning

The model builder applies these filters before returning the model:
- **Remove off-screen nodes**: Elements with bounds entirely outside the viewport (if Tier 2 data available)
- **Collapse decorative nodes**: Nodes with role "generic" or "none" that have a single child are flattened
- **Truncate deep trees**: Nodes beyond depth 15 are summarized as `{ "role": "group", "name": "... (N children)" }`
- **Node count warning**: If the tree exceeds 200 nodes, the response includes a `warning: "large_tree"` flag suggesting the agent use scoped extraction

### Element Count in Response

Every extraction response includes `nodeCount` at the top level so the agent can decide whether to scope subsequent requests.

---

## Error Model

All MCP tool responses follow a consistent structure:

```typescript
interface ToolResponse {
  success: boolean;
  data?: SemanticModel | ActionResult;
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
  };
}
```

Error codes:
| Code | Description | Recoverable |
|------|-------------|-------------|
| `action_in_progress` | Another action is executing | Yes (wait and retry) |
| `element_not_found` | Target element no longer exists | Yes (re-extract) |
| `session_expired` | ServiceNow session expired | Yes (re-authenticate) |
| `page_crashed` | Browser tab crashed | No (restart required) |
| `extraction_timeout` | AX tree extraction took >5s | Yes (retry or scope) |
| `action_timeout` | Action did not complete within timeout | Yes (retry) |

---

## Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Runtime | Node.js / TypeScript | Match existing MCP ecosystem |
| Browser control | Playwright | Best shadow DOM support, CDP access, ARIA snapshots |
| CDP access | Playwright's CDP session | Direct protocol access for AX tree, DOM snapshots |
| MCP server | `@modelcontextprotocol/sdk` | Standard MCP server implementation |
| App handlers | Simple map lookup (Phase 1), plugin system (Phase 3) | Start simple, add complexity when needed |
| Testing | Vitest + Playwright Test | Fast unit tests + real browser integration tests |

---

## Project Structure

```
semantic-web-extractor/
├── src/
│   ├── index.ts                 # MCP server entry point
│   ├── engine/
│   │   ├── extractor.ts         # Core extraction orchestrator
│   │   ├── ax-tree.ts           # AX tree extraction via CDP (Tier 1)
│   │   ├── model-builder.ts     # Build SemanticModel from AX tree
│   │   ├── pruner.ts            # Tree pruning and scoping
│   │   └── dom-snapshot.ts      # DOM snapshot + layout (Phase 2)
│   ├── actions/
│   │   ├── executor.ts          # Action execution (click, type, select)
│   │   ├── targeting.ts         # AX nodeId → DOM element resolution
│   │   └── wait.ts              # DOM settle detection
│   ├── browser/
│   │   ├── connection.ts        # Browser connect/launch management
│   │   └── session.ts           # Session monitoring, expiry detection
│   ├── handlers/
│   │   ├── generic.ts           # Generic handler (works for any site)
│   │   └── servicenow/          # Added in Phase 1.5 when gaps are identified
│   │       └── index.ts
│   ├── mcp/
│   │   ├── server.ts            # MCP tool registration
│   │   └── tools.ts             # Tool definitions
│   └── types.ts                 # Shared type definitions (incl. error model)
├── tests/
│   ├── unit/                    # Unit tests (mocked CDP)
│   └── integration/             # Real browser tests against ServiceNow PDI
├── spike/
│   └── ax-tree-quality.ts       # Phase 0 spike: validate AX tree on ServiceNow
├── package.json
├── tsconfig.json
└── DESIGN.md
```

---

## Differentiation from Existing Tools

| | Stagehand | Browser Use | Skyvern | **Semantic Web Extractor** |
|--|-----------|------------|---------|---------------------------|
| Primary signal | DOM semantic tree | Vision + DOM | Vision + CDP | **AX tree + app handlers** |
| Enterprise-specific | No | No | Partial | **Yes (pluggable handlers)** |
| Shadow DOM | Generic | Generic | Generic | **App-aware flattening** |
| Drag-drop | Coordinate-based | Vision-guided | Vision-guided | **CDP drag events (precise)** |
| App intelligence | None | None | None | **Pre-mapped action models** |
| Delta updates | No (full re-extract) | No | No | **Yes (MutationObserver)** |
| Token cost per action | Medium | High (vision) | High (vision) | **Low (structured data)** |

**The moat**: App-specific handlers that turn raw semantic trees into **domain-aware action models**. Generic tools treat ServiceNow Flow Designer like any other website. We understand its toolbox, data pills, and canvas — and expose them as first-class actions.

---

## Phase 0: Validation Spike (MUST DO FIRST)

Before writing any production code, run a spike to validate the core assumption:

1. Open a ServiceNow PDI in Playwright (connect to existing Chrome session)
2. Extract the AX tree via CDP `Accessibility.getFullAXTree`
3. Navigate to: a form page, a list view, and Flow Designer
4. For each page, evaluate:
   - How many AX nodes are returned?
   - Do interactive elements (buttons, inputs, links) have meaningful names?
   - Are `now-*` web component internals exposed through the flattened AX tree?
   - Can we resolve `backendDOMNodeId` to a clickable DOM element?
5. Document findings in `spike/RESULTS.md`

**Go/no-go decision**: If the AX tree is too sparse for ServiceNow forms (< 50% of interactive elements have useful role+name), pivot to DOM injection approach instead.

## Phase 1 Scope (MVP)

1. **Browser connection** (connect to existing Chrome via CDP endpoint)
2. **Core extraction engine** (Tier 1 only — AX tree via CDP)
3. **Action targeting** (backendDOMNodeId → DOM element → click/type/select)
4. **Tree pruning & scoped extraction**
5. **Action queue** (serialize actions, wait for DOM settle)
6. **Generic handler** (works on any website — no app-specific logic yet)
7. **Error model** (consistent error responses)
8. **MCP server** with `page_extract`, `page_action`, `page_navigate`, `page_status` tools
9. **Integration test** against a ServiceNow PDI (form + list view)

**Not in Phase 1**: ServiceNow handler, Flow Designer, drag-drop, delta updates, Tier 2/3 extraction, vision fallback, browser launch mode.

**Phase 1 exit criteria**: AI agent (Claude via MCP) can extract a ServiceNow form page, read all field values, fill in fields, and submit — using only the generic handler.

## Phase 1.5: ServiceNow Handler

Added only after Phase 1 reveals specific gaps that generic extraction cannot cover:

1. **ServiceNow detection** (URL-based)
2. **UI context detection** (Workspace vs. Classic vs. Flow Designer)
3. **Form enrichment** (reference fields, choice lists, journal fields)
4. **List view enrichment** (column definitions, filter controls)

## Phase 2: Flow Designer

1. **Tier 2 extraction** (DOM snapshot + layout for bounding boxes)
2. **Drag-drop research spike** (determine if SN uses HTML5 drag API or mouse events)
3. **Drag-drop via CDP** (based on spike findings)
4. **Flow Designer handler** (add action, connect pill, configure)
5. **Delta updates** (benchmark full re-extraction first; only add MutationObserver if >200ms)
6. **Browser launch mode** with `storageState` session persistence

## Phase 3: Generalization

1. **Vision fallback** (Tier 3 — targeted screenshots)
2. **Handler plugin system** (dynamic loading)
3. **Salesforce handler** (first third-party app)
4. **App model caching** (persist extracted models for faster cold starts)
5. **Documentation and developer guide for writing handlers**
