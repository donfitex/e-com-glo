import { LocalEmbeddings } from '../src/modules/search/embeddings';
const vector = Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0));
const model = 'sentence-transformers/all-MiniLM-L6-v2';
test('local embedding adapter sends bounded requests and validates model/dimensions', async () => {
  const send = jest.fn(async () => Response.json({ model, embedding: vector }));
  expect(
    await new LocalEmbeddings(
      'http://model.internal:8000',
      send as typeof fetch,
    ).embed('headphones for running'),
  ).toEqual(vector);
  expect(send).toHaveBeenCalledWith(
    expect.any(URL),
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ text: 'headphones for running' }),
      signal: expect.any(AbortSignal),
    }),
  );
});
test('invalid model payloads, zero vectors and provider errors cannot enter search', async () => {
  for (const body of [
    { model: 'unknown', embedding: vector },
    { model, embedding: [1, 2] },
    { model, embedding: Array(384).fill(0) },
  ]) {
    await expect(
      new LocalEmbeddings('http://model.internal', (async () =>
        Response.json(body)) as typeof fetch).embed('query'),
    ).rejects.toThrow();
  }
  await expect(
    new LocalEmbeddings(
      'http://model.internal',
      (async () => new Response(null, { status: 503 })) as typeof fetch,
    ).embed('query'),
  ).rejects.toThrow('unavailable');
});
