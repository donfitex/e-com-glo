import { createClient } from 'redis';
import { deadline } from '../shared/deadline';
export type Redis = ReturnType<typeof createClient>;
export interface CacheStats {
  hits: number;
  misses: number;
  loads: number;
  errors: number;
}
export interface Cache {
  remember<T>(key: string, ttl: number, loader: () => Promise<T>): Promise<T>;
  invalidate(): Promise<void>;
  getStats?(): CacheStats;
}
export class CatalogCache implements Cache {
  private readonly stats: CacheStats = {
    hits: 0,
    misses: 0,
    loads: 0,
    errors: 0,
  };
  constructor(
    private readonly redis: Redis,
    private readonly timeoutMs = 1000,
  ) {}
  getStats() {
    return { ...this.stats };
  }
  async remember<T>(
    key: string,
    ttl: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    let version: string | null = null;
    let readable = false;
    try {
      const hit = await deadline(
        (async () => {
          version = await this.redis.get('catalog:version');
          return this.redis.get(`catalog:${version}:${key}`);
        })(),
        this.timeoutMs,
      );
      readable = true;
      if (hit) {
        const result = JSON.parse(hit) as T;
        this.stats.hits++;
        return result;
      }
    } catch {
      this.stats.errors++;
    }
    this.stats.misses++;
    this.stats.loads++;
    const value = await loader();
    if (readable) {
      try {
        await deadline(
          this.redis.set(`catalog:${version}:${key}`, JSON.stringify(value), {
            EX: ttl,
          }),
          this.timeoutMs,
        );
      } catch {
        this.stats.errors++;
      }
    }
    return value;
  }
  async invalidate() {
    // Generations prevent in-flight stale reads from resurrecting invalidated data.
    try {
      await deadline(this.redis.incr('catalog:version'), this.timeoutMs);
    } catch {
      this.stats.errors++; /* Configured TTL bounds stale reads after outage. */
    }
  }
}
