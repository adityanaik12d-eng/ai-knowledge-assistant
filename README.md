# AI Knowledge Assistant

Claude-style AI chat assistant with optional organization knowledge base (RAG), ready to be branded and deployed per client.

- Chat answers general questions from the model's own knowledge **plus** your uploaded documents (when relevant).
- Streaming responses with sources shown in the UI.
- Supabase backend (auth, conversations, messages, vector search) + Google Gemini (free tier) for chat and embeddings.
- Brand config in one file: `frontend/src/config/brand.js`.

## Stack

React + Vite (frontend) · Supabase + pgvector (auth/DB/vector search) · Supabase Edge Functions (chat + ingest) · Google Gemini (free tier LLM + embeddings).

## Full setup

See [SETUP.md](./SETUP.md).

## Quick start (once backend is live)

```bash
cd frontend
npm ci
npm run dev
```

## Project layout

```
frontend/                       React app (Vercel root = frontend)
supabase/
  migrations/0001_init.sql      schema: profiles, projects, documents, conversations, messages, RLS, vectors
  functions/
    chat/                       streaming chat: embed question -> vector search -> Gemini (NDJSON SSE)
    ingest/                     upload text/PDF -> chunk -> embed -> store
    _shared/                    cors + gemini helpers
```