import os
import sys
import json
import time
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import jwt as pyjwt
from jwt import PyJWKClient
from collections import Counter
from fastapi import FastAPI, HTTPException, File, UploadFile, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from dotenv import load_dotenv
from openai import OpenAI

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from search import HybridSearchIndex
from ingestion import extract_text_from_pdf, adaptive_chunk_text

DATA_DIR = Path(__file__).parent.parent / "data"
CACHE_FILE = Path(__file__).parent.parent / "chroma_store" / "notebook_cache.json"

load_dotenv(Path(__file__).parent.parent / ".env")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
CROSS_ENCODER_MODEL = os.getenv("CROSS_ENCODER_MODEL", "cross-encoder/ms-marco-TinyBERT-L-2-v2")
DENSE_K = int(os.getenv("DENSE_K", "10"))
SPARSE_K = int(os.getenv("SPARSE_K", "10"))
RERANK_TOP_K = int(os.getenv("RERANK_TOP_K", "5"))
CLERK_JWKS_URL = os.getenv("CLERK_JWKS_URL", "")

_index: Optional[HybridSearchIndex] = None
_openai_client: Optional[OpenAI] = None
_jwks_client: Optional[PyJWKClient] = None


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

_security = HTTPBearer(auto_error=False)


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(CLERK_JWKS_URL, cache_keys=True)
    return _jwks_client


def _verify_token(token: str) -> str:
    client = _get_jwks_client()
    signing_key = client.get_signing_key_from_jwt(token)
    payload = pyjwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        options={"verify_aud": False},
    )
    user_id = payload.get("sub", "")
    if not user_id:
        raise ValueError("Token missing sub claim")
    return user_id


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_security),
) -> str:
    if not CLERK_JWKS_URL:
        return "local-dev-user"
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        return _verify_token(credentials.credentials)
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}")


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _index, _openai_client
    print(f"Starting RAG API server (model: {CROSS_ENCODER_MODEL})...")
    _openai_client = OpenAI(api_key=OPENAI_API_KEY)
    _index = HybridSearchIndex(
        persist_directory=str(Path(__file__).parent.parent / "chroma_store"),
        openai_api_key=OPENAI_API_KEY,
        cross_encoder_model=CROSS_ENCODER_MODEL,
        rerank_top_k=RERANK_TOP_K,
    )
    count = _index._collection.count()
    if count > 0:
        _index.build_bm25_from_collection()
        print(f"Warm start complete: {count} chunks ready.")
    else:
        print("WARNING: No documents indexed. Upload PDFs via the UI.")
    yield
    print("Shutting down.")


app = FastAPI(title="Production RAG API", version="1.0.0", lifespan=lifespan)

_ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class QueryRequest(BaseModel):
    query: str
    dense_k: int = DENSE_K
    sparse_k: int = SPARSE_K
    enable_llm: bool = True


class SummarizeRequest(BaseModel):
    source: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_context(top_chunks: list) -> str:
    return "\n\n".join(
        f"[Chunk {i + 1}] Source: {c['source']}, Page: {c['page_num']}\n{c['text']}"
        for i, c in enumerate(top_chunks)
    )


# ---------------------------------------------------------------------------
# Core endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    count = _index._collection.count() if _index else 0
    return {"status": "ok", "chunks_indexed": count}


@app.get("/documents")
def list_documents(user_id: str = Depends(get_current_user)):
    if not _index:
        return {"documents": [], "total_chunks": 0}
    result = _index._collection.get(
        where={"user_id": user_id},
        include=["metadatas"],
    )
    counts = Counter(m["source"] for m in result["metadatas"])
    return {
        "documents": [{"name": k, "chunks": v} for k, v in sorted(counts.items())],
        "total_chunks": sum(counts.values()),
    }


