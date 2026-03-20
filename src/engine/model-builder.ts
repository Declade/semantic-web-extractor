import type { Page } from "playwright";
import type { SemanticModel, SemanticNode, PageContext } from "../types.js";
import type { ExtractionResult } from "./extractor.js";

/**
 * Build a unified SemanticModel from extraction results.
 * Merges top-level CDP extraction with optional iframe ariaSnapshot extraction.
 */
export function buildModel(page: Page, result: ExtractionResult): SemanticModel {
  const pageContext = buildPageContext(page);

  let root: SemanticNode;
  let nodeCount: number;

  if (result.iframe) {
    // Merge: top-level tree + iframe subtree as a child
    root = {
      ...result.topLevel.root,
      children: [
        ...(result.topLevel.root.children ?? []),
        {
          role: "region",
          name: "iframe-content",
          frameIndex: result.iframe.frameIndex,
          children: result.iframe.root.children ?? [result.iframe.root],
        },
      ],
    };
    nodeCount = result.topLevel.nodeCount + result.iframe.nodeCount;
  } else {
    root = result.topLevel.root;
    nodeCount = result.topLevel.nodeCount;
  }

  const model: SemanticModel = {
    page: pageContext,
    root,
    nodeCount,
    extractedAt: Date.now(),
  };

  if (nodeCount > 200) {
    model.warning = "large_tree";
  }

  return model;
}

function buildPageContext(page: Page): PageContext {
  const url = page.url();
  const ctx: PageContext = {
    url,
    title: "", // Will be set asynchronously if needed
  };

  // Detect app from URL patterns
  if (url.includes("/now/workflow-studio")) {
    ctx.app = "workflow-studio";
  } else if (url.includes("/now/sow")) {
    ctx.app = "sow-workspace";
  } else if (url.includes("/now/workspace")) {
    ctx.app = "workspace";
  } else if (url.includes(".do")) {
    ctx.app = "classic-ui";
  }

  return ctx;
}

/**
 * Async version that also resolves the page title.
 */
export async function buildModelAsync(page: Page, result: ExtractionResult): Promise<SemanticModel> {
  const model = buildModel(page, result);
  try {
    model.page.title = await page.title();
  } catch {
    model.page.title = "";
  }
  return model;
}
