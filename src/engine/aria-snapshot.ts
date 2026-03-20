import type { Frame } from "playwright";
import type { SemanticNode, NodeStates } from "../types.js";

export interface AriaExtractionResult {
  root: SemanticNode;
  nodeCount: number;
  frameIndex: number;
}

/**
 * Path B: Extract accessibility tree via Playwright `ariaSnapshot()` on an iframe.
 * Returns a SemanticNode tree with `frameIndex` set on each interactive node.
 */
export async function extractViaAriaSnapshot(
  frame: Frame,
  frameIndex: number,
): Promise<AriaExtractionResult> {
  const yaml = await frame.locator("body").ariaSnapshot({ timeout: 10000 });
  const root = parseAriaYaml(yaml, frameIndex);
  const nodeCount = countNodes(root);
  return { root, nodeCount, frameIndex };
}

/**
 * Find the best content-bearing frame from a list of frames.
 * Returns the frame with the most ariaSnapshot lines (most content).
 */
export async function findContentFrame(
  frames: Frame[],
): Promise<{ frame: Frame; index: number } | null> {
  let best: { frame: Frame; index: number; lines: number } | null = null;

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!;
    const url = f.url();
    if (url === "about:blank" || url === "") continue;

    // Skip the main frame
    if (f === f.page().mainFrame()) continue;

    try {
      const snap = await f.locator("body").ariaSnapshot({ timeout: 5000 });
      const lines = snap.split("\n").length;
      if (!best || lines > best.lines) {
        best = { frame: f, index: i, lines };
      }
    } catch {
      // Frame may not be ready or accessible
    }
  }

  return best ? { frame: best.frame, index: best.index } : null;
}

// ── YAML Parser ──────────────────────────────────────────────────

/**
 * Parse Playwright ariaSnapshot YAML into a SemanticNode tree.
 *
 * Format:
 *   - role "name":
 *     - childrole "childname"
 *   - role "name" [checked]
 *   - textbox "label": "value"
 */
function parseAriaYaml(yaml: string, frameIndex: number): SemanticNode {
  const lines = yaml.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { role: "none", name: "empty", frameIndex };
  }

  const root: SemanticNode = { role: "region", name: "iframe-content", children: [] };

  const stack: Array<{ node: SemanticNode; indent: number }> = [
    { node: root, indent: -1 },
  ];

  for (const line of lines) {
    const indent = line.search(/\S/);
    const trimmed = line.trim();

    // Remove leading "- " if present
    const content = trimmed.startsWith("- ") ? trimmed.slice(2) : trimmed;

    const parsed = parseLine(content, frameIndex);
    if (!parsed) continue;

    // Pop stack to find parent at lower indent
    while (stack.length > 1 && stack[stack.length - 1]!.indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1]!.node;
    if (!parent.children) parent.children = [];
    parent.children.push(parsed);
    stack.push({ node: parsed, indent });
  }

  // If root has exactly one child, promote it
  if (root.children?.length === 1) {
    const child = root.children[0]!;
    child.frameIndex = frameIndex;
    return child;
  }

  root.frameIndex = frameIndex;
  return root;
}

function parseLine(content: string, frameIndex: number): SemanticNode | null {
  if (!content) return null;

  // Pattern: role "name" [states]: "value"
  // or:      role "name" [states]
  // or:      role "name"
  // or:      text "content"

  const statePattern = /\[(checked|disabled|expanded|selected|required|readonly)\]/g;
  const states: NodeStates = {};
  let hasStates = false;
  let cleaned = content;

  let match;
  while ((match = statePattern.exec(content)) !== null) {
    const state = match[1] as keyof NodeStates;
    states[state] = true;
    hasStates = true;
    cleaned = cleaned.replace(match[0], "");
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // Match: role "name": "value"
  const withValue = cleaned.match(/^(\w[\w-]*)\s+"([^"]*)":\s*"([^"]*)"$/);
  if (withValue) {
    const node: SemanticNode = {
      role: withValue[1]!,
      name: withValue[2]!,
      value: withValue[3],
      frameIndex,
    };
    if (hasStates) node.states = states;
    return node;
  }

  // Match: role "name":  (parent with children, colon at end)
  const parentNode = cleaned.match(/^(\w[\w-]*)\s+"([^"]*)":?\s*$/);
  if (parentNode) {
    const node: SemanticNode = {
      role: parentNode[1]!,
      name: parentNode[2]!,
      frameIndex,
    };
    if (hasStates) node.states = states;
    return node;
  }

  // Match: role "name"
  const simple = cleaned.match(/^(\w[\w-]*)\s+"([^"]*)"$/);
  if (simple) {
    const node: SemanticNode = {
      role: simple[1]!,
      name: simple[2]!,
      frameIndex,
    };
    if (hasStates) node.states = states;
    return node;
  }

  // Match: just a role with no name (e.g., "list:")
  const roleOnly = cleaned.match(/^(\w[\w-]*):?\s*$/);
  if (roleOnly) {
    return { role: roleOnly[1]!, name: "", frameIndex };
  }

  // Plain text content
  return { role: "text", name: content, frameIndex };
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
