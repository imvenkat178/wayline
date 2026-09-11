import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { definitions } from "./schemas.mjs";
import { runTravelTool } from "./providers.mjs";
const server = new McpServer({ name: "wayline-travel", version: "1.0.0" });
for (const [name, definition] of Object.entries(definitions))
  server.registerTool(
    name,
    {
      description: definition.description,
      inputSchema: definition.input.shape,
      outputSchema: definition.output.shape,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args) => {
      try {
        const result = definition.output.parse(
          await runTravelTool(name, definition.input.parse(args)),
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (e) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: e.name === "ZodError" ? "Travel provider returned invalid data." : e.message,
                code: e.code ?? "TRAVEL_ERROR",
              }),
            },
          ],
        };
      }
    },
  );
await server.connect(new StdioServerTransport());
