import { z } from 'zod';
export interface DataSource<T> {
  name: string;
  url: string;
  schema: z.ZodType<T>;
}
export type SourceError = {
  source: string;
  code: 'HTTP_ERROR' | 'INVALID_RESPONSE' | 'REQUEST_FAILED';
  status?: number;
};
class SourceFailure extends Error {
  constructor(
    readonly code: SourceError['code'],
    readonly status?: number,
  ) {
    super(code);
  }
}
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new SourceFailure('INVALID_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 1024 * 1024) {
      await reader.cancel();
      throw new SourceFailure('INVALID_RESPONSE');
    }
    chunks.push(part.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new SourceFailure('INVALID_RESPONSE');
  }
}
export async function aggregate<T>(
  sources: readonly DataSource<T>[],
  transport: typeof fetch = fetch,
) {
  if (sources.length > 20)
    throw new RangeError('At most 20 sources are supported');
  const settled = await Promise.allSettled(
    sources.map(async (source) => {
      const target = new URL(source.url);
      if (target.protocol !== 'https:' || target.username || target.password)
        throw new SourceFailure('REQUEST_FAILED');
      const response = await transport(target, {
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      if (!response.ok) throw new SourceFailure('HTTP_ERROR', response.status);
      const parsed = source.schema.safeParse(await boundedJson(response));
      if (!parsed.success) throw new SourceFailure('INVALID_RESPONSE');
      return { source: source.name, data: parsed.data };
    }),
  );
  const results: { source: string; data: T }[] = [];
  const errors: SourceError[] = [];
  settled.forEach((entry, index) => {
    if (entry.status === 'fulfilled') results.push(entry.value);
    else
      errors.push({
        source: sources[index]!.name,
        code:
          entry.reason instanceof SourceFailure
            ? entry.reason.code
            : 'REQUEST_FAILED',
        ...(entry.reason instanceof SourceFailure && entry.reason.status
          ? { status: entry.reason.status }
          : {}),
      });
  });
  return { results, errors };
}
