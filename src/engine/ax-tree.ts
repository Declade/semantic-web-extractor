import type { Page } from "playwright";
import type { CDPSession } from "playwright";
import type { SemanticNode, NodeStates } from "../types.js";

/** Raw CDP AX node shape */
interface CDPAXNode {
  nodeId: string;
  role: { type: string; value: string };
  name?: { type: string; value: string };
  value?: { type: string; value: string };
  properties?: Array<{ name: string; value: { type: string; value: unknown } }>;
  childIds?: string[];
  backendDOMNodeId?: number;
  ignored?: boolean;
}

export interface CDPExtractionResult {
  root: SemanticNode;
  nodeCount: number;
  extractionMs: number;
}

const INTERACTIVE_ROLES = new Set([
  "button", "textbox", "combobox", "checkbox", "radio",
  "link", "menuitem", "tab", "treeitem", "searchbox",
  "spinbutton", "slider", "switch", "option", "listbox",
  "menuitemcheckbox", "menuitemradio", "gridcell", "row",
  "columnheader",
]);

/**
 * Path A: Extract accessibility tree via CDP `Accessibility.getFullAXTree`.
 * Returns a SemanticNode tree with `nodeId` (backendDOMNodeId) on each node.
 */
export async function extractViaCDP(page: Page): Promise<CDPExtractionResult> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Accessibility.enable" as never);
    await cdp.send("DOM.enable" as never);

    const start = Date.now();
    const result = await cdp.send("Accessibility.getFullAXTree" as never) as { nodes: CDPAXNode[] };
    const extractionMs = Date.now() - start;

    const root = buildTree(result.nodes);
    const nodeCount = countNodes(root);

    return { root, nodeCount, extractionMs };
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/**
 * Get a CDP session for the main page — used by action targeting.
 */
export async function getCDPSession(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable" as never);
  return cdp;
}

function buildTree(nodes: CDPAXNode[]): SemanticNode {
  const byId = new Map<string, CDPAXNode>();
  for (const n of nodes) {
    byId.set(n.nodeId, n);
  }

  function convert(node: CDPAXNode): SemanticNode | null {
    if (node.ignored) {
      // Still process children — they may be relevant
      const children: SemanticNode[] = [];
      for (const childId of node.childIds ?? []) {
        const child = byId.get(childId);
        if (child) {
          const converted = convert(child);
          if (converted) children.push(converted);
        }
      }
      // If ignored node has exactly one child, promote it
      if (children.length === 1) return children[0]!;
      if (children.length > 1) {
        return {
          role: "group",
          name: "",
          children,
        };
      }
      return null;
    }

    const role = node.role?.value ?? "unknown";
    const name = node.name?.value ?? "";
    const value = node.value?.value;
    const states = extractStates(node.properties);

    const children: SemanticNode[] = [];
    for (const childId of node.childIds ?? []) {
      const child = byId.get(childId);
      if (child) {
        const converted = convert(child);
        if (converted) children.push(converted);
      }
    }

    const result: SemanticNode = { role, name };
    if (value !== undefined) result.value = String(value);
    if (states) result.states = states;
    if (node.backendDOMNodeId !== undefined) result.nodeId = node.backendDOMNodeId;
    if (children.length > 0) result.children = children;

    return result;
  }

  // Root is the first node
  const rootNode = nodes[0];
  if (!rootNode) {
    return { role: "none", name: "empty" };
  }

  return convert(rootNode) ?? { role: "none", name: "empty" };
}

function extractStates(properties?: CDPAXNode["properties"]): NodeStates | undefined {
  if (!properties?.length) return undefined;
  const states: NodeStates = {};
  let hasAny = false;
  for (const prop of properties) {
    const val = prop.value.value;
    switch (prop.name) {
      case "disabled":
        if (val === true) { states.disabled = true; hasAny = true; }
        break;
      case "expanded":
        states.expanded = val as boolean; hasAny = true;
        break;
      case "checked":
        if (val === "true" || val === true) { states.checked = true; hasAny = true; }
        break;
      case "selected":
        if (val === true) { states.selected = true; hasAny = true; }
        break;
      case "required":
        if (val === true) { states.required = true; hasAny = true; }
        break;
      case "readonly":
        if (val === true) { states.readonly = true; hasAny = true; }
        break;
      case "busy":
        if (val === true) { states.busy = true; hasAny = true; }
        break;
      case "focused":
        if (val === true) { states.focused = true; hasAny = true; }
        break;
    }
  }
  return hasAny ? states : undefined;
}

function countNodes(node: SemanticNode): number {
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countNodes(child);
    }
  }
  return count;
}
