# Design Document
**Project:** Internal Knowledge Chatbot — Venus Remedies

---

## 1. Color & Theme

This is an internal enterprise tool for a pharma company — the design should read as **clean, trustworthy, and calm**, not flashy. Avoid anything that looks like a consumer app or marketing site; employees should feel like they're using a reliable internal system.

**Suggested palette (adjust to match Venus Remedies' existing brand colors if they have one):**

| Role | Color | Use |
|---|---|---|
| Primary | Deep teal/blue (`#0F6E7D` or similar) | Buttons, active states, links — pharma/healthcare-adjacent without being sterile-white-and-blue cliché |
| Background | Off-white (`#F7F8FA`) | Main background — easy on the eyes for a work tool used all day |
| Surface | White (`#FFFFFF`) | Chat bubbles, cards |
| Text primary | Near-black (`#1A1F24`) | Body text |
| Text muted | Grey (`#6B7280`) | Timestamps, source citations, secondary info |
| Success/confidence | Muted green (`#2E8B57`) | "Source verified" indicators |
| Warning | Amber (`#D97706`) | "Low confidence" or fallback messages |

**Theme:** Light mode only for v1 (internal tools rarely need dark mode as a priority; add later if requested).

## 2. Fonts

- **UI font:** Inter or system font stack (`-apple-system, Segoe UI, Roboto, sans-serif`) — highly legible, neutral, widely available, no licensing concerns
- **Monospace (if needed for source references/code):** JetBrains Mono or system monospace

Avoid decorative or display fonts — this is a utility tool, not a marketing surface.

## 3. Typography Scale

| Element | Size | Weight |
|---|---|---|
| Page title | 20px | 700 |
| Chat message text | 15px | 400 |
| Source citation | 12px | 500 |
| Timestamps/meta | 11px | 400 |
| Button text | 14px | 600 |

**Line height:** 1.5 for body/message text (readability matters more than density here).

**General principle:** Prioritize clarity and scan-ability over visual flair. Someone asking "what's our leave policy" mid-workday should get their answer fast, not admire the interface.
