import re
import time
import threading
from pathlib import Path
from typing import List, Dict, Optional

import chromadb
from chromadb.utils.embedding_functions import OpenAIEmbeddingFunction
from rank_bm25 import BM25Okapi
from sentence_transformers import CrossEncoder


class HybridSearchIndex:
    def __init__(
        self,
        persist_directory: str = "./chroma_store",
        collection_name: str = "production_rag",
        openai_api_key: str = "",
        cross_encoder_model: str = "cross-encoder/ms-marco-MiniLM-L-6-v2",
        rerank_top_k: int = 5,
    ):
        Path(persist_directory).mkdir(parents=True, exist_ok=True)

        ef = OpenAIEmbeddingFunction(
            api_key=openai_api_key,
            model_name="text-embedding-3-small",
        )
        self._client = chromadb.PersistentClient(path=persist_directory)
        self._collection = self._client.get_or_create_collection(
            name=collection_name,
            embedding_function=ef,
        )

        print(f"Loading cross-encoder model: {cross_encoder_model}")
        self._cross_encoder = CrossEncoder(cross_encoder_model)

        self._bm25: Optional[BM25Okapi] = None
        self._bm25_chunks: List[Dict] = []
        self._bm25_lock = threading.Lock()
        self.rerank_top_k = rerank_top_k

    @staticmethod
    def _tokenize_for_bm25(text: str) -> List[str]:
        tokens = re.findall(r"\b[a-z0-9]+\b", text.lower())
        return [t for t in tokens if len(t) >= 2]

    def add_documents(self, chunks: List[Dict]) -> None:
        exceptions: List[tuple] = []

        def chroma_worker():
            try:
                batch_size = 5000
                for i in range(0, len(chunks), batch_size):
                    batch = chunks[i : i + batch_size]
                    self._collection.upsert(
                        ids=[c["chunk_id"] for c in batch],
                        documents=[c["text"] for c in batch],
                        metadatas=[
                            {
                                "source": c["source"],
                                "token_count": c["token_count"],
                                "page_num": c["page_num"],
                                "user_id": c.get("user_id", ""),
                            }
                            for c in batch
                        ],
                    )
            except Exception as exc:
                exceptions.append(("chroma", exc))

        def bm25_worker():
            try:
                tokenized = [self._tokenize_for_bm25(c["text"]) for c in chunks]
                index = BM25Okapi(tokenized)
                with self._bm25_lock:
                    self._bm25 = index
                    self._bm25_chunks = list(chunks)
            except Exception as exc:
                exceptions.append(("bm25", exc))

        t1 = threading.Thread(target=chroma_worker)
        t2 = threading.Thread(target=bm25_worker)
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        if exceptions:
            raise RuntimeError(f"Index write failed: {exceptions}")

    def build_bm25_from_collection(self) -> None:
        print("Rebuilding BM25 index from ChromaDB...")
        result = self._collection.get(include=["documents", "metadatas"])
        ids = result["ids"]
        docs = result["documents"]
        metas = result["metadatas"]

        chunks = [
            {
                "chunk_id": ids[i],
                "text": docs[i],
                "source": metas[i].get("source", ""),
                "token_count": metas[i].get("token_count", 0),
                "page_num": metas[i].get("page_num", 0),
                "user_id": metas[i].get("user_id", ""),
            }
            for i in range(len(ids))
        ]

        tokenized = [self._tokenize_for_bm25(c["text"]) for c in chunks]
        with self._bm25_lock:
            self._bm25 = BM25Okapi(tokenized) if tokenized else None
            self._bm25_chunks = chunks
        print(f"BM25 ready: {len(chunks)} documents indexed.")

    def dense_search(self, query: str, top_k: int = 20, user_id: Optional[str] = None) -> List[Dict]:
        total = self._collection.count()
        if total == 0:
            return []

        where = {"user_id": user_id} if user_id else None
        results = self._collection.query(
            query_texts=[query],
            n_results=min(top_k, total),
            include=["documents", "metadatas", "distances"],
            where=where,
        )
        output = []
        for chunk_id, doc, meta, dist in zip(
            results["ids"][0],
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
        ):
            output.append({
                "chunk_id": chunk_id,
                "text": doc,
                "source": meta.get("source", ""),
                "token_count": meta.get("token_count", 0),
                "page_num": meta.get("page_num", 0),
                "score": 1.0 - (dist / 2.0),
                "retrieval_type": "dense",
            })
        return output

    def sparse_search(self, query: str, top_k: int = 20, user_id: Optional[str] = None) -> List[Dict]:
        with self._bm25_lock:
            # Filter chunks to this user, then build a fresh BM25 for that subset
            if user_id:
                chunks = [c for c in self._bm25_chunks if c.get("user_id") == user_id]
            else:
                chunks = list(self._bm25_chunks)

        if not chunks:
            return []

        tokenized = [self._tokenize_for_bm25(c["text"]) for c in chunks]
        bm25 = BM25Okapi(tokenized)

        query_tokens = self._tokenize_for_bm25(query)
        scores = bm25.get_scores(query_tokens)

        top_indices = scores.argsort()[::-1][:top_k]
        max_score = float(scores[top_indices[0]]) if len(top_indices) > 0 else 0.0

        if max_score == 0.0:
            return []

        output = []
        for idx in top_indices:
            chunk = chunks[idx]
            output.append({
                "chunk_id": chunk["chunk_id"],
                "text": chunk["text"],
                "source": chunk["source"],
                "token_count": chunk["token_count"],
                "page_num": chunk["page_num"],
                "score": float(scores[idx]) / max_score,
                "retrieval_type": "sparse",
            })
        return output

    def hybrid_search(self, query: str, dense_k: int = 20, sparse_k: int = 20, user_id: Optional[str] = None) -> List[Dict]:
        dense_results: List[Dict] = []
        sparse_results: List[Dict] = []
        errors: List[Exception] = []

        def run_dense():
            try:
                dense_results.extend(self.dense_search(query, dense_k, user_id=user_id))
            except Exception as exc:
                errors.append(exc)

        def run_sparse():
            try:
                sparse_results.extend(self.sparse_search(query, sparse_k, user_id=user_id))
            except Exception as exc:
                errors.append(exc)

        t1 = threading.Thread(target=run_dense)
        t2 = threading.Thread(target=run_sparse)
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        if errors:
            raise errors[0]

        seen: Dict[str, Dict] = {}
        for result in dense_results + sparse_results:
            cid = result["chunk_id"]
            if cid not in seen:
                seen[cid] = result
            else:
                existing = seen[cid]
                if result["score"] > existing["score"]:
                    seen[cid] = result
                seen[cid]["retrieval_type"] = "both"

        return list(seen.values())

    def re_rank(
        self,
        query: str,
        candidates: List[Dict],
        score_threshold: float = -float("inf"),
    ) -> List[Dict]:
        if not candidates:
            return []

        pairs = [(query, c["text"]) for c in candidates]

        t0 = time.perf_counter()
        scores = self._cross_encoder.predict(pairs, batch_size=32, show_progress_bar=False)
        elapsed_ms = (time.perf_counter() - t0) * 1000

        if elapsed_ms > 100:
            print(f"  [Warning] Re-ranking took {elapsed_ms:.1f}ms (target: <=100ms)")
        else:
            print(f"  Re-ranking: {elapsed_ms:.1f}ms for {len(candidates)} candidates")

        for i, c in enumerate(candidates):
            c["rerank_score"] = float(scores[i])

        above = [c for c in candidates if c["rerank_score"] >= score_threshold]
        above.sort(key=lambda x: x["rerank_score"], reverse=True)
        return above[: self.rerank_top_k]
