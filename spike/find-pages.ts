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

async function tryUrl(page: Page, label: string, path: string) {
  const url = INSTANCE_URL + path;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(3000);
    const title = await page.title();
    const snapshot = await page.locator("body").ariaSnapshot().catch(() => "FAILED");
    const lines = snapshot.split("\n").length;
    const has404 = snapshot.includes("nicht gefunden") || snapshot.includes("not found");
    const status = has404 ? "404" : "OK";
    console.log("[" + status + "] " + label);
    console.log("  URL: " + page.url());
    console.log("  Title: " + title);
    console.log("  Snapshot lines: " + lines);
    if (status === "OK" && lines > 5) {
      const snapshotLines = snapshot.split("\n").slice(0, 15);
      for (const line of snapshotLines) {
        console.log("    " + line);
      }
    }
    console.log("");
    return status === "OK";
  } catch (e: any) {
    console.log("[ERR] " + label + " → " + e.message.slice(0, 80));
    return false;
  }
}

async function main() {
  const browser = await chromium.launch({ headless: false, args: ["--window-size=1400,900"] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  await login(page);

  // Try various Next Experience / Workspace URLs
  const urls = [
    ["Flow Designer (now)", "/now/flow-designer"],
    ["Flow Designer (classic)", "/nav_to.do?uri=/$flow-designer.do"],
    ["Workspace Agent", "/now/workspace/agent"],
    ["Workspace CSM", "/now/csm/home"],
    ["Workspace ITSM", "/now/sow/home"],
    ["Workspace IRM", "/now/irm/home"],
    ["Next Experience Home", "/now/nav/ui/home"],
    ["Next Experience Classic", "/now/nav/ui/classic/params/target/incident_list.do"],
    ["UI Builder", "/now/ui-builder"],
    ["App Engine Studio", "/now/app-engine-studio"],
    ["Service Catalog", "/now/nav/ui/classic/params/target/catalog_home.do"],
    ["Process Automation", "/now/process-automation-designer"],
    ["Admin Center", "/now/admin-center"],
  ];

  for (const [label, path] of urls) {
    await tryUrl(page, label, path);
  }

  await browser.close();
}

main().catch(e => { console.error(e.message); process.exit(1); });
