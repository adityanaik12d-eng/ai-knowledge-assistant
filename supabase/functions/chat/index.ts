import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsify, corsHeaders, json } from "../_shared/cors.ts";
import { CHAT_MODEL, embedText } from "../_shared/gemini.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BRAND_NAME = Deno.env.get("BRAND_NAME") ?? "AI Knowledge Assistant";
const BRAND_DESC = Deno.env.get("BRAND_DESCRIPTION") ?? "your organization";

const MAX_MATCHES = 6;
const MAX_EXCERPT_CHARS = 2200;
const MAX_HISTORY_TURNS = 20;
const MAX_OUTPUT_TOKENS = 1800;

function buildSystemPrompt(): string {
  const freeMsgLimit = Number(Deno.env.get("FREE_MSG_LIMIT")) || 20;
  return [
    `You are ${BRAND_NAME}, a helpful AI assistant for ${BRAND_DESC}.`,
    "",
    "You behave like a top-tier general-purpose assistant (think Claude). " +
      "You have broad general knowledge about the world, technology, programming, " +
      "business, science and everyday life, and you use it freely when the question is general.",
    "",
    "You are also given excerpts from the organization's internal knowledge base below. " +
      "When the question is about internal matters (policies, IT procedures, onboarding, product details), " +
      "ground your answer in those excerpts and cite them like [1], [2] next to the facts you used.",
    "",
    "Account limits and support:",
    `- Free accounts can send up to ${freeMsgLimit} questions every 2 hours; the limit resets automatically after that. ` +
      "Premium and admin accounts have unlimited questions.",
    "- For questions about your plan, usage limits, asking the limit to be increased, or any other help, " +
      "contact the system administrator (Aditya Naik) by email at adityanaik.12d@gmail.com " +
      "or by Instagram DM at @aditya_naik_20.",
    "",
    "Rules:",
    "- NEVER invent internal facts (specific policies, contact emails, phone numbers, URLs). " +
      "If the exact internal detail is not in the excerpts, say you don't have that precise information " +
      "and suggest contacting the support channels above WITHOUT fabricating other emails or phone numbers.",
    "- If the question is general knowledge, answer from your own knowledge; the excerpts are optional in that case.",
    "- Be honest about uncertainty. Keep answers clear, well-structured and reasonably concise. " +
      "Use markdown (headings, lists, code blocks) when it helps.",
  ].join("\n");
}

const encoder = new TextEncoder();

// Provider-side rate limiting: once Gemini reports 429, remember it for the
// next 2 hours (Deno.Kv, with in-memory fallback) so subsequent requests fail
// fast with the friendly limit message instead of re-calling a hanging Gemini.
const KV_KEY = ["gemini_limit_until"];
let kv: Deno.Kv | null = null;
let memLimitUntil = 0;

async function getLimitUntil(): Promise<number> {
  try {
    if (!kv) kv = await Deno.openKv();
    const res = await kv.get<number>(KV_KEY);
    return res?.value ?? 0;
  } catch {
    return memLimitUntil;
  }
}

