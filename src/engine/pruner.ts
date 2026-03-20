import type { SemanticNode, ExtractionOptions } from "../types.js";

const DECORATIVE_ROLES = new Set(["generic", "none", "presentation"]);

/**
 * Prune a semantic tree:
 * 1. Scoped extraction (find subtree matching role+name)
 * 2. Collapse decorative nodes (generic/none with single child)
 * 3. Depth limit
 */
export function pruneTree(root: SemanticNode, options: ExtractionOptions = {}): SemanticNode {
  let tree = root;

  // Scoped extraction — find matching subtree
  if (options.scope) {
    const found = findSubtree(tree, options.scope.role, options.scope.name);
    if (found) {
      tree = found;
    }
  }

  // Collapse decorative nodes and apply depth limit
  const maxDepth = options.maxDepth ?? 15;
  tree = collapseAndLimit(tree, 0, maxDepth);

  return tree;
}

function findSubtree(node: SemanticNode, role: string, name: string): SemanticNode | null {
  if (node.role === role && node.name.toLowerCase().includes(name.toLowerCase())) {
    return node;
  }
  if (node.children) {
    for (const child of node.children) {
      const found = findSubtree(child, role, name);
      if (found) return found;
    }
  }
  return null;
}

function collapseAndLimit(node: SemanticNode, depth: number, maxDepth: number): SemanticNode {
  // At depth limit, strip children
  if (depth >= maxDepth) {
    const { children, ...rest } = node;
    return rest;
  }

  if (!node.children?.length) return node;

  // Process children
  let children = node.children.map((c) => collapseAndLimit(c, depth + 1, maxDepth));

  // Collapse decorative nodes with single child
  children = children.map((child) => {
    if (DECORATIVE_ROLES.has(child.role) && !child.name && child.children?.length === 1) {
      return child.children[0]!;
    }
    return child;
  });

  // Remove empty decorative nodes
  children = children.filter(
    (child) => !(DECORATIVE_ROLES.has(child.role) && !child.name && !child.children?.length),
  );

  return { ...node, children: children.length > 0 ? children : undefined };
}

/**
 * Count nodes in a tree.
 */
export function countNodes(node: SemanticNode): number {
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countNodes(child);
    }
  }
  return count;
}
