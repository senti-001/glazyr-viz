import { Redis } from '@upstash/redis';

/**
 * Strict Redis Wrapper for Senti_002 Memory Isolation
 * 
 * Enforces a strict `senti002:` namespace prefix across all datastore interactions
 * to guarantee zero bleed between the primary Senti-001 instance and Senti_002.
 */
export class Senti002Redis {
    private client: Redis;
    private prefix = 'senti002:';

    constructor() {
        this.client = new Redis({
            url: process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL!,
            token: process.env.REDIS_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN!,
        });
    }

    private p(key: string): string {
        return `${this.prefix}${key}`;
    }

    async get<T>(key: string): Promise<T | null> {
        return await this.client.get<T>(this.p(key));
    }

    async set(key: string, value: any, options?: any) {
        return await this.client.set(this.p(key), value, options);
    }

    async del(...keys: string[]) {
        const prefixedKeys = keys.map(k => this.p(k));
        return await this.client.del(...prefixedKeys);
    }

    async incrby(key: string, increment: number) {
        return await this.client.incrby(this.p(key), increment);
    }

    // Pass through pipeline access if necessary, but strictly wrap the keys
    pipeline() {
        const p = this.client.pipeline();
        // A minimal decorator pattern to enforce prefixing on the pipeline
        return {
            set: (key: string, value: any) => p.set(this.p(key), value),
            get: (key: string) => p.get(this.p(key)),
            del: (key: string) => p.del(this.p(key)),
            exec: () => p.exec(),
        };
    }
}

// Export a singleton instance for standard usage across the Senti_002 sub-systems
export const senti002Memory = new Senti002Redis();
