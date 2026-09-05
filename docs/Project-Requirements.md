# Project Requirements Document
**Project:** IT/CSE Knowledge Assistant — Venus Remedies
**Type:** General-purpose reasoning assistant (with optional document context)

---

## 1. What to Build

An internal AI assistant for the IT/CSE department — a direct-reasoning chat tool, similar in spirit to Claude/ChatGPT, that can answer technical questions, explain concepts, help write and debug code, and reason through problems on request.

If relevant internal documents have been uploaded (runbooks, SOPs, notes), the assistant will use them as additional context and cite them when it does. But it is **not limited to only answering from uploaded documents** — it can reason and answer from its own general knowledge as well.

**Not in scope:**
- Any write-actions (the assistant only answers, it does not modify records, send emails, or take actions)
- Company-wide rollout (still scoped to IT/CSE department only)

## 2. Targeted Users

- **IT/CSE department staff only** — access-gated by department, same as before
- Not targeted: any other department (HR, Finance, QA/regulatory, etc.)

## 3. Core Features

1. **Chat interface** — single-page chat window, ask anything, get a direct answer
2. **General reasoning** — the assistant can answer technical/coding/IT questions using its own knowledge, not just uploaded content
3. **Optional document context** — if the team has uploaded relevant internal docs, the assistant references and cites them; if not, it still answers using general knowledge
4. **Login/access control** — IT/CSE department only (unchanged)
5. **Document upload (optional, not required to use chat)** — team members can still add internal docs to give the assistant extra context on internal-specific things (like internal tool names, internal processes)
6. **Conversation history** — within a session, follow-up questions are understood in context

## 4. Success Criteria

- IT/CSE staff can ask any technical question — whether or not a document exists for it — and get a useful, direct answer
- When an uploaded document is relevant, it's cited; when it isn't, the assistant still helps using its own knowledge
- Demo-ready: staff can see it functioning like a knowledgeable teammate, not just a document search tool