# Architecture Document
**Project:** IT/CSE Knowledge Assistant — Venus Remedies

---

## 1. App Flow & Architecture
                 ┌─────────────────┐
                 │  IT/CSE Staff    │
                 │   (browser)      │
                 └────────┬─────────┘
                          │  1. logs in, asks question
                          ▼
                 ┌─────────────────┐
                 │  Frontend (SPA)  │
                 └────────┬─────────┘
                          │  2. calls chat Edge Function
                          ▼
                 ┌─────────────────┐
                 │  Backend         │
                 │  (auth + dept    │
                 │   check)         │
                 └────────┬─────────┘
                          │  3. (optional) check for relevant
                          │     uploaded documents
                          ▼
                 ┌─────────────────┐
                 │  Vector DB       │◄── optional context,
                 │  (uploaded docs, │    not a hard requirement
                 │   if any exist)  │
                 └────────┬─────────┘
                          │  4. question (+ any relevant
                          │     context found) + conversation
                          │     history
                          ▼
                 ┌─────────────────┐
                 │  LLM API call    │
                 │  (reasons freely,│
                 │   uses context   │
                 │   when relevant, │
                 │   cites it when  │
                 │   used)          │
                 └────────┬─────────┘
                          │  5. answer (+ sources, if any
                          │     were used)
                          ▼
                 ┌─────────────────┐
                 │  Frontend renders│
                 │  answer          │
                 └─────────────────┘

**Key architectural change from earlier version:** the assistant is no longer restricted to answering *only* from retrieved document chunks. Document retrieval is now an *optional enrichment* step — if relevant internal content exists, it's included as context and cited; if not, the LLM answers from its own general knowledge, without needing a document match to proceed.

## 2. Tech Stack (actual, as built)

| Layer | Choice |
|---|---|
| Frontend | React (Vite) |
| Backend | Supabase Edge Functions (Deno) |
| Database | Supabase (Postgres + pgvector, for optional document context) |
| Auth | Supabase Auth (email + password) |
| Embeddings (optional doc context) | Supabase built-in `gte-small` |
| LLM | NVIDIA NIM API (`meta/llama-3.1-8b-instruct`) |
| Access control | Department-based (`profiles.department = 'IT/CSE'`), enforced client + server side |

## 3. Folder & File Structure

knowledge-chatbot/
├── frontend/
│ └── src/
│ ├── context/AuthContext.jsx
│ ├── routes/ProtectedRoute.jsx
│ ├── pages/
│ │ ├── Login.jsx
│ │ ├── Home.jsx
│ │ ├── Chat.jsx
│ │ ├── Upload.jsx # optional context upload, not required
│ │ ├── ResetPassword.jsx
│ │ └── AccessDenied.jsx
│ ├── lib/supabase.js
│ └── App.jsx
├── (Supabase Edge Functions: chat, ingest)
└── docs/