import type { Page } from "playwright";
import type {
  SemanticModel,
  ActionRequest,
  ActionResult,
  ExtractionOptions,
  PageStatus,
  ToolResponse,
} from "../types.js";
import { extract } from "../engine/extractor.js";
import { buildModelAsync } from "../engine/model-builder.js";
import { pruneTree, countNodes } from "../engine/pruner.js";
import { executeAction } from "../actions/executor.js";
import { SessionMonitor } from "../browser/session.js";

/**
 * Tool handler implementations — wired into the MCP server.
 */
export function createToolHandlers(page: Page, sessionMonitor: SessionMonitor) {
  return {
    page_extract: async (params: {
      scope?: { role: string; name: string };
      maxDepth?: number;
    }): Promise<ToolResponse<SemanticModel>> => {
      try {
        const result = await extract(page);
        const model = await buildModelAsync(page, result);

        const options: ExtractionOptions = {};
        if (params.scope) options.scope = params.scope;
        if (params.maxDepth) options.maxDepth = params.maxDepth;

        if (options.scope || options.maxDepth) {
          model.root = pruneTree(model.root, options);
          model.nodeCount = countNodes(model.root);
          model.warning = "scoped";
        }

        return { success: true, data: model };
      } catch (e: any) {
        return {
          success: false,
          error: {
            code: "extraction_timeout",
            message: e.message ?? "Extraction failed",
            recoverable: true,
          },
        };
      }
    },

    page_action: async (params: {
      action: ActionRequest["action"];
      target: ActionRequest["target"];
      value?: string;
    }): Promise<ToolResponse<ActionResult>> => {
      try {
        const result = await executeAction(page, {
          action: params.action,
          target: params.target,
          value: params.value,
        });
        return { success: true, data: result };
      } catch (e: any) {
        return {
          success: false,
          error: {
            code: e.code ?? "action_timeout",
            message: e.message ?? "Action failed",
            recoverable: e.recoverable ?? true,
          },
        };
      }
    },

    page_navigate: async (params: {
      url: string;
    }): Promise<ToolResponse<SemanticModel>> => {
      try {
        await page.goto(params.url, { waitUntil: "networkidle", timeout: 30000 });
        // Wait for SPA rendering
        await page.waitForTimeout(3000);

        const result = await extract(page);
        const model = await buildModelAsync(page, result);
        return { success: true, data: model };
      } catch (e: any) {
        return {
          success: false,
          error: {
            code: "connection_failed",
            message: e.message ?? "Navigation failed",
            recoverable: true,
          },
        };
      }
    },

    page_status: async (): Promise<ToolResponse<PageStatus>> => {
      try {
        const status = await sessionMonitor.getStatus();
        return { success: true, data: status };
      } catch (e: any) {
        return {
          success: false,
          error: {
            code: "connection_failed",
            message: e.message ?? "Status check failed",
            recoverable: false,
          },
        };
      }
    },
  };
}
