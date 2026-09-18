// copilot — Dev-Copilot: natural-language questions about the company's data.
// Admin-only. Turns a question into a WHITELISTED read-only lookup, runs it,
// then asks Gemini to summarize the result into a clean answer.
// No arbitrary SQL is ever executed — safety by construction.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const CHAT_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.6-flash";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

async function requireAdmin(req: Request): Promise<{ ok: true } | { ok: false; status: number; body: { error: string } }> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false, status: 401, body: { error: "Unauthorized" } };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { ok: false, status: 401, body: { error: "Unauthorized" } };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, suspended")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile || profile.role !== "admin") return { ok: false, status: 403, body: { error: "Forbidden" } };
  if (profile.suspended) return { ok: false, status: 403, body: { error: "Account suspended" } };
  return { ok: true };
}

const OPS: Record<string, { desc: string; params: Record<string, string> }> = {
  usage_summary: { desc: "High-level counts: total users, active premium, free, refunds, messages, conversations, documents, leads.", params: {} },
  user_list: { desc: "List users (email, role, plan, premium expiry).", params: { role: "optional: free|premium|admin", limit: "optional number (default 20)" } },
  expiring_subscriptions: { desc: "Premium subscriptions expiring within N days.", params: { days: "number (default 30)" } },
  messages_by_user: { desc: "Top users by message count.", params: { limit: "optional number (default 10)" } },
  chat_volume: { desc: "Messages sent in the last N days.", params: { days: "number (default 7)" } },
  top_documents: { desc: "Most uploaded documents / usage by title.", params: { limit: "optional number (default 10)" } },
  pending_payments: { desc: "Users with unpaid order drafts (subscription_status=created).", params: {} },
  lead_pipeline: { desc: "Sales leads by stage; optionally filter by one stage.", params: { stage: "optional: lead|demo|proposal|signed|paid|won|lost" } },
  table_counts: { desc: "Row counts of every app table.", params: {} },
  find_user: { desc: "Search for a user/profile by email.", params: { email: "email substring" } },
};

const PLAN_LABELS: Record<string, string> = { monthly: "Monthly ₹499", quarterly: "Quarterly ₹1,299", yearly: "Yearly ₹3,999" };

function num(v: unknown, fallback: number, min = 0, max = 90): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

async function pickOp(question: string): Promise<any> {
  const plan = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: question }] }],
        systemInstruction: {
          parts: [{
            text:
              "You map a user's question to EXACTLY ONE operation from this list, outputting ONLY compact JSON like {\"op\":\"user_list\",\"params\":{...}}. Available ops with params:\n" +
              JSON.stringify(OPS, null, 0) +
              "\nIf nothing fits, use usage_summary with no params. Never output anything except the JSON object.",
          }],
        },
        generationConfig: { temperature: 0, maxOutputTokens: 200 },
      }),
      signal: AbortSignal.timeout(20000),
    }
  );
  if (!res.ok) throw new Error("Mapper unavailable");
  const d = await res.json();
  const text = d?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("Could not understand the question");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("Could not parse the question mapping");
  }
}

