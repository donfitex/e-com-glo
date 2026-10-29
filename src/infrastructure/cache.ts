import { createClient } from 'redis';
export type Redis = ReturnType<typeof createClient>;
export interface Cache {
  remember<T>(key: string, ttl: number, loader: () => Promise<T>): Promise<T>;
  invalidate(): Promise<void>;
}
export class CatalogCache implements Cache {
  constructor(private readonly redis: Redis) {}
  async remember<T>(
    key: string,
    ttl: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    // A generation token prevents an in-flight stale read from resurrecting invalidated data.
    let version: string | null = null;
    try {
      version = await this.redis.get('catalog:version');
      const hit = await this.redis.get(`catalog:${version}:${key}`);
      if (hit) return JSON.parse(hit) as T;
    } catch {
      /* database remains authoritative */
    }
    const value = await loader();
    try {
      await this.redis.set(`catalog:${version}:${key}`, JSON.stringify(value), {
        EX: ttl,
      });
    } catch {
      /* bounded degradation */
    }
    return value;
  }
  async invalidate() {
    try {
      await this.redis.incr('catalog:version');
    } catch {
      /* read TTL bounds stale data */
    }
  }
}
