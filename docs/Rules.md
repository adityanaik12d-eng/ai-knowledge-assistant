# Rules Document
**Project:** IT/CSE Knowledge Assistant — Venus Remedies

---

## 1. What to Use

- Environment variables for all secrets — never hardcoded, never committed
- Server-side input sanitization on every endpoint
- A single, consistent way to call the LLM (one function/module, not scattered calls)

## 2. What to Avoid

- **No client-side API keys or credentials** — ever, even during quick testing
- **No unverified/hallucinated library APIs** — check imports actually exist before using them
- **No silent failures** — if a call fails, the user sees a clear message
- **No autonomous actions** — the assistant only answers questions; it never sends emails, files tickets, or writes to any company system
- **No storing sensitive personal data** (salary, medical, disciplinary records) in uploaded documents

## 3. Boundaries of AI in This Project

- The assistant reasons freely and answers from its own general knowledge when no specific internal document is relevant — this is an intentional product decision (see Memory.md log for context on this change from the earlier strict-document-only design)
- When internal documents ARE relevant and used, they should be cited
- **No autonomous actions**, regardless of reasoning mode — the assistant never takes real-world actions, only answers
- Human review required before expanding into compliance/SOP/audit territory — those carry regulatory stakes not covered by this project's design