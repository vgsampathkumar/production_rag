# Architecture Deep-Dive

---

## Phase 1 — Adaptive Segmentation & PDF Parsing

**File:** `src/ingestion.py`

### Why adaptive chunking?

Fixed-size chunking at 512 tokens blindly splits sentences mid-thought, degrading retrieval quality. The adaptive chunker respects sentence boundaries:

1. Text is split into sentences using paragraph breaks and punctuation
2. Sentences are accumulated into a buffer
3. When the buffer reaches `target_max` (800 tokens), it flushes — but only if it has already reached `target_min` (500 tokens)
4. A 15% overlap window is carried forward into the next chunk to preserve cross-boundary context

```
[Long Document]
      │
      ▼
  split_into_sentences()
      │  ┌──────────────────────────────┐
      │  │ Sentence stream              │
      │  │ sent_1, sent_2, sent_3, ...  │
      │  └──────────────────────────────┘
      ▼
  Accumulate until 500–800 tokens
      │
      ├── flush_chunk() → Chunk N
      │
      └── carry 15% tail → Chunk N+1 (overlap)
```

### OCR Fallback

For scanned PDFs with no text layer:
1. PyPDF attempts direct text extraction on each page
2. Pages with empty text trigger PyMuPDF (`fitz`) to render the page at 150 DPI
3. Tesseract OCR extracts text from the rendered image
4. Pages that remain empty after OCR are silently skipped

DPI is set to 150 (reduced from 300) to balance speed vs. accuracy — 4× less memory and 4× faster OCR with negligible accuracy loss for standard contract fonts.

### Chunk ID

Each chunk gets a deterministic MD5 ID from `source::chunk_index::text[:50]`. This makes upserts idempotent — re-indexing the same file replaces existing chunks rather than duplicating them.

---

## Phase 2 — Dual-Engine Indexing (Dense + Sparse)

**File:** `src/search.py`

### Dense Path — ChromaDB + OpenAI Embeddings

```python
OpenAIEmbeddingFunction(model_name="text-embedding-3-small")
chromadb.PersistentClient(path="chroma_store/")
```

`text-embedding-3-small` produces 1536-dimensional vectors. ChromaDB stores these with metadata (`source`, `page_num`, `token_count`, `user_id`) and supports `where` filter queries for per-user isolation.

**Batching:** ChromaDB upserts are batched at 150 chunks per call (~105k tokens) to stay under OpenAI's 300k-token-per-embedding-request limit.

### Sparse Path — BM25

```python
BM25Okapi(tokenized_corpus)
```

BM25 (Best Match 25) scores documents by term frequency weighted against inverse document frequency across the corpus. It excels at exact keyword matching — critical for legal/financial documents where precise terms like "earnest money deposit" or "contingency clause" must surface exact-match hits that semantic embeddings may normalize away.

Tokens are lowercased, filtered to alphanumeric, minimum 2 characters:
```python
re.findall(r"\b[a-z0-9]+\b", text.lower())
```

For per-user BM25 queries, the full chunk list is filtered by `user_id` before building a fresh in-memory BM25 index for that subset.

### Hybrid Fusion

Both paths run concurrently in threads. Results are deduplicated by `chunk_id`. If a chunk appears in both, the higher score wins and `retrieval_type` is marked `"both"` — a strong signal for the re-ranker.

---

## Phase 3 — Cross-Encoder Re-Ranking

**File:** `src/search.py` → `re_rank()`

### Why re-rank?

The dual-index retrieval step optimizes for recall — it surfaces broad candidate sets. The cross-encoder optimizes for precision — it scores each (query, chunk) pair by jointly attending to both strings, which bi-encoder embeddings cannot do.

### Model Selection

| Model | Size | CPU Latency (20 pairs) | Accuracy |
|-------|------|----------------------|----------|
| `ms-marco-MiniLM-L-6-v2` | 22MB | ~2,500ms | High |
| `ms-marco-TinyBERT-L-2-v2` | 17MB | ~200ms | Good |

TinyBERT-L-2 is used in production — 4× faster at acceptable precision loss for the domain.

The model is pre-downloaded during Docker build to avoid cold-start latency:
```dockerfile
RUN python -c "from sentence_transformers import CrossEncoder; CrossEncoder('cross-encoder/ms-marco-TinyBERT-L-2-v2')"
```

