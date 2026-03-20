/**
 * Phase 0 Spike: Validate AX tree quality on ServiceNow
 *
 * Usage:
 *   npm run spike
 *
 * Automatically logs into the ServiceNow PDI and tests AX tree extraction
 * on multiple page types (home, incident form, list view, flow designer).
 */

import { chromium } from "playwright";

const INSTANCE_URL = process.env.SWE_INSTANCE_URL ?? "https://dev205951.service-now.com";
const SN_USERNAME = process.env.SN_USERNAME ?? "admin";
const SN_PASSWORD = process.env.SN_PASSWORD ?? "Ym*+ZTHx18vf";

interface AXNode {
  nodeId: string;
  role: { type: string; value: string };
  name?: { type: string; value: string };
  value?: { type: string; value: string };
  properties?: Array<{ name: string; value: { type: string; value: unknown } }>;
  childIds?: string[];
  backendDOMNodeId?: number;
  ignored?: boolean;
}

async function login(page: any) {
  console.log("Logging in...");
  await page.goto(`${INSTANCE_URL}/login.do`, { waitUntil: "networkidle" });

  // Check if already logged in (redirected away from login)
  if (!page.url().includes("login")) {
    console.log("Already logged in.\n");
    return;
  }

  await page.fill("#user_name", SN_USERNAME);
  await page.fill("#user_password", SN_PASSWORD);
  await page.click("#sysverb_login");
  await page.waitForLoadState("networkidle");
  console.log(`Logged in. Current URL: ${page.url()}\n`);
}

