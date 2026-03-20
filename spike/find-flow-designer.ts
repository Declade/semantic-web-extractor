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

  // Go to the home page with navigation
  console.log("On home page. Using search to find Flow Designer...\n");
  await page.waitForTimeout(3000);

  // Use the application navigator search to find Flow Designer
  // Type in the search/filter navigator
  const searchBox = page.locator('input[placeholder*="ilter"], input[aria-label*="uchen"], input[aria-label*="earch"], input[aria-label*="Filter"]').first();

  // Try the combobox search
  console.log("Trying global search for 'Flow Designer'...");
  const globalSearch = page.getByRole("combobox", { name: "Suchen" }).first();
  await globalSearch.click();
  await globalSearch.fill("Flow Designer");
  await page.waitForTimeout(3000);

  // Take a screenshot to see what's on screen
  await page.screenshot({ path: "/Users/marcschuelke/semantic-web-extractor/spike/search-result.png" });
  console.log("Screenshot saved to spike/search-result.png");

  // Get the snapshot to see search results
  const snapshot = await page.locator("body").ariaSnapshot();
  const lines = snapshot.split("\n");
  console.log("\nSearch results ariaSnapshot (" + lines.length + " lines):");
  for (const line of lines) {
    if (line.toLowerCase().includes("flow") || line.toLowerCase().includes("designer") || line.includes("link") || line.includes("menuitem")) {
      console.log("  " + line);
    }
  }

  // Also try various URL patterns
  console.log("\n\nTrying URL patterns...");
  const urls = [
    "/now/flow-designer",
    "/$flow-designer.do",
    "/now/nav/ui/classic/params/target/%24flow-designer.do",
    "/nav_to.do?uri=%24flow-designer.do",
    "/now/flow/home",
    "/$flow.do",
  ];

  for (const path of urls) {
    await page.goto(INSTANCE_URL + path, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const url = page.url();
    const title = await page.title();
    const snap = await page.locator("body").ariaSnapshot().catch(() => "FAILED");
    const has404 = snap.includes("nicht gefunden") || snap.includes("not found");
    console.log((has404 ? "[404]" : "[OK ]") + " " + path);
    console.log("  → " + url);
    console.log("  → " + title);
    if (!has404) {
      const snapLines = snap.split("\n");
      console.log("  → " + snapLines.length + " snapshot lines");
      for (const line of snapLines.slice(0, 10)) {
        console.log("    " + line);
      }
    }
  }

  await browser.close();
}

main().catch(e => { console.error(e.message); process.exit(1); });
