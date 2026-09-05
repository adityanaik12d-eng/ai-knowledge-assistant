# Memory Document
**Project:** IT/CSE Knowledge Assistant — Venus Remedies

> Update this file after every work session.

---

## What Has Been Completed

- [x] Phase 1-6 complete (login, ingestion, security, error-handling+rate-limit, admin dashboard, design-align + load-testing) — see prior entries below.
- [x] Production deployment on Vercel (fixed SPA-routing 404, Framework Preset fix, Supabase Auth redirect URLs updated), password-reset re-verified on production.
- [x] Chat system-prompt identity update: "built by IT/CSE team, for users at Venus Remedies."
- [x] **NVIDIA model-retirement incident (2026-08-26) — fully resolved, corrected version:**
  - Both depended-on models retired by NVIDIA with zero advance warning: chat model `meta/llama-3.1-8b-instruct` (EOL 2026-08-26) and embedding model `nvidia/nv-embedqa-e5-v5` (EOL 2026-08-25) — both returned HTTP 410 Gone.
  - Diagnosed via NVIDIA's live `/v1/models` endpoint (83 active models) rather than guessing from blogs; test-called candidates directly since presence in the list doesn't guarantee callability. New models adopted: chat → `openai/gpt-oss-20b`, embedding → `nvidia/nemotron-3-embed-1b` (2048-dim, up from 1024).
  - `documents.embedding` column altered `vector(1024)` → `vector(2048)` (had to drop the old ivfflat index first — pgvector's ivfflat caps at 2000 dimensions). Existing 750 chunks' embeddings set to null (no in-place resize possible), text content preserved.
  - **Correction to an earlier claim:** a prior session's Memory.md entry stated the 750-chunk backfill was "confirmed complete" — this was **not actually true**. A follow-up session found, via direct live-database query, that only 40 chunks (a just-uploaded document) had embeddings; all 750 pre-existing chunks were still `NULL`. The backfill Edge Function had been built but never actually finished running. Re-triggered and completed properly this time: since direct Edge Function invocation wasn't available as a tool in that session, the `http` Postgres extension was installed and used to call the backfill function repeatedly from SQL (`extensions.http_post`, with `CURLOPT_TIMEOUT_MS` raised past the 5s default) until it reported `done: true`. Verified directly against the live table afterward: `790/790` rows with non-null embeddings, `0` remaining — not just trusting the function's own "done" claim.
  - End-to-end retrieval re-verified by the user asking a question tied to a specific pre-existing document (`SOP_for_allotment__withdrawal_of_authorizations_for_usage_of_computer_system_signed.pdf`) and confirming it was correctly cited as a source — this is the test that actually proves the backfill worked, as opposed to just checking row counts.
  - Temporary diagnostic Edge Functions (`nvidia-diag`, `reembed-migration`) neutralized (redeployed as harmless no-ops) after use, since both were left publicly callable (`verify_jwt: false`) and `nvidia-diag` exposed API key presence/length/prefix to anyone who hit the URL.
  - **Lesson reinforced (this is now the second time this exact mistake happened in this project):** never trust a "this is done" claim — from a log entry, a tool's own success response, or even a prior AI session's summary — without independently checking live state. A migration function returning `done: true` is still worth a separate `SELECT COUNT(*)` against the real table before calling it confirmed.
  - **New tooling note:** when direct Edge Function invocation isn't available in a session (no `invoke_edge_function`-style MCP tool), the Postgres `http` extension can call an Edge Function's own HTTPS URL directly from SQL as a workaround — useful specifically because the function's own secrets (API keys) stay server-side and don't need to be known at the SQL layer. Default `http` extension timeout is only 5 seconds; raise via `http_set_curlopt('CURLOPT_TIMEOUT_MS', ...)` before calling anything slower.

## Currently In Progress

- **File/module:** None active.
- **Status:** Chatbot fully live and confirmed working in production, including verified-correct retrieval from the pre-existing 18-document knowledge base after the full incident (model retirement + dimension migration + backfill) is now genuinely resolved, not just claimed resolved.
- **Blockers:** None.
- **Recommended next step:** (1) Upload NextGen ERP documentation to the knowledge base — a public Notion page (SpineNextGen Training & FAQ) was identified but lives in a workspace the connected Notion integration can't access; a second attempt reconnected Notion to the correct company workspace (`GenNex-SpineBMS`) and found the real "Spine Training Center" hub with 3 sub-pages and a 135-row module directory database, partially explored (module list + a few "how-to" FAQ pages fetched) before this session's NVIDIA-outage detour — resuming this is the next real task. (2) Send credentials to already-created reviewer accounts now that deployment/auth/model issues are all resolved.

## Deferred (explicitly, not forgotten)

- Large PDF ingestion still unreliable (real 408-page book PDF still fails). Not resolved.
- NextGen ERP knowledge base population — Notion source now accessible, extraction in progress, not yet uploaded.

## Open Decisions / Not Yet Finalized

- Minimum password length — resolved (both sides enforce 8).
- Skip-sources-on-bare-greeting — not confirmed present in current code.
- Dashboard actions beyond "Add User" — not individually re-verified.
- No monitoring/alerting for third-party model deprecations — this is now the pattern's second occurrence (first: Groq's `gemma2-9b-it`); worth a periodic health-check or documented manual-check cadence.
- Rollout: send credentials to reviewer accounts.

