# Production-Grade RAG — Complete Documentation

An enterprise-ready "Ask My Doc" pipeline for domain-specific documents (legal contracts, real estate agreements, financial papers). Combines lexical and semantic retrieval with neural re-ranking, streaming answers, per-user authentication, and a React UI.

**Live Demo:** https://production-rag-beta.vercel.app  
**Backend API:** https://vgsampathkumar-production-rag-d1a67e9.hf.space

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Feature Summary](#feature-summary)
- [Performance Metrics](#performance-metrics)
- [Tech Stack](#tech-stack)
- [Quick Start (Local)](#quick-start-local)
- [Detailed Docs](#detailed-docs)

---

## Architecture Overview

```
[PDF Upload]
     │
     ▼
[Adaptive Chunking Engine]          src/ingestion.py
  500–800 tokens · 15% overlap
  Sentence-boundary aware
  OCR fallback (Tesseract) for scanned PDFs
     │
     ├──────────────────────────────────┐
     ▼                                  ▼
[Dense Path]                      [Sparse Path]
ChromaDB + OpenAI                 BM25 (rank-bm25)
text-embedding-3-small            Keyword index
     │                                  │
     └──────────────┬───────────────────┘
                    ▼
         [Hybrid Aggregation]
         Dedup · Score fusion
                    │
                    ▼
         [Cross-Encoder Re-Ranker]
         TinyBERT-L-2 (~200ms)
                    │
                    ▼
         [Top-5 Re-ranked Chunks]
                    │
                    ▼
         [GPT-4o-mini Answer]
         Streaming SSE · Source citations
```

---

## Feature Summary

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Adaptive PDF chunking (500–800 tokens, 15% overlap) | ✅ |
| 1 | OCR fallback for scanned PDFs (Tesseract) | ✅ |
| 2 | Dense vector search (ChromaDB + OpenAI embeddings) | ✅ |
| 2 | Sparse BM25 keyword search | ✅ |
| 2 | Hybrid fusion (dense + sparse, deduplication) | ✅ |
| 3 | Cross-encoder re-ranking (TinyBERT-L-2) | ✅ |
| 3 | Golden evaluation dataset + Precision@K harness | ✅ |
| 4 | Streaming SSE answers (GPT-4o-mini) | ✅ |
| 4 | Latency optimization (TinyBERT 4× faster than MiniLM) | ✅ |
| 5 | Per-user authentication (Clerk — Google/GitHub/Facebook) | ✅ |
| 5 | Document isolation per user (ChromaDB metadata filter) | ✅ |
| 5 | Document delete with BM25 rebuild | ✅ |
| 5 | AI Notebook (document summaries + research guide) | ✅ |
| 5 | React UI with drag-and-drop upload + streaming chat | ✅ |

---

## Performance Metrics

| Metric | Target | Achieved |
|--------|--------|----------|
| Retrieval Precision@5 | ≥ 92% | **92%** (11/12 eval queries) |
| Re-ranking latency | ≤ 100ms | ~200ms (TinyBERT on CPU) |
| Upload response time | < 60s | Instant (background task) |
| Streaming TTFT | — | < 1s |

---

## Tech Stack

**Backend**
- FastAPI + uvicorn (streaming SSE, background tasks)
- ChromaDB (persistent vector store, metadata filtering)
- OpenAI `text-embedding-3-small` (dense embeddings)
- rank-bm25 (sparse keyword index)
- `cross-encoder/ms-marco-TinyBERT-L-2-v2` (re-ranking)
- GPT-4o-mini (answer generation)
- PyPDF + PyMuPDF + Tesseract (PDF parsing + OCR)
- PyJWT + Clerk JWKS (JWT authentication)

**Frontend**
- React 18 + Vite
- Clerk React SDK (sign-in, user management)
- Framer Motion (animations)
- Tailwind CSS (dark UI)

**Infrastructure**
- HuggingFace Spaces (Docker, backend)
- Vercel (frontend)
- Clerk (authentication service)

---

## Quick Start (Local)

### Prerequisites
- Python 3.11+
- Node.js 18+
- Tesseract OCR (`brew install tesseract` / `apt install tesseract-ocr`)
- OpenAI API key
- Clerk account (free tier)

### Backend

```bash
# Clone and install
git clone https://github.com/vgsampathkumar/production_rag
cd production_rag
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env: set OPENAI_API_KEY and CLERK_JWKS_URL

# Run API server
uvicorn api.server:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend

```bash
cd ui
npm install
# Create ui/.env.local:
# VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
# VITE_API_BASE=http://localhost:8000
npm run dev
```

### Run Evaluation

```bash
# After indexing documents locally:
python eval/eval_precision.py --k 5 --verbose
```

---

## Detailed Docs

| Document | Description |
|----------|-------------|
| [architecture.md](architecture.md) | Deep-dive on each phase, algorithms, design decisions |
| [api-reference.md](api-reference.md) | All API endpoints, request/response schemas |
| [deployment.md](deployment.md) | HuggingFace Spaces + Vercel deployment guide |
| [authentication.md](authentication.md) | Clerk setup, JWT flow, per-user isolation |