async function runOp(op: any): Promise<unknown> {
  const key = String(op?.op ?? "usage_summary");
  if (!(key in OPS)) throw new Error("Unsupported operation");
  const params = (op?.params ?? {}) as Record<string, unknown>;

  switch (key) {
    case "usage_summary": {
      const [p, m, c, d, leads] = await Promise.all([
        supabase.from("profiles").select("id, role, subscription_status, premium_expires_at, premium_plan, created_at"),
        supabase.from("messages").select("id"),
        supabase.from("conversations").select("id"),
        supabase.from("documents").select("id"),
        supabase.from("leads").select("id, stage, setup_fee, amc, won_amount"),
      ]);
      const profiles = p.data ?? [];
      const now = Date.now();
      const active = profiles.filter((x) => x.role === "premium" && x.subscription_status === "active" && x.premium_expires_at && new Date(x.premium_expires_at).getTime() > now);
      return {
        table: "profiles/messages/conversations/documents/leads",
        total_users: profiles.length,
        active_premium: active.length,
        free_users: profiles.filter((x) => x.role === "free").length,
        admins: profiles.filter((x) => x.role === "admin").length,
        pending_payments: profiles.filter((x) => x.subscription_status === "created").length,
        refunded: profiles.filter((x) => x.subscription_status === "refunded").length,
        total_messages: m.count ?? 0,
        total_conversations: c.count ?? 0,
        total_documents: d.count ?? 0,
        leads: leads.data?.length ?? 0,
      };
    }
    case "user_list": {
      const limit = num(params.limit, 20, 1, 50);
      let q = supabase.from("profiles").select("email, full_name, role, subscription_status, premium_plan, premium_expires_at, created_at");
      if (["free", "premium", "admin"].includes(String(params.role))) q = q.eq("role", String(params.role));
      const { data } = await q.order("created_at", { ascending: false }).limit(limit);
      return { table: "profiles", rows: data ?? [] };
    }
    case "expiring_subscriptions": {
      const days = num(params.days, 30, 1, 90);
      const soon = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("profiles")
        .select("email, premium_plan, premium_expires_at")
        .eq("role", "premium")
        .eq("subscription_status", "active")
        .not("premium_expires_at", "is", null)
        .lte("premium_expires_at", soon)
        .order("premium_expires_at", { ascending: true });
      return { table: "profiles", expiring_within_days: days, rows: data ?? [] };
    }
    case "messages_by_user": {
      const limit = num(params.limit, 10, 1, 50);
      const { data: msgs } = await supabase.from("messages").select("user_id, created_at").order("created_at", { ascending: false }).limit(4000);
      const tally: Record<string, number> = {};
      for (const m of msgs ?? []) tally[m.user_id] = (tally[m.user_id] ?? 0) + 1;
      const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, limit);
      const { data: profs } = await supabase.from("profiles").select("id, email").in("id", top.map(([id]) => id));
      const byId = new Map((profs ?? []).map((x) => [x.id, x.email]));
      return { table: "messages", rows: top.map(([id, cnt]) => ({ user: byId.get(id) ?? id, messages: cnt })) };
    }
    case "chat_volume": {
      const days = num(params.days, 7, 1, 90);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase.from("messages").select("created_at").gte("created_at", since);
      return { table: "messages", days, count: data?.length ?? 0 };
    }
    case "top_documents": {
      const limit = num(params.limit, 10, 1, 50);
      const { data } = await supabase.from("document_stats").select("title, uploaded_by, chunkCount, totalChars, firstUploaded").order("firstUploaded", { ascending: false }).limit(limit);
      return { table: "document_stats", rows: data ?? [] };
    }
    case "pending_payments": {
      const { data } = await supabase.from("profiles").select("email, premium_plan, payment_order_id, created_at").eq("subscription_status", "created").order("created_at", { ascending: false });
      return { table: "profiles", rows: data ?? [] };
    }
    case "lead_pipeline": {
      let q = supabase.from("leads").select("company, stage, size, setup_fee, amc, won_amount, next_follow_up");
      if (typeof params.stage === "string" && params.stage) q = q.eq("stage", params.stage);
      const { data } = await q.order("updated_at", { ascending: false });
      return { table: "leads", rows: data ?? [] };
    }
    case "table_counts": {
      const tables = ["profiles", "documents", "documents_embeddings", "conversations", "messages", "leads"] as const;
      const out: Record<string, number> = {};
      for (const t of tables) {
        try {
          const r = await supabase.from(t).select("id", { count: "exact", head: true });
          out[t] = r.count ?? 0;
        } catch {
          out[t] = -1;
        }
      }
      return { table: "information_schema", row_counts: out };
    }
    case "find_user": {
      const email = String(params.email ?? "").trim().toLowerCase();
      if (!email) throw new Error("email param is required for find_user");
      const { data } = await supabase.from("profiles").select("email, full_name, role, subscription_status, premium_plan, premium_expires_at, created_at").ilike("email", `%${email}%`).limit(10);
      return { table: "profiles", rows: data ?? [] };
    }
    default:
      throw new Error("Unsupported operation");
  }
}

async function summarize(question: string, op: any, result: unknown): Promise<string> {
  if (!GEMINI_API_KEY) return "No Gemini key configured.";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: question }] }],
        systemInstruction: {
          parts: [{
            text:
              "You are the owner's Dev-Copilot for their white-label SaaS. Below is a question and the raw result of the lookup. " +
              "Answer the question briefly in clear English/Hinglish-friendly markdown (short bullets, numbers as given). " +
              "Do NOT invent numbers. If there is no data, say so.\n\nQUESTION: " + question +
              "\n\nOPERATION: " + JSON.stringify(op || {}) +
              "\n\nRESULT:\n" + JSON.stringify(result, null, 2),
          }],
        },
        generationConfig: { temperature: 0.3, maxOutputTokens: 600 },
      }),
      signal: AbortSignal.timeout(25000),
    }
  );
  if (!res.ok) return result ? JSON.stringify(result).slice(0, 1200) : "No data.";
  const d = await res.json();
  return d?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") || "No answer generated.";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await requireAdmin(req);
  if (!auth.ok) return json(auth.body, auth.status);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON body" }, 400); }

  const question = String(body?.question ?? "").trim();
  if (!question) return json({ error: "question is required" }, 400);

  try {
    const op = await pickOp(question);
    const result = await runOp(op);
    const answer = await summarize(question, op, result);
    return json({ answer, op });
  } catch (e) {
    console.error("copilot error:", (e as Error).message ?? e);
    return json({ error: "I couldn't answer that. Try rephrasing (e.g. \"expiring subscriptions in 30 days\")." }, 500);
  }
});