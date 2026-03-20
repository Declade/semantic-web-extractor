import { connect, disconnect, type ConnectionConfig } from "./browser/connection.js";
import { createMCPServer, startServer } from "./mcp/server.js";

function getConfig(): ConnectionConfig {
  const instanceUrl = process.env.SWE_INSTANCE_URL;
  const username = process.env.SN_USERNAME;
  const password = process.env.SN_PASSWORD;

  if (!instanceUrl || !username || !password) {
    console.error(
      "Missing required environment variables:\n" +
      "  SWE_INSTANCE_URL  — ServiceNow instance URL (e.g. https://dev205951.service-now.com)\n" +
      "  SN_USERNAME       — ServiceNow username\n" +
      "  SN_PASSWORD       — ServiceNow password\n",
    );
    process.exit(1);
  }

  return {
    instanceUrl,
    username,
    password,
    headless: process.env.SWE_HEADLESS === "true",
  };
}

async function main() {
  const config = getConfig();

  console.error(`[swe] Connecting to ${config.instanceUrl}...`);
  const conn = await connect(config);
  console.error("[swe] Browser connected and logged in.");

  const server = await createMCPServer(conn.page);
  console.error("[swe] MCP server created. Starting on stdio...");

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.error("[swe] Shutting down...");
    await disconnect(conn);
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.error("[swe] Shutting down...");
    await disconnect(conn);
    process.exit(0);
  });

  await startServer(server);
}

main().catch((err) => {
  console.error("[swe] Fatal error:", err.message);
  process.exit(1);
});
