import type { Page } from "playwright";
import type { SemanticNode, ExtractionPath } from "../types.js";
import { extractViaCDP, type CDPExtractionResult } from "./ax-tree.js";
import { extractViaAriaSnapshot, findContentFrame, type AriaExtractionResult } from "./aria-snapshot.js";

export interface ExtractionResult {
  /** Top-level extraction (always present) */
  topLevel: CDPExtractionResult;
  /** Iframe extraction (present only when content iframe detected) */
  iframe?: AriaExtractionResult;
  /** Which paths were used */
  paths: ExtractionPath[];
}

/**
 * Two-path extraction orchestrator.
 *
 * 1. Always extract top-level page via CDP (Path A)
 * 2. Detect iframes — if content iframe found, also extract via ariaSnapshot (Path B)
 * 3. Return both results for the model builder to merge
 */
export async function extract(page: Page): Promise<ExtractionResult> {
  // Path A: CDP extraction on main page
  const topLevel = await extractViaCDP(page);
  const paths: ExtractionPath[] = ["cdp"];

  // Check for content iframes
  const frames = page.frames();
  let iframe: AriaExtractionResult | undefined;

  if (frames.length > 1) {
    const contentFrame = await findContentFrame(frames);
    if (contentFrame) {
      iframe = await extractViaAriaSnapshot(contentFrame.frame, contentFrame.index);
      paths.push("aria-snapshot");
    }
  }

  return { topLevel, iframe, paths };
}
