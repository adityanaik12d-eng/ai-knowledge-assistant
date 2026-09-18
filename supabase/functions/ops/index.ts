// ops — Ops-Copilot: private enterprise command center for the owner/admin.
// Returns a single business "overview" payload computed from live Supabase data:
// KPIs, MRR, subscriptions, payment health, and an AI-generated daily briefing
// (Gemini). Admin-only; service-role reads under the hood.

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

// Plan economics (base amount, convenience fee, per-month MRR contribution).
const PLANS: Record<string, { amount: number; fee: number; mrr: number; label: string }> = {
  monthly: { amount: 499, fee: 16, mrr: 499, label: "Monthly" },
  quarterly: { amount: 1299, fee: 41, mrr: 1299 / 3, label: "Quarterly" },
  yearly: { amount: 3999, fee: 121, mrr: 3999 / 12, label: "Yearly" },
};

async function requireAdmin(
  req: Request
): Promise<{ ok: true } | { ok: false; status: number; body: { error: string } }> {
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

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / (24 * 60 * 60 * 1000));
}

async function overview() {
  const now = new Date().toISOString();
  const in7 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [profilesRes, messagesRes, docsRes, convRes] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, role, subscription_status, premium_plan, payment_order_id, premium_expires_at, created_at, suspended"),
    supabase.from("messages").select("id, user_id, created_at").eq("role", "user").gte("created_at", since7),
    supabase.from("documents").select("id"),
    supabase.from("conversations").select("id"),
  ]);

  const profiles = profilesRes.data ?? [];
  const msgs7 = messagesRes.data ?? [];

  const activePremium = profiles.filter(
    (p) => p.role === "premium" && p.subscription_status === "active" && daysUntil(p.premium_expires_at) !== null && daysUntil(p.premium_expires_at)! >= 0
  );
  const expiring = profiles
    .filter((p) => p.role === "premium" && p.subscription_status === "active")
    .map((p) => ({
      id: p.id,
      email: p.email ?? "",
      full_name: p.full_name ?? "",
      plan: p.premium_plan ?? "monthly",
      expires_at: p.premium_expires_at,
      days_left: daysUntil(p.premium_expires_at),
    }))
    .filter((s) => s.days_left !== null)
    .sort((a, b) => (a.days_left! - b.days_left!));

  const expiring7 = expiring.filter((s) => s.days_left! >= 0 && s.days_left! <= 7);
  const expiring30 = expiring.filter((s) => s.days_left! >= 0 && s.days_left! <= 30);

  const payments = profiles
    .filter((p) => p.subscription_status && ![ "none", ""].includes(String(p.subscription_status)))
    .map((p) => ({
      id: p.id,
      email: p.email ?? "",
      status: p.subscription_status,
      plan: p.premium_plan ?? null,
      order_id: p.payment_order_id ?? null,
      expires_at: p.premium_expires_at ?? null,
      created_at: p.created_at ?? null,
      days_left: daysUntil(p.premium_expires_at),
    }))
    .sort((a, b) => String(a.email).localeCompare(String(b.email)));

  const pending = profiles.filter((p) => p.subscription_status === "created");
  const abandoned = pending.filter((p) => {
    if (!p.created_at) return false;
    return Date.now() - new Date(p.created_at).getTime() > 48 * 60 * 60 * 1000;
  });

  const breakdown = Object.keys(PLANS).map((key) => {
    const users = activePremium.filter((p) => p.premium_plan === key);
    return {
      plan: key,
      label: PLANS[key].label,
      count: users.length,
      mrr: Math.round(users.length * PLANS[key].mrr),
    };
  });
  const mrrTotal = breakdown.reduce((s, b) => s + b.mrr, 0);
  const feesTotal = activePremium.reduce((s, p) => s + (PLANS[p.premium_plan ?? "monthly"]?.fee ?? 0), 0);

  const stats = {
    totalUsers: profiles.length,
    activePremium: activePremium.length,
    freeUsers: profiles.filter((p) => p.role === "free").length,
    admins: profiles.filter((p) => p.role === "admin").length,
    suspended: profiles.filter((p) => p.suspended).length,
    refunded: profiles.filter((p) => p.subscription_status === "refunded").length,
    expiring7: expiring7.length,
    expiring30: expiring30.length,
    pendingPayments: pending.length,
    abandonedPayments: abandoned.length,
    signups7: profiles.filter((p) => p.created_at && p.created_at >= since7).length,
    activeUsers7: new Set(msgs7.map((m) => m.user_id)).size,
    totalMessages: messagesRes.count ?? 0,
    totalDocuments: docsRes.count ?? 0,
    totalConversations: convRes.count ?? 0,
    conversionRate: profiles.length ? Math.round((activePremium.length / profiles.length) * 1000) / 10 : 0,
  };

  const mrr = {
    breakdown,
    total: mrrTotal,
    feesTotal,
    projectedAnnual: mrrTotal * 12,
  };

  return {
    generated_at: now,
    stats,
    mrr,
    subscriptions: expiring.slice(0, 200),
    payments: payments.slice(0, 200),
    pending: pending.map((p) => ({ email: p.email, created_at: p.created_at, order_id: p.payment_order_id, days_pending: p.created_at ? Math.floor((Date.now() - new Date(p.created_at).getTime()) / (24*60*60*1000)) : 0 })),
  };
}

async function makeBriefing(data: any): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;
  const compact = {
    stats: data.stats,
    mrr: data.mrr,
    expiringSoon: data.subscriptions.slice(0, 8),
    pendingPayments: data.pending.slice(0, 8),
  };
  const prompt =
    "You are the CEO's AI operations copilot for a small white-label SaaS business called 'AI Knowledge Assistant' " +
    "(knowledge Q&A chatbot on Supabase + Vercel + Gemini, premium plans ₹499/mo · ₹1,299/qtr · ₹3,999/yr, convenience fee non-refundable).\n\n" +
    "Using ONLY the live business data below, write a concise daily briefing (max ~180 words, markdown) with:\n" +
    "1. One short headline sentence about overall health.\n" +
    "2. A 'Key metrics' bullet list (3-5 bullets) — what changed/what matters.\n" +
    "3. '⚠ Action items' — top 3 concrete follow-ups derived strictly from the data (e.g. expiring subscriptions to chase, abandoned payments to nudge, low conversion, no recent activity).\n\n" +
    "Do NOT invent numbers. If a number is zero or empty, say so plainly. End with a short motivational one-liner.\n\n" +
    "DATA (JSON):\n" + JSON.stringify(compact);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 700 },
        }),
        signal: AbortSignal.timeout(30000),
      }
    );
    if (!res.ok) return null;
    const data2 = await res.json();
    const text = data2?.candidates?.[0]?.content?.parts
      ?.map((p: any) => (typeof p.text === "string" ? p.text : ""))
      .join("") ?? "";
    return text.trim() || null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await requireAdmin(req);
  if (!auth.ok) return json(auth.body, auth.status);

  try {
    const data = await overview();
    const briefing = await makeBriefing(data);
    return json({ ...data, briefing });
  } catch (e) {
    console.error("ops fn error:", (e as Error).message ?? e);
    return json({ error: "Failed to load operations data" }, 500);
  }
});