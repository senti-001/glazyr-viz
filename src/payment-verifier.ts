import { createPublicClient, http, parseAbiItem } from 'viem';
import { base } from 'viem/chains';
import { Redis } from '@upstash/redis';

let redisClient: Redis | null = null;

/**
 * Robustly resolves Redis configuration and initializes the client lazily.
 */
async function getRedis() {
    if (redisClient) return redisClient;

    let url = process.env.REDIS_URL || '';
    let token = process.env.REDIS_TOKEN || '';

    const isMalformed = (val: string) => val.includes('<!DOCTYPE html>') || val.includes('<html') || val.trim().length < 5;

    // Fallback to GCP Metadata if credentials are missing or appear to be HTML error pages
    if (!url || isMalformed(url) || !token || isMalformed(token)) {
        console.error("[*] Billing: Redis config missing or malformed. Attempting to fetch from GCP Metadata...");
        try {
            const fetchMetadata = async (key: string) => {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2000);
                try {
                    const response = await fetch(`http://169.254.169.254/computeMetadata/v1/instance/attributes/${key}`, {
                        headers: { 'Metadata-Flavor': 'Google' },
                        signal: controller.signal
                    });
                    if (!response.ok) throw new Error(`Metadata fetch failed: ${response.statusText}`);
                    return (await response.text()).trim();
                } finally {
                    clearTimeout(timeoutId);
                }
            };

            const metaUrl = await fetchMetadata('REDIS_URL');
            const metaToken = await fetchMetadata('REDIS_TOKEN');

            if (!isMalformed(metaUrl) && !isMalformed(metaToken)) {
                url = metaUrl;
                token = metaToken;
                console.error("[*] Billing: Successfully recovered Redis config from GCP Metadata.");
            }
        } catch (err: any) {
            console.error(`[*] Billing: Not on GCP or Metadata service unavailable: ${err.message}.`);
        }
    }

    redisClient = new Redis({
        url: (url || 'http://localhost:8080').trim(),
        token: (token || 'fallback').trim(),
    });

    return redisClient;
}

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TREASURY_ADDRESS = '0x104A40D202d40458d8c67758ac54E93024A41B01';
const MIN_PAYMENT_USDC = 8.0;
const FRAMES_PER_DOLLAR = 50000;
const FREE_TIER_GRANT = 10_000;

const client = createPublicClient({
    chain: base,
    transport: http()
});

/**
 * Resolves a Session Token to a User ID via the NextAuth Redis store.
 * This ensures credits are pooled at the user level, not just per-session.
 */
async function getUserIdFromToken(token: string): Promise<string> {
    const redis = await getRedis();
    console.error(`[BILLING TRACE] getUserIdFromToken called with: ${token.substring(0, 12)}...`);

    // Auth.js Upstash Adapter stores sessions under 'user:session:<token>'
    const key1 = `user:session:${token}`;
    const data1: any = await redis.get(key1);
    console.error(`[BILLING TRACE] Lookup '${key1}' => ${data1 ? JSON.stringify(data1).substring(0, 80) : 'null'}`);
    if (data1 && data1.userId) {
        console.error(`[BILLING TRACE] ✅ RESOLVED via user:session: => userId=${data1.userId}`);
        return data1.userId;
    }

    // Legacy prefix fallback
    const key2 = `session:${token}`;
    const data2: any = await redis.get(key2);
    console.error(`[BILLING TRACE] Lookup '${key2}' => ${data2 ? JSON.stringify(data2).substring(0, 80) : 'null'}`);
    if (data2 && data2.userId) {
        console.error(`[BILLING TRACE] ✅ RESOLVED via session: => userId=${data2.userId}`);
        return data2.userId;
    }

    // Raw token fallback
    const data3: any = await redis.get(token);
    console.error(`[BILLING TRACE] Lookup '${token.substring(0, 12)}...' => ${data3 ? JSON.stringify(data3).substring(0, 80) : 'null'}`);
    if (data3 && data3.userId) {
        console.error(`[BILLING TRACE] ✅ RESOLVED via raw token => userId=${data3.userId}`);
        return data3.userId;
    }

    console.error(`[BILLING TRACE] ❌ FALLBACK: Using raw token as userId: ${token.substring(0, 12)}...`);
    return token;
}

export async function verifyAndCredit(txHash: `0x${string}`, sessionId: string): Promise<{ success: boolean; message: string; grantedCredits?: number }> {
    const redis = await getRedis();
    // Replay protection via Redis setnx
    const lockKey = `tx:processed:${txHash}`;
    const isNew = await redis.set(lockKey, "1", { nx: true });
    if (!isNew) {
        return { success: false, message: 'Replay protection: Transaction hash already processed.' };
    }

    try {
        const receipt = await client.getTransactionReceipt({ hash: txHash });
        if (receipt.status !== 'success') return { success: false, message: 'Transaction failed on-chain.' };

        let totalUsdc = 0n;
        let foundValidTransfer = false;
        for (const log of receipt.logs) {
            if (log.address.toLowerCase() === USDC_ADDRESS.toLowerCase()) {
                const topics = log.topics;
                if (topics && topics.length >= 3 && topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
                    const toTopic = topics[2];
                    if (toTopic) {
                        const to = '0x' + toTopic.slice(26);
                        if (to.toLowerCase() === TREASURY_ADDRESS.toLowerCase()) {
                            totalUsdc += BigInt(log.data);
                            foundValidTransfer = true;
                        }
                    }
                }
            }
        }

        if (!foundValidTransfer) return { success: false, message: 'No valid USDC transfer to Treasury found.' };

        const usdcAmount = Number(totalUsdc) / 1_000_000;
        if (usdcAmount < MIN_PAYMENT_USDC) return { success: false, message: `Payment too low. Min $${MIN_PAYMENT_USDC}.` };

        const userId = await getUserIdFromToken(sessionId);
        const grantedFrames = Math.floor(usdcAmount * FRAMES_PER_DOLLAR);

        await redis.incrby(`user:credits:${userId}`, grantedFrames);

        return {
            success: true,
            message: `Successfully verified $${usdcAmount.toFixed(2)} payment.`,
            grantedCredits: grantedFrames
        };
    } catch (error) {
        await redis.del(lockKey); // Release lock on error to allow retry
        return { success: false, message: 'Verification failed.' };
    }
}

export async function getRemainingCredits(sessionId: string): Promise<number> {
    const redis = await getRedis();
    const userId = await getUserIdFromToken(sessionId);
    const balance = await redis.get<number>(`user:credits:${userId}`);

    if (balance === null) {
        // Automatic Beta Grant for new users detected on first intake
        await redis.set(`user:credits:${userId}`, FREE_TIER_GRANT);
        return FREE_TIER_GRANT;
    }
    return balance;
}

export async function consumeCredit(sessionId: string): Promise<boolean> {
    const redis = await getRedis();
    const userId = await getUserIdFromToken(sessionId);
    
    // Decrby frame (atomic)
    const newBalance = await redis.decr(`user:credits:${userId}`);
    
    if (newBalance < 0) {
        // Rollback only if we want strict zero-floor, but usually we allow -1 to signal termination
        if (newBalance < -100) { // Safety buffer for race conditions
             return false;
        }
    }
    
    return true;
}

