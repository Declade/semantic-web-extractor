// ── Semantic Model ──────────────────────────────────────────────

export interface SemanticModel {
  page: PageContext;
  root: SemanticNode;
  actions?: AvailableAction[];
  nodeCount: number;
  extractedAt: number;
  warning?: "large_tree" | "scoped";
}

export interface PageContext {
  url: string;
  title: string;
  app?: string;
  context?: string;
  breadcrumb?: string[];
}

export interface SemanticNode {
  role: string;
  name: string;
  value?: string;
  states?: NodeStates;
  /** Backend DOM node ID — present when extracted via CDP (Path A) */
  nodeId?: number;
  /** Frame index — present when extracted from iframe via ariaSnapshot (Path B) */
  frameIndex?: number;
  bounds?: BoundingBox;
  children?: SemanticNode[];
  meta?: Record<string, unknown>;
}

/** Describes which extraction path produced a node, for action targeting */
export type ExtractionPath = "cdp" | "aria-snapshot";

export interface NodeStates {
  disabled?: boolean;
  expanded?: boolean;
  checked?: boolean;
  selected?: boolean;
  required?: boolean;
  readonly?: boolean;
  busy?: boolean;
  focused?: boolean;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Actions ─────────────────────────────────────────────────────

export interface AvailableAction {
  id: string;
  description: string;
  params: ActionParam[];
}

export interface ActionParam {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

export type ActionType = "click" | "type" | "select" | "clear" | "press_key";

export interface ActionRequest {
  action: ActionType;
  /** Target element — by nodeId or by role+name */
  target: { nodeId: number } | { role: string; name: string };
  /** Value for type/select/press_key actions */
  value?: string;
}

export interface ActionResult {
  executed: boolean;
  action: ActionType;
  /** Updated semantic model after action */
  model?: SemanticModel;
}

// ── Extraction Options ──────────────────────────────────────────

export interface ExtractionOptions {
  /** Scope extraction to a subtree matching this role+name */
  scope?: { role: string; name: string };
  /** Max tree depth (default 15) */
  maxDepth?: number;
  /** Include Tier 2 bounds data */
  includeBounds?: boolean;
}

// ── Page Status ─────────────────────────────────────────────────

export type PageState =
  | "idle"
  | "loading"
  | "dialog_open"
  | "session_expired"
  | "crashed"
  | "disconnected";

export interface PageStatus {
  state: PageState;
  url: string;
  title: string;
  nodeCount?: number;
}

// ── Error Model ─────────────────────────────────────────────────

export type ErrorCode =
  | "action_in_progress"
  | "element_not_found"
  | "session_expired"
  | "page_crashed"
  | "extraction_timeout"
  | "action_timeout"
  | "connection_failed"
  | "invalid_params";

export interface ToolError {
  code: ErrorCode;
  message: string;
  recoverable: boolean;
}

export interface ToolResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ToolError;
}

// ── App Handler ─────────────────────────────────────────────────

export interface AppHandler {
  id: string;
  detect(url: string, axTree: SemanticNode): boolean;
  enrich(model: SemanticModel, page: unknown): Promise<SemanticModel>;
  customActions: Record<string, CustomActionHandler>;
}

export type CustomActionHandler = (
  params: Record<string, unknown>,
  model: SemanticModel,
  page: unknown,
) => Promise<ActionResult>;