@app.post("/upload")
async def upload_documents(
    files: list[UploadFile] = File(...),
    user_id: str = Depends(get_current_user),
):
    if not _index:
        raise HTTPException(status_code=503, detail="Index not initialised")

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    results = []
    any_ingested = False

    for file in files:
        name = file.filename or "unknown.pdf"
        if not name.lower().endswith(".pdf"):
            results.append({"name": name, "status": "skipped", "message": "Only PDF files are supported"})
            continue

        save_path = DATA_DIR / name
        content = await file.read()
        save_path.write_bytes(content)

        try:
            pages = extract_text_from_pdf(save_path)
            if not pages:
                results.append({
                    "name": name, "status": "warning",
                    "message": "No text extracted — scanned PDF. Ensure Tesseract is installed.",
                })
                continue

            chunks = adaptive_chunk_text(pages)

            _index._collection.upsert(
                ids=[c["chunk_id"] for c in chunks],
                documents=[c["text"] for c in chunks],
                metadatas=[
                    {
                        "source": c["source"],
                        "token_count": c["token_count"],
                        "page_num": c["page_num"],
                        "user_id": user_id,
                    }
                    for c in chunks
                ],
            )
            results.append({"name": name, "status": "ok", "chunks": len(chunks), "pages": len(pages)})
            any_ingested = True
        except Exception as exc:
            results.append({"name": name, "status": "error", "message": str(exc)})

    if any_ingested:
        _index.build_bm25_from_collection()

    return {
        "results": results,
        "total_chunks": _index._collection.count(),
    }


@app.delete("/document/{name:path}")
def delete_document(name: str, user_id: str = Depends(get_current_user)):
    if not _index:
        raise HTTPException(status_code=503, detail="Index not initialised")

    _index._collection.delete(
        where={"$and": [{"source": {"$eq": name}}, {"user_id": {"$eq": user_id}}]}
    )
    _index.build_bm25_from_collection()

    cache = _load_cache(user_id)
    cache["summaries"].pop(name, None)
    _save_cache(user_id, cache)

    return {"status": "ok", "deleted": name}


@app.post("/query")
def query_endpoint(req: QueryRequest, user_id: str = Depends(get_current_user)):
    if not _index:
        raise HTTPException(status_code=503, detail="Index not initialised")

    t0 = time.perf_counter()
    candidates = _index.hybrid_search(req.query, dense_k=req.dense_k, sparse_k=req.sparse_k, user_id=user_id)
    search_ms = (time.perf_counter() - t0) * 1000

    t1 = time.perf_counter()
    top_chunks = _index.re_rank(req.query, candidates)
    rerank_ms = (time.perf_counter() - t1) * 1000

    answer = ""
    llm_ms = 0.0
    if req.enable_llm and _openai_client and top_chunks:
        t2 = time.perf_counter()
        response = _openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a document analyst. Answer questions using only the provided context. "
                        "Cite chunk numbers like (Chunk 1) when referencing information."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Context:\n{_build_context(top_chunks)}\n\nQuestion: {req.query}",
                },
            ],
            temperature=0,
        )
        answer = response.choices[0].message.content or ""
        llm_ms = (time.perf_counter() - t2) * 1000

    total_ms = (time.perf_counter() - t0) * 1000
    return {
        "query": req.query,
        "top_chunks": top_chunks,
        "answer": answer,
        "metrics": {
            "search_ms": round(search_ms, 1),
            "rerank_ms": round(rerank_ms, 1),
            "llm_ms": round(llm_ms, 1),
            "total_ms": round(total_ms, 1),
        },
    }


