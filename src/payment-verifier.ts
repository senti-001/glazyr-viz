import { createPublicClient, http, parseAbiItem, Log } from 'viem';
import { base } from 'viem/chains';
import fs from 'fs';
import path from 'path';

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TREASURY_ADDRESS = '0x104A40D202d40458d8c67758ac54E93024A41B01';
const MIN_PAYMENT_USDC = 1.0; // $1.00 USDC
const FRAMES_PER_DOLLAR = 1000;

const DB_PATH = path.join(process.cwd(), 'data', 'x402-ledger.json');

interface Ledger {
    processedHashes: string[];
    credits: Record<string, number>; // sessionId -> remaining_frames
}

// Ensure data directory exists
if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

function loadLedger(): Ledger {
    if (fs.existsSync(DB_PATH)) {
        return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    }
    return { processedHashes: [], credits: {} };
}

function saveLedger(ledger: Ledger) {
    fs.writeFileSync(DB_PATH, JSON.stringify(ledger, null, 4));
}

const client = createPublicClient({
    chain: base,
    transport: http()
});

/**
 * Verifies a USDC transfer on Base mainnet.
 * Checks for:
 * 1. Transaction success/confirmation.
 * 2. Contract address is USDC.
 * 3. Recipient is Treasury.
 * 4. Amount >= $1.00.
 * 5. Hash hasn't been used (Replay protection).
 */
export async function verifyAndCredit(txHash: `0x${string}`, sessionId: string): Promise<{ success: boolean; message: string; grantedCredits?: number }> {
    const ledger = loadLedger();

    if (ledger.processedHashes.includes(txHash)) {
        return { success: false, message: 'Replay protection: Transaction hash already processed.' };
    }

    try {
        const receipt = await client.getTransactionReceipt({ hash: txHash });

        if (receipt.status !== 'success') {
            return { success: false, message: 'Transaction failed on-chain.' };
        }

        // We check for at least 1 confirmation (getTransactionReceipt ensures it's mined)
        // For higher security, we could wait for more, but sub-16ms goals prefer speed.

        const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

        let totalUsdc = 0n;
        let foundValidTransfer = false;

        for (const log of receipt.logs) {
            if (log.address.toLowerCase() === USDC_ADDRESS.toLowerCase()) {
                // Manually check if it's a Transfer to Treasury
                // (Using parseAbiItem or checking topics)
                const topics = log.topics;
                if (topics && topics.length >= 3 && topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') { // Transfer topic
                    const toTopic = topics[2];
                    if (toTopic) {
                        const to = '0x' + toTopic.slice(26); // Extract to address from topic 2
                        if (to.toLowerCase() === TREASURY_ADDRESS.toLowerCase()) {
                            const value = BigInt(log.data);
                            totalUsdc += value;
                            foundValidTransfer = true;
                        }
                    }
                }
            }
        }

        if (!foundValidTransfer) {
            return { success: false, message: 'No valid USDC transfer to Treasury found in this transaction.' };
        }

        const usdcAmount = Number(totalUsdc) / 1_000_000;
        if (usdcAmount < MIN_PAYMENT_USDC) {
            return { success: false, message: `Payment too low. Minimum is $${MIN_PAYMENT_USDC} USDC.` };
        }

        // Grant credits
        const grantedFrames = Math.floor(usdcAmount * FRAMES_PER_DOLLAR);
        ledger.credits[sessionId] = (ledger.credits[sessionId] || 0) + grantedFrames;
        ledger.processedHashes.push(txHash);
        saveLedger(ledger);

        return {
            success: true,
            message: `Successfully verified $${usdcAmount.toFixed(2)} payment.`,
            grantedCredits: grantedFrames
        };

    } catch (error) {
        console.error('[x402] Verification Error:', error);
        return { success: false, message: 'Verification failed. Ensure the transaction hash is correct and confirmed on Base.' };
    }
}

export function getRemainingCredits(sessionId: string): number {
    const ledger = loadLedger();
    return ledger.credits[sessionId] || 0;
}

export function consumeCredit(sessionId: string): boolean {
    const ledger = loadLedger();
    if (ledger.credits[sessionId] && ledger.credits[sessionId] > 0) {
        ledger.credits[sessionId] -= 1;
        saveLedger(ledger);
        return true;
    }
    return false;
}
