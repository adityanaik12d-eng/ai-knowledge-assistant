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
    "Rules:",
    "- NEVER invent internal facts (specific policies, contact emails, phone numbers, URLs). " +
      "If the exact internal detail is not in the excerpts, say you don't have that precise information " +
      "and suggest contacting the IT helpdesk WITHOUT fabricating an email or phone number.",
    "- If the question is general knowledge, answer from your own knowledge; the excerpts are optional in that case.",
    "- Be honest about uncertainty. Keep answers clear, well-structured and reasonably concise. " +
      "Use markdown (headings, lists, code blocks) when it helps.",
  ].join("\n");
}

const encoder = new TextEncoder();

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Authenticate the caller (frontend sends the user's Supabase access token).
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("Missing authorization header");
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) throw new Error("Unauthorized");
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unauthorized" }, 401);
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
    return json({ error: "Embedding service unavailable: " + (e as Error).message }, 500);
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

        const gRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents,
              systemInstruction: { parts: [{ text: systemPrompt }] },
              generationConfig: { temperature: 0.7, maxOutputTokens: MAX_OUTPUT_TOKENS },
            }),
          }
        );

        if (!gRes.ok || !gRes.body) {
          const errText = await gRes.text().catch(() => "");
          send({ type: "error", error: `LLM request failed (${gRes.status}): ${errText.slice(0, 300)}` });
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