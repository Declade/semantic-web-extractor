import type { Page } from "playwright";
import type {
  ActionRequest,
  ActionResult,
  ActionType,
  SemanticModel,
  ToolError,
} from "../types.js";
import { resolveTarget, clickViaCDP } from "./targeting.js";
import { waitForDomSettle } from "./wait.js";
import { extract } from "../engine/extractor.js";
import { buildModelAsync } from "../engine/model-builder.js";

let actionInProgress = false;

/**
 * Execute an action on the page.
 * Mutex-locked — only one action at a time.
 * Auto re-extracts after action completes and returns fresh model.
 */
export async function executeAction(
  page: Page,
  request: ActionRequest,
): Promise<ActionResult> {
  if (actionInProgress) {
    const err: ToolError = {
      code: "action_in_progress",
      message: "Another action is currently executing. Wait for it to complete.",
      recoverable: true,
    };
    throw err;
  }

  actionInProgress = true;
  try {
    const target = await resolveTarget(page, request.target);

    switch (request.action) {
      case "click":
        await performClick(page, target);
        break;
      case "type":
        await performType(target, request.value ?? "");
        break;
      case "select":
        await performSelect(target, request.value ?? "");
        break;
      case "clear":
        await performClear(target);
        break;
      case "press_key":
        await performPressKey(page, target, request.value ?? "Enter");
        break;
    }

    // Wait for DOM to settle after action
    await waitForDomSettle(page);

    // Re-extract for fresh model
    const result = await extract(page);
    const model = await buildModelAsync(page, result);

    return { executed: true, action: request.action, model };
  } finally {
    actionInProgress = false;
  }
}

async function performClick(
  page: Page,
  target: Awaited<ReturnType<typeof resolveTarget>>,
): Promise<void> {
  if (target.type === "cdp") {
    await clickViaCDP(target.page, target.backendNodeId);
  } else {
    // Use force: true for shadow DOM click interception (ServiceNow now-* components)
    await target.locator.click({ force: true, timeout: 5000 });
  }
}

async function performType(
  target: Awaited<ReturnType<typeof resolveTarget>>,
  value: string,
): Promise<void> {
  if (target.type === "cdp") {
    throw Object.assign(new Error("Type action requires locator target (role+name), not nodeId"), {
      code: "invalid_params" as const,
      recoverable: true,
    });
  }
  await target.locator.fill(value, { timeout: 5000 });
}

async function performSelect(
  target: Awaited<ReturnType<typeof resolveTarget>>,
  value: string,
): Promise<void> {
  if (target.type === "cdp") {
    throw Object.assign(new Error("Select action requires locator target (role+name), not nodeId"), {
      code: "invalid_params" as const,
      recoverable: true,
    });
  }
  await target.locator.selectOption(value, { timeout: 5000 });
}

async function performClear(
  target: Awaited<ReturnType<typeof resolveTarget>>,
): Promise<void> {
  if (target.type === "cdp") {
    throw Object.assign(new Error("Clear action requires locator target (role+name), not nodeId"), {
      code: "invalid_params" as const,
      recoverable: true,
    });
  }
  await target.locator.clear({ timeout: 5000 });
}

async function performPressKey(
  page: Page,
  target: Awaited<ReturnType<typeof resolveTarget>>,
  key: string,
): Promise<void> {
  if (target.type === "locator") {
    await target.locator.press(key, { timeout: 5000 });
  } else {
    // For CDP targets, press key on the page
    await page.keyboard.press(key);
  }
}
