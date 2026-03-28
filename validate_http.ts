import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const BACKEND = process.env.BACKEND_URL || "https://mcp.glazyr.com";

console.log(`\n🌐 Connecting to GCP Perception Node MCP at: ${BACKEND}/mcp/sse\n`);

try {
    const transport = new SSEClientTransport(new URL(`${BACKEND}/mcp/sse`));
    const client = new Client({ name: "http-validator", version: "1.0.0" });

    await client.connect(transport);
    console.log("✅ SSE Transport connected!\n");

    const { tools } = await client.listTools();
    console.log(`Found ${tools.length} tools on remote GCP Perception Node:\n`);
    for (const tool of tools) {
        const params = tool.inputSchema?.properties
            ? Object.keys(tool.inputSchema.properties).join(", ")
            : "none";
        console.log(`  🔧 ${tool.name} (params: ${params})`);
    }

    // Smoke test: peek_vision_buffer via remote
    console.log("\n--- Smoke Test: peek_vision_buffer (remote) ---");
    try {
        const result = await client.callTool({ name: "peek_vision_buffer", arguments: { include_base64: false } });
        for (const item of result.content as any[]) {
            if (item.type === "text") {
                const parsed = JSON.parse(item.text);
                console.log("  Status:", parsed.status);
                console.log("  Source:", parsed.source);
                if (parsed.active_sessions !== undefined) console.log("  Active Sessions:", parsed.active_sessions);
                if (parsed.latest_seq !== undefined) console.log("  Latest Seq:", parsed.latest_seq);
            }
        }
    } catch (e: any) {
        console.log("  Error:", e.message);
    }

    console.log("\n🏁 HTTP MCP Validation complete.");
    await client.close();
    process.exit(0);
} catch (e: any) {
    console.error("❌ Connection failed:", e.message);
    process.exit(1);
}
