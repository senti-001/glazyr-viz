import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
const server = new McpServer({ name: "test", version: "1.0.0" });
console.log("Methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(server)));
console.log("Server instance methods:", Object.getOwnPropertyNames(Object.getPrototypeOf((server as any).server)));
