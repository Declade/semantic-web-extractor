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

async function analyzeWithCDP(page: Page, label: string) {
  console.log("\n--- CDP Analysis: " + label + " ---");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Accessibility.enable" as any);
  await cdp.send("DOM.enable" as any);
  const start = Date.now();
  const result = await cdp.send("Accessibility.getFullAXTree" as any) as any;
  const ms = Date.now() - start;
  const nodes = result.nodes;
  const nonIgnored = nodes.filter((n: any) => !n.ignored);
  const interactive = nonIgnored.filter((n: any) => {
    const r = n.role?.value;
    return ["button", "textbox", "combobox", "link", "tab", "treeitem", "menuitem",
      "checkbox", "searchbox", "listbox", "option", "radio", "switch", "slider",
      "gridcell", "row", "columnheader", "menuitemcheckbox"].includes(r);
  });
  const named = interactive.filter((n: any) => n.name?.value?.trim());
  const withNodeId = interactive.filter((n: any) => n.backendDOMNodeId != null);

  console.log("  Time: " + ms + "ms | Nodes: " + nodes.length + " | Non-ignored: " + nonIgnored.length);
  console.log("  Interactive: " + interactive.length + " | Named: " + named.length +
    " (" + (interactive.length > 0 ? Math.round(named.length / interactive.length * 100) : 0) + "%) | With nodeId: " + withNodeId.length);

  // Role breakdown
  const roles = new Map<string, number>();
  for (const n of nonIgnored) {
    const r = n.role?.value || "?";
    roles.set(r, (roles.get(r) || 0) + 1);
  }
  console.log("  Top roles:");
  const sorted = [...roles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  for (const [r, c] of sorted) {
    console.log("    " + r.padEnd(22) + c);
  }

  // Sample interactive
  console.log("  Sample interactive (first 25):");
  for (const n of interactive.slice(0, 25)) {
    const name = n.name?.value || "(unnamed)";
    const val = n.value?.value ? ' = "' + String(n.value.value).slice(0, 30) + '"' : "";
    console.log("    " + (n.role.value || "?").padEnd(15) + '"' + name.slice(0, 50) + '"' + val);
  }

  // Test nodeId resolution
  console.log("  NodeId resolution:");
  for (const n of withNodeId.slice(0, 5)) {
    try {
      const res = await cdp.send("DOM.resolveNode" as any, { backendNodeId: n.backendDOMNodeId });
      console.log("    OK " + n.role.value + ' "' + (n.name?.value || "").slice(0, 30) + '"');
    } catch {
      console.log("    FAIL " + n.role.value + ' "' + (n.name?.value || "").slice(0, 30) + '"');
    }
  }

  return { nodes: nodes.length, interactive: interactive.length, named: named.length, ms };
}

async function main() {
  const browser = await chromium.launch({ headless: false, args: ["--window-size=1400,900"] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  await login(page);

  // ── Workflow Studio Home ──
  console.log("Navigating to Workflow Studio (Flow Designer)...");
  await page.goto(INSTANCE_URL + "/$flow-designer.do", { waitUntil: "networkidle" });
  await page.waitForTimeout(8000);
  console.log("Final URL: " + page.url());

  // Full ariaSnapshot
  const snap1 = await page.locator("body").ariaSnapshot();
  const lines1 = snap1.split("\n");
  console.log("\n=== ARIA SNAPSHOT: Workflow Studio Home (" + lines1.length + " lines) ===");
  for (const line of lines1.slice(0, 80)) {
    console.log(line);
  }
  if (lines1.length > 80) console.log("... (" + (lines1.length - 80) + " more)");

  const r1 = await analyzeWithCDP(page, "Workflow Studio Home");

  // ── Open or create a flow ──
  // Check if there are existing flows we can click on
  console.log("\n\nLooking for existing flows to open...");
  const flowLinks = await page.getByRole("link").all();
  console.log("Total links on page: " + flowLinks.length);

  // Look for a flow link in the list
  const snap1Lines = snap1.split("\n");
  const flowLines = snap1Lines.filter((l: string) =>
    l.includes("link") || l.includes("row") || l.includes("gridcell") || l.includes("Flow") || l.includes("flow")
  );
  console.log("\nFlow-related lines from snapshot:");
  for (const line of flowLines.slice(0, 20)) {
    console.log("  " + line);
  }

  // Try to click on the first flow in the table
  console.log("\n\nTrying to open a flow...");
  const firstFlowLink = page.getByRole("link").filter({ hasText: /flow|Flow/ }).first();
  try {
    const flowText = await firstFlowLink.textContent();
    console.log("Found flow link: " + flowText);
    await firstFlowLink.click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(8000);
    console.log("Opened flow. URL: " + page.url());

    const snap2 = await page.locator("body").ariaSnapshot();
    const lines2 = snap2.split("\n");
    console.log("\n=== ARIA SNAPSHOT: Flow Editor (" + lines2.length + " lines) ===");
    for (const line of lines2.slice(0, 100)) {
      console.log(line);
    }
    if (lines2.length > 100) console.log("... (" + (lines2.length - 100) + " more)");

    await analyzeWithCDP(page, "Flow Editor");
  } catch (e: any) {
    console.log("No flow link found or couldn't open: " + e.message.slice(0, 100));
    console.log("Trying to create a new flow instead...");

    // Click Create button
    try {
      await page.getByRole("button", { name: "Erstellen" }).click();
      await page.waitForTimeout(3000);

      const createSnap = await page.locator("body").ariaSnapshot();
      console.log("\nAfter clicking Create:");
      for (const line of createSnap.split("\n").slice(0, 30)) {
        console.log("  " + line);
      }
    } catch (e2: any) {
      console.log("Create button failed: " + e2.message.slice(0, 100));
    }
  }

  await browser.close();
}

main().catch(e => { console.error(e.message); process.exit(1); });
