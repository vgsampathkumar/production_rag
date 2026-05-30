# Iteration 2 — React UI with Streaming (FastAPI + Vite)

**Date:** 2026-05-29
**Status:** Complete and running

---

## Objective

Add an interactive browser-based interface for the production RAG system so engineers and stakeholders can test queries, inspect retrieved chunks, and watch AI answers generate in real time — without touching the CLI.

---

## Architecture Overview

```
Browser (React 18 / Vite)
        │
        │  POST /stream  (SSE — text/event-stream)
        │  POST /query   (single-shot JSON)
        │  GET  /health
        ▼
FastAPI Server (api/server.py)  :8000
        │
        ├── HybridSearchIndex (warm-started from ChromaDB)
        │       hybrid_search() → re_rank()
        │
        └── OpenAI client
                GPT-4o-mini (stream=True)
```

**Data flow per query:**
1. React sends `POST /stream` with `{ query, dense_k, sparse_k, enable_llm }`
2. FastAPI runs `hybrid_search` + `re_rank` in a thread-pool executor (non-blocking)
3. Server immediately SSE-streams one `chunk` event per top-5 result — React cards render as they arrive
4. Server then streams GPT-4o-mini tokens as `token` events — answer builds character by character
5. Final `done` event carries timing metrics; MetricsBar appears

---

## New Project Structure

```
production_rag/
├── api/
│   ├── __init__.py
│   └── server.py          # FastAPI: /health, /query, /stream (SSE)
├── ui/                    # React frontend (Vite)
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx       # React 18 root mount
│       ├── App.jsx        # State machine + SSE client
│       ├── index.css      # Tailwind directives + custom keyframes
│       └── components/
│           ├── SearchBar.jsx    # Animated input with cycling placeholders
│           ├── ResultCard.jsx   # Per-chunk card with score bar + expand
│           ├── ResultsList.jsx  # Staggered entrance animation container
│           ├── AnswerPanel.jsx  # Streaming answer with typewriter cursor
│           └── MetricsBar.jsx   # Timing metrics (rerank flagged if >100ms)
```

---

## Module: `api/server.py`

### Startup (lifespan hook)
- Loads `.env` from project root
- Creates `HybridSearchIndex` singleton with `PersistentClient` warm-start
- Calls `build_bm25_from_collection()` — BM25 rebuilt in ~1s from existing ChromaDB; no PDF re-parsing
- CORS configured for `http://localhost:5173`

### `GET /health`
Returns `{ "status": "ok", "chunks_indexed": N }` — used to verify the backend is alive.

### `POST /query`
Synchronous endpoint. Runs `hybrid_search → re_rank → GPT-4o-mini` and returns a single JSON response with `top_chunks`, `answer`, and `metrics`. Useful for automated testing.

### `POST /stream`
SSE streaming endpoint using `sse_starlette.sse.EventSourceResponse`.

| Event | Payload | When |
|-------|---------|------|
| `chunk` | `{rank, chunk_id, text, source, page_num, token_count, score, retrieval_type, rerank_score}` | Immediately after re-ranking, one per top-5 chunk |
| `token` | `{content}` | Each GPT-4o-mini delta token as it streams |
| `done` | `{metrics: {search_ms, rerank_ms, llm_ms, total_ms}}` | After LLM stream completes |
| `error` | `{message}` | If an exception occurs mid-stream |

`hybrid_search` and `re_rank` run in `asyncio.run_in_executor` (thread pool) to avoid blocking the async event loop.

---

## Module: `ui/src/App.jsx`

### State Machine
```
idle ──► loading ──► streaming ──► done
                              └──► error
```

### SSE Client (fetch + ReadableStream)
Standard `EventSource` only supports GET. Since `/stream` needs a POST body, the client uses `fetch` with a `ReadableStream` reader and a line-by-line SSE parser:

```js
async function* parseSseStream(response) {
  const reader = response.body.getReader()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    // parse "event: ..." and "data: ..." lines
  }
}
```

