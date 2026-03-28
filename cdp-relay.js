#!/usr/bin/env node
/**
 * CDP Relay - Bridges Redis commands to headless Chrome via DevTools Protocol.
 * 
 * Subscribes to `glazyr:viz:commands` Redis channel and executes:
 *   - navigate: navigates Chrome to a URL
 *   - eval_js: evaluates JS in the page and writes the result to a Redis reply key
 *   - set_fish_count: injects JS to set the fish count
 *
 * Usage: node cdp-relay.js [--chrome-port 9223] [--redis-host 127.0.0.1]
 */
import { createClient } from "redis";
import WebSocket from "ws";
import http from "http";

const CHROME_PORT = parseInt(process.env.CHROME_PORT || "9222", 10);
const REDIS_HOST = process.env.GCP_REDIS_HOST || "127.0.0.1";
const REDIS_PORT = parseInt(process.env.GCP_REDIS_PORT || "6379", 10);
const COMMAND_CHANNEL = "glazyr:viz:commands";

let ws = null;
let messageId = 1;
const pendingCallbacks = new Map();

// --- Chrome DevTools Protocol Connection ---

async function getWsUrl() {
    return new Promise((resolve, reject) => {
        // First try /json/list to get a PAGE target (required for Runtime.evaluate)
        http.get(`http://127.0.0.1:${CHROME_PORT}/json/list`, (res) => {
            let data = "";
            res.on("data", (chunk) => data += chunk);
            res.on("end", () => {
                try {
                    const targets = JSON.parse(data);
                    const page = targets.find(t => t.type === "page");
                    if (page && page.webSocketDebuggerUrl) {
                        console.error(`[CDP] Found page target: ${page.title || page.url}`);
                        resolve(page.webSocketDebuggerUrl);
                    } else {
                        // Fallback to browser-level
                        http.get(`http://127.0.0.1:${CHROME_PORT}/json/version`, (res2) => {
                            let d2 = "";
                            res2.on("data", (chunk) => d2 += chunk);
                            res2.on("end", () => {
                                const json = JSON.parse(d2);
                                resolve(json.webSocketDebuggerUrl);
                            });
                        }).on("error", reject);
                    }
                } catch (e) { reject(new Error(`Bad JSON from Chrome: ${data.substring(0, 200)}`)); }
            });
        }).on("error", reject);
    });
}

async function connectChrome() {
    const wsUrl = await getWsUrl();
    console.error(`[CDP] Connecting to Chrome at ${wsUrl}`);

    ws = new WebSocket(wsUrl);

    ws.on("open", () => console.error("[CDP] Connected to Chrome."));

    ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.id && pendingCallbacks.has(msg.id)) {
            const cb = pendingCallbacks.get(msg.id);
            pendingCallbacks.delete(msg.id);
            cb(msg);
        }
    });

    ws.on("close", () => {
        console.error("[CDP] Chrome connection closed. Reconnecting in 3s...");
        setTimeout(connectChrome, 3000);
    });

    ws.on("error", (err) => {
        console.error(`[CDP] WebSocket error: ${err.message}`);
    });

    // Wait for open
    await new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
    });

    // Enable required CDP domains
    await sendCDP("Runtime.enable");
    await sendCDP("Page.enable");
    console.error("[CDP] Runtime and Page domains enabled.");
}

function sendCDP(method, params = {}) {
    return new Promise((resolve, reject) => {
        const id = messageId++;
        const timeout = setTimeout(() => {
            pendingCallbacks.delete(id);
            reject(new Error(`CDP timeout for ${method}`));
        }, 10000);

        pendingCallbacks.set(id, (msg) => {
            clearTimeout(timeout);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
        });

        ws.send(JSON.stringify({ id, method, params }));
    });
}

// --- Redis Subscriber ---

async function startRelay() {
    await connectChrome();

    const subscriber = createClient({ url: `redis://${REDIS_HOST}:${REDIS_PORT}` });
    const publisher = createClient({ url: `redis://${REDIS_HOST}:${REDIS_PORT}` });

    await subscriber.connect();
    await publisher.connect();
    console.error(`[Relay] Connected to Redis at ${REDIS_HOST}:${REDIS_PORT}`);

    await subscriber.subscribe(COMMAND_CHANNEL, async (message) => {
        try {
            const cmd = JSON.parse(message);
            console.error(`[Relay] Received: ${cmd.action}`);

            switch (cmd.action) {
                case "navigate": {
                    await sendCDP("Page.navigate", { url: cmd.url });
                    console.error(`[Relay] Navigated to ${cmd.url}`);
                    break;
                }

                case "eval_js": {
                    try {
                        const wrappedScript = `
(() => {
    try {
        const res = eval(${JSON.stringify(cmd.script)});
        if (typeof res === "object" && res !== null) {
            if ("innerText" in res) return res.innerText;
            if ("textContent" in res) return res.textContent;
            if (res instanceof NodeList || res instanceof HTMLCollection || Array.isArray(res)) {
                return Array.from(res).map(e => e.innerText || e.textContent || String(e)).join('\\n');
            }
        }
        return res;
    } catch(err) {
        return "EVAL_ERROR: " + err.message;
    }
})()
`;
                        const result = await sendCDP("Runtime.evaluate", {
                            expression: wrappedScript,
                            returnByValue: true
                        });
                        const value = result?.result?.value ?? result?.result?.description ?? "undefined";
                        const reply = typeof value === "object" ? JSON.stringify(value) : String(value);

                        if (cmd.reply_key) {
                            await publisher.set(cmd.reply_key, reply, { EX: 30 });
                            console.error(`[Relay] JS result written to ${cmd.reply_key}: ${reply.substring(0, 100)} `);
                        }
                    } catch (err) {
                        if (cmd.reply_key) {
                            await publisher.set(cmd.reply_key, `ERROR: ${err.message} `, { EX: 30 });
                        }
                        console.error(`[Relay] JS eval error: ${err.message} `);
                    }
                    break;
                }

                case "set_fish_count": {
                    const count = cmd.value || 0;
                    await sendCDP("Runtime.evaluate", {
                        expression: `if (typeof setSetting === 'function') { setSetting(document.getElementById('numFish'), ${count}) } else { console.log('setSetting not found') } `,
                        returnByValue: true
                    });
                    console.error(`[Relay] Fish count set to ${count} `);
                    break;
                }

                default:
                    console.error(`[Relay] Unknown action: ${cmd.action} `);
            }
        } catch (err) {
            console.error(`[Relay] Error processing command: ${err.message} `);
        }
    });

    console.error(`[Relay] ✅ CDP Relay active.Listening on channel: ${COMMAND_CHANNEL} `);
    console.error(`[Relay] Chrome: ws://127.0.0.1:${CHROME_PORT} | Redis: ${REDIS_HOST}:${REDIS_PORT}`);
}

startRelay().catch((err) => {
    console.error(`[Relay] Fatal: ${err.message}`);
    process.exit(1);
});
