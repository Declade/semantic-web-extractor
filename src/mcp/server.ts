import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { Page } from "playwright";
import { SessionMonitor } from "../browser/session.js";
import { createToolHandlers } from "./tools.js";

/**
 * Create and start the MCP server with all 4 core tools.
 */
export async function createMCPServer(page: Page): Promise<McpServer> {
  const sessionMonitor = new SessionMonitor(page);
  const handlers = createToolHandlers(page, sessionMonitor);

  const server = new McpServer({
    name: "semantic-web-extractor",
    version: "0.1.0",
  });

  // ── page_extract ─────────────────────────────────────────────
  server.tool(
    "page_extract",
    "Extract semantic model of the current page. Returns structured accessibility tree with interactive elements, their roles, names, and states. Use optional scope to extract only a subtree.",
    {
      scope: z.object({
        role: z.string().describe("ARIA role to match (e.g. 'region', 'navigation')"),
        name: z.string().describe("Accessible name to match (substring, case-insensitive)"),
      }).optional().describe("Scope extraction to a subtree matching this role+name"),
      maxDepth: z.number().optional().describe("Max tree depth (default 15)"),
    },
    async ({ scope, maxDepth }) => {
      const result = await handlers.page_extract({ scope, maxDepth });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // ── page_action ──────────────────────────────────────────────
  server.tool(
    "page_action",
    "Perform an action on a page element. Target by nodeId (from CDP extraction) or by role+name (from ariaSnapshot extraction). Returns updated semantic model after action.",
    {
      action: z.enum(["click", "type", "select", "clear", "press_key"])
        .describe("Action to perform"),
      target: z.union([
        z.object({ nodeId: z.number().describe("Backend DOM node ID from extraction") }),
        z.object({
          role: z.string().describe("ARIA role of the target element"),
          name: z.string().describe("Accessible name of the target element"),
          frameIndex: z.number().optional().describe("Frame index for iframe targets"),
        }),
      ]).describe("Target element — by nodeId or by role+name"),
      value: z.string().optional()
        .describe("Value for type/select/press_key actions"),
    },
    async ({ action, target, value }) => {
      const result = await handlers.page_action({ action, target, value });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // ── page_navigate ────────────────────────────────────────────
  server.tool(
    "page_navigate",
    "Navigate to a URL. Waits for page load and returns the semantic model of the new page.",
    {
      url: z.string().describe("Full URL to navigate to"),
    },
    async ({ url }) => {
      const result = await handlers.page_navigate({ url });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // ── page_status ──────────────────────────────────────────────
  server.tool(
    "page_status",
    "Get current page state: idle, loading, dialog_open, session_expired, crashed, or disconnected. Also returns URL and title.",
    {},
    async () => {
      const result = await handlers.page_status();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  return server;
}

/**
 * Start the MCP server on stdio transport.
 */
export async function startServer(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
