import { z } from 'zod';
export interface Embeddings {
  readonly model: string;
  embed(text: string): Promise<number[]>;
}
export class LocalEmbeddings implements Embeddings {
  readonly model = 'sentence-transformers/all-MiniLM-L6-v2';
  constructor(
    private readonly endpoint: string,
    private readonly transport: typeof fetch = fetch,
  ) {}
  async embed(text: string) {
    const response = await this.transport(new URL('/embed', this.endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error('Embedding service unavailable');
    const data = z
      .object({
        model: z.literal(this.model),
        embedding: z.array(z.number().finite()).length(384),
      })
      .parse(await response.json());
    if (!data.embedding.some((n) => n !== 0)) throw new Error('Zero embedding');
    return data.embedding;
  }
}
