# Production-Grade RAG — Ask My Docs

[![Live Demo](https://img.shields.io/badge/Live_Demo-Vercel-blue?style=for-the-badge)](https://production-rag-beta.vercel.app)
[![Backend API](https://img.shields.io/badge/Backend_API-HuggingFace-orange?style=for-the-badge)](https://vgsampathkumar-production-rag-d1a67e9.hf.space)

An "Ask My Doc" pipeline built for domain-specific documents — legal contracts, real estate agreements, financial papers. Moves beyond basic RAG demos by combining hybrid retrieval (BM25 + vector search), cross-encoder re-ranking, and a measured evaluation harness.

**Retrieval Precision@5: 92%** — up from 75% with dense-only search.

---

## Why Hybrid + Re-ranking?

Basic RAG embeds your query, finds the nearest vectors, and hopes for the best. That breaks on real documents:

| Problem | Dense-only fails because | This system's fix |
|---|---|---|
| "Earnest money deposit" vs "upfront payment" | Embedding models normalize synonyms; exact terms may not surface | BM25 exact-match runs in parallel, always finds the literal string |
| 400-page scanned contract | Cosine similarity on OCR text | Page-level OCR fallback (Tesseract), then hybrid retrieval |
| "Is this the most relevant chunk?" | Bi-encoders compare embeddings independently | Cross-encoder reads (query, chunk) together — same as a human would |

Precision@5 by retrieval method on the 12-query evaluation set:

| Method | Precision@5 |
|---|---|
| Dense-only (ChromaDB) | 75% |
| Hybrid (dense + BM25) | 83% |
| **Hybrid + cross-encoder re-ranking** | **92%** |

---

## Architecture

```
[PDF Upload]
      │
      ▼
[Adaptive Chunking]                    src/ingestion.py
  500–800 tokens · 15% overlap
  Sentence-boundary aware
  OCR fallback for scanned pages (Tesseract, 150 DPI)
      │
      ├─────────────────────────┐
      ▼                         ▼
[Dense Search]             [Sparse Search]
ChromaDB +                 BM25 (rank-bm25)
text-embedding-3-small     Keyword index
      │                         │
      └──────────┬──────────────┘
                 ▼
      [Hybrid Fusion + Dedup]
                 │
                 ▼
      [Cross-Encoder Re-ranking]
      TinyBERT-L-2 (~200ms on CPU)
                 │
                 ▼
      [Top-5 Chunks → GPT-4o-mini]
      Streaming SSE · Source citations
```

---

## Features

- **Adaptive chunking** — sentence-boundary aware, 500–800 tokens, 15% overlap, idempotent MD5 chunk IDs
- **Hybrid retrieval** — dense vectors (ChromaDB) + BM25 keyword search run concurrently in threads
- **Cross-encoder re-ranking** — TinyBERT-L-2 scores (query, chunk) pairs jointly for precision
- **Streaming answers** — Server-Sent Events, GPT-4o-mini, chunk citations with source + page number
- **OCR pipeline** — PyMuPDF renders pages at 150 DPI, Tesseract extracts text; graceful fallback if unavailable
- **Per-user isolation** — Clerk JWT auth; every chunk tagged with `user_id`, every query filtered
- **Background ingestion** — large PDFs (400+ pages) are saved instantly, OCR/indexing runs in a thread pool
- **Batched embeddings** — ChromaDB upserts in 150-chunk batches to stay under OpenAI's 300k token/request limit
- **Evaluation harness** — 12-query golden dataset, `eval/eval_precision.py --k 5` reports Precision@K
- **Observability** — `/debug/auth` and `/debug/backend` expose dependency health without auth

---

## Tech Stack

| Layer | Technology |
|---|---|
| API | FastAPI + uvicorn (SSE streaming, BackgroundTasks) |
| Vector store | ChromaDB (persistent, per-user metadata filters) |
| Embeddings | OpenAI `text-embedding-3-small` |
| Keyword search | rank-bm25 |
| Re-ranking | `cross-encoder/ms-marco-TinyBERT-L-2-v2` |
| LLM | GPT-4o-mini |
| PDF parsing | PyPDF + PyMuPDF + Tesseract |
| Auth | Clerk (JWKS/RS256 JWT verification via PyJWT) |
| Frontend | React 18 + Vite + Tailwind CSS + Framer Motion |
| Deployment | HuggingFace Spaces (Docker) + Vercel |

---

## Quick Start

**Prerequisites:** Python 3.11+, Node.js 18+, Tesseract (`brew install tesseract` / `apt install tesseract-ocr`)

```bash
# Clone
git clone https://github.com/vgsampathkumar/production_rag
cd production_rag

# Backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env: set OPENAI_API_KEY and CLERK_JWKS_URL
uvicorn api.server:app --host 0.0.0.0 --port 8000 --reload
```

```bash
# Frontend (new terminal)
cd ui && npm install
# Create ui/.env.local:
# VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
# VITE_API_BASE=http://localhost:8000
npm run dev
```

```bash
# Run evaluation (after indexing documents locally)
python eval/eval_precision.py --k 5 --verbose
```

---

## Documentation

| Doc | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Phase-by-phase deep-dive: chunking algorithm, BM25 vs dense, re-ranking model selection, background upload pattern |
| [docs/api-reference.md](docs/api-reference.md) | All endpoints, request/response schemas, SSE event format |
| [docs/authentication.md](docs/authentication.md) | Clerk setup, JWT verification flow, per-user document isolation |
| [docs/deployment.md](docs/deployment.md) | HuggingFace Spaces + Vercel deployment guide with checklist |

---

## Project Structure

```
production_rag/
├── api/
│   └── server.py          # FastAPI: all endpoints, auth, background tasks
├── src/
│   ├── ingestion.py       # PDF parsing, OCR, adaptive chunking
│   └── search.py          # ChromaDB + BM25 + cross-encoder
├── eval/
│   ├── eval_precision.py  # Precision@K evaluation harness
│   └── eval_queries.jsonl # 12-query golden dataset
├── ui/                    # React frontend
├── docs/                  # Architecture, API, auth, deployment docs
├── Dockerfile             # HuggingFace Spaces deployment
└── requirements.txt
```