async function persistLimitUntil(ms: number): Promise<void> {
  try {
    if (!kv) kv = await Deno.openKv();
    await kv.set(KV_KEY, ms, { expireIn: Math.max(ms - Date.now(), 60000) });
  } catch {
    memLimitUntil = ms;
  }
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Authenticate the caller (frontend sends the user's Supabase access token).
  let authedUserId = "";
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("Missing authorization header");
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) throw new Error("Unauthorized");
    authedUserId = data.user.id;
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unauthorized" }, 401);
  }

  // Fast path: if the Gemini provider is currently rate-limited (429 seen
  // Plan-based message quota + provider-rate-limit cooldown.
  // Only free users are limited — premium and admin accounts are unlimited.
  {
    const FREE_LIMIT = Number(Deno.env.get("FREE_MSG_LIMIT")) || 20;
    const WINDOW_MS = 2 * 60 * 60 * 1000;
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", authedUserId)
        .maybeSingle();
      const role = profile?.role ?? "free";
      if (role === "free") {
        // If the Gemini provider was recently rate-limited (429 seen), answer
        // immediately with the friendly limit message instead of re-calling it.
        const limitUntil = await getLimitUntil();
        if (Date.now() < limitUntil) {
          return json(
            {
              code: "quota_exceeded",
              error:
                "You've reached your answer limit for now. Please try again in a bit, or upgrade to Premium for unlimited access.",
              resetAt: limitUntil,
            },
            429
          );
        }
        // Free users get FREE_LIMIT questions per 2-hour window.
        const since = new Date(Date.now() - WINDOW_MS).toISOString();
        const { count } = await supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("user_id", authedUserId)
          .eq("role", "user")
          .gte("created_at", since);
        if ((count ?? 0) > FREE_LIMIT) {
          return json(
            {
              code: "quota_exceeded",
              error:
                `You've reached your free-plan answer limit (${FREE_LIMIT} questions per 2 hours). ` +
                "Please try again in a bit, or upgrade to Premium for unlimited answers.",
              resetAt: Date.now() + WINDOW_MS,
            },
            429
          );
        }
      }
    } catch {
      // quota lookup failed — allow the request through rather than blocking chat
    }
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad JSON body" }, 400);
  }

  const question = String(body?.question ?? "").trim();
  if (!question) return json({ error: "question is required" }, 400);
  const history = Array.isArray(body?.history) ? body.history.slice(-MAX_HISTORY_TURNS) : [];

  if (!GEMINI_API_KEY) {
    return json({ error: "Gemini API key is not configured on the server." }, 500);
  }

  // 1) Embed the question
  let qVec: number[];
  try {
    qVec = await embedText(question);
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (/Embedding failed \(429\)/.test(msg)) {
      const untilMs = Date.now() + 2 * 60 * 60 * 1000;
      await persistLimitUntil(untilMs);
      return json(
        {
          code: "quota_exceeded",
          error:
            "You've reached your answer limit for now. Please try again in a bit, or upgrade to Premium for unlimited access.",
          resetAt: untilMs,
        },
        429
      );
    }
    if ((e as Error & { name?: string }).name === "TimeoutError") {
      return json(
        {
          error: "I'm having trouble connecting to the model right now. Please try again in a moment.",
        },
        500
      );
    }
    return json(
      { error: "I'm having trouble connecting to the model right now. Please try again in a moment." },
      500
    );
  }

  // 2) Vector search the knowledge base
  let rows: Array<{ title: string; content: string; similarity: number }> = [];
  try {
    const { data, error } = await supabase.rpc("match_documents", {
      query_embedding: qVec,
      match_count: MAX_MATCHES,
    });
    if (!error && Array.isArray(data)) {
      rows = data as Array<{ title: string; content: string; similarity: number }>;
    }
  } catch {
    rows = [];
  }

  // 3) Build sources + context
  const sources = rows.map((row) => ({
    id: "",
    title: row.title,
    text: row.content.slice(0, MAX_EXCERPT_CHARS),
    content: row.content.slice(0, MAX_EXCERPT_CHARS),
    similarity: Math.round(row.similarity * 100),
  }));

  const context =
    rows.length === 0
      ? "(No internal knowledge-base excerpts matched this question. You may answer from general knowledge.)"
      : rows
          .map(
            (row, i) =>
              `[${i + 1}] (title: ${row.title})\n${row.content.slice(0, MAX_EXCERPT_CHARS)}`
          )
          .join("\n\n---\n\n");

  const systemPrompt = buildSystemPrompt();
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  for (const turn of history) {
    const role = turn.role === "assistant" ? "model" : "user";
    const text = String(turn.content ?? "").trim();
    if (!text) continue;
    contents.push({ role, parts: [{ text }] });
  }
  contents.push({ role: "user", parts: [{ text: `${question}\n\nCONTEXT:\n${context}` }] });

  // 4) Stream the answer back as NDJSON events (same protocol the frontend expects)
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        send({ type: "sources", sources });

        // Wait up to 12s for the first Gemini bytes; if the provider hangs,
        // fail fast with a friendly message instead of making the client wait 35s.
        const gCtrl = new AbortController();
        const gWait = setTimeout(() => gCtrl.abort(), 12000);
        let gRes: Response;
        try {
          gRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents,
                systemInstruction: { parts: [{ text: systemPrompt }] },
                generationConfig: { temperature: 0.7, maxOutputTokens: MAX_OUTPUT_TOKENS },
              }),
              signal: gCtrl.signal,
            }
          );
        } catch (err) {
          clearTimeout(gWait);
          send({
            type: "error",
            error: "I'm a bit busy right now. Please try again in a moment.",
          });
          controller.close();
          return;
        }
        clearTimeout(gWait);

if (!gRes.ok || !gRes.body) {
          if (gRes.status === 429) {
            const untilMs = Date.now() + 2 * 60 * 60 * 1000;
            await persistLimitUntil(untilMs);
            send({
              type: "error",
              error:
                "You've reached your answer limit for now. Please try again in about 2 hours, or upgrade to Premium for unlimited access.",
              resetAt: untilMs,
            });
            controller.close();
            return;
          }
          send({
            type: "error",
            error: "Sorry, we couldn't generate an answer right now. Please try again in a moment.",
          });
          controller.close();
          return;
        }

        const reader = gRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            let evt: any;
            try {
              evt = JSON.parse(payload);
            } catch {
              continue;
            }
            // Gemini can also 429 mid-stream (SSE error payload).
            if (evt?.error && (/429/.test(String(evt.error.code ?? "")) || /QUOTA|rate|limit/i.test(String(evt.error.message ?? "")))) {
              const untilMs = Date.now() + 2 * 60 * 60 * 1000;
              await persistLimitUntil(untilMs);
              send({
                type: "error",
                error:
                  "You've reached your answer limit for now. Please try again in about 2 hours, or upgrade to Premium for unlimited access.",
                resetAt: untilMs,
              });
              controller.close();
              return;
            }
            const parts: any[] = evt.candidates?.[0]?.content?.parts ?? [];
            for (const part of parts) {
              if (typeof part.text === "string" && part.text) {
                send({ type: "token", text: part.text });
              }
            }
          }
        }
        send({ type: "done" });
        controller.close();
      } catch (e) {
        try {
          send({ type: "error", error: (e as Error).message });
        } catch {
          /* ignore */
        }
        controller.close();
      }
    },
  });

  return corsify(
    new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    })
  );
}

Deno.serve(handler);