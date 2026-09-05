# Phases Document
**Project:** Internal Knowledge Chatbot — Venus Remedies

---

Each phase should be fully working and demoable before moving to the next. Don't start Phase N+1 until Phase N runs end-to-end without errors.

## Phase 1 — Login
- Basic auth: email + password (or magic link)
- Session handling (logged-in state persists across page refresh)
- Protected route: unauthenticated users can't reach the chat page
- **Done when:** an employee can log in, see a logged-in state, and log out

## Phase 2 — Document Ingestion (minimum viable)
- Admin-only upload endpoint: accept a text/PDF document
- Chunking logic: split document into reasonably sized chunks
- Embedding generation + storage in vector DB
- **Done when:** uploading a test document results in retrievable chunks in the vector DB (verify via a direct query, not yet through the chat UI)

## Phase 3 — Core Chat + Retrieval
- Chat UI: input box, message list, send button
- Backend `/api/chat` endpoint: takes question → embeds it → retrieves top-k chunks → calls LLM → returns answer
- Source citation shown alongside each answer
- **Done when:** a logged-in employee can ask a question about an uploaded document and get a grounded, cited answer

## Phase 4 — Fallback & Error Handling
- "I don't have enough information" response when retrieval confidence is low
- Clear error messages for: LLM API failure, vector DB failure, network issues
- Rate limiting / basic abuse protection on the chat endpoint
- **Done when:** every failure mode shows the user something sensible, nothing silently breaks

## Phase 5 — Dashboard (Admin View)
- List of uploaded documents (with upload date, chunk count)
- Ability to remove/replace a document from the knowledge base
- Basic usage stats (question count, most-asked topics if easy to derive)
- **Done when:** an admin can manage the knowledge base without touching the database directly

## Phase 6 — Polish & Demo Readiness
- Visual design applied (see Design.md)
- Conversation history within a session
- Load testing with realistic document volume
- **Done when:** the tool is ready to demo live to leadership

---

**After each phase:** update `Memory.md` — mark what's complete, note what file/module is currently in progress, and flag any open decisions before starting the next phase.
