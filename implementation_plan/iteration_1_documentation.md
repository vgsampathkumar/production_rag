# Iteration 1 — Production-Grade RAG with Hybrid Search & Re-ranking

**Date:** 2026-05-29  
**Status:** Core pipeline complete, latency tuning pending

---

## Objective

Move beyond basic vector-only RAG demos to build an enterprise-ready "Ask My Doc" pipeline capable of handling domain-specific documents (legal contracts, real estate agreements, financial papers). The distinguishing feature over simpler RAG systems is a **hybrid retrieval layer** (lexical + semantic) combined with a **neural re-ranking step** to capture complex terminology that single embedding models often miss.

**Success Targets:**
- Retrieval Precision ≥ 92% on specific keyword edge-cases
- Re-ranking execution latency ≤ 100ms overhead

---

## Architecture Overview

```
[PDF / Text Files]
       │
       ▼
[Adaptive Chunking Engine]
  500–800 tokens per chunk
  15% rolling window overlap
  Sentence-boundary aware
       │
       ├─────────────────────────────────┐
       ▼                                 ▼
[Dense Path]                       [Sparse Path]
ChromaDB Vector Index              BM25 Lexical Index
text-embedding-3-small             rank-bm25 (in-memory)
(semantic similarity)              (keyword frequency)
       │                                 │
       └──────────────┬──────────────────┘
                      ▼
         [Aggregated Raw Results]
          Top 20 dense + Top 20 BM25
          Deduplication by chunk_id
                      │
                      ▼
         [Cross-Encoder Re-Ranker]
         ms-marco-MiniLM-L-6-v2
         Scores each query-chunk pair
                      │
                      ▼
         [Top-5 Re-ranked Chunks]
                      │
                      ▼
         [GPT-4o-mini Answer Generation]
         Cited, context-grounded answer
```

---

## Project Structure

```
production_rag/
├── src/
│   ├── ingestion.py          # PDF parsing + adaptive chunking
│   ├── search.py             # HybridSearchIndex (ChromaDB + BM25 + cross-encoder)
│   └── main.py               # CLI orchestration loop
├── data/                     # Input PDFs (drop files here)
├── chroma_store/             # ChromaDB persistent index (auto-created)
├── implementation_plan/
│   └── iteration_1_documentation.md   # This file
├── requirements.txt
├── .env                      # API keys (not committed)
└── .env.example              # Template for API keys
```

---

## Module 1: `src/ingestion.py` — Document Parser & Chunker

### Purpose
Reads raw PDF files and converts them into clean, token-bounded, overlapping text chunks ready for indexing.

### Key Functions

#### `get_tokenizer()`
- Returns a singleton `tiktoken` encoder using the `cl100k_base` vocabulary
- This matches the tokenizer used by `text-embedding-3-small`, ensuring token counts used during chunking are accurate relative to the embedding model

#### `extract_text_from_pdf(path)`
- Opens each PDF page-by-page using `pypdf.PdfReader`
- Skips pages that return `None` or empty text (handles scanned/image-only PDFs gracefully)
- Returns a list of `{page_text, page_num, source}` dicts preserving per-page provenance for metadata

#### `split_into_sentences(text)`
- Splits text into individual sentences using pure regex — no NLTK or external NLP dependency
- First splits on paragraph breaks (`\n\n`) as hard boundaries
- Then splits within paragraphs on sentence-ending punctuation followed by a capital letter: `(?<=[.!?])\s+(?=[A-Z])`

#### `adaptive_chunk_text(pages, target_min=500, target_max=800, overlap_ratio=0.15)`
The core chunking algorithm. Uses a **greedy sentence accumulator**:

1. Flattens all pages into a single ordered sentence stream with page provenance
2. Accumulates sentences until `current_tokens >= target_min` AND adding the next sentence would exceed `target_max`
3. On flush, walks backwards through the current chunk's sentences to find the overlap tail — sentences whose combined tokens ≈ `current_tokens × 0.15`
4. Overlap tail is carried forward into the next chunk, always at a sentence boundary (never mid-sentence)
5. Each chunk gets a **deterministic MD5 ID** (`source::index::text[:50]`) — re-ingesting the same PDF runs `upsert` (no duplicates)

