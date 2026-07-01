# API Reference

Base URL: `https://vgsampathkumar-production-rag-d1a67e9.hf.space`

All endpoints except `/health`, `/debug/auth`, and `/debug/backend` require a valid Clerk JWT in the `Authorization: Bearer <token>` header.

---

## Authentication

Tokens are obtained via the Clerk React SDK:
```js
const { getToken } = useAuth()
const token = await getToken()
// Pass as: Authorization: Bearer <token>
```

If `CLERK_JWKS_URL` is not set (local dev), all requests are accepted and assigned `user_id = "local-dev-user"`.

---

## Endpoints

### GET /health

No auth required. Returns server status and total chunk count.

**Response**
```json
{
  "status": "ok",
  "chunks_indexed": 842
}
```

---

### GET /documents

Returns the list of indexed documents for the authenticated user.

**Response**
```json
{
  "documents": [
    { "name": "contract.pdf", "chunks": 47 },
    { "name": "agreement.pdf", "chunks": 23 }
  ],
  "total_chunks": 70
}
```

---

### POST /upload

Upload one or more PDF files. Files are saved immediately and indexed in a background thread (OCR + embedding). Returns `status: "queued"` instantly.

**Request** — `multipart/form-data`
| Field | Type | Description |
|-------|------|-------------|
| `files` | `File[]` | One or more PDF files |

**Response**
```json
{
  "results": [
    {
      "name": "contract.pdf",
      "status": "queued",
      "message": "Saved — indexing in background (may take 1-2 min for large PDFs)",
      "chunks": 0,
      "pages": 0
    }
  ],
  "total_chunks": 70
}
```

Non-PDF files return `"status": "skipped"`. Poll `/documents` every 10 seconds to detect when indexing completes.

---

### DELETE /document/{name}

Delete all chunks belonging to a document. Only deletes chunks owned by the authenticated user. Rebuilds the BM25 index and clears the cached summary.

**Path parameter:** `name` — the filename (e.g., `contract.pdf`). URL-encoded if it contains spaces.

**Response**
```json
{
  "status": "ok",
  "deleted": "contract.pdf",
  "chunks_removed": 47
}
```

---

### POST /stream

Hybrid search + re-rank + streaming GPT-4o-mini answer via Server-Sent Events.

**Request body**
```json
{
  "query": "what is the total contract price?",
  "dense_k": 10,
  "sparse_k": 10,
  "enable_llm": true
}
```

**SSE Event stream**

| Event | Payload |
|-------|---------|
| `chunk` | Retrieved chunk: `{rank, chunk_id, text, source, page_num, score, retrieval_type, rerank_score}` |
| `token` | LLM token: `{content: "string"}` |
| `done` | Metrics: `{metrics: {search_ms, rerank_ms, llm_ms, total_ms}}` |
| `error` | Error: `{message: "string"}` |

---

### POST /query

Non-streaming version of `/stream`. Returns all results at once.

**Request body** — same as `/stream`

**Response**
```json
{
  "query": "what is the total contract price?",
  "top_chunks": [
    {
      "chunk_id": "abc123",
      "text": "The total purchase price shall be...",
      "source": "contract.pdf",
      "page_num": 3,
      "score": 0.94,
      "rerank_score": 4.21,
      "retrieval_type": "both"
    }
  ],
  "answer": "The total contract price is $853,575 (Chunk 1).",
  "metrics": {
    "search_ms": 124.3,
    "rerank_ms": 198.7,
    "llm_ms": 843.1,
    "total_ms": 1166.1
  }
}
```

---

### GET /notebook

Returns cached notebook state (guide + summaries) for the authenticated user.

**Response**
```json
{
  "guide": {
    "overview": "...",
    "themes": ["theme1", "theme2"],
    "doc_onelines": { "contract.pdf": "Real estate purchase agreement..." },
    "suggested_questions": ["Q1?", "Q2?"],
    "generated_at": "2026-06-01T12:00:00"
  },
  "summaries": {
    "contract.pdf": {
      "summary": "...",
      "topics": ["pricing", "contingencies"],
      "generated_at": "2026-06-01T12:05:00"
    }
  }
}
```

---

### POST /notebook/generate

Generate a research guide from all of the user's indexed documents (streaming SSE).

**SSE Event stream**

| Event | Payload |
|-------|---------|
| `token` | `{content: "string"}` (JSON being built) |
| `done` | `{guide: { overview, themes, doc_onelines, suggested_questions, generated_at }}` |
| `error` | `{message: "string"}` |

---

### POST /document/summarize

Generate a summary for a specific document (streaming SSE).

**Request body**
```json
{ "source": "contract.pdf" }
```

**SSE Event stream**

| Event | Payload |
|-------|---------|
| `token` | `{content: "string"}` |
| `done` | `{source: "contract.pdf", entry: { summary, topics, generated_at }}` |
| `error` | `{message: "string"}` |

---

## Diagnostics

### GET /debug/auth

No auth required. Returns Clerk JWKS configuration and connectivity status.

```json
{
  "clerk_jwks_url_set": true,
  "dev_bypass_active": false,
  "clerk_jwks_url": "https://...",
  "jwks_reachable": true,
  "keys_count": 1
}
```

### GET /debug/backend

No auth required. Full backend health check — OpenAI, ChromaDB, and recent background task errors.

```json
{
  "openai_api_key_set": true,
  "clerk_jwks_url_set": true,
  "chromadb_status": "ok",
  "total_chunks_in_db": 842,
  "openai_status": "ok",
  "recent_bg_errors": []
}
```
