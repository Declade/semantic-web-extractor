import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export interface BrowserConnection {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export interface ConnectionConfig {
  instanceUrl: string;
  username: string;
  password: string;
  headless?: boolean;
  viewport?: { width: number; height: number };
}

/**
 * Launch Playwright Chromium and auto-login to ServiceNow.
 * Returns { browser, context, page } ready for extraction.
 */
export async function connect(config: ConnectionConfig): Promise<BrowserConnection> {
  const {
    instanceUrl,
    username,
    password,
    headless = false,
    viewport = { width: 1400, height: 900 },
  } = config;

  const browser = await chromium.launch({
    headless,
    args: [`--window-size=${viewport.width},${viewport.height}`],
  });

  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  await login(page, instanceUrl, username, password);

  return { browser, context, page };
}

async function login(page: Page, instanceUrl: string, username: string, password: string): Promise<void> {
  await page.goto(`${instanceUrl}/login.do`, { waitUntil: "networkidle" });

  // Already logged in (redirected away from login page)
  if (!page.url().includes("login")) return;

  await page.fill("#user_name", username);
  await page.fill("#user_password", password);
  await page.click("#sysverb_login");
  await page.waitForLoadState("networkidle");
}

/**
 * Close the browser and all associated resources.
 */
export async function disconnect(conn: BrowserConnection): Promise<void> {
  await conn.browser.close();
}
