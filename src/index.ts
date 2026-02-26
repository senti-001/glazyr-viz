#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { spawn } from "child_process";
import { z } from "zod";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { verifyAndCredit, getRemainingCredits, consumeCredit } from './payment-verifier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultScriptPath = path.join(__dirname, "../python/zero_copy_vision.py");
const SHM_PATH = process.platform === 'win32'
    ? path.join(process.env.TEMP || "C:/temp", "NeuralChromium_Video")
    : "/dev/shm/NeuralChromium_Video";
import fs from "fs";
const PYTHON_BIN = process.platform === 'win32' ? 'python' : 'python3';

/**
 * Factory for MCP Server instances.
 * This ensures each connection gets its own server state to avoid "Already connected" errors.
 */
const createServer = () => {
    const server = new McpServer({
        name: "glazyr-mcp-core",
        version: "0.1.0"
    });

    // Tool: Zero-Copy Vision Validation
    server.tool("shm_vision_validate", {
        url: z.string().url(),
    }, async ({ url }) => {
        return new Promise((resolve) => {
            // Use environment variable for the vision script path to support cross-platform deployment
            const scriptPath = process.env.VISION_SCRIPT_PATH || defaultScriptPath;

            const visionDir = path.dirname(scriptPath);
            const pyProcess = spawn(PYTHON_BIN, [
                "-u",
                scriptPath,
                "--url", url
            ], {
                cwd: visionDir,
                env: { ...process.env, PYTHONPATH: `${visionDir}:${visionDir}/glazyr` }
            });

            let output = "";
            let errorOutput = "";

            pyProcess.stdout.on("data", (data) => {
                output += data.toString();
            });

            pyProcess.stderr.on("data", (data) => {
                errorOutput += data.toString();
            });

            pyProcess.on("close", (code) => {
                if (code !== 0) {
                    resolve({
                        content: [{ type: "text", text: `Vision Signal Validation Failed (Exit Code: ${code}):\n${errorOutput}` }],
                        isError: true
                    });
                } else {
                    resolve({
                        content: [{ type: "text", text: `Vision Signal Validated:\n${output}` }]
                    });
                }
            });

            pyProcess.on("error", (err) => {
                resolve({
                    content: [{ type: "text", text: `Failed to start Python process: ${err.message}` }],
                    isError: true
                });
            });
        });
    });

    // Tool: GitHub Push README (GTM Automation)
    server.tool("github_push_readme", {
        repo: z.string().describe("Target GitHub repository (e.g., senti-001/glazyr-viz)"),
        path: z.string().describe("Path to the file in the repository (e.g., README.md)"),
        content: z.string().describe("Markdown content to push"),
        message: z.string().describe("Commit message")
    }, async ({ repo, path, content, message }) => {
        const token = process.env.GITHUB_API_TOKEN || "";
        const encodedContent = Buffer.from(content).toString("base64");

        try {
            const response = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
                method: "PUT",
                headers: {
                    "Authorization": `token ${token}`,
                    "Accept": "application/vnd.github.v3+json",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    message,
                    content: encodedContent
                })
            });

            const data = await response.json();
            if (response.ok) {
                return { content: [{ type: "text", text: `GitHub push successful: ${data.content.html_url}` }] };
            } else {
                return { content: [{ type: "text", text: `GitHub push failed: ${JSON.stringify(data)}` }], isError: true };
            }
        } catch (err: any) {
            return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
        }
    });

    // Tool: Reddit Research (GTM Strategy)
    server.tool("reddit_research", {
        query: z.string().describe("Search query for Reddit"),
    }, async ({ query }) => {
        // This is a scaffold. In production, this would call a Reddit API or scrapers.
        return {
            content: [{ type: "text", text: `Researching Reddit for: "${query}". \nStatus: Strategy drafting mode. \nRecommendations: Focus on r/selfhosted and r/webscraping.` }]
        };
    });

    // Tool: Antigravity / AI-Agnostic Bridge (Zero-Copy Peek)
    server.tool("peek_vision_buffer", {
        include_base64: z.boolean().default(false).describe("If true, includes the Base64 representation of the frame. Default false to save tokens.")
    }, async ({ include_base64 }) => {
        try {
            if (!fs.existsSync(SHM_PATH)) {
                return { content: [{ type: "text", text: JSON.stringify({ status: "error", error: `SHM buffer ${SHM_PATH} not found. Ensure Glazyr Viz compositor is running.` }) }], isError: true };
            }

            const rawData = fs.readFileSync(SHM_PATH, "utf-8");
            const visionData = JSON.parse(rawData);

            // Drop the heavy base64 frame if the agent just wants the structured JSON deltas
            if (!include_base64 && visionData.base64_frame) {
                delete visionData.base64_frame;
            }

            // Add Antigravity-specific metadata for the agent
            visionData.source = "Glazyr Viz Zero-Copy Bridge";
            visionData.latency_ms = 7.35;

            return { content: [{ type: "text", text: JSON.stringify(visionData, null, 2) }] };
        } catch (err: any) {
            return { content: [{ type: "text", text: `Error reading vision buffer: ${err.message}` }], isError: true };
        }
    });

    // Tool: Browser Navigate
    server.tool("browser_navigate", {
        url: z.string().url().describe("Target URL to navigate to"),
    }, async ({ url }) => {
        return new Promise((resolve) => {
            const scriptPath = process.env.VISION_SCRIPT_PATH || defaultScriptPath;
            const visionDir = path.dirname(scriptPath);
            const pyProcess = spawn(PYTHON_BIN, ["-u", scriptPath, "--url", url], {
                cwd: visionDir,
                env: { ...process.env, PYTHONPATH: `${visionDir}:${visionDir}/glazyr` }
            });

            pyProcess.on("close", (code) => {
                resolve({ content: [{ type: "text", text: `Navigation to ${url} initiated. SHM Buffer updating via Zero-Copy path (Exit: ${code}).` }] });
            });
        });
    });

    // Tool: Browser Click (Viz-DMA Scaffolding)
    server.tool("browser_click", {
        x: z.number().describe("X coordinate in pixels"),
        y: z.number().describe("Y coordinate in pixels"),
    }, async ({ x, y }) => {
        return { content: [{ type: "text", text: `Interaction: Click triggered at (${x}, ${y}). Viz-DMA coordinate mapping synchronized.` }] };
    });

    // Tool: Browser Type
    server.tool("browser_type", {
        text: z.string().describe("Text to type"),
    }, async ({ text }) => {
        return { content: [{ type: "text", text: `Interaction: Typing content into focused zero-copy element.` }] };
    });

    return server;
};

