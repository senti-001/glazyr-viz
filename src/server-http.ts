import express from "express";
import cors from "cors";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer } from "./index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";

const app = express();
app.use(cors());
app.use(express.json());

class StatelessTransport implements Transport {
    private responseResolver?: (msg: JSONRPCMessage) => void;
    onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;
    onclose?: () => void;
    onerror?: (error: Error) => void;

    async start() { }
    async close() { }
    async send(message: JSONRPCMessage): Promise<void> {
        this.responseResolver?.(message);
    }

    async handle(message: JSONRPCMessage): Promise<JSONRPCMessage | undefined> {
        if (!this.onmessage) return undefined;
        const isNotification = !("id" in message);
        if (isNotification) {
            this.onmessage(message);
            return undefined;
        }
        return new Promise((resolve) => {
            this.responseResolver = resolve;
            this.onmessage!(message);
            setTimeout(() => resolve({
                jsonrpc: "2.0",
                id: (message as any).id,
                error: { code: -32000, message: "Stateless response timeout" }
            } as any), 30000);
        });
    }
}

const statelessSessions = new Map<string, { server: McpServer, transport: StatelessTransport }>();

// Smithery server-card: allows discovery without MCP scanning
app.get("/.well-known/mcp/server-card.json", (_req, res) => {
    res.json({
        name: "Glazyr Viz",
        description: "Zero-Copy MCP Vision Server — sub-8ms browser perception for AI agents.",
        version: "1.0.0",
        transport: { type: "sse", url: "https://mcp.glazyr.com/mcp/sse" },
        homepage: "https://glazyr.com",
        configSchema: {
            type: "object",
            properties: {
                GCP_REDIS_HOST: { type: "string", description: "Host IP of the GCP Redis telemetry node.", default: "127.0.0.1" },
                GCP_REDIS_PORT: { type: "number", description: "Port of the GCP Redis telemetry node.", default: 6379 }
            }
        },
        tools: [
            { name: "get_optic_nerve_status", description: "Returns real-time FPS, latency, and Aquarium population telemetry." },
            { name: "navigate", description: "Navigate the agent browser to a specified URL." },
            { name: "set_fish_count", description: "Set the aquarium fish count (0-30,000) on the GCP GCP Perception Node." },
            { name: "peek_vision_buffer", description: "Direct low-latency peek at the raw compositor vision stream." },
            { name: "evaluate_js", description: "Evaluate arbitrary JavaScript in the remote browser context." },
            { name: "run_dogfood_surge", description: "Execute the integrated 'Killer Demo' dogfood surge sequence." },
            { name: "verify_payment", description: "Verify a USDC payout on Base and top up session credits." },
            { name: "get_remaining_credits", description: "Retrieve the vision credit balance for the current session." }
        ],
        prompts: [
            { name: "vision-auditor", description: "Instruct the agent to perform a comprehensive visual health check." }
        ]
    });
});

const transports = new Map<string, { transport: SSEServerTransport, ip: string, created: number }>();

app.get("/mcp/sse", async (req, res) => {
    const ip = req.headers["x-real-ip"] as string || req.ip || "unknown";
    const ua = req.headers["user-agent"] || "unknown";

    // Extract Bearer token from Authorization header or Query Param (fallback)
    const authHeader = req.headers["authorization"];
    const token = authHeader?.startsWith("Bearer ")
        ? authHeader.substring(7)
        : (req.query.token as string);

    console.error(`[*] New SSE connection: ${ip} | Token: ${token ? 'PRESENT' : 'MISSING'} | UA: ${ua}`);

    const transport = new SSEServerTransport("/mcp/messages", res);

    if (transport.sessionId) {
        transports.set(transport.sessionId, { transport, ip, created: Date.now() });
        console.error(`[*] SSE session registered: ${transport.sessionId} (IP: ${ip}). Pool: ${transports.size}`);

        res.on("close", () => {
            console.error(`[!] SSE connection closed by client: ${transport.sessionId}. Grace period started (60s).`);
            setTimeout(() => {
                if (transports.has(transport.sessionId!)) {
                    console.error(`[!] SSE session expired: ${transport.sessionId}`);
                    transports.delete(transport.sessionId!);
                }
            }, 60000);
        });

        // Pass the token to the server instance for session-based credit billing
        const server = createServer(token || transport.sessionId, () => transports.size + statelessSessions.size);
        await server.connect(transport);
        console.error(`[*] SSE session active: ${transport.sessionId}`);
    } else {
        res.status(401).json({ error: "Failed to establish SSE session" });
    }
});

