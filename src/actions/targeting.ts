import type { Page, Locator, Frame } from "playwright";
import type { ActionRequest, LocatorDescriptor } from "../types.js";

export type ResolvedTarget =
  | { type: "cdp"; backendNodeId: number; page: Page }
  | { type: "locator"; locator: Locator; frame: Frame };

/**
 * Resolve an action target to either a CDP node reference or a Playwright locator.
 *
 * - Path A (nodeId): Use CDP DOM.resolveNode for precise targeting
 * - Path B (role+name): Build frame.getByRole() locator for iframe content
 */
export async function resolveTarget(
  page: Page,
  target: ActionRequest["target"],
): Promise<ResolvedTarget> {
  if ("nodeId" in target) {
    return { type: "cdp", backendNodeId: target.nodeId, page };
  }

  // Path B: role + name locator
  const desc = target as LocatorDescriptor;

  if (desc.frameIndex !== undefined) {
    const frames = page.frames();
    const frame = frames[desc.frameIndex];
    if (!frame) {
      throw new Error(`Frame index ${desc.frameIndex} not found (${frames.length} frames available)`);
    }
    const locator = frame.getByRole(desc.role as any, { name: desc.name });
    return { type: "locator", locator, frame };
  }

  // No frameIndex — target on main page
  const locator = page.getByRole(desc.role as any, { name: desc.name });
  return { type: "locator", locator, frame: page.mainFrame() };
}

/**
 * Execute a click via CDP on a backendNodeId.
 * Falls back to Playwright click if CDP resolution fails.
 */
export async function clickViaCDP(page: Page, backendNodeId: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await (cdp as any).send("DOM.enable");
    const { object } = await (cdp as any).send("DOM.resolveNode", {
      backendNodeId,
    }) as { object: { objectId: string } };

    // Scroll into view
    await (cdp as any).send("DOM.scrollIntoViewIfNeeded", {
      objectId: object.objectId,
    });

    // Get box model for click coordinates
    const { model } = await (cdp as any).send("DOM.getBoxModel", {
      objectId: object.objectId,
    }) as { model: { content: number[] } };

    const [x1, y1, x2, y2, x3, y3, x4, y4] = model.content;
    const centerX = (x1! + x3!) / 2;
    const centerY = (y1! + y3!) / 2;

    // Click via Input.dispatchMouseEvent
    await (cdp as any).send("Input.dispatchMouseEvent", {
      type: "mousePressed", x: centerX, y: centerY, button: "left", clickCount: 1,
    });
    await (cdp as any).send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: centerX, y: centerY, button: "left", clickCount: 1,
    });
  } finally {
    await cdp.detach().catch(() => {});
  }
}