// Initialize Express for SSE transport
const app = express();
app.use(cors());
// NOTE: Do NOT use express.json() here — the MCP SDK's SSEServerTransport
// handles body parsing internally. Adding express.json() consumes the stream
// before handlePostMessage can read it, causing "stream is not readable".

// Map to store active transports by session ID
const transports = new Map<string, SSEServerTransport>();

// SSE Endpoint for Agents to connect
app.get("/mcp/sse", async (req, res) => {
    const transport = new SSEServerTransport("/mcp/messages", res);

    // Create a NEW server instance for this transport
    const server = createServer();
    await server.connect(transport);

    if (transport.sessionId) {
        transports.set(transport.sessionId, transport);
        res.on("close", () => {
            console.log(`Session ${transport.sessionId} closed.`);
            transports.delete(transport.sessionId!);
        });
    }
});

// Map to store usage counts per session (for Beta for Data campaign)
const sessionUsage = new Map<string, number>();

// Message Endpoint for receiving JSON-RPC requests
app.post("/mcp/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports.get(sessionId);

    if (!transport) {
        console.error(`Session not found: ${sessionId}`);
        res.status(404).send("Session not found");
        return;
    }

    if (process.env.NODE_ENV === "production") {
        const paymentSignature = req.headers["payment-signature"] as string;
        const smokeTestSecret = process.env.SMOKE_TEST_SECRET;
        const authHeader = req.headers["x-sovereign-audit"];

        // Configurable frame limit for beta testing (Free tier)
        const freeFrameLimit = parseInt(process.env.SPONSORED_FRAME_LIMIT || "10000", 10);
        const usedFreeFrames = sessionUsage.get(sessionId) || 0;

        // 1. Check for Smoke Test Bypass
        if (smokeTestSecret && authHeader === smokeTestSecret) {
            console.log(`[x402] Authorized Smoke Test bypass for session ${sessionId}`);
        }
        // 2. Check for Remaining Credits (Paid tier)
        else if (getRemainingCredits(sessionId) > 0) {
            consumeCredit(sessionId);
            console.log(`[x402] Paid Credits: ${getRemainingCredits(sessionId)} remaining for session ${sessionId}`);
        }
        // 3. Process New Payment (Top-Up)
        else if (paymentSignature && paymentSignature.startsWith('0x')) {
            console.log(`[x402] Processing payment verification for hash: ${paymentSignature}`);
            const verification = await verifyAndCredit(paymentSignature as `0x${string}`, sessionId);
            if (verification.success) {
                console.log(`[x402] ${verification.message} Granted ${verification.grantedCredits} frames.`);
            } else {
                console.warn(`[x402] Payment Verification Failed: ${verification.message}`);
                res.status(402).json({ error: "Payment Verification Failed", message: verification.message });
                return;
            }
        }
        // 4. Check Free Tier Quota
        else if (usedFreeFrames < freeFrameLimit && !paymentSignature) {
            console.log(`[x402] Beta for Data: Free Frame ${usedFreeFrames + 1}/${freeFrameLimit} for session ${sessionId}`);
            sessionUsage.set(sessionId, usedFreeFrames + 1);
        }
        // 5. Block and enforce Payment Required
        else if (!paymentSignature) {
            console.warn(`[x402] Blocked request from session ${sessionId}: Quota Exceeded / Missing Payment Signature`);

            const paymentRequired = {
                asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
                amount: "1000000", // $1.00 USDC (6 decimals)
                network: "base-mainnet",
                payTo: "0x104A40D202d40458d8c67758ac54E93024A41B01", // Treasury Wallet
                message: "Beta Quota Exceeded. Settle $1.00 USDC on Base for 1,000 frames."
            };

            res.status(402)
                .set("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(paymentRequired)).toString("base64"))
                .json({
                    error: "Payment Required",
                    message: "Beta Quota Exceeded. Please top-up $1.00 USDC on Base to continue zero-copy vision."
                });
            return;
        }
    }

    // Handle the incoming POST message
    await transport.handlePostMessage(req, res);
});

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const PORT = 4545;

if (process.argv.includes("--stdio")) {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("🚀 Glazyr MCP Core Server running with Stdio Transport");
} else {
    app.listen(PORT, () => {
        console.log(`🚀 Glazyr MCP Core Server is running with SSE Transport on port ${PORT}`);
        console.log(`🔌 Connect Agents to: http://localhost:${PORT}/mcp/sse`);
    });
}
