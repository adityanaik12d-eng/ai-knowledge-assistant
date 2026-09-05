# Setup Guide — AI Knowledge Assistant

Goal: ek naya, independent chatbot jo Claude jaisa kaam kare (general + aapke docs), apne alag
Supabase project pe, apne brand ke saath. ~10 minute ka setup.

---

## 1) Supabase project banao

1. [supabase.com](https://supabase.com) → **New project** → naam do (e.g. `ai-assistant-<client>`).
2. Password note karo (DB password).
3. Project banne ke baad:
   - **Settings → API**: `Project URL` aur `anon public key` copy karo.
   - **Settings → API** mein `service_role` (secret) key bhi copy karo (dhyan se rakho, secret hai).

## 2) Database schema

Dashboard → **SQL Editor** → paste kar do `supabase/migrations/0001_init.sql` → **Run**.

Ye banata hai: `profiles`, `projects`, `documents` (plus pgvector + HNSW index),
`conversations`, `messages`, `match_documents()` helper, RLS policies, aur signup par profile trigger.

## 3) Auth enable karo (email/password)

Dashboard → **Authentication → Providers → Email**: enable karo (`enable email signups` on).
Passwordless allowed. Phir **URL Configuration** mein SITE URL apna Vercel URL rakho,
aur redirect URL mein `https://<your-alias>.vercel.app/reset-password` add karo.

> Pehla user: **Authentication → Users → Invite user** se banao (email+temp password).
> Admin banna ho to `profiles` table mein us user ki `role` = `admin` karo.

## 4) Gemini (free) API key

1. [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → **Create API key** (free).
2. Default models (free tier): chat = `gemini-2.0-flash`, embeddings = `text-embedding-004`.
3. Isley ko Edge Function secrets mein rakho (step 6).

## 5) Edge Functions deploy karo

Dono tarike chalte hain — **Dashboard** sabse easy:

### Option A — Dashboard (recommended)
Supabase Dashboard → **Edge Functions → New Function**:
1. **chat**: paste `supabase/functions/chat/index.ts`, deploy.
   - Settings → **Secrets** add karo: `GEMINI_API_KEY`, `BRAND_NAME`, `BRAND_DESCRIPTION`
     (baki env `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` auto-detect ho jaate hain).
2. **ingest**: paste `supabase/functions/ingest/index.ts`, deploy. (koi secrets nahi chahiye isko,
   `GEMINI_API_KEY` function-level bhi chalega.)

### Option B — Supabase CLI
```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase secrets set GEMINI_API_KEY=... BRAND_NAME="..." BRAND_DESCRIPTION="..."
supabase functions deploy chat
supabase functions deploy ingest
```

## 6) Frontend config aur deploy (Vercel)

1. `frontend/.env.local` (aapki machine pe; **gitignored hai**):
   ```
   VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon_key>
   ```
2. Vercel pe env add karo (Settings → Environment Variables):
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (same values).
3. Deploy (repo root ke `frontend/` folder se): `vercel --prod --yes`.
   Build root = `frontend`.

## 7) Branding (har client ke liye)

`frontend/src/config/brand.js`:
- `name` / `tagline` → site naam, home page, sidebar, search-bars.
- `helpdeskLabel` / `helpdeskEmail` → home page pe helpdesk line (email khali rakho to chhupta hai).

System prompt (`supabase/functions/chat/index.ts` mein `buildSystemPrompt`) pe
`BRAND_NAME` va `BRAND_DESCRIPTION` env secrets use hote hain — Edge Function secrets se
server-side branding bhi set hoti hai (bina code change).

---

## Income / per-client setup ka flow

1. Client ke liye naya Supabase project → migration run (5 min).
2. Gemini key secret pe (client allowed hai to) ya aapka shared key.
3. `brand.js` mein client ka naam/helpdesk → Vercel pe naya alias/prod deploy (mins).
4. Client ko bhejo: login invite + `verify` karke test.

**Ek system, unlimited brands.** Har client ka data totally alag Supabase project mein hota hai.