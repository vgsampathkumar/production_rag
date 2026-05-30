# Production-Grade RAG with Hybrid Search & Re-ranking

An enterprise-ready "Ask My Doc" pipeline for domain-specific documents (legal contracts, real estate agreements, financial papers). Combines lexical and semantic retrieval with neural re-ranking and a streaming React UI.

---

## Architecture

```
[PDF / Text Files]
       │
       ▼
[Adaptive Chunking Engine]          src/ingestion.py
  500–800 tokens · 15% overlap
  Sentence-boundary aware
  OCR fallback (Tesseract) for scanned PDFs
       │
       ├──────────────────────────────────┐
       ▼                                  ▼
[Dense Path]                        [Sparse Path]
ChromaDB + text-embedding-3-small   BM25 (rank-bm25)
Semantic similarity                 Keyword frequency
       │                                  │
       └───────────────┬──────────────────┘
                       ▼
          [Hybrid Merge & Dedup]        top 10 + top 10
                       │
                       ▼
          [Cross-Encoder Re-Ranker]     api/server.py
          ms-marco-TinyBERT-L-2-v2
          ~100ms avg on CPU
                       │
                       ▼
          [Top-5 Re-ranked Chunks]
                       │
                       ▼
          [GPT-4o-mini Answer]          streamed via SSE
                       │
                       ▼
          [React UI / CLI]              ui/ · src/main.py
```

---

## Features

- **Hybrid retrieval** — dense vector search (ChromaDB + OpenAI embeddings) merged with BM25 keyword search; deduplication by chunk ID keeps the higher-scored result
- **Cross-encoder re-ranking** — TinyBERT reads each (query, chunk) pair together for precise relevance scoring; ~100ms average on CPU
- **OCR support** — PyMuPDF + Tesseract fallback for scanned/image-only PDFs
- **Streaming React UI** — dark enterprise theme, drag-and-drop document upload, SSE-streamed LLM answers with token-by-token typewriter effect
- **Document upload** — add new PDFs through the UI; instantly indexed and searchable
- **Evaluation harness** — `eval/eval_precision.py` measures Precision@K against known query-answer pairs
- **Warm restart** — BM25 rebuilt from ChromaDB on startup; no re-parsing of PDFs
- **Fully configurable** — model, candidate pool size, and top-K all tunable via `.env`

---

## Measured Results

| Metric | Result | Target |
|--------|--------|--------|
| Precision@5 | **12/12 = 100%** | ≥ 92% |
| Avg re-rank latency | **~100ms** | ≤ 100ms |
| Documents ingested | **8/8** (incl. 2 OCR) | — |
| Chunks indexed | **70** | — |

---

## Prerequisites