@app.post("/stream")
async def stream_endpoint(req: QueryRequest, user_id: str = Depends(get_current_user)):
    if not _index:
        raise HTTPException(status_code=503, detail="Index not initialised")

    async def event_generator():
        loop = asyncio.get_event_loop()
        t0 = time.perf_counter()

        try:
            candidates = await loop.run_in_executor(
                None,
                lambda: _index.hybrid_search(req.query, dense_k=req.dense_k, sparse_k=req.sparse_k, user_id=user_id),
            )
            search_ms = (time.perf_counter() - t0) * 1000

            t1 = time.perf_counter()
            top_chunks = await loop.run_in_executor(
                None, lambda: _index.re_rank(req.query, candidates)
            )
            rerank_ms = (time.perf_counter() - t1) * 1000

            for i, chunk in enumerate(top_chunks):
                yield {
                    "event": "chunk",
                    "data": json.dumps({
                        "rank": i + 1,
                        "chunk_id": chunk["chunk_id"],
                        "text": chunk["text"],
                        "source": chunk["source"],
                        "page_num": chunk["page_num"],
                        "token_count": chunk.get("token_count", 0),
                        "score": round(chunk.get("score", 0), 4),
                        "retrieval_type": chunk.get("retrieval_type", "dense"),
                        "rerank_score": round(chunk.get("rerank_score", 0), 4),
                    }),
                }

            llm_ms = 0.0
            if req.enable_llm and _openai_client and top_chunks:
                t2 = time.perf_counter()
                stream = _openai_client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {
                            "role": "system",
                            "content": (
                                "You are a document analyst. Answer questions using only the provided context. "
                                "Cite chunk numbers like (Chunk 1) when referencing information."
                            ),
                        },
                        {
                            "role": "user",
                            "content": f"Context:\n{_build_context(top_chunks)}\n\nQuestion: {req.query}",
                        },
                    ],
                    temperature=0,
                    stream=True,
                )
                for delta in stream:
                    content = delta.choices[0].delta.content
                    if content:
                        yield {"event": "token", "data": json.dumps({"content": content})}
                        await asyncio.sleep(0)
                llm_ms = (time.perf_counter() - t2) * 1000

            total_ms = (time.perf_counter() - t0) * 1000
            yield {
                "event": "done",
                "data": json.dumps({
                    "metrics": {
                        "search_ms": round(search_ms, 1),
                        "rerank_ms": round(rerank_ms, 1),
                        "llm_ms": round(llm_ms, 1),
                        "total_ms": round(total_ms, 1),
                    }
                }),
            }

        except Exception as exc:
            yield {"event": "error", "data": json.dumps({"message": str(exc)})}

    return EventSourceResponse(event_generator())


# ---------------------------------------------------------------------------
# Per-user notebook cache
# ---------------------------------------------------------------------------

def _load_cache(user_id: str) -> dict:
    if CACHE_FILE.exists():
        try:
            data = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
            return data.get(user_id, {"guide": None, "summaries": {}})
        except Exception:
            pass
    return {"guide": None, "summaries": {}}


def _save_cache(user_id: str, user_data: dict) -> None:
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    all_data: dict = {}
    if CACHE_FILE.exists():
        try:
            all_data = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    all_data[user_id] = user_data
    CACHE_FILE.write_text(json.dumps(all_data, indent=2, ensure_ascii=False), encoding="utf-8")


# ---------------------------------------------------------------------------
# Notebook endpoints
# ---------------------------------------------------------------------------

@app.get("/notebook")
def get_notebook(user_id: str = Depends(get_current_user)):
    return _load_cache(user_id)


