#!/usr/bin/env python3
"""
Evaluation harness — measures Precision@K for the hybrid RAG retrieval pipeline.

Usage:
    python eval/eval_precision.py           # default k=5
    python eval/eval_precision.py --k 3     # precision at 3
    python eval/eval_precision.py --verbose # show chunk previews for each query
"""

import json
import sys
import time
import argparse
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "src"))

from dotenv import load_dotenv
import os

load_dotenv(ROOT / ".env")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
CROSS_ENCODER_MODEL = os.getenv("CROSS_ENCODER_MODEL", "cross-encoder/ms-marco-TinyBERT-L-2-v2")
DENSE_K = int(os.getenv("DENSE_K", "10"))
SPARSE_K = int(os.getenv("SPARSE_K", "10"))

from search import HybridSearchIndex


def load_queries(path: Path):
    queries = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                queries.append(json.loads(line))
    return queries


def run_evaluation(k: int = 5, verbose: bool = False):
    print("=" * 60)
    print("Production RAG — Retrieval Precision Evaluation")
    print("=" * 60)
    print(f"Model:    {CROSS_ENCODER_MODEL}")
    print(f"dense_k:  {DENSE_K}  |  sparse_k: {SPARSE_K}  |  rerank top_k: {k}")
    print()

    print("Loading index (warm start)...")
    index = HybridSearchIndex(
        persist_directory=str(ROOT / "chroma_store"),
        openai_api_key=OPENAI_API_KEY,
        cross_encoder_model=CROSS_ENCODER_MODEL,
        rerank_top_k=k,
    )
    index.build_bm25_from_collection()
    total_chunks = index._collection.count()
    print(f"Index ready: {total_chunks} chunks\n")

    queries = load_queries(Path(__file__).parent / "eval_queries.jsonl")
    print(f"Running {len(queries)} evaluation queries  (Precision@{k})\n")
    print("-" * 60)

    hits = 0
    rerank_times = []
    results = []

    for q in queries:
        query = q["query"]
        expected_source = q["expected_source"]
        expected_fragment = q["expected_fragment"].lower()
        description = q.get("description", "")

        t0 = time.perf_counter()
        candidates = index.hybrid_search(query, dense_k=DENSE_K, sparse_k=SPARSE_K)
        t1 = time.perf_counter()
        top_chunks = index.re_rank(query, candidates)
        rerank_ms = (time.perf_counter() - t1) * 1000
        rerank_times.append(rerank_ms)

        # HIT = at least one top-k chunk is from the expected source AND contains the expected fragment
        hit = any(
            c["source"] == expected_source and expected_fragment in c["text"].lower()
            for c in top_chunks
        )
        hits += hit

        status = "HIT" if hit else "MISS"
        top_src = top_chunks[0]["source"] if top_chunks else "none"
        top_score = top_chunks[0].get("rerank_score", 0) if top_chunks else 0

        print(f"[{status}] {query}")
        print(f"         {description}")
        if not hit:
            print(f"         Expected: {expected_source}")
            print(f"         Got:      {top_src}  (score={top_score:.3f})")
        if verbose and top_chunks:
            print(f"         Top chunk preview: \"{top_chunks[0]['text'][:100]}...\"")
        print(f"         Rerank: {rerank_ms:.0f}ms  |  Candidates: {len(candidates)}")
        print()

        results.append({
            "query": query,
            "description": description,
            "hit": hit,
            "rerank_ms": round(rerank_ms, 1),
            "top_source": top_src,
        })

    precision = hits / len(queries) * 100
    avg_rerank_ms = sum(rerank_times) / len(rerank_times)
    max_rerank_ms = max(rerank_times)

    print("=" * 60)
    print(f"RESULTS")
    print("=" * 60)
    print(f"Precision@{k}:      {hits}/{len(queries)} = {precision:.1f}%")
    print(f"Target:            >= 92.0%")
    precision_status = "PASS" if precision >= 92.0 else "BELOW TARGET"
    print(f"Precision status:  {precision_status}")
    print()
    print(f"Avg rerank latency:  {avg_rerank_ms:.0f}ms")
    print(f"Max rerank latency:  {max_rerank_ms:.0f}ms")
    print(f"Latency target:      <= 100ms")
    latency_status = "PASS" if max_rerank_ms <= 100 else f"{max_rerank_ms:.0f}ms > 100ms (above target)"
    print(f"Latency status:      {latency_status}")
    print("=" * 60)

    return precision, avg_rerank_ms, results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate RAG retrieval precision")
    parser.add_argument("--k", type=int, default=5, help="Top-k cutoff (default: 5)")
    parser.add_argument("--verbose", action="store_true", help="Show chunk text previews")
    args = parser.parse_args()
    run_evaluation(k=args.k, verbose=args.verbose)