## Known Pitfalls (learned the hard way — avoid repeating)

- Don't let an AI agent freely rearchitect an already-working piece without being asked; verify library imports exist before using them; prefer PowerShell heredoc over interactive Notepad; deleting a `profiles` row doesn't delete the `auth.users` account; re-creating a test account resets `department` to `'unassigned'`.
- Full-file regenerations by Claude Code can silently drop fixes and introduce new syntax errors — always re-verify and parse.
- A "VERIFIED"/"done"/"complete" claim from any tool, log entry, or prior AI session is not trustworthy on its own — **this has now caused two separate incidents in this project** (the 384/1024-dim bug, and the 750-chunk backfill that was claimed done but wasn't). Independently re-check live state every time, no exceptions.
- Confirm model availability against a provider's own live `/v1/models` endpoint, not blog posts or docs. Being listed doesn't guarantee callability — test-call before committing.
- A clean structured error (e.g. HTTP 410 Gone with a `detail` field naming an EOL date) should be read and trusted fully — it may directly state the root cause.
- `supabase.functions.fetch(...)` isn't real — use `.functions.invoke()`. CORS `Access-Control-Allow-Headers` needs `x-client-info` for `.invoke()` calls to succeed.
- `profiles.last_sign_in_at` doesn't exist — read via `auth.admin.listUsers()`.
- Changing an embedding model's dimensionality requires a `vector(N)` column-type change AND a full re-embedding backfill — happened twice now, treat as standard whenever the embedding model changes. Also: pgvector's `ivfflat` index type caps at 2000 dimensions — drop the index before widening past that, don't assume the column-type change alone will work.
- A connector showing "Connected" in the UI doesn't guarantee its tools are callable in a given session — this can be a structural gap, not a fixable sync issue.
- A public Notion page shared from a personal/individual workspace isn't accessible to a company's connected integration even with a valid link — needs duplicating into the connected workspace, or reconnecting the integration to the correct workspace outright (which is what actually worked here).
- When no direct Edge-Function-invoke tool is available, the Postgres `http` extension can call a function's own URL from SQL as a working alternative — remember to raise its default 5-second timeout for anything slow.

## Log (most recent first)

| Date | What changed |
|------|--------------|
| 2026-08-29 (approx.) | Corrected an inaccurate "backfill complete" claim from a prior session: live-checked the database, found only 40/790 chunks had embeddings (not 750 as claimed), and properly completed the backfill for all 750 pre-existing chunks using the Postgres `http` extension to repeatedly invoke the backfill Edge Function from SQL. Verified `790/790` embeddings present via direct query, then verified real retrieval end-to-end via a targeted user test against a known pre-existing document. Neutralized two diagnostic Edge Functions left publicly exposed after the incident. |
| 2026-08-26 | NVIDIA retired both depended-on models (chat + embedding), full production outage. Diagnosed via NVIDIA's live model list, adopted `openai/gpt-oss-20b` (chat) and `nvidia/nemotron-3-embed-1b` (embedding, 2048-dim). Production deployment migrated GitHub Pages → Vercel (SPA-routing fix), Supabase Auth redirect URLs updated, system-prompt identity wording updated. |
| 2026-08-23 | Phase 6 completed: Design.md typography alignment, load testing (found + fixed a rate-limit race condition via atomic Postgres function). |
| 2026-08-22 | Fixed critical `vector(384)` vs `vector(1024)` embedding-dimension mismatch breaking all uploads. Chat.jsx fixes: upload-history-awareness, inline delete-confirm, dropdown hover states. |
| 2026-08-21 | Phase 5 (Admin Dashboard) built, confirmed working. Chat system prompt UTC → IST. |
| 2026-08-20 | Phase 4 signed off complete. PDF page-by-page extraction fix deployed; still fails on very large PDFs — deferred. |
| 2026-08-17 (approx.) | Streaming re-enabled. Full revert to last-known-working after provider-switching confusion. |
| 2026-08-14 to 2026-08-17 (approx.) | Groq/NVIDIA provider debugging, CPU-timeout root cause fixed via hosted-embedding switch. |
| 2026-08-13 to 2026-08-14 (approx.) | Six-point UI/UX overhaul, multi-round Chat.jsx bug-fix pass. |
| 2026-08-12 | Phase 3 (Core Chat + Reasoning) complete. Multi-chat history, inline file-attach. |
| 2026-08-08 | Phase 3 (original RAG-only) completed and verified. |
| 2026-08-04 | Security hardening + Phase 2 (Ingestion) completed and verified. |
| 2026-07-29 | Phase 1 (Login) completed and verified end-to-end. |
| 2026-07-28 | Reverted incorrect custom Express backend; restored Supabase-Auth frontend. |
| 2026-07-25 | Supabase project created; Phase 1 code delivered. Initial 6 planning docs created. |
