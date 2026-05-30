import re
import hashlib
import platform
from pathlib import Path
from typing import List, Dict, Optional

import tiktoken
from pypdf import PdfReader

_TOKENIZER: Optional[tiktoken.Encoding] = None

# Tesseract search paths for Windows
_TESSERACT_PATHS_WIN = [
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
]


def get_tokenizer() -> tiktoken.Encoding:
    global _TOKENIZER
    if _TOKENIZER is None:
        _TOKENIZER = tiktoken.get_encoding("cl100k_base")
    return _TOKENIZER


def _configure_tesseract() -> bool:
    """Point pytesseract at the Tesseract binary on Windows. Returns True if found."""
    try:
        import pytesseract
        if platform.system() == "Windows":
            for p in _TESSERACT_PATHS_WIN:
                if Path(p).exists():
                    pytesseract.pytesseract.tesseract_cmd = p
                    return True
            return False
        return True  # Unix: tesseract assumed on PATH
    except ImportError:
        return False


def _ocr_page(fitz_page) -> str:
    """Render a PDF page to an image and extract text via Tesseract OCR."""
    import pytesseract
    from PIL import Image
    import io
    pix = fitz_page.get_pixmap(dpi=300)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    return pytesseract.image_to_string(img)


def extract_text_from_pdf(path: Path) -> List[Dict]:
    reader = PdfReader(str(path))
    raw_texts = [page.extract_text() or "" for page in reader.pages]

    # Open PyMuPDF doc only if some pages have no text layer
    needs_ocr = any(not t.strip() for t in raw_texts)
    fitz_doc = None
    ocr_ready = False
    if needs_ocr:
        try:
            import fitz  # PyMuPDF
            fitz_doc = fitz.open(str(path))
            ocr_ready = _configure_tesseract()
            if not ocr_ready:
                print(f"    OCR: pytesseract/Tesseract not found — image pages will be skipped.")
        except ImportError:
            print(f"    OCR: PyMuPDF not installed (pip install pymupdf) — image pages will be skipped.")

    pages = []
    for i, (page, raw_text) in enumerate(zip(reader.pages, raw_texts)):
        text = raw_text
        if not text.strip() and ocr_ready and fitz_doc:
            print(f"    Page {i + 1}: no text layer — running OCR...")
            text = _ocr_page(fitz_doc[i])

        if not text or not text.strip():
            continue
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        pages.append({"page_text": text, "page_num": i + 1, "source": path.name})

    if fitz_doc:
        fitz_doc.close()
    return pages


def split_into_sentences(text: str) -> List[str]:
    paragraphs = re.split(r"\n\n+", text)
    sentences = []
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        parts = re.split(r"(?<=[.!?])\s+(?=[A-Z])", para)
        for part in parts:
            part = part.strip()
            if part:
                sentences.append(part)
    return sentences


def _token_count(text: str) -> int:
    return len(get_tokenizer().encode(text))


def _compute_overlap_tail(sentences: List[str], token_counts: List[int], overlap_ratio: float) -> tuple:
    total_tokens = sum(token_counts)
    overlap_target = int(total_tokens * overlap_ratio)
    tail_sentences, tail_counts = [], []
    running = 0
    for sent, tc in zip(reversed(sentences), reversed(token_counts)):
        if running + tc <= overlap_target:
            tail_sentences.insert(0, sent)
            tail_counts.insert(0, tc)
            running += tc
        else:
            break
    return tail_sentences, tail_counts


def adaptive_chunk_text(
    pages: List[Dict],
    target_min: int = 500,
    target_max: int = 800,
    overlap_ratio: float = 0.15,
) -> List[Dict]:
    sentence_stream: List[tuple] = []
    for page in pages:
        for sent in split_into_sentences(page["page_text"]):
            sentence_stream.append((sent, page["page_num"], page["source"]))

    chunks = []
    chunk_index = 0
    current_sentences: List[str] = []
    current_counts: List[int] = []
    current_tokens = 0
    first_page = 1
    source = pages[0]["source"] if pages else "unknown"

    def flush_chunk():
        nonlocal chunk_index
        if not current_sentences:
            return
        text = " ".join(current_sentences)
        cid = hashlib.md5(f"{source}::{chunk_index}::{text[:50]}".encode()).hexdigest()[:16]
        chunks.append({
            "text": text,
            "source": source,
            "chunk_id": cid,
            "token_count": sum(current_counts),
            "page_num": first_page,
        })
        chunk_index += 1

    for sent, page_num, src in sentence_stream:
        tc = _token_count(sent)
        if current_tokens + tc > target_max and current_tokens >= target_min:
            flush_chunk()
            tail_sents, tail_counts = _compute_overlap_tail(current_sentences, current_counts, overlap_ratio)
            current_sentences = tail_sents
            current_counts = tail_counts
            current_tokens = sum(tail_counts)
            first_page = page_num

        if not current_sentences:
            first_page = page_num
            source = src

        current_sentences.append(sent)
        current_counts.append(tc)
        current_tokens += tc

    flush_chunk()
    return chunks


def ingest_directory(data_dir: Path) -> List[Dict]:
    pdf_paths = sorted(data_dir.glob("*.pdf"))
    if not pdf_paths:
        print(f"No PDF files found in {data_dir}")
        return []

    print(f"Found {len(pdf_paths)} PDF(s) in {data_dir}")
    all_chunks: List[Dict] = []

    for path in pdf_paths:
        print(f"  Processing {path.name}...")
        pages = extract_text_from_pdf(path)
        if not pages:
            print(f"    Warning: no extractable text in {path.name}, skipping.")
            continue
        chunks = adaptive_chunk_text(pages)
        all_chunks.extend(chunks)
        print(f"    -> {len(chunks)} chunks from {len(pages)} pages")

    if all_chunks:
        avg_tokens = sum(c["token_count"] for c in all_chunks) / len(all_chunks)
        print(f"\nIngestion complete: {len(all_chunks)} total chunks, avg {avg_tokens:.0f} tokens/chunk")

    return all_chunks
