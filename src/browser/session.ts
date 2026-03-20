import type { Page } from "playwright";
import type { PageState, PageStatus } from "../types.js";

/**
 * Session monitor — tracks page state and detects session expiry / crashes.
 */
export class SessionMonitor {
  private page: Page;
  private crashed = false;

  constructor(page: Page) {
    this.page = page;
    this.page.on("crash", () => {
      this.crashed = true;
    });
  }

  async getStatus(): Promise<PageStatus> {
    const state = await this.getState();
    let url = "";
    let title = "";
    try {
      url = this.page.url();
      title = await this.page.title();
    } catch {
      // page may be crashed or disconnected
    }
    return { state, url, title };
  }

  private async getState(): Promise<PageState> {
    if (this.crashed) return "crashed";

    try {
      // Check if page is still connected
      this.page.url();
    } catch {
      return "disconnected";
    }

    const url = this.page.url();

    // Session expired — redirected to login
    if (url.includes("/login.do") || url.includes("/login_redirect.do")) {
      return "session_expired";
    }

    // Check for open dialogs by looking for common modal patterns
    try {
      const hasDialog = await this.page.evaluate(() => {
        const dialog = document.querySelector("[role='dialog']");
        return dialog !== null && (dialog as HTMLElement).offsetParent !== null;
      });
      if (hasDialog) return "dialog_open";
    } catch {
      return "disconnected";
    }

    // Check loading state
    try {
      const loading = await this.page.evaluate(() => document.readyState !== "complete");
      if (loading) return "loading";
    } catch {
      return "disconnected";
    }

    return "idle";
  }
}
