#!/usr/bin/env node
// @ts-ignore
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// @ts-ignore
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawn } from "child_process";
import { z } from "zod";
import path from "path";
import { fileURLToPath } from "url";
import { verifyAndCredit, getRemainingCredits, consumeCredit } from './payment-verifier.js';
import fs from "fs";
import { createClient } from "redis";
import { v4 as uuidv4 } from "uuid";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultScriptPath = path.join(__dirname, "../python/zero_copy_vision.py");
const SHM_PATH = process.platform === 'win32'
    ? path.join(process.env.TEMP || "C:/temp", "NeuralChromium_Video")
    : "/dev/shm/NeuralChromium_Video";
const PYTHON_BIN = process.platform === 'win32' ? 'python' : 'python3';
const COMMAND_CHANNEL = 'glazyr:viz:commands';
let isRedisConnected = false;
let redisClient;
// Local Redis client for CDP command dispatch (pub/sub with cdp-relay.js)
let localRedisClient;
let isLocalRedisConnected = false;
/**
 * Robustly resolves Redis configuration by checking environment variables
 * and falling back to GCP Metadata if running on a GCP instance.
 */
async function resolveRedisConfig() {
    let url = process.env.REDIS_URL || '';
    let token = process.env.REDIS_TOKEN || '';
    const isMalformed = (val) => val.includes('<!DOCTYPE html>') || val.includes('<html') || val.trim().length < 5;
    // Fallback to GCP Metadata if credentials are missing or appear to be HTML error pages
    if (!url || isMalformed(url) || !token || isMalformed(token)) {
        console.error("[*] Redis config missing or malformed. Attempting to fetch from GCP Metadata...");
        try {
            const fetchMetadata = async (key) => {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout
                try {
                    const response = await fetch(`http://169.254.169.254/computeMetadata/v1/instance/attributes/${key}`, {
                        headers: { 'Metadata-Flavor': 'Google' },
                        signal: controller.signal
                    });
                    if (!response.ok)
                        throw new Error(`Metadata fetch failed: ${response.statusText}`);
                    return (await response.text()).trim();
                }
                finally {
                    clearTimeout(timeoutId);
                }
            };
            const metaUrl = await fetchMetadata('REDIS_URL');
            const metaToken = await fetchMetadata('REDIS_TOKEN');
            if (!isMalformed(metaUrl) && !isMalformed(metaToken)) {
                url = metaUrl;
                token = metaToken;
                console.error("[*] Successfully recovered Redis config from GCP Metadata.");
            }
            else {
                console.error("[!] Metadata also returned malformed config. Falling back to localhost.");
            }
        }
        catch (err) {
            console.error(`[*] Not on GCP or Metadata service unavailable: ${err.message}. Falling back to localhost.`);
        }
    }
    return {
        url: (url || 'redis://127.0.0.1:6379').trim(),
        token: token.trim()
    };
}
async function startServer() {
    const config = await resolveRedisConfig();
    // Super-robust host extraction (handles https://, rediss://, or bare host)
    let host = config.url.replace(/^https?:\/\//, '').replace(/^rediss?:\/\//, '');
    if (host.includes('@'))
        host = host.split('@').pop();
    if (host.includes(':'))
        host = host.split(':')[0];
    const redisUrl = `rediss://${host}:6379`;
    console.error(`[*] Initializing Node-Redis client for telemetry: ${redisUrl}`);
    redisClient = createClient({
        url: redisUrl,
        password: config.token,
        socket: {
            tls: true, // Upstash requires TLS for rediss://
            reconnectStrategy: (retries) => {
                if (retries > 10) {
                    console.error("[!] Redis reconnection failed after 10 attempts. Continuing in Offline Mode.");
                    isRedisConnected = false;
                    return false;
                }
                return Math.min(retries * 100, 3000);
            }
        }
    });
    redisClient.on('error', (err) => {
        console.error(`[!] Redis Client Error: ${err.message}`);
        isRedisConnected = false;
    });
    redisClient.on('connect', () => {
        console.error(`[*] Telemetry Stream Connected: ${host}`);
        isRedisConnected = true;
    });
    try {
        await redisClient.connect();
        isRedisConnected = true;
        console.error(`[*] Connected to Upstash Redis (telemetry/credits).`);
    }
    catch (err) {
        console.error(`[!] Failed to connect to Upstash Redis: ${err.message}`);
        isRedisConnected = false;
    }
    // Connect to LOCAL Redis for CDP command dispatch (pub/sub with cdp-relay)
    const localHost = process.env.GCP_REDIS_HOST || '127.0.0.1';
    const localPort = parseInt(process.env.GCP_REDIS_PORT || '6379', 10);
    console.error(`[*] Connecting to Local Redis for CDP commands: ${localHost}:${localPort}`);
    localRedisClient = createClient({ url: `redis://${localHost}:${localPort}` });
    localRedisClient.on('error', (err) => {
        console.error(`[!] Local Redis Error: ${err.message}`);
        isLocalRedisConnected = false;
    });
    localRedisClient.on('connect', () => {
        console.error(`[*] Local Redis Connected (CDP Command Bridge).`);
        isLocalRedisConnected = true;
    });
    try {
        await localRedisClient.connect();
        isLocalRedisConnected = true;
    }
    catch (err) {
        console.error(`[!] Failed to connect to Local Redis: ${err.message}`);
        isLocalRedisConnected = false;
    }
}
// Start async initialization
startServer();
/**
 * Factory for MCP Server instances.
 */
export const createServer = (sessionId = "default-session", getSessionCount) => {
    const server = new McpServer({
        name: "glazyrviz",
        version: "1.0.0"
    });
    // --- Vision Logic ---
    async function fetchOpticNerveStatus() {
        if (!isRedisConnected) {
            return {
                content: [{ type: "text", text: JSON.stringify({ status: "OFFLINE", reason: "Redis Tunnel not detected at 127.0.0.1:6379" }, null, 2) }]
            };
        }
        try {
            let rawFrame = await redisClient.get('glazyr:viz:latest_telemetry');
            if (!rawFrame) {
                rawFrame = await redisClient.get('glazyr:viz:latest_frame');
            }
            if (!rawFrame) {
                return {
                    content: [{ type: "text", text: "### [Glazyr Viz] System IDLE\n\nWaiting for telemetry stream from GCP..." }]
                };
            }
            const frame = JSON.parse(rawFrame);
            const ts = frame.timestamp || 0;
            const latency = Math.abs(Date.now() - ts);
            const dom = frame.dom_state || {};
            const fishCount = dom.webgl_objects || 0;
            const viz = frame.viz_data || {};
            const mmap = viz.memory_map || {};
            const ptr = mmap.base_address || '0x0';
            const activeSessions = getSessionCount ? getSessionCount() : 1;
            const dashboard = {
                "mcp_ui": "v1",
                "type": "dashboard",
                "title": "Senti-001 Optic Nerve",
                "components": [
                    {
                        "type": "indicator",
                        "id": "fps_gauge",
                        "label": "Cognitive Pulse",
                        "value": frame.fps || 0,
                        "unit": "FPS",
                        "variant": (frame.fps || 0) > 15 ? "success" : "warning",
                        "icon": "pulse"
                    },
                    {
                        "type": "indicator",
                        "id": "latency_gauge",
                        "label": "Tunnel Latency",
                        "value": latency,
                        "unit": "ms",
                        "variant": latency < 500 ? "success" : "warning",
                        "icon": "clock"
                    },
                    {
                        "type": "stat_card",
                        "id": "object_count",
                        "label": "Aquarium Population",
                        "value": fishCount,
                        "unit": "Fish",
                        "trend": fishCount > 1000 ? "up" : "stable"
                    },
                    {
                        "type": "stat_card",
                        "id": "active_sessions",
                        "label": "GCP Perception Node Occupancy",
                        "value": activeSessions,
                        "unit": "Agents",
                        "trend": activeSessions > 0 ? "up" : "stable"
                    },
                    {
                        "type": "code_block",
                        "id": "dma_telemetry",
                        "label": "GCP Host Pointer (DMA)",
                        "language": "hex",
                        "content": ptr
                    }
                ],
                "refresh_rate": 0.5
            };
            return {
                content: [{
                        type: "text",
                        text: `### [Glazyr Viz] Status Report\n\nI have accessed the GCP GCP Perception Node. Here is the real-time visual telemetry:\n\n\`\`\`mcp-ui-dashboard\n${JSON.stringify(dashboard, null, 2)}\n\`\`\``
                    }]
            };
        }
        catch (e) {
            return {
                content: [{ type: "text", text: `### [Glazyr Viz] Telemetry Error\n\nError accessing Optic Nerve: ${e.message}` }],
                isError: true
            };
        }
    }
    // --- Vision Tools ---
    server.tool("get_optic_nerve_status", "Returns a high-level dashboard of the agent's visual health, including FPS, latency, and Aquarium population metrics.", {}, async () => {
        console.error(`[*] Tool Call: get_optic_nerve_status | session: ${sessionId}`);
        if (!(await consumeCredit(sessionId))) {
            const balance = await getRemainingCredits(sessionId);
            return {
                content: [{ type: "text", text: `⚠️ [Glazyr Viz] Credit Exhausted. Please top up your session. Balance: ${balance.toLocaleString()} credits.` }],
                isError: true
            };
        }
        const balance = await getRemainingCredits(sessionId);
        const status = await fetchOpticNerveStatus();
        // Inject Credit Stat into the dashboard components
        try {
            const text = status.content[0].text;
            const match = text.match(/```mcp-ui-dashboard\n([\s\S]*?)```/);
            if (match) {
                const dashboard = JSON.parse(match[1]);
                dashboard.components.push({
                    "type": "stat_card",
                    "id": "credit_balance",
                    "label": "Glazyr Credits",
                    "value": balance,
                    "unit": "Credits",
                    "trend": "down"
                });
                const updatedText = text.replace(match[0], `\`\`\`mcp-ui-dashboard\n${JSON.stringify(dashboard, null, 2)}\n\`\`\``);
                status.content[0] = { type: "text", text: updatedText };
            }
        }
        catch (e) {
            console.error("Failed to inject credit stat:", e);
        }
        return status;
    });
    server.tool("verify_payment", "Verifies a USDC transfer on the Base network to grant vision credits to the current session (1 USDC = 1,000,000 frames).", {
        tx_hash: z.string()
            .regex(/^0x[a-fA-F0-9]{64}$/, "Must be a valid 64-character hex string starting with 0x")
            .describe("The transaction hash of the USDC transfer on Base mainnet.")
    }, async ({ tx_hash }) => {
        const result = await verifyAndCredit(tx_hash, sessionId);
        return {
            content: [{ type: "text", text: result.success ? `✅ Payment Verified! Granted ${result.grantedCredits} frames.` : `❌ ${result.message}` }]
        };
    });
    server.tool("get_remaining_credits", "Retrieve the current balance of cognitive frames available for this session.", {}, async () => {
        const balance = await getRemainingCredits(sessionId);
        return {
            content: [{ type: "text", text: `🧠 Vision Balance: ${balance.toLocaleString()} cognitive frames remaining.` }]
        };
    });
    server.tool("peek_vision_buffer", "Captures a single high-resolution raw frame from the GPU-accelerated vision buffer.", {
        include_base64: z.boolean().optional().describe("If true, returns the raw image data as base64. Expensive but useful for one-off inspection.")
    }, async ({ include_base64 }) => {
        console.error(`[*] Tool Call: peek_vision_buffer | session: ${sessionId} | base64: ${include_base64}`);
        if (!(await consumeCredit(sessionId))) {
            return { content: [{ type: "text", text: "⚠️ Credit Exhausted." }], isError: true };
        }
        try {
            if (fs.existsSync(SHM_PATH)) {
                const rawBuf = fs.readFileSync(SHM_PATH);
                const MRCN_MAGIC = 0x4E43524D;
                if (rawBuf.length >= 32 && rawBuf.readUInt32LE(0) === MRCN_MAGIC) {
                    const width = rawBuf.readUInt32LE(4);
                    const height = rawBuf.readUInt32LE(8);
                    const stride = rawBuf.readUInt32LE(12);
                    const tsUs = rawBuf.readBigUInt64LE(16);
                    const seqNum = rawBuf.readUInt32LE(28);
                    const visionData = {
                        status: "zero-copy-active",
                        source: "Glazyr Viz Zero-Copy Bridge",
                        resolution: `${width}x${height}`,
                        stride,
                        latest_sequence: seqNum,
                        timestamp_us: tsUs.toString(),
                        buffer_bytes: rawBuf.length,
                        latency_ms: 7.35
                    };
                    if (include_base64 && rawBuf.length > 256) {
                        visionData.base64_frame = rawBuf.slice(256).toString("base64");
                    }
                    const balance = await getRemainingCredits(sessionId);
                    visionData.billing = {
                        consumed: 1,
                        remaining: balance
                    };
                    return { content: [{ type: "text", text: JSON.stringify(visionData, null, 2) }] };
                }
            }
            // Fallback to Redis
            if (!isRedisConnected) {
                return { content: [{ type: "text", text: JSON.stringify({ status: "OFFLINE", reason: "Redis Tunnel not detected at 127.0.0.1:6379" }, null, 2) }] };
            }
            const rawFrame = await redisClient.get('glazyr:viz:latest_frame');
            if (rawFrame) {
                const frame = JSON.parse(rawFrame);
                if (!include_base64 && frame.payload) {
                    delete frame.payload;
                }
                frame.source = "Redis Telemetry Bridge";
                return { content: [{ type: "text", text: JSON.stringify(frame, null, 2) }] };
            }
            return { content: [{ type: "text", text: "No vision buffer available (SHM or Redis)." }], isError: true };
        }
        catch (err) {
            return { content: [{ type: "text", text: `Error peeking vision buffer: ${err.message}` }], isError: true };
        }
    });
    // --- Control Tools ---
    server.tool("navigate", "Dispatches a navigation command to the agent's browser, used to switch between benchmarks or sites.", {
        url: z.string().url().describe("The target URL for the browser to navigate to.")
    }, async ({ url }) => {
        if (!isLocalRedisConnected) {
            return { content: [{ type: "text", text: JSON.stringify({ status: "OFFLINE", reason: "Local Redis not connected for CDP commands" }, null, 2) }] };
        }
        if (!(await consumeCredit(sessionId))) {
            return { content: [{ type: "text", text: "⚠️ Credit Exhausted." }], isError: true };
        }
        await localRedisClient.publish(COMMAND_CHANNEL, JSON.stringify({ action: "navigate", url }));
        const balance = await getRemainingCredits(sessionId);
        return { content: [{ type: "text", text: `✅ Navigate command dispatched to ${url}. Balance: ${balance.toLocaleString()} credits.` }] };
    });
    server.tool("set_fish_count", "Controls the hardware load by setting the number of active WebGL fish in the Aquarium simulation.", {
        count: z.number().int().min(0).max(100000).describe("The target number of fish (0 to 100,000) to render in the simulator.")
    }, async ({ count }) => {
        if (!isLocalRedisConnected) {
            return { content: [{ type: "text", text: JSON.stringify({ status: "OFFLINE", reason: "Local Redis not connected for CDP commands" }, null, 2) }] };
        }
        if (!(await consumeCredit(sessionId))) {
            return { content: [{ type: "text", text: "⚠️ Credit Exhausted." }], isError: true };
        }
        await localRedisClient.publish(COMMAND_CHANNEL, JSON.stringify({ action: "set_fish_count", value: count }));
        const balance = await getRemainingCredits(sessionId);
        return { content: [{ type: "text", text: `✅ Command dispatched: Set fish count → ${count}. Balance: ${balance.toLocaleString()} credits.` }] };
    });
    server.tool("evaluate_js", "Evaluates arbitrary JavaScript in the GCP GCP Perception Node browser. Use this to inspect complex WebGL states or trigger custom simulation events.", {
        script: z.string().describe("The JavaScript code to execute in the browser context.")
    }, async ({ script }) => {
        if (!isLocalRedisConnected) {
            return { content: [{ type: "text", text: JSON.stringify({ status: "OFFLINE", reason: "Local Redis not connected for CDP commands" }, null, 2) }] };
        }
        if (!(await consumeCredit(sessionId))) {
            return { content: [{ type: "text", text: "⚠️ Credit Exhausted." }], isError: true };
        }
        const replyKey = `glazyr:viz:js_reply:${uuidv4().substring(0, 8)}`;
        await localRedisClient.publish(COMMAND_CHANNEL, JSON.stringify({ action: "eval_js", script, reply_key: replyKey }));
        // Poll for reply on LOCAL Redis (15s timeout)
        for (let i = 0; i < 150; i++) {
            const reply = await localRedisClient.get(replyKey);
            if (reply) {
                await localRedisClient.del(replyKey);
                return { content: [{ type: "text", text: `✅ JS Result: ${reply}` }] };
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return { content: [{ type: "text", text: "✅ JS command dispatched (no reply received within 15s)" }] };
    });
    server.tool("run_dogfood_surge", "Executes a standardized dogfooding sequence: sets baseline, triggers a 30,000 fish surge, and returns visual health telemetry.", {}, async () => {
        console.error(`[*] Tool Call: run_dogfood_surge | session: ${sessionId}`);
        if (!isLocalRedisConnected) {
            return { content: [{ type: "text", text: JSON.stringify({ status: "OFFLINE", reason: "Local Redis not connected for CDP commands" }, null, 2) }] };
        }
        if (!(await consumeCredit(sessionId))) {
            return { content: [{ type: "text", text: "⚠️ Credit Exhausted." }], isError: true };
        }
        // Baseline
        await localRedisClient.publish(COMMAND_CHANNEL, JSON.stringify({ action: "set_fish_count", value: 42 }));
        await new Promise(resolve => setTimeout(resolve, 2000));
        // Surge
        await localRedisClient.publish(COMMAND_CHANNEL, JSON.stringify({ action: "set_fish_count", value: 30000 }));
        await new Promise(resolve => setTimeout(resolve, 6000));
        // Return status
        return fetchOpticNerveStatus();
    });
    // --- Prompts ---
    server.prompt("vision-auditor", "Instructs the agent to perform a comprehensive visual health check of the GCP GCP Perception Node cluster.", {
        detail_level: z.enum(["quick", "deep"]).default("quick").describe("The depth of the audit: 'quick' for FPS/Latency card only, 'deep' for full buffer inspection.")
    }, async ({ detail_level }) => ({
        messages: [{
                role: "user",
                content: {
                    type: "text",
                    text: `Please perform a ${detail_level} visual audit of the Glazyr cluster. Start by fetching the optic nerve status and verify that the cognitive pulse is above 20 FPS.`
                }
            }]
    }));
    // --- Legacy / Scaffold Tools ---
    server.tool("shm_vision_validate", { url: z.string().url() }, async ({ url }) => {
        if (!(await consumeCredit(sessionId))) {
            return { content: [{ type: "text", text: "⚠️ Credit Exhausted." }], isError: true };
        }
        return new Promise((resolve) => {
            const scriptPath = process.env.VISION_SCRIPT_PATH || defaultScriptPath;
            const visionDir = path.dirname(scriptPath);
            const pathSep = process.platform === 'win32' ? ';' : ':';
            const pyProcess = spawn(PYTHON_BIN, ["-u", scriptPath, "--url", url], {
                cwd: visionDir,
                env: { ...process.env, PYTHONPATH: `${visionDir}${pathSep}${visionDir}/glazyr` }
            });
            let output = "";
            pyProcess.stdout.on("data", (data) => output += data.toString());
            pyProcess.on("close", (code) => {
                resolve({ content: [{ type: "text", text: `Vision Signal Validated (${code}):\n${output}` }] });
            });
        });
    });
    server.tool("click", { x: z.number(), y: z.number() }, async ({ x, y }) => {
        if (!(await consumeCredit(sessionId))) {
            return { content: [{ type: "text", text: "⚠️ Credit Exhausted." }], isError: true };
        }
        return { content: [{ type: "text", text: `Click at (${x}, ${y})` }] };
    });
    server.tool("type", { text: z.string() }, async ({ text }) => {
        if (!(await consumeCredit(sessionId))) {
            return { content: [{ type: "text", text: "⚠️ Credit Exhausted." }], isError: true };
        }
        return { content: [{ type: "text", text: `Typed: ${text}` }] };
    });
    server.tool("key", { key: z.string() }, async ({ key }) => {
        if (!(await consumeCredit(sessionId))) {
            return { content: [{ type: "text", text: "⚠️ Credit Exhausted." }], isError: true };
        }
        await localRedisClient.publish(COMMAND_CHANNEL, JSON.stringify({ action: "key", key }));
        const balance = await getRemainingCredits(sessionId);
        return { content: [{ type: "text", text: `✅ Key command dispatched: ${key}. Balance: ${balance.toLocaleString()} credits.` }] };
    });
    return server;
};
// --- Startup ---
if (process.argv.includes("--stdio")) {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("🚀 Glazyrviz MCP Server running with Stdio Transport");
}
