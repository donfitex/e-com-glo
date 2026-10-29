"""Optional local CPU embedding service; keep it on a private network."""
import os
from fastapi import FastAPI
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer

MODEL = "sentence-transformers/all-MiniLM-L6-v2"
# Pre-download and mount the model directory to avoid network access at runtime.
model = SentenceTransformer(os.environ.get("MODEL_PATH", MODEL), local_files_only=True)
app = FastAPI(title="E-com Global Local Embeddings")

class Input(BaseModel):
    text: str = Field(min_length=1, max_length=12000)

@app.post("/embed")
def embed(data: Input):
    return {"model": MODEL, "embedding": model.encode(data.text, normalize_embeddings=True).tolist()}