### Pipeline

```
candidates = hybrid_search(query, dense_k=10, sparse_k=10)  # up to 20 unique chunks
pairs = [(query, chunk.text) for chunk in candidates]
scores = cross_encoder.predict(pairs)                        # joint attention scoring
top_5 = sorted by rerank_score, descending
```

---

## Phase 4 — Streaming Answer Generation

**File:** `api/server.py` → `/stream`

GPT-4o-mini generates answers from the top-5 re-ranked chunks using streaming Server-Sent Events (SSE):

```
event: chunk   ← retrieval result (source, page, score)
event: chunk
event: chunk
event: token   ← LLM token stream
event: token
event: done    ← latency metrics
```

The frontend parses the SSE stream and renders tokens as they arrive — typical time-to-first-token is under 1 second.

Context is constructed with chunk number labels so the model can cite `(Chunk 1)` etc. in its answer.

---

## Phase 5 — Authentication & Per-User Isolation

**Files:** `api/server.py`, `ui/src/` (Clerk components)

### JWT Flow

```
Browser                  Clerk CDN                 FastAPI
  │                          │                         │
  │── Sign In ──────────────►│                         │
  │◄─ JWT (RS256, 60s TTL) ──│                         │
  │                          │                         │
  │── POST /upload ──────────────────────────────────►│
  │   Authorization: Bearer <JWT>                       │
  │                          │                         │
  │                          │◄── JWKS fetch (cached) ─│
  │                          │──── public key ────────►│
  │                          │                         │── decode JWT → user_id
  │                          │                         │── store chunk metadata:
  │                          │                         │   {user_id: "user_abc"}
```

`PyJWKClient` fetches Clerk's JWKS endpoint (`/.well-known/jwks.json`) and caches the public keys. JWT decode uses `leeway=120s` to tolerate Clerk development instance token expiry (60s TTL + clock skew).

### Per-User Document Isolation

Every chunk upserted to ChromaDB carries `{"user_id": user_id}` in its metadata. Every query, listing, and delete is filtered:

```python
collection.get(where={"user_id": user_id})          # list documents
collection.query(..., where={"user_id": user_id})    # search
collection.get(where={"$and": [                      # delete
    {"source": {"$eq": name}},
    {"user_id": {"$eq": user_id}}
]})
```

Users see only their own documents. Deleting fetches matching chunk IDs first, then deletes by ID (avoiding a ChromaDB compound-filter bug with `collection.delete(where=...)`).

### Background Upload

Large PDFs (400+ pages) trigger OCR that takes 2-5 minutes — beyond HuggingFace Spaces' nginx 60-second proxy timeout. The solution:

1. `/upload` saves the file to disk and immediately returns `{"status": "queued"}`
2. A FastAPI `BackgroundTask` runs OCR + chunking + embedding in a thread pool
3. Frontend polls `/documents` every 10 seconds for up to 2 minutes
4. Document appears in the library once indexing completes

```
Client ──POST /upload──► server saves file ──► returns {"status": "queued"}  (instant)
                              │
                              └──► BackgroundTask: OCR → chunk → embed → upsert
                                   (runs in thread pool, 1–5 minutes)

Client ──GET /documents──► empty          (t=0)
Client ──GET /documents──► empty          (t=10s)
Client ──GET /documents──► [yourfile.pdf] (t=60–120s) ✓
```

---

## Evaluation Harness

**Files:** `eval/eval_precision.py`, `eval/eval_queries.jsonl`

12 golden queries against a real estate sales contract corpus. Each query specifies:
- The expected source document
- An expected fragment (keyword that must appear in a retrieved chunk)

```bash
python eval/eval_precision.py --k 5 --verbose
```

Measures **Precision@5**: fraction of queries where a relevant chunk appears in the top-5 re-ranked results.

**Baseline comparison:**
| Retrieval Strategy | Precision@5 |
|-------------------|-------------|
| Dense-only (ChromaDB) | 75% |
| Sparse-only (BM25) | 67% |
| Hybrid (dense + sparse) | 83% |
| Hybrid + Re-ranking | **92%** |

The 17-point lift from re-ranking on top of hybrid retrieval validates the cross-encoder step for precise domain queries.