@app.post("/notebook/generate")
async def generate_notebook(user_id: str = Depends(get_current_user)):
    if not _index or not _openai_client:
        raise HTTPException(status_code=503, detail="Index not initialised")

    async def event_generator():
        try:
            loop = asyncio.get_event_loop()

            all_data = await loop.run_in_executor(
                None,
                lambda: _index._collection.get(
                    where={"user_id": user_id},
                    include=["documents", "metadatas"],
                ),
            )
            from collections import defaultdict
            doc_chunks: dict = defaultdict(list)
            for doc, meta in zip(all_data["documents"], all_data["metadatas"]):
                src = meta.get("source", "unknown")
                if len(doc_chunks[src]) < 2:
                    doc_chunks[src].append(doc[:600])

            if not doc_chunks:
                yield {"event": "error", "data": json.dumps({"message": "No documents indexed. Upload PDFs first."})}
                return

            doc_excerpts = "\n\n".join(
                f"=== {src} ===\n" + "\n---\n".join(excerpts)
                for src, excerpts in sorted(doc_chunks.items())
            )

            system_prompt = (
                "You are an expert research assistant. Analyse the document excerpts and respond with "
                "ONLY a valid JSON object — no markdown fences, no extra text — matching this schema:\n"
                '{"overview":"2-3 sentence overview","themes":["theme1","theme2","theme3","theme4"],'
                '"doc_onelines":{"filename":"one-line description"},'
                '"suggested_questions":["Q1?","Q2?","Q3?","Q4?","Q5?","Q6?"]}'
            )

            full_text = ""
            stream = _openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Document excerpts:\n\n{doc_excerpts}"},
                ],
                temperature=0.3,
                stream=True,
            )
            for delta in stream:
                content = delta.choices[0].delta.content
                if content:
                    full_text += content
                    yield {"event": "token", "data": json.dumps({"content": content})}
                    await asyncio.sleep(0)

            try:
                parsed = json.loads(full_text)
            except Exception:
                import re
                m = re.search(r"\{.*\}", full_text, re.DOTALL)
                parsed = json.loads(m.group()) if m else {}

            from datetime import datetime
            guide = {**parsed, "generated_at": datetime.utcnow().isoformat()}
            cache = _load_cache(user_id)
            cache["guide"] = guide
            _save_cache(user_id, cache)

            yield {"event": "done", "data": json.dumps({"guide": guide})}

        except Exception as exc:
            yield {"event": "error", "data": json.dumps({"message": str(exc)})}

    return EventSourceResponse(event_generator())


@app.post("/document/summarize")
async def summarize_document(req: SummarizeRequest, user_id: str = Depends(get_current_user)):
    if not _index or not _openai_client:
        raise HTTPException(status_code=503, detail="Index not initialised")

    async def event_generator():
        try:
            loop = asyncio.get_event_loop()

            result = await loop.run_in_executor(
                None,
                lambda: _index._collection.get(
                    where={"$and": [{"source": {"$eq": req.source}}, {"user_id": {"$eq": user_id}}]},
                    include=["documents"],
                ),
            )
            docs = result.get("documents") or []
            if not docs:
                yield {"event": "error", "data": json.dumps({"message": f"No chunks found for {req.source}"})}
                return

            content = "\n\n---\n\n".join(d[:500] for d in docs[:6])

            system_prompt = (
                "You are a document analyst. Respond with ONLY a valid JSON object — no markdown, no extra text:\n"
                '{"summary":"2-3 sentence summary of the document","topics":["topic1","topic2","topic3","topic4","topic5"]}'
            )

            full_text = ""
            stream = _openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Document: {req.source}\n\nExcerpts:\n{content}"},
                ],
                temperature=0.2,
                stream=True,
            )
            for delta in stream:
                content_tok = delta.choices[0].delta.content
                if content_tok:
                    full_text += content_tok
                    yield {"event": "token", "data": json.dumps({"content": content_tok})}
                    await asyncio.sleep(0)

            try:
                parsed = json.loads(full_text)
            except Exception:
                import re
                m = re.search(r"\{.*\}", full_text, re.DOTALL)
                parsed = json.loads(m.group()) if m else {"summary": full_text, "topics": []}

            from datetime import datetime
            entry = {**parsed, "generated_at": datetime.utcnow().isoformat()}
            cache = _load_cache(user_id)
            cache["summaries"][req.source] = entry
            _save_cache(user_id, cache)

            yield {"event": "done", "data": json.dumps({"source": req.source, "entry": entry})}

        except Exception as exc:
            yield {"event": "error", "data": json.dumps({"message": str(exc)})}

    return EventSourceResponse(event_generator())
