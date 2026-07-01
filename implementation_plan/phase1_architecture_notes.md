# Production-Grade RAG with Hybrid Search & Re-ranking

## Context
Building an enterprise-ready "Ask My Doc" pipeline from scratch in `c:\Sampath\claude\production_rag\`. The workspace is currently empty. Existing projects at `c:\Sampath\rag` and `c:\Sampath\rag_documentation_helper` use LangChain + Pinecone — this new system intentionally avoids those abstractions, using direct library calls for full control over chunking, retrieval, and re-ranking.

**Goal:** Achieve ≥92% retrieval precision on keyword edge-cases, ≤100ms re-ranking overhead.

---

## Directory Structure

```
production_rag/
├── src/
│   ├── ingestion.py    # PDF parsing + adaptive chunking
│   ├── search.py       # ChromaDB + BM25 + cross-encoder
│   └── main.py         # CLI orchestration
├── data/               # Drop PDFs here
├── chroma_store/       # Auto-created by ChromaDB
├── requirements.txt
└── .env.example
```

---

## Phase 1 — `src/ingestion.py`

### Key functions

**`get_tokenizer() -> tiktoken.Encoding`**
- Singleton returning `cl100k_base` encoding (matches `text-embedding-3-small`)

**`extract_text_from_pdf(path: Path) -> List[Dict]`**
- Returns `[{page_text, page_num, source}]` per page via `pypdf.PdfReader`
- Skip None/empty pages silently (scanned PDFs)

**`split_into_sentences(text: str) -> List[str]`**
- Regex split on `(?<=[.!?])\s+(?=[A-Z])` + `\n\n` paragraph breaks
- No NLTK dependency

**`adaptive_chunk_text(pages, target_min=500, target_max=800, overlap_ratio=0.15) -> List[Dict]`**
- Greedy sentence accumulator: flush chunk when `current_tokens >= target_min` AND adding next sentence would exceed `target_max`
- Overlap tail: walk backwards through flushed sentences, keep sentences until `tail_tokens ≈ current_tokens * 0.15` — always splits at sentence boundary
- Chunk ID: `md5(f"{source}::{index}::{text[:50]}")[:16]` — deterministic, idempotent on re-ingest
- Output: `{text, source, chunk_id, token_count, page_num}`

**`ingest_directory(data_dir: Path) -> List[Dict]`**
- Glob `*.pdf`, process each, print progress, return flat chunk list

---

## Phase 2 — `src/search.py`

### `HybridSearchIndex` class

**`__init__(persist_directory, collection_name, openai_api_key, cross_encoder_model, rerank_top_k=5)`**
- `Path(persist_directory).mkdir(parents=True, exist_ok=True)` before ChromaDB init
- `chromadb.PersistentClient` + `OpenAIEmbeddingFunction("text-embedding-3-small")`
- `client.get_or_create_collection(...)` — idempotent startup
- `CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")` — ~23MB one-time download
- `self._bm25 = None`, `self._bm25_chunks = []`

**`_tokenize_for_bm25(text) -> List[str]`** (static)
- `re.findall(r'\b[a-z0-9]+\b', text.lower())`, filter len < 2
- Preserves numbers → handles codes like "GPT-4", "ISO-9001"

**`add_documents(chunks)`**
- Two threads in parallel (no mutex needed — write to separate structures):
  - Thread A: `collection.upsert(ids, documents, metadatas)` — batched at 5000 if large
  - Thread B: `BM25Okapi([tokenize(c["text"]) for c in chunks])`, store `self._bm25_chunks`
- Propagate exceptions from either thread

**`dense_search(query, top_k=20) -> List[Dict]`**
- `collection.query(query_texts=[query], n_results=top_k)`
- Normalize distance → score: `score = 1.0 - (distance / 2.0)`
- Tag `retrieval_type="dense"`

**`sparse_search(query, top_k=20) -> List[Dict]`**
- `bm25.get_scores(tokenize(query))`, argsort descending
- Normalize by max score; return empty list if max_score == 0
- Tag `retrieval_type="sparse"`

**`hybrid_search(query, dense_k=20, sparse_k=20) -> List[Dict]`**
- Run `dense_search` + `sparse_search` in parallel threads
- Dedup by `chunk_id`: keep higher-score entry, mark `retrieval_type="both"` for matches

**`re_rank(query, candidates, score_threshold=0.0) -> List[Dict]`**
- `pairs = [(query, c["text"]) for c in candidates]`
- `scores = cross_encoder.predict(pairs, batch_size=32)`
- Measure elapsed_ms; warn if > 100ms
- Sort descending by score, filter by threshold, return `[:rerank_top_k]`

**`build_bm25_from_collection()`**
- Called on warm restart: fetch all docs from ChromaDB, rebuild BM25 in-memory

---

## Phase 3 — `src/main.py`

- Load `.env`, validate `OPENAI_API_KEY`
- Instantiate `HybridSearchIndex`
- `build_index()`: if ChromaDB already has docs → call `build_bm25_from_collection()` (fast path, no PDF re-parsing); otherwise ingest `data/` directory
- Interactive CLI loop: `hybrid_search` → `re_rank` → `display_results` → optional `generate_answer` via `gpt-4o-mini`
- `ENABLE_LLM_ANSWER=true/false` in `.env` controls whether LLM synthesis runs

---

## Dependencies (`requirements.txt`)

```
openai>=1.0.0
chromadb>=0.5.0
rank-bm25>=0.2.2
sentence-transformers>=3.0.0
pypdf>=4.0.0
tiktoken>=0.7.0
python-dotenv>=1.0.0
```

---

## Verification

1. **Install:** `pip install -r requirements.txt`
2. **Setup:** Copy `.env.example` → `.env`, add `OPENAI_API_KEY`
3. **Place PDFs** in `production_rag/data/`
4. **Run:** `python production_rag/src/main.py`
5. **Cold start check:** Chunks printed, ChromaDB populated, BM25 built
6. **Warm restart check:** Second run skips PDF parsing, says "Using existing index"
7. **Keyword precision:** Query an exact technical term from a PDF → verify that chunk appears in top-3 BM25 results
8. **Re-ranking validation:** Cross-encoder should reorder the raw merged list at least 30% of the time
9. **Latency check:** Re-ranking elapsed_ms printed after each query — should be ≤100ms on CPU
