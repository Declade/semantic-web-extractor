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

  // Navigate to Service Operations Workspace
  console.log("Navigating to Service Operations Workspace...");
  await page.goto(INSTANCE_URL + "/now/sow/home", { waitUntil: "networkidle" });
  await page.waitForTimeout(8000);

  // Full ariaSnapshot
  console.log("\n=== ARIA SNAPSHOT: SOW Home ===");
  const snapshot = await page.locator("body").ariaSnapshot();
  const lines = snapshot.split("\n");
  console.log("Total lines: " + lines.length);
  for (const line of lines) {
    console.log(line);
  }

  // CDP AX tree
  console.log("\n\n=== CDP AX TREE: SOW Home ===");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Accessibility.enable" as any);
  await cdp.send("DOM.enable" as any);
  const startTime = Date.now();
  const result = await cdp.send("Accessibility.getFullAXTree" as any) as any;
  const extractionTime = Date.now() - startTime;
  const nodes = result.nodes;
  const interactive = nodes.filter((n: any) =>
    !n.ignored && ["button", "textbox", "combobox", "link", "tab", "treeitem", "menuitem", "checkbox", "searchbox", "listbox", "option"].includes(n.role?.value)
  );
  const named = interactive.filter((n: any) => n.name?.value?.trim());
  console.log("Extraction time: " + extractionTime + "ms");
  console.log("Total nodes: " + nodes.length);
  console.log("Interactive: " + interactive.length);
  console.log("Named: " + named.length + " (" + (interactive.length > 0 ? Math.round(named.length / interactive.length * 100) : 0) + "%)");
  console.log("\nSample interactive elements:");
  for (const n of interactive.slice(0, 30)) {
    const name = n.name?.value ?? "(unnamed)";
    const value = n.value?.value ? ' = "' + String(n.value.value).slice(0, 30) + '"' : "";
    console.log("  " + n.role.value + ' "' + name + '"' + value + " [nodeId:" + (n.backendDOMNodeId ?? "none") + "]");
  }

  // Now navigate into an incident record from workspace
  console.log("\n\n=== Navigating to incident list in workspace ===");
  // Try clicking on a list or navigating
  await page.goto(INSTANCE_URL + "/now/sow/list/incident", { waitUntil: "networkidle" });
  await page.waitForTimeout(8000);

  const snapshot2 = await page.locator("body").ariaSnapshot();
  const lines2 = snapshot2.split("\n");
  console.log("Incident list - ariaSnapshot lines: " + lines2.length);
  for (const line of lines2.slice(0, 80)) {
    console.log(line);
  }
  if (lines2.length > 80) {
    console.log("... (" + (lines2.length - 80) + " more)");
  }

  // CDP check
  const cdp2 = await page.context().newCDPSession(page);
  await cdp2.send("Accessibility.enable" as any);
  const result2 = await cdp2.send("Accessibility.getFullAXTree" as any) as any;
  const interactive2 = result2.nodes.filter((n: any) =>
    !n.ignored && ["button", "textbox", "combobox", "link", "tab", "treeitem", "menuitem", "checkbox", "searchbox", "listbox", "option", "gridcell", "row", "columnheader"].includes(n.role?.value)
  );
  console.log("\nCDP AX tree: " + result2.nodes.length + " nodes, " + interactive2.length + " interactive");

  await browser.close();
}

main().catch(e => { console.error(e.message); process.exit(1); });
