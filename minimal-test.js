#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "minimal-test", version: "1.0.0" });

const TestSchema = z.object({
  text: z.string(),
  number: z.number().optional().default(42)
});

server.registerTool("test_tool", {
  description: "A simple test tool",
  inputSchema: {
    text: z.string(),
    number: z.number().optional().default(42)
  }
}, async ({ text, number }) => {
  console.error("test_tool DEBUG - text:", text);
  console.error("test_tool DEBUG - number:", number);
  
  return {
    content: [{
      type: "text",
      text: `Hello! You said: ${text} and number: ${number}`
    }]
  };
});

console.error("About to connect server...");
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Minimal test server connected and running...");