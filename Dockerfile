FROM python:3.11-slim

# System deps: Tesseract OCR + graphics libs for PyMuPDF
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (layer-cached if requirements.txt unchanged)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download and cache TinyBERT cross-encoder into the image
# This avoids a ~17 MB download on every cold start
RUN python -c "\
from sentence_transformers import CrossEncoder; \
CrossEncoder('cross-encoder/ms-marco-TinyBERT-L-2-v2'); \
print('TinyBERT cached.')"

# Copy application source
COPY api/ api/
COPY src/ src/
COPY .env.example .env.example

# Bake the pre-built ChromaDB index (5.5 MB) into the image
# Documents are NOT included (personal PDFs); users upload via the UI
COPY chroma_store/ chroma_store/

# HuggingFace Spaces uses port 7860 by default
EXPOSE 7860

CMD ["uvicorn", "api.server:app", "--host", "0.0.0.0", "--port", "7860"]
