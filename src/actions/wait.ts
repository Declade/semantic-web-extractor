import type { Page } from "playwright";

/**
 * Wait for DOM to settle — no mutations for `quietMs` milliseconds.
 * Returns true if settled, false if timed out.
 */
export async function waitForDomSettle(
  page: Page,
  quietMs = 150,
  timeoutMs = 5000,
): Promise<boolean> {
  return page.evaluate(
    ([quiet, timeout]) => {
      return new Promise<boolean>((resolve) => {
        let timer: ReturnType<typeof setTimeout>;
        const deadline = setTimeout(() => {
          observer.disconnect();
          resolve(false);
        }, timeout);

        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            observer.disconnect();
            clearTimeout(deadline);
            resolve(true);
          }, quiet);
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });

        // Start the quiet timer immediately — if nothing mutates, settle fast
        timer = setTimeout(() => {
          observer.disconnect();
          clearTimeout(deadline);
          resolve(true);
        }, quiet);
      });
    },
    [quietMs, timeoutMs] as const,
  );
}
