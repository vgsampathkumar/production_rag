# Why This Is Production-Grade RAG

A breakdown of what separates this system from a basic RAG demo — covering robustness, failure handling, and where it outperforms traditional single-path retrieval.

---

## 1. What "Production-Ready" Actually Means Here

A basic RAG demo does three things: embed a PDF, store vectors, query with cosine similarity. That works in a notebook. Production means it holds up when:

- Documents are 400 pages, scanned, or in poor condition
- Multiple users share the same backend
- The OpenAI API has token-per-request limits
- The infrastructure proxy kills connections after 60 seconds
- You need to prove retrieval quality with numbers, not intuition

Every one of those failure modes was hit during development and solved:

| Failure Mode | Naive Approach | This System |
|---|---|---|
| 400-page scanned PDF | OCR blocks the HTTP request for 5 min → proxy timeout | File saved instantly; OCR runs in `BackgroundTask`; frontend polls |
| 400k-token embedding batch | Single `upsert()` → OpenAI 400 error | Batched at 150 chunks (~105k tokens) per call |
| JWT expires mid-session | 401 every 60 seconds | `leeway=120s` in PyJWT + configurable Clerk session TTL |
| Re-uploading the same PDF | Duplicate chunks → inflated results | Deterministic MD5 chunk IDs make every upsert idempotent |
| User A sees User B's docs | Shared ChromaDB collection | Every chunk tagged `user_id`; every query filtered by it |
| Tesseract not installed | OCR crash | Graceful fallback — text-layer pages indexed, image-only pages skipped |

---

## 2. Robustness & Stability Details

**Idempotent indexing.** Chunk IDs are MD5 hashes of `source::chunk_index::text_prefix`. Re-uploading the same PDF replaces existing chunks — it never duplicates. A naive system doubles chunk count on every re-upload.

**Thread-safe BM25.** The BM25 index lives in memory and gets rebuilt after every upload or delete. A `threading.Lock` guards all reads and writes. Without this, a concurrent query and upload would race on the index data structure.

**ChromaDB compound filter workaround.** `collection.delete(where={"$and": [...]})` silently fails in ChromaDB. The delete endpoint fetches matching chunk IDs first via `collection.get()`, then deletes by ID — reliable across all ChromaDB versions.

**Background error surfacing.** Background task failures (OCR errors, embedding API errors) are caught, logged, and stored in a ring buffer accessible via `/debug/backend`. Without this, silent failures show as "No documents indexed" with no explanation.

**Observability endpoints.** `/debug/auth` and `/debug/backend` expose the health of every external dependency — Clerk JWKS reachability, OpenAI API connectivity, ChromaDB chunk count, recent background errors — without requiring authentication.

---

## 3. Features Worth Highlighting

**Hybrid retrieval** is the centerpiece. Dense vectors and BM25 run in parallel threads. A legal document with "earnest money deposit" surfaces via BM25 exact-match even when the query says "upfront payment" — the semantic path handles paraphrase, the keyword path handles terminology. Neither alone is sufficient.

**Cross-encoder re-ranking** is the precision layer. After retrieval gives 20 candidate chunks optimized for recall, TinyBERT scores each (query, chunk) pair jointly — attending to both strings simultaneously, the way a human would compare them. Precision@5 goes from 83% (hybrid retrieval alone) to 92% (hybrid + re-ranking).

**Adaptive chunking** matters for legal documents. A paragraph about "closing conditions" should not be split at an arbitrary 512-token boundary. The chunker accumulates sentences until it has 500–800 tokens, respects paragraph and sentence breaks, and carries a 15% overlap tail into the next chunk to preserve cross-boundary references.

**Page-granular OCR.** Most RAG demos assume text-layer PDFs. This system detects missing text layers per-page and falls back to Tesseract (at 150 DPI). A 50-page document where pages 1–40 have text and pages 41–50 are scanned images handles each correctly without treating the whole document as scanned.

**Evaluation dataset.** 12 golden queries against real estate contracts, each with a known source document and expected keyword fragment. `eval/eval_precision.py` runs the full pipeline and reports Precision@K — a regression test you can run in one command when changing models or retrieval parameters.

**Streaming with chunk attribution.** The `/stream` endpoint emits retrieved chunks before the LLM answer starts. Users see which document and page number each chunk came from. The LLM is instructed to cite `(Chunk N)` in its answer. "The contract says X on page 7" is verifiable; "AI says X" is not.

---

## 4. Where This Stands Out vs. Traditional RAG

Traditional RAG pipeline: `embed(query) → cosine_similarity → top_k → LLM`

That's a single-path, single-model system. It has well-known failure modes:

**Vocabulary mismatch.** Embedding models normalize semantically similar terms. A query about "liquidated damages" may not retrieve the chunk containing "penalty clause" because both map to similar but distinct vector regions. BM25 is immune to this — it finds the exact string regardless of what the embedding model thinks about synonyms.

**The bi-encoder gap.** ChromaDB's embedding function encodes query and document independently and compares their vectors. Cross-encoders attend to both strings simultaneously, modeling the interaction between them. For legal precision queries, this difference accounts for 9 percentage points of Precision@5.

**No measurable ground truth.** Traditional RAG systems are tuned by feel. This system has a reproducible benchmark — run `eval/eval_precision.py` to compare any two retrieval configurations objectively.

**No multi-tenancy.** A basic RAG API serves one corpus. Every user sees every document. This system uses ChromaDB metadata filtering to give each Clerk user a completely isolated view of the same collection — no separate databases, no data leakage, no per-user ChromaDB instances.

**No recovery from large documents.** A traditional system receiving a 400-page PDF either times out the HTTP connection or exhausts the embedding API token limit. The background task pattern decouples file receipt from processing entirely — the HTTP response is immediate regardless of document size.
