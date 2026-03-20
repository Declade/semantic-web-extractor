/**
 * Phase 0 Spike: Validate AX tree quality on ServiceNow
 *
 * Prerequisites:
 *   1. Launch Chrome with remote debugging:
 *      /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
 *   2. Log into your ServiceNow PDI manually
 *   3. Run: npm run spike
 *
 * This script connects to your Chrome session, extracts the AX tree,
 * and evaluates whether it's sufficient for AI-driven automation.
 */

import { chromium } from "playwright";

const CDP_ENDPOINT = process.env.SWE_CDP_ENDPOINT ?? "http://localhost:9222";

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

async function main() {
  console.log(`\n🔗 Connecting to Chrome at ${CDP_ENDPOINT}...\n`);

  const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    console.error("No browser contexts found. Is Chrome running with a page open?");
    process.exit(1);
  }

  const pages = contexts[0].pages();
  if (pages.length === 0) {
    console.error("No pages found. Open a ServiceNow page in Chrome first.");
    process.exit(1);
  }

  // Use the first page, or find the ServiceNow tab
  const page = pages.find(p => p.url().includes("service-now.com")) ?? pages[0];
  console.log(`📄 Using page: ${page.url()}\n`);

  // Create CDP session
  const cdpSession = await page.context().newCDPSession(page);

  // Enable required domains
  await cdpSession.send("Accessibility.enable" as any);
  await cdpSession.send("DOM.enable" as any);

  // Extract full AX tree
  console.log("🌳 Extracting accessibility tree...\n");
  const startTime = Date.now();
  const result = await cdpSession.send("Accessibility.getFullAXTree" as any) as { nodes: AXNode[] };
  const extractionTime = Date.now() - startTime;

  const nodes = result.nodes;

  // Analyze the tree
  const totalNodes = nodes.length;
  const nonIgnored = nodes.filter(n => !n.ignored);
  const interactive = nonIgnored.filter(n => {
    const role = n.role?.value;
    return [
      "button", "textbox", "combobox", "checkbox", "radio",
      "link", "menuitem", "tab", "treeitem", "searchbox",
      "spinbutton", "slider", "switch", "option", "listbox",
    ].includes(role);
  });
  const named = interactive.filter(n => n.name?.value && n.name.value.trim().length > 0);
  const withBackendId = interactive.filter(n => n.backendDOMNodeId !== undefined);

  console.log("═══════════════════════════════════════════════");
  console.log("  AX TREE ANALYSIS RESULTS");
  console.log("═══════════════════════════════════════════════");
  console.log(`  Extraction time:      ${extractionTime}ms`);
  console.log(`  Total AX nodes:       ${totalNodes}`);
  console.log(`  Non-ignored nodes:    ${nonIgnored.length}`);
  console.log(`  Interactive elements:  ${interactive.length}`);
  console.log(`  Named (have label):   ${named.length} (${pct(named.length, interactive.length)})`);
  console.log(`  Have backendNodeId:   ${withBackendId.length} (${pct(withBackendId.length, interactive.length)})`);
  console.log("═══════════════════════════════════════════════\n");

  // Show role distribution
  const roleCounts = new Map<string, number>();
  for (const node of nonIgnored) {
    const role = node.role?.value ?? "unknown";
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
  }
  console.log("Role distribution (top 20):");
  const sorted = [...roleCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  for (const [role, count] of sorted) {
    console.log(`  ${role.padEnd(20)} ${count}`);
  }

  // Show sample interactive elements
  console.log("\n\nSample interactive elements (first 15):");
  console.log("─".repeat(80));
  for (const node of interactive.slice(0, 15)) {
    const role = node.role?.value ?? "?";
    const name = node.name?.value ?? "(unnamed)";
    const value = node.value?.value ? ` = "${node.value.value}"` : "";
    const bid = node.backendDOMNodeId ? ` [nodeId: ${node.backendDOMNodeId}]` : " [NO nodeId]";
    console.log(`  ${role.padEnd(12)} "${name}"${value}${bid}`);
  }

  // Test backendDOMNodeId resolution
  console.log("\n\n🔍 Testing backendDOMNodeId resolution...\n");
  const testNodes = withBackendId.slice(0, 5);
  for (const node of testNodes) {
    try {
      const resolved = await cdpSession.send("DOM.resolveNode" as any, {
        backendNodeId: node.backendDOMNodeId,
      });
      const objectId = (resolved as any).object?.objectId;
      const role = node.role?.value ?? "?";
      const name = node.name?.value ?? "(unnamed)";
      console.log(`  ✅ ${role} "${name}" → objectId: ${objectId ? "resolved" : "FAILED"}`);
    } catch (e: any) {
      const role = node.role?.value ?? "?";
      const name = node.name?.value ?? "(unnamed)";
      console.log(`  ❌ ${role} "${name}" → Error: ${e.message}`);
    }
  }

  // Go/No-Go assessment
  const nameRatio = interactive.length > 0 ? named.length / interactive.length : 0;
  console.log("\n\n═══════════════════════════════════════════════");
  console.log("  GO / NO-GO ASSESSMENT");
  console.log("═══════════════════════════════════════════════");
  if (nameRatio >= 0.7) {
    console.log(`  ✅ GO — ${pct(named.length, interactive.length)} of interactive elements have names`);
    console.log("  The AX tree is sufficient as the primary extraction signal.");
  } else if (nameRatio >= 0.3) {
    console.log(`  ⚠️  PARTIAL — ${pct(named.length, interactive.length)} of interactive elements have names`);
    console.log("  Proceed with AX tree but plan supplementary DOM injection for gaps.");
  } else {
    console.log(`  ❌ NO-GO — Only ${pct(named.length, interactive.length)} of interactive elements have names`);
    console.log("  Pivot to DOM injection as the primary extraction approach.");
  }
  console.log("═══════════════════════════════════════════════\n");

  // Estimate JSON model size
  const sampleModel = nonIgnored.slice(0, 100).map(n => ({
    role: n.role?.value,
    name: n.name?.value,
    nodeId: n.backendDOMNodeId,
  }));
  const estimatedSize = JSON.stringify(sampleModel).length * (nonIgnored.length / 100);
  console.log(`Estimated full model JSON size: ~${Math.round(estimatedSize / 1024)}KB\n`);

  await cdpSession.detach();
  await browser.close();
}

function pct(a: number, b: number): string {
  if (b === 0) return "0%";
  return `${Math.round((a / b) * 100)}%`;
}

main().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});
