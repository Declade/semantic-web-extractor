/**
 * Deep investigation: Why does getFullAXTree only return 77 nodes for Next Experience?
 */

import { chromium, type Page } from "playwright";

const INSTANCE_URL = "https://dev205951.service-now.com";
const SN_USERNAME = "admin";
const SN_PASSWORD = "Ym*+ZTHx18vf";

async function login(page: Page) {
  console.log("Logging in...");
  await page.goto(INSTANCE_URL + "/login.do", { waitUntil: "networkidle" });
  if (!page.url().includes("login")) {
    console.log("Already logged in.\n");
    return;
  }
  await page.fill("#user_name", SN_USERNAME);
  await page.fill("#user_password", SN_PASSWORD);
  await page.click("#sysverb_login");
  await page.waitForLoadState("networkidle");
  console.log("Logged in.\n");
}

async function checkShadowDOM(page: Page, label: string) {
  console.log("\n=== " + label + " ===");
  console.log("URL: " + page.url());

  // Check 1: What custom elements exist and are shadows open?
  console.log("\n-- Shadow DOM structure --");
  try {
    const result = await page.evaluate(() => {
      const out: string[] = [];
      function walk(el: Element, depth: number) {
        if (depth > 8) return;
        const tag = (el.tagName || "").toLowerCase();
        const sr = (el as any).shadowRoot;
        if (tag.indexOf("-") !== -1 || sr) {
          const prefix = "  ".repeat(depth);
          const mode = sr ? "OPEN" : "no-shadow";
          const kids = el.children ? el.children.length : 0;
          const sKids = sr ? sr.children.length : 0;
          out.push(prefix + tag + " [" + mode + " children:" + kids + " shadow-children:" + sKids + "]");
        }
        if (el.children) {
          for (let i = 0; i < el.children.length; i++) {
            walk(el.children[i], depth + 1);
          }
        }
        if (sr) {
          for (let i = 0; i < sr.children.length; i++) {
            walk(sr.children[i] as Element, depth + 1);
          }
        }
      }
      walk(document.documentElement, 0);
      return out;
    });
    console.log("Custom elements found: " + result.length);
    for (const line of result.slice(0, 60)) {
      console.log(line);
    }
    if (result.length > 60) {
      console.log("  ... (" + (result.length - 60) + " more)");
    }
  } catch (e: any) {
    console.log("Shadow walk failed: " + e.message.slice(0, 200));
  }

  // Check 2: Interactive elements via JS shadow traversal
  console.log("\n-- Interactive elements (JS shadow traversal) --");
  try {
    const elements = await page.evaluate(() => {
      const out: string[] = [];
      function walk(node: Element | ShadowRoot, depth: number) {
        if (depth > 15) return;
        const children = node.children ? Array.from(node.children) : [];
        for (const child of children) {
          const tag = (child.tagName || "").toLowerCase();
          const role = child.getAttribute ? child.getAttribute("role") : null;
          const ariaLabel = child.getAttribute ? child.getAttribute("aria-label") : null;
          const interTags = ["button", "input", "select", "textarea", "a"];
          const interRoles = ["button", "textbox", "combobox", "link", "tab", "menuitem", "checkbox", "searchbox", "treeitem"];
          if (interTags.indexOf(tag) !== -1 || interRoles.indexOf(role || "") !== -1) {
            const label = ariaLabel || (child.textContent || "").trim().substring(0, 50) || "(none)";
            out.push("  " + tag + (role ? "[role=" + role + "]" : "") + ' "' + label + '" depth:' + depth);
          }
          if ((child as any).shadowRoot) {
            walk((child as any).shadowRoot, depth + 1);
          }
          walk(child, depth + 1);
        }
      }
      walk(document.documentElement, 0);
      return out;
    });
    console.log("Interactive elements found: " + elements.length);
    for (const line of elements.slice(0, 40)) {
      console.log(line);
    }
    if (elements.length > 40) {
      console.log("  ... (" + (elements.length - 40) + " more)");
    }
  } catch (e: any) {
    console.log("Interactive walk failed: " + e.message.slice(0, 200));
  }

  // Check 3: Playwright ariaSnapshot
  console.log("\n-- Playwright ariaSnapshot --");
  try {
    const snapshot = await page.locator("body").ariaSnapshot();
    const lines = snapshot.split("\n");
    console.log("ariaSnapshot lines: " + lines.length);
    for (const line of lines.slice(0, 50)) {
      console.log("  " + line);
    }
    if (lines.length > 50) {
      console.log("  ... (" + (lines.length - 50) + " more)");
    }
  } catch (e: any) {
    console.log("ariaSnapshot failed: " + e.message.slice(0, 200));
  }
}

async function main() {
  const browser = await chromium.launch({ headless: false, args: ["--window-size=1400,900"] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  await login(page);

  // Test Flow Designer
  console.log("Navigating to Flow Designer...");
  await page.goto(INSTANCE_URL + "/now/flow-designer", { waitUntil: "networkidle" });
  await page.waitForTimeout(10000);
  await checkShadowDOM(page, "FLOW DESIGNER");

  // Test Workspace
  console.log("\n\nNavigating to Workspace...");
  await page.goto(INSTANCE_URL + "/now/workspace/agent/record/incident", { waitUntil: "networkidle" });
  await page.waitForTimeout(12000);
  await checkShadowDOM(page, "WORKSPACE INCIDENT");

  await browser.close();
}

main().catch(e => {
  console.error("Fatal: " + e.message);
  process.exit(1);
});
