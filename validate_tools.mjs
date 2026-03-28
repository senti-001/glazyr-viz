import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js", "--stdio"],
});

const client = new Client({ name: "validator", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`\n✅ MCP Server Connected. Found ${tools.length} tools:\n`);
for (const tool of tools) {
    const params = tool.inputSchema?.properties
        ? Object.keys(tool.inputSchema.properties).join(", ")
        : "none";
    console.log(`  🔧 ${tool.name} (params: ${params})`);
}

// Quick smoke test: call peek_vision_buffer (safe, no side effects)
console.log("\n--- Smoke Test: peek_vision_buffer ---");
try {
    const result = await client.callTool({ name: "peek_vision_buffer", arguments: { include_base64: false } });
    console.log("  Result:", JSON.stringify(result.content, null, 2));
} catch (e) {
    console.log("  Error (expected if no backend/SHM):", e.message);
}

console.log("\n🏁 Validation complete.");
await client.close();
process.exit(0);
