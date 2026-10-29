-- Optional search index. Requires a PostgreSQL installation with pgvector.
-- Apply explicitly after the core migrations; not required for ordinary commerce.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS "ProductEmbedding" (
 "productId" UUID PRIMARY KEY REFERENCES "Product"(id) ON DELETE CASCADE,
 model TEXT NOT NULL,
 "sourceText" TEXT NOT NULL,
 embedding vector(384) NOT NULL
);
CREATE INDEX IF NOT EXISTS "ProductEmbedding_cosine_idx"
 ON "ProductEmbedding" USING hnsw (embedding vector_cosine_ops);
