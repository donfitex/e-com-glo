import { deadline } from '../shared/deadline';
import { RequestHandler, Request } from 'express';
import { createHash } from 'node:crypto';
import { Redis } from './cache';
export interface RateLimiter {
  consume(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; retryAfter: number }>;
}
export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: Redis) {}
  async consume(key: string, limit: number, windowSeconds: number) {
    const result = (await deadline(
      this.redis.eval(
        `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return {n,redis.call('TTL',KEYS[1])}`,
        { keys: [`rate:${key}`], arguments: [String(windowSeconds)] },
      ),
    )) as number[];
    return {
      allowed: result[0]! <= limit,
      retryAfter: Math.max(1, result[1]!),
    };
  }
}
export function rateLimit(
  limiter: RateLimiter,
  scope: string,
  limit: number,
  windowSeconds = 60,
  identity?: (request: Request) => string,
): RequestHandler {
  return (req, res, next) => {
    const ip = createHash('sha256')
      .update(identity ? identity(req) : (req.ip ?? 'unknown'))
      .digest('hex');
    limiter
      .consume(`${scope}:${ip}`, limit, windowSeconds)
      .then((result) => {
        if (result.allowed) return next();
        res.setHeader('Retry-After', result.retryAfter);
        res.status(429).json({
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests',
            requestId: res.locals.requestId,
          },
        });
      })
      .catch(() =>
        res.status(503).json({
          error: {
            code: 'RATE_LIMIT_UNAVAILABLE',
            message: 'Please try again shortly',
            requestId: res.locals.requestId,
          },
        }),
      );
  };
}