**Output per chunk:**
```
{
  text:        str   # joined sentence text
  source:      str   # PDF filename
  chunk_id:    str   # 16-char hex deterministic ID
  token_count: int   # exact tiktoken count
  page_num:    int   # page of first sentence in chunk
}
```

#### `ingest_directory(data_dir)`
- Globs all `*.pdf` files, processes each, prints progress per file
- Returns a flat list of all chunks across all documents

### Run Results (Iteration 1)
| PDF | Chunks | Notes |
|-----|--------|-------|
| Williams_Grove_lot_3_-_Sales_contract.pdf | 47 | 45-page contract |
| SampathVGKumar.pdf | 6 | — |
| SampathVGKumar-Madhu Agreement.pdf | 6 | — |
| Sampath_20Subhashini_20Preapproval.pdf | 1 | — |
| ifp-download.pdf | 1 | — |
| Lot 3 Shiloh D quote.pdf | 0 | Scanned image — no extractable text |
| Lot 3 Shiloh D quote (1).pdf | 0 | Scanned image — no extractable text |
| Williams_Grove_lot_3_-_Customer_Information_S.pdf | 1 | — |
| **Total** | **62 chunks** | avg 742 tokens/chunk |

---

## Module 2: `src/search.py` — Hybrid Search & Re-ranking Engine

### Purpose
Stores chunks in two complementary indices and re-ranks merged results using a neural cross-encoder.

### `HybridSearchIndex` Class

#### Initialization
- Creates a `chromadb.PersistentClient` backed by the local `chroma_store/` directory — index survives restarts
- Attaches an `OpenAIEmbeddingFunction` using `text-embedding-3-small` — ChromaDB calls OpenAI automatically on every query
- Uses `get_or_create_collection` — idempotent, safe to call on every startup
- Loads `CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")` — ~23MB model, one-time download to `~/.cache/huggingface`
- BM25 index starts as `None` and is built separately (it is not persistent)

#### `_tokenize_for_bm25(text)` — static
- Lowercases and extracts word tokens via `re.findall(r'\b[a-z0-9]+\b', text)`
- Filters tokens shorter than 2 characters
- Preserves numeric tokens — handles codes like `ISO-9001`, `GPT-4`, dollar amounts

#### `add_documents(chunks)` — Dual Parallel Indexing
Runs two threads simultaneously:
- **Thread A (ChromaDB):** Batch-upserts all chunks (IDs, documents, metadata). Batches at 5000 to avoid memory ceiling.
- **Thread B (BM25):** Tokenizes all chunks and builds a `BM25Okapi` index in-memory. Stores the ordered chunk list for index→chunk lookup.

No mutex is needed during construction since the two threads write to separate data structures.

