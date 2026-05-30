Project 1: Production-Grade RAG with Hybrid Search & Re-ranking
File name: project1_production_rag.md

Markdown
# Product Requirements & Technical Specification
## Project 1: Production-Grade RAG with Hybrid Search & Re-ranking

## 1. Executive Summary & Requirements
*   **Objective:** Move beyond basic vector-only demos to build an enterprise-ready "Ask My Doc" pipeline handling domain-specific documents (legal contracts, medical manuals, or technical financial papers).
*   **Core Feature:** Hybrid search (Lexical + Dense Vector) combined with a Cross-Encoder re-ranking layer to capture complex terminology that single embedding models often miss.
*   **Success Metrics:** 
    *   Retrieval Precision: >= 92% on specific keyword edge-cases.
    *   Re-ranking Execution Latency: <= 100ms overhead.

## 2. System Design Blueprint
[Unstructured Data / PDFs] ──► [Adaptive Chunking Engine (500-800 tokens)]
│
┌───────────────────┴───────────────────┐
▼                                       ▼
[Dense Path: ChromaDB Vector]           [Sparse Path: BM25 Lexical]
│                                       │
└───────────────────┬───────────────────┘
▼
[Aggregated Raw Search Results]
│
▼
[Cross-Encoder Model Re-Ranker]
│
▼
[Top-K Re-ranked Context Docs]


## 3. Detailed Phase-Wise Implementation Plan

### Phase 1: Adaptive Segmentation & Parsing Framework
*   **Task:** Build a modular document processor that parses PDFs/text files into tokens.
*   **Specification:** Segment chunks using a token-count slider set to `500–800 tokens` with a strict `15% rolling window overlap` to maintain sentence context.
*   **Claude Code Execution:**
```bash
    mkdir -p production_rag/src
    touch production_rag/src/{ingestion.py,search.py,main.py}
    # claude "Write a python module in ingestion.py that extracts text from PDFs and implements token-based recursive chunking with adaptive boundaries"
    ```

### Phase 2: Dual-Engine Indexing (Dense + Sparse Mapping)
*   **Task:** Construct the parallel storage indices.
*   **Specification:** Route chunks into a local `ChromaDB` instance using `text-embedding-3-small` for dense vectors, and concurrently index the exact same chunks into a rank-based `BM25` instance for keyword lookups.
*   **Claude Code Execution:**
```bash
    # claude "In search.py, initialize a local ChromaDB collection and a rank-bm25 index. Write a method to add text chunks to both indices concurrently."
    ```

### Phase 3: Cross-Encoder Re-Ranking Pipeline
*   **Task:** Implement the precision layer to merge and re-rank results.
*   **Specification:** Fetch top 20 results from vector search and top 20 from BM25. Deduplicate them, then run them through a local Hugging Face cross-encoder model (`cross-encoder/ms-marco-MiniLM-L-6-v2`) to output the definitive top 5 highly relevant chunks.
*   **Claude Code Execution:**
```bash
    # claude "Add a re_rank_results method to search.py using a cross-encoder to compute semantic similarity scores across the merged sparse/dense results."
    ```