State updates:
- `chunk` event → appends to `chunks[]` (cards appear one at a time)
- `token` event → appends to `answer` string (typewriter effect)
- `done` event → sets `metrics`, transitions to `done`

---

## Component Breakdown

### `SearchBar.jsx`
- Framer Motion `boxShadow` animation on focus: `0 0 30px rgba(99,102,241,0.4)`
- Placeholder cycles through 5 example queries every 3.5s (stops while focused)
- Button shows spinning SVG loader while `status === "loading" || "streaming"`

### `ResultsList.jsx`
- Framer Motion `variants` with `staggerChildren: 0.08s` and `delayChildren: 0.05s`
- Cards slide up from `y:18` with spring physics (`stiffness:280, damping:28`)

### `ResultCard.jsx`
- **Rank badge** — indigo circle, `#1` through `#5`
- **Retrieval type pill** — `DENSE` (blue) / `SPARSE` (green) / `BOTH` (purple)
- **Score bar** — animated progress bar, width = `(rerank_score / max_score) × 100%`, grows on mount
- **Source + page + token count** row with SVG icons
- **Text preview** — 220 chars; "Show more" button with chevron animation
- `whileHover={{ y: -3, boxShadow: "0 0 24px rgba(99,102,241,0.25)" }}`

### `AnswerPanel.jsx`
- Bouncing dot trio while streaming; "Done ✓" badge when complete
- Blinking `cursor-blink` pseudo-element at end of growing text
- Framer Motion slide-up: `initial={{ opacity:0, y:20 }}`

### `MetricsBar.jsx`
- Shows Search / Re-rank / LLM / Total times
- Re-rank time rendered in `text-red-400` if > 100ms (target not yet met)
- Fade-in with `y: -8` slide-down

---

## Design System

| Token | Value | Usage |
|-------|-------|-------|
| `bg` | `#0a0f1a` | Page background |
| `surface` | `#111827` | Cards, panels |
| `accent` | `#6366f1` | Primary interactive colour |
| `dense` | `#3b82f6` | Dense retrieval badge |
| `sparse` | `#10b981` | Sparse retrieval badge |
| `both` | `#8b5cf6` | Hybrid badge |
| `body` | `#e2e8f0` | Body text |
| `muted` | `#6b7280` | Secondary text, icons |

Font: **Inter** (body) · **JetBrains Mono** (code/chunk text)

---

## Dependencies Added

**Python (`requirements.txt`):**
| Package | Version | Purpose |
|---------|---------|---------|
| `fastapi` | ≥0.115.0 | HTTP framework |
| `uvicorn` | ≥0.30.0 | ASGI server |
| `sse-starlette` | ≥2.1.0 | SSE streaming helper |

**Node (`ui/package.json`):**
| Package | Version | Purpose |
|---------|---------|---------|
| `react` | ^18.3.0 | UI library |
| `react-dom` | ^18.3.0 | DOM renderer |
| `framer-motion` | ^11.0.0 | Animations |
| `vite` | ^5.4.0 | Dev server + bundler |
| `tailwindcss` | ^3.4.0 | Utility CSS |
| `@vitejs/plugin-react` | ^4.3.0 | Vite React plugin |

---

## How to Run

```bash
# Terminal 1 — backend
cd production_rag
uvicorn api.server:app --reload --port 8000

# Terminal 2 — frontend
cd production_rag/ui
npm run dev
# → http://localhost:5173
```

Verify backend health before querying:
```
GET http://localhost:8000/health
→ {"status":"ok","chunks_indexed":62}
```

---

## Verified Behaviour

| Test | Result |
|------|--------|
| Page loads with dark theme | ✓ |
| Placeholder text cycles through 5 examples | ✓ |
| Query submission → spinner on button | ✓ |
| 5 result cards slide in with stagger | ✓ |
| BOTH/DENSE/SPARSE badges display correctly | ✓ |
| Score bar widths differ between cards | ✓ |
| LLM answer streams token-by-token | ✓ |
| MetricsBar appears on completion | ✓ |
| Re-rank time shown in red (2500ms > 100ms) | ✓ |
| Error banner shown if backend is down | ✓ |