#### `dense_search(query, top_k=20)`
- Embeds the query via `text-embedding-3-small` (handled automatically by ChromaDB's embedding function)
- Queries ChromaDB for top-k by cosine distance
- Normalizes distance to similarity score: `score = 1.0 - (distance / 2.0)` → range [0, 1]
- Tags results with `retrieval_type="dense"`

#### `sparse_search(query, top_k=20)`
- Tokenizes query using `_tokenize_for_bm25`
- Calls `bm25.get_scores()` over the full corpus
- Normalizes scores by dividing by the max score → range [0, 1]
- Returns empty list if max score is 0 (query terms not in corpus)
- Tags results with `retrieval_type="sparse"`

#### `hybrid_search(query, dense_k=20, sparse_k=20)`
- Runs `dense_search` and `sparse_search` **in parallel threads**
- Merges results with deduplication by `chunk_id`:
  - If a chunk appears in both results → keep the higher-score version, mark `retrieval_type="both"`
  - If unique to one path → keep as-is
- Returns up to 40 deduplicated candidates

#### `re_rank(query, candidates, score_threshold=-inf)`
- Builds `(query, chunk_text)` pairs for every candidate
- Runs `CrossEncoder.predict(pairs, batch_size=32)` — reads query+chunk together for precise relevance scoring
- Measures elapsed time; warns if > 100ms
- Sorts descending by cross-encoder score, filters by threshold, returns top 5

> **Note on cross-encoder scores:** `ms-marco-MiniLM-L-6-v2` outputs raw logits (not probabilities), typically in the range `[-10, 10]`. Higher = more relevant. Default threshold is `-inf` (keep all).

#### `build_bm25_from_collection()`
- Called on warm restarts when ChromaDB is populated but BM25 is cold
- Fetches all documents from ChromaDB and rebuilds the BM25 index in-memory
- Avoids re-parsing PDFs on every run

---

## Module 3: `src/main.py` — CLI Orchestration

### Purpose
Wires ingestion, search, and answer generation into an interactive query loop.

### Startup Logic

```
Is ChromaDB already populated?
  YES → Warm restart: rebuild BM25 from ChromaDB (~1 second), skip PDF parsing
  NO  → Cold start: ingest PDFs → build ChromaDB + BM25
  --reingest flag → Force re-parse even if index exists
```

### Query Loop (per query)
1. `hybrid_search(query)` → parallel dense + BM25, deduplicated candidates
2. `re_rank(query, candidates)` → cross-encoder scores, top 5 returned
3. `display_results()` → prints chunk preview, rerank score, source, page, token count
4. `generate_answer()` → sends top-5 chunks as context to `gpt-4o-mini`, returns cited answer

### Configuration (`.env`)
| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | required | Used for embeddings + GPT-4o-mini |
| `ENABLE_LLM_ANSWER` | `true` | Set to `false` to skip GPT answer generation |

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `openai` | ≥1.0.0 | Embeddings (`text-embedding-3-small`) + answer generation (`gpt-4o-mini`) |
| `chromadb` | ≥0.5.0 | Local persistent vector database for dense search |
| `rank-bm25` | ≥0.2.2 | BM25 lexical index for sparse keyword search |
| `sentence-transformers` | ≥3.0.0 | Cross-encoder re-ranking model |
| `pypdf` | ≥4.0.0 | PDF text extraction |
| `tiktoken` | ≥0.7.0 | Accurate token counting (cl100k_base) |
| `python-dotenv` | ≥1.0.0 | `.env` file loading |

---

## Verified Behaviour (Iteration 1 Test Run)

### Query: "what is the total contract price?"
- Hybrid search: 28 unique candidates
- Top result: `Williams_Grove_lot_3_-_Sales_contract.pdf p.16` (type=both)
- **Answer generated:** *"The total contract price, referred to as the Net Purchase Price, is $853,575.00 (Chunk 1)."*
- Correct ✓

### Query: "what are the buyer obligations?"
- Hybrid search: 31 unique candidates
- Top result: `Williams_Grove_lot_3_-_Sales_contract.pdf p.6` (type=both)
- **Answer generated:** Listed 6 specific buyer obligations with source citation
- Correct ✓

### Warm Restart Verified
- Second run loaded from existing ChromaDB, BM25 rebuilt in ~1 second
- No PDF re-parsing occurred ✓

---

## Known Issues & Pending Work

| Issue | Severity | Notes |
|-------|----------|-------|
| Re-ranking latency ~2500ms | Medium | CPU-only execution; target is ≤100ms. Requires GPU or reduced candidate pool. Option A: reduce `dense_k`/`sparse_k` to 5. Option B: switch to `ms-marco-TinyBERT-L-2-v2`. |
| 2 PDFs skipped (scanned images) | Low | `Lot 3 Shiloh D quote.pdf` files contain image-only pages. Fix requires OCR integration (`pytesseract` + `pdf2image`). |
| No evaluation harness | Low | ≥92% precision target has no automated measurement yet. Needs `eval_queries.jsonl` + `eval_precision.py`. |

---

## How to Run

```bash
# Install dependencies (one-time)
pip install -r requirements.txt

# First run — ingests PDFs, builds indices
python src/main.py

# Subsequent runs — warm restart from existing index
python src/main.py

# Force re-ingest (e.g. after adding new PDFs)
python src/main.py --reingest
```

---

## Next Iteration Options

1. **Fix latency** — Reduce candidate pool or switch to TinyBERT cross-encoder
2. **OCR support** — Add `pytesseract` to handle scanned PDFs
3. **Evaluation harness** — Build precision measurement script to validate ≥92% target