| Dependency | Install |
|-----------|---------|
| Python 3.10+ | [python.org](https://python.org) |
| Node.js 18+ | [nodejs.org](https://nodejs.org) |
| Tesseract OCR | `winget install UB-Mannheim.TesseractOCR` (Windows) · `brew install tesseract` (macOS) · `apt install tesseract-ocr` (Linux) |
| OpenAI API key | [platform.openai.com](https://platform.openai.com) |

---

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/vgsampathkumar/production_rag.git
cd production_rag

# 2. Install Python dependencies
pip install -r requirements.txt

# 3. Install Node dependencies (for the UI)
cd ui && npm install && cd ..

# 4. Configure environment
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY
```

---

## Configuration (`.env`)

```env
# Required
OPENAI_API_KEY=sk-...

# Optional — defaults shown
ENABLE_LLM_ANSWER=true

# Latency vs accuracy trade-off
# Fast (default): cross-encoder/ms-marco-TinyBERT-L-2-v2   ~100ms, MRR@10=0.369
# Accurate:       cross-encoder/ms-marco-MiniLM-L-6-v2     ~2500ms, MRR@10=0.390
CROSS_ENCODER_MODEL=cross-encoder/ms-marco-TinyBERT-L-2-v2

# Retrieval pool sizes (lower = faster re-ranking)
DENSE_K=10
SPARSE_K=10
RERANK_TOP_K=5
```

---

## Running

### Web UI (recommended)

```bash
# Terminal 1 — ingest PDFs on first run (drop PDFs into data/ first)
python src/main.py

# Terminal 2 — API backend
uvicorn api.server:app --reload --port 8000

# Terminal 3 — React frontend
cd ui && npm run dev
```

Open **http://localhost:5173**

### CLI

```bash
# First run — ingest PDFs from data/
python src/main.py

# Subsequent runs — warm start from existing index
python src/main.py

# Force re-ingest (after adding new PDFs via CLI)
python src/main.py --reingest
```

### Evaluation

```bash
# Measure Precision@5 across 12 test queries
python eval/eval_precision.py

# Stricter: Precision@3
python eval/eval_precision.py --k 3

# Show retrieved chunk text for each query
python eval/eval_precision.py --verbose
```

---

## Using the UI

| Feature | How |
|---------|-----|
| Ask a question | Type in the search bar and press **Ask** or Enter |
| Upload new documents | Click **Manage Documents** → drag PDFs onto the drop zone → **Upload** |
| View indexed library | Click **Manage Documents** to see all files and chunk counts |
| Inspect retrieved chunks | Each card shows source, page, token count, retrieval type badge (DENSE / SPARSE / BOTH), and re-rank score bar |
| View timing | Metrics bar appears after each query showing Search / Re-rank / LLM latency |

---

## Project Structure

```
production_rag/
├── api/
│   └── server.py              # FastAPI: /health /query /stream /documents /upload
├── src/
│   ├── ingestion.py           # PDF parsing, OCR fallback, adaptive chunking
│   ├── search.py              # HybridSearchIndex (ChromaDB + BM25 + cross-encoder)
│   └── main.py                # CLI query loop
├── eval/
│   ├── eval_queries.jsonl     # 12 evaluation test cases
│   └── eval_precision.py      # Precision@K measurement script
├── ui/
│   ├── src/
│   │   ├── App.jsx            # State machine + SSE stream client
│   │   └── components/
│   │       ├── SearchBar.jsx   # Animated search input
│   │       ├── UploadPanel.jsx # Drag-and-drop document upload
│   │       ├── ResultCard.jsx  # Per-chunk result card
│   │       ├── ResultsList.jsx # Staggered animation list
│   │       ├── AnswerPanel.jsx # Streaming LLM answer
│   │       └── MetricsBar.jsx  # Timing display
│   ├── package.json
│   └── vite.config.js
├── implementation_plan/       # Iteration documentation (3 iterations)
├── .env.example               # Configuration template
├── requirements.txt
└── README.md
```

> **Not committed:** `data/` (your PDFs), `.env` (API keys), `chroma_store/` (vector index), `ui/node_modules/`

---

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | `{"status":"ok","chunks_indexed":N}` |
| `/documents` | GET | List all indexed documents with chunk counts |
| `/query` | POST | Single-shot: `{query, dense_k, sparse_k, enable_llm}` → full JSON response |
| `/stream` | POST | SSE stream: `chunk` · `token` · `done` events |
| `/upload` | POST | `multipart/form-data` with `files` field; saves, ingests, and indexes PDFs |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Embeddings | OpenAI `text-embedding-3-small` |
| Vector store | ChromaDB (local persistent) |
| Lexical search | `rank-bm25` (BM25Okapi, in-memory) |
| Re-ranking | `sentence-transformers` CrossEncoder |
| Answer synthesis | OpenAI `gpt-4o-mini` |
| PDF parsing | `pypdf` + PyMuPDF + Tesseract OCR |
| Token counting | `tiktoken` (`cl100k_base`) |
| Backend | FastAPI + uvicorn + sse-starlette |
| Frontend | React 18 + Vite + Tailwind CSS + Framer Motion |