// Primary message endpoint
const handlePostMessage = async (req: express.Request, res: express.Response) => {
    let sessionId = req.query.sessionId as string;
    const ip = req.headers["x-real-ip"] as string || req.ip || "unknown";

    // Forensic logging
    console.error(`[*] POST ${req.path} | IP: ${ip} | session: ${sessionId} | body: ${JSON.stringify(req.body).substring(0, 50)}...`);

    // Singleton/IP-based mapping for SSE clients that forget sessionId
    if (!sessionId) {
        const activeSessions = Array.from(transports.entries());
        if (activeSessions.length === 1) {
            sessionId = activeSessions[0][0];
            console.error(`[*] Auto-mapped to singleton session: ${sessionId}`);
        } else {
            const ipMatch = activeSessions.find(e => e[1].ip === ip);
            if (ipMatch) {
                sessionId = ipMatch[0];
                console.error(`[*] Auto-mapped via IP match (${ip}): ${sessionId}`);
            }
        }
    }

    const session = sessionId ? transports.get(sessionId) : null;

    if (!session) {
        // Extract token from header if available for credit resolution
        const authHeader = req.headers["authorization"];
        let token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
        
        // Fallback to query param if header is missing (some SSE clients)
        if (!token) {
            token = req.query.token as string;
        }

        if (!token) {
            console.error(`[!] ACCESS DENIED: Unauthenticated request from IP: ${ip}`);
            return res.status(401).json({ 
                error: "Unauthorized", 
                message: "Authentication required. Please sign in at https://glazyr.com to obtain an auth token." 
            });
        }

        // Cache stateless sessions by Token hash to prevent collisions
        const statelessKey = `auth:${token.substring(0, 16)}`;
        let statelessSession = statelessSessions.get(statelessKey);

        if (!statelessSession) {
            // Use token as sessionId for better credit resolution in payment-verifier.ts
            const resolvedSessionId = token || `stateless-${ip}`;
            const server = createServer(resolvedSessionId, () => transports.size + statelessSessions.size);
            const transport = new StatelessTransport();
            await server.connect(transport);
            statelessSession = { server, transport };
            statelessSessions.set(statelessKey, statelessSession);
            console.error(`[*] Created stateless session for ${statelessKey} (mapped to session: ${resolvedSessionId})`);
        }

        const body = req.body;
        if (!body) {
            return res.status(400).json({ error: "Missing request body" });
        }

        // Batch support
        const messages = Array.isArray(body) ? body : [body];

        try {
            const responses = await Promise.all(messages.map(m => statelessSession!.transport.handle(m)));
            const validResponses = responses.filter(r => r !== undefined);

            if (validResponses.length > 0) {
                res.json(Array.isArray(body) ? validResponses : validResponses[0]);
            } else {
                res.status(204).end();
            }
        } catch (err: any) {
            console.error(`[!] Stateless processing error: ${err.message}`);
            res.status(500).json({ error: "Stateless processing failed", message: err.message });
        }
        return;
    }

    // Standard SSE processing
    try {
        console.error(`[*] Routing message to active transport: ${sessionId}`);
        await session.transport.handlePostMessage(req, res, req.body);
    } catch (err: any) {
        console.error(`[!] Transport Error for ${sessionId}: ${err.message}`);
        res.status(500).json({ error: "Transport failed", message: err.message });
    }
};

app.post("/mcp/messages", handlePostMessage);
app.post("/mcp/sse", handlePostMessage);

// Global 404 Logger
app.use((req, res) => {
    console.error(`[404] ${req.method} ${req.url} - Headers: ${JSON.stringify(req.headers)}`);
    res.status(404).json({ error: "Route not found", path: req.url });
});

const PORT = process.env.PORT || 4545;
app.listen(PORT, () => {
    console.error(`🚀 Glazyrviz Cloud-Native MCP Server is running at http://0.0.0.0:${PORT}/mcp/sse`);
    console.error(`[*] Nerve Center: ${process.env.GCP_REDIS_HOST || '127.0.0.1'}:${process.env.GCP_REDIS_PORT || '6379'}`);
});
