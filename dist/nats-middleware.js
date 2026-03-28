import { StringCodec } from 'nats';
import { Redis } from '@upstash/redis';
let redisClient = null;
/**
 * Robustly resolves Redis configuration and initializes the client lazily.
 */
async function getRedis() {
    if (redisClient)
        return redisClient;
    let url = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL || '';
    let token = process.env.REDIS_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
    const isMalformed = (val) => val.includes('<!DOCTYPE html>') || val.includes('<html') || val.trim().length < 5;
    // Fallback to GCP Metadata if credentials are missing or appear to be HTML error pages
    if (!url || isMalformed(url) || !token || isMalformed(token)) {
        console.error("[*] NATS: Redis config missing or malformed. Attempting to fetch from GCP Metadata...");
        try {
            const fetchMetadata = async (key) => {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2000);
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
                console.error("[*] NATS: Successfully recovered Redis config from GCP Metadata.");
            }
        }
        catch (err) {
            console.error(`[*] NATS: Not on GCP or Metadata service unavailable: ${err.message}.`);
        }
    }
    redisClient = new Redis({
        url: (url || 'http://localhost:8080').trim(),
        token: (token || 'fallback').trim(),
    });
    return redisClient;
}
const sc = StringCodec();
/**
 * NATS JetStream Middleware for the GCP RTX 4090 Node
 * Intercepts payloads, validates the NextAuth session, and routes to the SHM Buffer.
 */
export async function withZeroTrustNats(msg, executeVizCommand) {
    // Cast to JsMsg to access JetStream-specific methods like ack() and term()
    const jm = msg;
    try {
        // 1. Intercept and extract the token from NATS headers
        if (!msg.headers) {
            throw new Error("UNAUTHORIZED: Missing NATS headers. Dropping payload.");
        }
        const sessionToken = msg.headers.get("Authorization")?.replace("Bearer ", "");
        if (!sessionToken) {
            throw new Error("UNAUTHORIZED: Missing Session Token.");
        }
        // 2. Cryptographic Check via Upstash Redis
        const redis = await getRedis();
        const sessionKey = `user:session:${sessionToken}`;
        const sessionData = await redis.get(sessionKey);
        if (!sessionData) {
            throw new Error("UNAUTHORIZED: Session invalid or not found in Upstash.");
        }
        // 3. Expiration Validation
        if (new Date(sessionData.expires) < new Date()) {
            const redis = await getRedis();
            await redis.del(sessionKey); // Scrub the stale session
            throw new Error("UNAUTHORIZED: Session expired.");
        }
        // 4. Decode the Chromium Viz / SHM payload
        const payload = JSON.parse(sc.decode(msg.data));
        console.log(`[AUTH SUCCESS] Verified User ${sessionData.userId} for GCP Node execution.`);
        // 5. Hand off to the Chromium Viz subsystem with the verified identity
        await executeVizCommand(payload, sessionData.userId);
        // Acknowledge the message in JetStream to clear it from the queue
        if (typeof jm.ack === 'function')
            jm.ack();
    }
    catch (error) {
        console.error(`[ZERO-TRUST BLOCK] ${error.message}`);
        // Terminate the message entirely. Do not retry unauthorized traffic on the Big Iron.
        if (typeof jm.term === 'function')
            jm.term();
    }
}