async function analyzeAxTree(page: any, label: string) {
  console.log(`\n\n${"═".repeat(60)}`);
  console.log(`  AX TREE ANALYSIS: ${label}`);
  console.log(`  URL: ${page.url()}`);
  console.log("═".repeat(60));

  // Collect AX trees from main frame + all child frames
  const allNodes: AXNode[] = [];
  const frames = page.frames();
  console.log(`  Frames found: ${frames.length}`);

  const startTime = Date.now();
  for (const frame of frames) {
    try {
      const cdp = await page.context().newCDPSession(frame);
      await cdp.send("Accessibility.enable" as any);
      await cdp.send("DOM.enable" as any);
      const result = await cdp.send("Accessibility.getFullAXTree" as any) as { nodes: AXNode[] };
      const frameUrl = frame.url();
      const shortUrl = frameUrl.length > 60 ? frameUrl.slice(0, 57) + "..." : frameUrl;
      console.log(`    Frame: ${shortUrl} → ${result.nodes.length} nodes`);
      allNodes.push(...result.nodes);
    } catch (e: any) {
      console.log(`    Frame error: ${e.message.slice(0, 80)}`);
    }
  }
  const extractionTime = Date.now() - startTime;

  const nodes = allNodes;
  const totalNodes = nodes.length;
  const nonIgnored = nodes.filter((n: AXNode) => !n.ignored);
  const interactive = nonIgnored.filter((n: AXNode) => {
    const role = n.role?.value;
    return [
      "button", "textbox", "combobox", "checkbox", "radio",
      "link", "menuitem", "tab", "treeitem", "searchbox",
      "spinbutton", "slider", "switch", "option", "listbox",
      "menuitemcheckbox", "menuitemradio",
    ].includes(role);
  });
  const named = interactive.filter((n: AXNode) => n.name?.value && n.name.value.trim().length > 0);
  const withBackendId = interactive.filter((n: AXNode) => n.backendDOMNodeId !== undefined);

  console.log(`  Extraction time:      ${extractionTime}ms`);
  console.log(`  Total AX nodes:       ${totalNodes}`);
  console.log(`  Non-ignored nodes:    ${nonIgnored.length}`);
  console.log(`  Interactive elements: ${interactive.length}`);
  console.log(`  Named (have label):   ${named.length} (${pct(named.length, interactive.length)})`);
  console.log(`  Have backendNodeId:   ${withBackendId.length} (${pct(withBackendId.length, interactive.length)})`);

  // Role distribution
  const roleCounts = new Map<string, number>();
  for (const node of nonIgnored) {
    const role = node.role?.value ?? "unknown";
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
  }
  console.log("\n  Role distribution (top 15):");
  const sorted = [...roleCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  for (const [role, count] of sorted) {
    console.log(`    ${role.padEnd(25)} ${count}`);
  }

  // Sample interactive elements
  console.log("\n  Sample interactive elements (first 20):");
  console.log("  " + "─".repeat(76));
  for (const node of interactive.slice(0, 20)) {
    const role = node.role?.value ?? "?";
    const name = node.name?.value ?? "(unnamed)";
    const value = node.value?.value ? ` = "${String(node.value.value).slice(0, 30)}"` : "";
    const bid = node.backendDOMNodeId ? ` [nodeId: ${node.backendDOMNodeId}]` : " [NO nodeId]";
    console.log(`    ${role.padEnd(15)} "${name}"${value}${bid}`);
  }

  // Test backendDOMNodeId resolution (using first frame's CDP session)
  console.log("\n  Testing backendDOMNodeId resolution...");
  const testNodes = withBackendId.slice(0, 5);
  for (const node of testNodes) {
    let resolved = false;
    for (const frame of page.frames()) {
      try {
        const testCdp = await page.context().newCDPSession(frame);
        await testCdp.send("DOM.enable" as any);
        const result = await testCdp.send("DOM.resolveNode" as any, {
          backendNodeId: node.backendDOMNodeId,
        });
        const objectId = (result as any).object?.objectId;
        if (objectId) {
          const role = node.role?.value ?? "?";
          const name = node.name?.value ?? "(unnamed)";
          console.log(`    OK ${role} "${name}"`);
          resolved = true;
          break;
        }
      } catch {
        // Try next frame
      }
    }
    if (!resolved) {
      const role = node.role?.value ?? "?";
      const name = node.name?.value ?? "(unnamed)";
      console.log(`    FAIL ${role} "${name}"`);
    }
  }

  // Estimated model size
  const sampleModel = nonIgnored.slice(0, 100).map((n: AXNode) => ({
    role: n.role?.value,
    name: n.name?.value,
    nodeId: n.backendDOMNodeId,
  }));
  const estimatedSize = JSON.stringify(sampleModel).length * (nonIgnored.length / Math.min(100, nonIgnored.length));
  console.log(`\n  Estimated model JSON size: ~${Math.round(estimatedSize / 1024)}KB`);

  const nameRatio = interactive.length > 0 ? named.length / interactive.length : 0;
  return { nameRatio, interactive: interactive.length, named: named.length, extractionTime, totalNodes };
}

async function main() {
  console.log(`\nLaunching browser and navigating to ${INSTANCE_URL}...\n`);

  const browser = await chromium.launch({
    headless: false,
    args: ["--window-size=1400,900"],
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  // Login
  await login(page);

  const results: Array<{ label: string; nameRatio: number; extractionTime: number }> = [];

  // ── Test 1: Home page (post-login) ──
  console.log("Waiting for home page to settle...");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);
  const r1 = await analyzeAxTree(page, "Home Page");
  results.push({ label: "Home Page", nameRatio: r1.nameRatio, extractionTime: r1.extractionTime });

  // ── Test 2: Incident form — direct URL (no iframe wrapper) ──
  console.log("\n\nNavigating to Incident form (direct URL)...");
  await page.goto(`${INSTANCE_URL}/incident.do?sys_id=-1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(5000);
  const r2 = await analyzeAxTree(page, "Incident Form (Direct)");
  results.push({ label: "Incident Form (Direct)", nameRatio: r2.nameRatio, extractionTime: r2.extractionTime });

  // ── Test 3: Incident list — direct URL ──
  console.log("\n\nNavigating to Incident list (direct URL)...");
  await page.goto(`${INSTANCE_URL}/incident_list.do`, { waitUntil: "networkidle" });
  await page.waitForTimeout(5000);
  const r3 = await analyzeAxTree(page, "Incident List (Direct)");
  results.push({ label: "Incident List (Direct)", nameRatio: r3.nameRatio, extractionTime: r3.extractionTime });

  // ── Test 4: Workspace Incident form (Polaris, no iframe) ──
  console.log("\n\nNavigating to Workspace Incident form...");
  await page.goto(`${INSTANCE_URL}/now/workspace/agent/record/incident`, { waitUntil: "networkidle" });
  await page.waitForTimeout(8000);
  const r4 = await analyzeAxTree(page, "Workspace Incident Form");
  results.push({ label: "Workspace Form", nameRatio: r4.nameRatio, extractionTime: r4.extractionTime });

  // ── Test 5: Flow Designer ──
  console.log("\n\nNavigating to Flow Designer...");
  await page.goto(`${INSTANCE_URL}/now/flow-designer`, { waitUntil: "networkidle" });
  await page.waitForTimeout(8000);
  const r5 = await analyzeAxTree(page, "Flow Designer");
  results.push({ label: "Flow Designer", nameRatio: r5.nameRatio, extractionTime: r5.extractionTime });

  // ── Final Summary ──
  console.log(`\n\n${"═".repeat(60)}`);
  console.log("  FINAL SUMMARY — GO / NO-GO");
  console.log("═".repeat(60));

  for (const r of results) {
    const status = r.nameRatio >= 0.7 ? "GO" : r.nameRatio >= 0.3 ? "PARTIAL" : "NO-GO";
    const icon = r.nameRatio >= 0.7 ? "OK" : r.nameRatio >= 0.3 ? "WARN" : "FAIL";
    console.log(`  [${icon}] ${r.label.padEnd(20)} ${pct2(r.nameRatio)} named | ${r.extractionTime}ms`);
  }

  const avgRatio = results.reduce((sum, r) => sum + r.nameRatio, 0) / results.length;
  console.log(`\n  Overall: ${pct2(avgRatio)} average naming ratio`);

  if (avgRatio >= 0.7) {
    console.log("  >>> GO — AX tree is sufficient as primary extraction signal.");
  } else if (avgRatio >= 0.3) {
    console.log("  >>> PARTIAL — Proceed with AX tree, plan supplementary DOM injection for gaps.");
  } else {
    console.log("  >>> NO-GO — Pivot to DOM injection as primary approach.");
  }
  console.log("═".repeat(60) + "\n");

  await browser.close();
}

function pct(a: number, b: number): string {
  if (b === 0) return "0%";
  return `${Math.round((a / b) * 100)}%`;
}

function pct2(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

main().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});
