import { chromium, type Page } from "playwright";

const INSTANCE_URL = "https://dev205951.service-now.com";

async function login(page: Page) {
  await page.goto(INSTANCE_URL + "/login.do", { waitUntil: "networkidle" });
  if (!page.url().includes("login")) return;
  await page.fill("#user_name", "admin");
  await page.fill("#user_password", "Ym*+ZTHx18vf");
  await page.click("#sysverb_login");
  await page.waitForLoadState("networkidle");
  console.log("Logged in.\n");
}

async function main() {
  const browser = await chromium.launch({ headless: false, args: ["--window-size=1400,900"] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  await login(page);

  // Navigate to Workflow Studio and open a flow
  console.log("Navigating to Workflow Studio...");
  await page.goto(INSTANCE_URL + "/$flow-designer.do", { waitUntil: "networkidle" });
  await page.waitForTimeout(5000);

  // Open a flow
  console.log("Opening a flow...");
  const flowButton = page.getByRole("button", { name: /Click to open the flow/ }).first();
  await flowButton.click({ force: true });
  await page.waitForTimeout(12000);

  // List all frames
  const frames = page.frames();
  console.log("\n=== FRAMES (" + frames.length + ") ===");
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const url = f.url();
    console.log("[" + i + "] " + url.slice(0, 120));
  }

  // Check each frame for content
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const url = f.url();
    if (url === "about:blank" || url === "") continue;

    console.log("\n\n=== FRAME " + i + ": " + url.slice(0, 80) + " ===");

    // Try ariaSnapshot on frame
    try {
      const snap = await f.locator("body").ariaSnapshot({ timeout: 5000 });
      const lines = snap.split("\n");
      console.log("ariaSnapshot: " + lines.length + " lines");
      for (const line of lines.slice(0, 60)) {
        console.log("  " + line);
      }
      if (lines.length > 60) console.log("  ... (" + (lines.length - 60) + " more)");
    } catch (e: any) {
      console.log("ariaSnapshot failed: " + e.message.slice(0, 100));
    }

    // Try CDP on frame
    try {
      const cdp = await page.context().newCDPSession(f as any);
      await cdp.send("Accessibility.enable" as any);
      const result = await cdp.send("Accessibility.getFullAXTree" as any) as any;
      const nodes = result.nodes;
      const interactive = nodes.filter((n: any) =>
        !n.ignored && ["button", "textbox", "combobox", "link", "tab", "treeitem",
          "menuitem", "checkbox", "searchbox", "listbox", "option"].includes(n.role?.value)
      );
      console.log("\nCDP: " + nodes.length + " nodes, " + interactive.length + " interactive");
      for (const n of interactive.slice(0, 20)) {
        console.log("  " + (n.role?.value || "?").padEnd(15) + '"' + (n.name?.value || "").slice(0, 50) + '"');
      }
    } catch (e: any) {
      console.log("CDP failed: " + e.message.slice(0, 100));
    }
  }

  await browser.close();
}

main().catch(e => { console.error(e.message); process.exit(1); });
