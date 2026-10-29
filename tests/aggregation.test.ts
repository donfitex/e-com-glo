import { z } from 'zod';
import { aggregate } from '../src/modules/aggregation/service';
const schema = z.object({ id: z.number(), title: z.string() });
const sources = ['first', 'second'].map((name) => ({
  name,
  url: `https://example.com/${name}`,
  schema,
}));
function transport(fn: (url: string) => Promise<Response>): typeof fetch {
  return ((url) => fn(String(url))) as typeof fetch;
}
test('aggregation starts independent requests concurrently and validates successes', async () => {
  let started = 0;
  const fetcher = transport(async () => {
    started++;
    await Promise.resolve();
    expect(started).toBe(2);
    return Response.json({ id: 1, title: 'Valid record' });
  });
  const result = await aggregate(sources, fetcher);
  expect(result.results).toHaveLength(2);
  expect(result.errors).toEqual([]);
});
test('partial failures preserve successful records and structured HTTP errors', async () => {
  const result = await aggregate(
    sources,
    transport(async (url) =>
      url.endsWith('first')
        ? Response.json({ id: 1, title: 'Valid' })
        : new Response(null, { status: 503 }),
    ),
  );
  expect(result.results).toHaveLength(1);
  expect(result.errors).toEqual([
    { source: 'second', code: 'HTTP_ERROR', status: 503 },
  ]);
});
test('total network failure is settled without leaking provider errors', async () => {
  const result = await aggregate(
    sources,
    transport(async () => {
      throw new Error('private-provider-details');
    }),
  );
  expect(result.results).toEqual([]);
  expect(result.errors).toHaveLength(2);
  expect(JSON.stringify(result)).not.toContain('private');
});
test('malformed JSON, domain-invalid records and oversized bodies are rejected', async () => {
  for (const response of [
    new Response('{'),
    Response.json({ id: 'wrong' }),
    new Response('x'.repeat(1024 * 1024 + 1)),
  ]) {
    expect(
      (
        await aggregate(
          sources.slice(0, 1),
          transport(async () => response),
        )
      ).errors[0]?.code,
    ).toBe('INVALID_RESPONSE');
  }
});
