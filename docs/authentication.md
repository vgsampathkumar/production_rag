# Authentication Guide

Authentication uses [Clerk](https://clerk.com) — a managed auth service that handles OAuth sign-in (Google, GitHub, Facebook), session management, and JWT issuance.

---

## How It Works

```
User clicks "Sign In"
       │
       ▼
  Clerk modal (Google / GitHub / Facebook)
       │
       ▼
  Clerk issues RS256 JWT
  - Subject (sub): unique user ID, e.g. "user_2abc..."
  - Expiry: 60s (dev) / configurable (prod)
       │
       ▼
  Frontend stores token in memory (Clerk SDK)
       │
  On every API call:
  const token = await getToken()
  fetch('/upload', { headers: { Authorization: `Bearer ${token}` } })
       │
       ▼
  Backend: PyJWT + PyJWKClient
  - Fetches Clerk's JWKS endpoint (public keys, cached)
  - Verifies RS256 signature
  - Extracts user_id from "sub" claim
  - Returns 401 if missing / expired / invalid
       │
       ▼
  user_id stored in every ChromaDB chunk metadata
  All queries filtered: where={"user_id": user_id}
```

---

## Clerk Setup

### 1. Create a Clerk application

1. Go to [dashboard.clerk.com](https://dashboard.clerk.com)
2. Create a new application — name it anything (e.g., "Production RAG")
3. Enable sign-in methods: **Google**, **GitHub**, **Email**

### 2. Get your keys

In the Clerk dashboard → **API Keys**:

| Key | Where to use |
|-----|-------------|
| **Publishable key** (`pk_test_...`) | Frontend — `VITE_CLERK_PUBLISHABLE_KEY` |
| **JWKS URL** | Backend — `CLERK_JWKS_URL` |

The JWKS URL is at:
```
https://<your-clerk-frontend-api>/.well-known/jwks.json
```

Find it in Clerk dashboard → **Configure → Developers → API Keys** → scroll to "JWT verification".

### 3. Set environment variables

**Frontend** (`ui/.env.local` for local, Vercel env vars for production):
```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_cmVsZXZhbnQtZ29vc2UtMTEuY2xlcmsuYWNjb3VudHMuZGV2JA
```

**Backend** (`.env` for local, HF Space Secrets for production):
```
CLERK_JWKS_URL=https://relevant-goose-11.clerk.accounts.dev/.well-known/jwks.json
```

### 4. Increase JWT lifetime (development instances)

Clerk development instances issue JWTs with a **60-second expiry** by default. The backend uses `leeway=120s` to tolerate this, but it's better to increase the lifetime:

1. Clerk dashboard → **Configure → Sessions**
2. Set **Token lifetime** to `3600` seconds (1 hour)

---

## Frontend Integration

Clerk is initialized in `ui/src/main.jsx`:
```jsx
import { ClerkProvider } from '@clerk/clerk-react'

<ClerkProvider publishableKey={VITE_CLERK_PUBLISHABLE_KEY}>
  <App />
</ClerkProvider>
```

Sign-in gate in `ui/src/App.jsx`:
```jsx
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/clerk-react'

<SignedOut>
  <SignInButton mode="modal" />
</SignedOut>
<SignedIn>
  <UserButton />
  {/* app content */}
</SignedIn>
```

Auth headers in any component:
```jsx
import { useAuth } from '@clerk/clerk-react'

const { getToken } = useAuth()
const token = await getToken()
const headers = token ? { Authorization: `Bearer ${token}` } : {}
```

---

## Backend Integration

JWT verification in `api/server.py`:

```python
CLERK_JWKS_URL = os.getenv("CLERK_JWKS_URL", "")

def _verify_token(token: str) -> str:
    client = PyJWKClient(CLERK_JWKS_URL, cache_keys=True)
    signing_key = client.get_signing_key_from_jwt(token)
    payload = pyjwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        options={"verify_aud": False},
        leeway=120,  # tolerates Clerk dev 60s TTL + clock skew
    )
    return payload["sub"]  # Clerk user ID
```

If `CLERK_JWKS_URL` is not set (local dev without auth), all requests return `user_id = "local-dev-user"` — no auth check is performed.

---

## Per-User Document Isolation

Every ChromaDB chunk upsert includes the user's ID:
```python
metadatas=[{
    "source": filename,
    "page_num": page,
    "token_count": count,
    "user_id": user_id,   # ← Clerk user ID
}]
```

Every read operation filters by that ID:
```python
# List documents
collection.get(where={"user_id": user_id})

# Search
collection.query(query_texts=[q], where={"user_id": user_id})

# Delete
collection.get(where={"$and": [
    {"source": {"$eq": filename}},
    {"user_id": {"$eq": user_id}},
]})
```

This ensures complete isolation: users can only see, search, and delete their own documents, even though all users share the same ChromaDB collection.

---

## Switching to Production

When you're ready to go to production:

1. In Clerk dashboard, create a **Production instance** (separate from Development)
2. Configure custom domain (required for production)
3. Update `VITE_CLERK_PUBLISHABLE_KEY` in Vercel with the production publishable key (`pk_live_...`)
4. Update `CLERK_JWKS_URL` in HF Space Secrets with the production JWKS URL
5. Production instances issue JWTs with longer default expiry and have higher rate limits
