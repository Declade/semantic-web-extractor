/**
 * Smoke test: Launch browser, login, extract Workflow Studio, print model.
 */
import { connect, disconnect } from "../src/browser/connection.js";
import { extract } from "../src/engine/extractor.js";
import { buildModelAsync } from "../src/engine/model-builder.js";
import { pruneTree, countNodes } from "../src/engine/pruner.js";
import { SessionMonitor } from "../src/browser/session.js";

const INSTANCE_URL = "https://dev205951.service-now.com";

async function main() {
  console.log("Connecting...");
  const conn = await connect({
    instanceUrl: INSTANCE_URL,
    username: "admin",
    password: "Ym*+ZTHx18vf",
  });

  const session = new SessionMonitor(conn.page);
  const status = await session.getStatus();
  console.log("Status:", status);

  // ── Test 1: Workflow Studio Home ──
  console.log("\n═══ Test 1: Workflow Studio Home ═══");
  await conn.page.goto(`${INSTANCE_URL}/$flow-designer.do`, { waitUntil: "networkidle" });
  await conn.page.waitForTimeout(8000);

  const r1 = await extract(conn.page);
  const m1 = await buildModelAsync(conn.page, r1);
  console.log(`Paths: ${r1.paths.join(", ")}`);
  console.log(`Nodes: ${m1.nodeCount} | App: ${m1.page.app} | URL: ${m1.page.url}`);
  console.log(`Title: ${m1.page.title}`);

  // Print interactive elements summary
  const interactive1 = collectInteractive(m1.root);
  console.log(`Interactive elements: ${interactive1.length}`);
  for (const n of interactive1.slice(0, 20)) {
    console.log(`  ${n.role.padEnd(15)} "${n.name.slice(0, 60)}"`);
  }

  // ── Test 2: Open a flow (Flow Editor with iframe) ──
  console.log("\n═══ Test 2: Flow Editor (iframe) ═══");
  const flowButton = conn.page.getByRole("button", { name: /Click to open the flow/ }).first();
  try {
    await flowButton.click({ force: true });
    await conn.page.waitForTimeout(12000);

    const r2 = await extract(conn.page);
    const m2 = await buildModelAsync(conn.page, r2);
    console.log(`Paths: ${r2.paths.join(", ")}`);
    console.log(`Nodes: ${m2.nodeCount} | App: ${m2.page.app}`);
    console.log(`Title: ${m2.page.title}`);

    if (r2.iframe) {
      console.log(`Iframe nodes: ${r2.iframe.nodeCount} (frame ${r2.iframe.frameIndex})`);
    }

    const interactive2 = collectInteractive(m2.root);
    console.log(`Interactive elements: ${interactive2.length}`);
    for (const n of interactive2.slice(0, 25)) {
      const val = n.value ? ` = "${n.value.slice(0, 30)}"` : "";
      console.log(`  ${n.role.padEnd(15)} "${n.name.slice(0, 60)}"${val}`);
    }
  } catch (e: any) {
    console.log("Could not open flow:", e.message.slice(0, 100));
  }

  // ── Test 3: Scoped extraction ──
  console.log("\n═══ Test 3: Scoped extraction ═══");
  const r3 = await extract(conn.page);
  const m3 = await buildModelAsync(conn.page, r3);
  const pruned = pruneTree(m3.root, { scope: { role: "region", name: "iframe" }, maxDepth: 5 });
  const prunedCount = countNodes(pruned);
  console.log(`Full tree: ${m3.nodeCount} nodes → Scoped: ${prunedCount} nodes`);

  // ── Test 4: Page status ──
  console.log("\n═══ Test 4: Page Status ═══");
  const finalStatus = await session.getStatus();
  console.log("Status:", JSON.stringify(finalStatus));

  console.log("\n✓ All smoke tests passed.");
  await disconnect(conn);
}

import type { SemanticNode } from "../src/types.js";

function collectInteractive(node: SemanticNode): SemanticNode[] {
  const roles = new Set([
    "button", "textbox", "combobox", "checkbox", "radio",
    "link", "menuitem", "tab", "treeitem", "searchbox",
    "switch", "option", "listbox",
  ]);
  const result: SemanticNode[] = [];
  function walk(n: SemanticNode) {
    if (roles.has(n.role) && n.name) result.push(n);
    if (n.children) n.children.forEach(walk);
  }
  walk(node);
  return result;
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
