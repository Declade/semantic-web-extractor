# Phase 0 Spike Results — 2026-03-20

## GO — AX tree is viable for all target page types

## Key Finding: Hybrid Extraction Required

ServiceNow uses two rendering contexts that require different extraction methods:

| Context | Method | Why |
|---------|--------|-----|
| Top-level Polaris/Workspace pages | CDP `Accessibility.getFullAXTree` | Full tree with `backendDOMNodeId` for action targeting |
| Iframe-embedded content (Flow Editor) | Playwright `frame.locator("body").ariaSnapshot()` | Same-origin iframe can't get own CDP session |

## Page-by-Page Results

### Workflow Studio Home (`/$flow-designer.do` → `/now/workflow-studio/home/flow`)
- **Method**: CDP `getFullAXTree`
- **Nodes**: 11,624 total | 9,251 non-ignored | 1,974 interactive
- **Named**: 100% (1,974/1,974)
- **NodeId resolution**: 100%
- **Extraction time**: 97ms
- **Content captured**: Full flow grid (123 flows), column headers with sort/filter, tabs (Homepage, Operations, Integrations), sub-tabs (Playbooks, Flows, Subflows, Actions, Decision tables), Create button, all navigation
- **Estimated JSON size**: Large (~500KB+ for full grid). Needs pruning/pagination.

### Flow Editor (iframe inside Workflow Studio)
- **Method**: Playwright `ariaSnapshot()` on iframe frame
- **Snapshot lines**: 62
- **Content captured**:
  - Flow name (editable textbox)
  - Trigger type ("Servicekatalog")
  - All action steps with labels ("1 - Um Genehmigung bitten")
  - Add action buttons ("Hinzufügen Aktion, Flow-Logik oder Subflow")
  - Data pills as labeled buttons: "Angefordertes Element Record", "Genehmigungsstatus", etc.
  - Flow controls: Test, Edit, Deactivate, More Actions
  - Error handler checkbox
  - Collapsible Flow Variables sections
- **CDP access**: NOT available (same-origin iframe, no separate CDP session)
- **NodeId targeting**: NOT available via CDP. Must use Playwright role-based locators (`frame.getByRole()`)
- **Click interception**: Shadow DOM `<now-card-header>` intercepts clicks on flow cards. Need `{ force: true }` or click inner element.

### Service Operations Workspace (`/now/sow/home`)
- **Method**: CDP `getFullAXTree`
- **Nodes**: 833 total | 42 interactive
- **Named**: 100%
- **Extraction time**: 17ms
- **Content captured**: Full workspace with tabs (Home, Inbox, List, Teams, Schedules, Dashboard), widgets, quick links

### SOW Incident List (`/now/sow/list/incident`)
- **Method**: CDP `getFullAXTree`
- **Nodes**: 1,561 total | 149 interactive
- **Named**: 100%
- **Content captured**: Tree view with categories (Interactions, Requests, Incidents), list items, checkboxes

### Classic UI Forms (`/incident.do?sys_id=-1`)
- **Method**: CDP `getFullAXTree` (direct URL, not via nav_to.do iframe wrapper)
- **Nodes**: 754 total | 98 interactive
- **Named**: 100%
- **Extraction time**: 11ms
- **Content captured**: All form fields (Number, Category, Status, Impact, Priority, etc.) with labels and values

### Classic UI List (`/incident_list.do`)
- **Method**: CDP `getFullAXTree` (direct URL)
- **Nodes**: 7,402 total | 599 interactive
- **Named**: 100%
- **Extraction time**: 51ms
- **Warning**: 371KB estimated JSON — too large for LLM. Needs pruning.

## Critical Findings

### 1. URL Discovery
- Flow Designer is now "Workflow Studio" at `/$flow-designer.do` → `/now/workflow-studio/home/flow`
- `/now/flow-designer` returns 404 on this instance
- Classic UI forms behind `nav_to.do` are in iframes — use direct URLs instead

### 2. Shadow DOM and AX Tree
- ServiceNow `now-*` web components use OPEN shadow roots
- The browser AX tree DOES flatten through shadow DOM — full content is accessible
- 77-node results on Flow Designer/Workspace were caused by 404 pages, not shadow DOM issues

### 3. Iframe Pattern
- Workflow Studio loads the flow editor in a same-origin iframe
- Classic UI (`nav_to.do`) also wraps content in iframes
- Same-origin iframes can't get separate CDP sessions in Playwright
- Playwright `frame.locator().ariaSnapshot()` works as alternative
- Trade-off: ariaSnapshot gives YAML text (needs parsing), no `backendDOMNodeId`

### 4. Click Interception
- ServiceNow's shadow DOM components (`<now-card-header>`) can intercept pointer events
- Playwright's strict click checks fail when shadow children overlay the target
- Workaround: `{ force: true }` or target the inner element directly

### 5. Data Pill Representation
- Data pills appear as labeled buttons in the AX tree
- Format: `"Angefordertes Element Record of type Record in Action Auslöser➛Angefordertes Element Record"`
- Contains: pill name, data type, source action path — sufficient for AI to understand and reference

## Architecture Decision

### Extraction Strategy (Two-Path)

```
Page load
  ├─ Is content in iframe?
  │   ├─ YES → Use Playwright frame.locator("body").ariaSnapshot()
  │   │        Parse YAML into SemanticNode tree
  │   │        Target elements via frame.getByRole()
  │   │
  │   └─ NO  → Use CDP Accessibility.getFullAXTree
  │            Get backendDOMNodeId for each node
  │            Target elements via DOM.resolveNode
  │
  └─ Merge frame results into unified SemanticModel
```

### Action Targeting (Two-Path)

| Context | Targeting Method |
|---------|-----------------|
| CDP-extracted nodes | `DOM.resolveNode({ backendNodeId })` → direct execution |
| ariaSnapshot-extracted nodes | `frame.getByRole(role, { name })` → Playwright locator |

Both paths produce the same `SemanticNode` interface for the AI. The targeting method is an internal implementation detail.
