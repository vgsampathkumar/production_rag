# Deployment Guide

This project deploys the backend to HuggingFace Spaces (Docker) and the frontend to Vercel.

---

## Backend — HuggingFace Spaces

### How it works

The HF Space uses the `Dockerfile` at the repo root. On every push to the `main` branch of the HF Space git remote, HF rebuilds the Docker image and restarts the container.

The Space has a separate git remote (`space`) from the GitHub origin:

```bash
git remote -v
# origin  https://github.com/vgsampathkumar/production_rag.git
# space   https://user:<HF_TOKEN>@huggingface.co/spaces/vgsampathkumar/production-rag
```

### First-time setup

1. Create a Space at [huggingface.co/new-space](https://huggingface.co/new-space)
   - SDK: **Docker**
   - Visibility: Public

2. Add the HF remote:
   ```bash
   git remote add space https://user:<YOUR_HF_TOKEN>@huggingface.co/spaces/<USERNAME>/<SPACE_NAME>
   ```

3. Set required Secrets in the Space Settings → **Variables and secrets**:

   | Secret | Value |
   |--------|-------|
   | `OPENAI_API_KEY` | `sk-proj-...` |
   | `CLERK_JWKS_URL` | `https://<your-clerk-domain>/.well-known/jwks.json` |

   Optional overrides:
   | Variable | Default | Notes |
   |----------|---------|-------|
   | `ALLOWED_ORIGINS` | `http://localhost:5173,...,https://your-vercel-app.vercel.app` | Add your Vercel URL if not the default |
   | `CROSS_ENCODER_MODEL` | `cross-encoder/ms-marco-TinyBERT-L-2-v2` | |
   | `DENSE_K` | `10` | |
   | `SPARSE_K` | `10` | |
   | `RERANK_TOP_K` | `5` | |

4. Push to deploy:
   ```bash
   git push space feature/production_rag:main
   ```

### Subsequent deployments

```bash
git push space feature/production_rag:main
```

The HF Space rebuilds and restarts. **Docker build takes 5–10 minutes** because it installs all Python packages and pre-downloads TinyBERT. Monitor progress in the Space's **Logs** tab.

### Important limitations (free tier)

- **Ephemeral storage**: `data/` and `chroma_store/` directories are wiped on every container restart. Uploaded documents do not persist across restarts.
- **No sleep/persistent storage**: The free tier container can be recycled at any time.
- For production persistence, use [HF Spaces Persistent Storage](https://huggingface.co/docs/hub/spaces-storage) (paid) or migrate to a cloud VM.

### Dockerfile overview

```dockerfile
FROM python:3.11-slim

# Tesseract OCR for scanned PDFs
RUN apt-get install -y tesseract-ocr libglib2.0-0 libsm6 libxext6 libxrender-dev

# Install Python dependencies
COPY requirements.txt .
RUN pip install -r requirements.txt

# Pre-cache TinyBERT to avoid cold-start download
RUN python -c "from sentence_transformers import CrossEncoder; CrossEncoder('cross-encoder/ms-marco-TinyBERT-L-2-v2')"

COPY api/ api/
COPY src/ src/

EXPOSE 7860
CMD ["uvicorn", "api.server:app", "--host", "0.0.0.0", "--port", "7860"]
```

---

## Frontend — Vercel

### How it works

Vercel builds from the `ui/` directory using Vite. The `vercel.json` in the repo root sets the output directory and injects the `VITE_API_BASE` environment variable.

### First-time setup

1. Import the GitHub repo into [vercel.com](https://vercel.com)
2. Set environment variables in Vercel project → **Settings → Environment Variables**:

   | Variable | Value |
   |----------|-------|
   | `VITE_CLERK_PUBLISHABLE_KEY` | `pk_test_...` from Clerk dashboard |
   | `VITE_API_BASE` | Your HF Space app URL (with hash if applicable) |

3. Deploy:
   ```bash
   npx vercel --prod --yes
   ```

### vercel.json

```json
{
  "buildCommand": "cd ui && npm install && npm run build",
  "outputDirectory": "ui/dist",
  "framework": null,
  "env": {
    "VITE_API_BASE": "https://vgsampathkumar-production-rag-d1a67e9.hf.space"
  }
}
```

> **Note:** The HF Space app URL may include a hash suffix (e.g., `-d1a67e9`). Find it in your Space's embed URL or browser address bar when viewing the running Space.

### Subsequent deployments

Frontend deploys automatically on every GitHub push to `main` if the repo is connected to Vercel. Manual deployment:

```bash
npx vercel --prod --yes --force
```

---

## CORS Configuration

The backend `ALLOWED_ORIGINS` must include your Vercel frontend URL. The default value in `server.py` already includes the production Vercel URL:

```python
_DEFAULT_ORIGINS = (
    "http://localhost:5173,"
    "http://localhost:5174,"
    "https://production-rag-beta.vercel.app"
)
```

To add a custom Vercel URL without redeploying, set the `ALLOWED_ORIGINS` HF Space Secret:
```
ALLOWED_ORIGINS=http://localhost:5173,https://your-app.vercel.app
```

---

## End-to-End Deployment Checklist

- [ ] HF Space created (Docker SDK)
- [ ] `space` git remote added
- [ ] `OPENAI_API_KEY` set in HF Space Secrets
- [ ] `CLERK_JWKS_URL` set in HF Space Secrets
- [ ] Code pushed: `git push space feature/production_rag:main`
- [ ] HF Space build complete (check Logs tab, wait 5–10 min)
- [ ] Backend health check: `https://<your-space>.hf.space/health`
- [ ] Clerk app created (see [authentication.md](authentication.md))
- [ ] `VITE_CLERK_PUBLISHABLE_KEY` set in Vercel
- [ ] `VITE_API_BASE` set in Vercel pointing to HF Space URL
- [ ] Frontend deployed to Vercel
- [ ] Sign in works on the deployed app
- [ ] Upload a PDF → document appears in library within 1–3 minutes
