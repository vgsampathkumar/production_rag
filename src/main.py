import os
import sys
from pathlib import Path
from typing import List, Dict

from dotenv import load_dotenv
from openai import OpenAI

sys.path.insert(0, str(Path(__file__).parent))
from ingestion import ingest_directory
from search import HybridSearchIndex

DATA_DIR = Path(__file__).parent.parent / "data"
CHROMA_DIR = Path(__file__).parent.parent / "chroma_store"
RERANK_TOP_K = 5

SYSTEM_PROMPT = (
    "You are a precise assistant. Answer the user's question using ONLY the provided context. "
    "If the context does not contain enough information, say so explicitly. "
    "Cite which chunk(s) you are drawing from by referencing their number."
)


def build_index(index: HybridSearchIndex, force_reingest: bool = False) -> None:
    count = index._collection.count()

    if count > 0 and not force_reingest:
        print(f"Using existing index ({count} chunks). Rebuilding BM25 from ChromaDB...")
        index.build_bm25_from_collection()
        return

    if not DATA_DIR.exists():
        print(f"ERROR: Data directory not found: {DATA_DIR}")
        sys.exit(1)

    chunks = ingest_directory(DATA_DIR)

    if not chunks:
        print("ERROR: No chunks produced. Add PDF files to the data/ directory.")
        sys.exit(1)

    print(f"\nAdding {len(chunks)} chunks to index...")
    index.add_documents(chunks)
    print(f"Index built: ChromaDB ({index._collection.count()} docs), BM25 ({len(chunks)} docs).")


def generate_answer(query: str, context_chunks: List[Dict], client: OpenAI) -> str:
    context_parts = []
    for i, chunk in enumerate(context_chunks, 1):
        context_parts.append(
            f"[Chunk {i} | {chunk['source']} p.{chunk['page_num']} | rerank_score={chunk.get('rerank_score', 0):.3f}]\n{chunk['text']}"
        )
    context = "\n\n---\n\n".join(context_parts)

    user_message = f"Context:\n{context}\n\nQuestion: {query}"

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            temperature=0,
        )
        return response.choices[0].message.content
    except Exception as exc:
        return f"[LLM error: {exc}]"


def display_results(chunks: List[Dict]) -> None:
    print(f"\n--- Top {len(chunks)} Retrieved Chunks ---")
    for i, chunk in enumerate(chunks, 1):
        rerank = chunk.get("rerank_score", 0.0)
        rtype = chunk.get("retrieval_type", "?")
        source = chunk.get("source", "?")
        page = chunk.get("page_num", "?")
        tokens = chunk.get("token_count", "?")
        preview = chunk["text"][:120].replace("\n", " ")
        print(f"[{i}] rerank={rerank:.3f} | type={rtype:<6} | {source} p.{page} | tokens={tokens}")
        print(f"    \"{preview}...\"")
    print()


def main() -> None:
    load_dotenv()

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("ERROR: OPENAI_API_KEY not set. Copy .env.example to .env and add your key.")
        sys.exit(1)

    enable_llm = os.getenv("ENABLE_LLM_ANSWER", "true").lower() == "true"
    openai_client = OpenAI(api_key=api_key) if enable_llm else None

    cross_encoder_model = os.getenv("CROSS_ENCODER_MODEL", "cross-encoder/ms-marco-TinyBERT-L-2-v2")
    dense_k = int(os.getenv("DENSE_K", "10"))
    sparse_k = int(os.getenv("SPARSE_K", "10"))
    rerank_top_k = int(os.getenv("RERANK_TOP_K", str(RERANK_TOP_K)))

    index = HybridSearchIndex(
        persist_directory=str(CHROMA_DIR),
        openai_api_key=api_key,
        cross_encoder_model=cross_encoder_model,
        rerank_top_k=rerank_top_k,
    )

    force = "--reingest" in sys.argv
    build_index(index, force_reingest=force)

    print(f"\nProduction RAG ready. Model: {cross_encoder_model}")
    print(f"Search: dense_k={dense_k}, sparse_k={sparse_k}, rerank_top_k={rerank_top_k}")
    print("Type your query (or 'quit' to exit).\n")

    while True:
        try:
            query = input("Query> ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nExiting.")
            break

        if query.lower() in ("quit", "exit", "q"):
            break
        if not query:
            continue

        candidates = index.hybrid_search(query, dense_k=dense_k, sparse_k=sparse_k)
        print(f"  Hybrid search: {len(candidates)} unique candidates (dense + BM25)")

        top_chunks = index.re_rank(query, candidates)

        display_results(top_chunks)

        if enable_llm and openai_client:
            print("Generating answer...\n")
            answer = generate_answer(query, top_chunks, openai_client)
            print(f"Answer:\n{answer}\n")


if __name__ == "__main__":
    main()
