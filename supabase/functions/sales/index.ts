// sales — Sales-Copilot: private pipeline CRM for white-label deals.
// Admin-only CRUD over the `leads` table + pipeline summary (follow-ups,
// won revenue, live AMC). Service-role reads/writes under the hood.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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

class ClientError extends Error {}

const STAGES = new Set(["lead", "demo", "proposal", "signed", "paid", "won", "lost"]);
const SIZES = new Set(["s", "m", "e"]);
const FIELDS = new Set([
  "company", "contact_name", "contact_email", "contact_phone", "size", "source",
  "stage", "addons", "setup_fee", "amc", "notes", "next_follow_up", "won_amount",
]);

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

function normalize(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of FIELDS) {
    if (body[key] === undefined) continue;
    if (key === "size") {
      if (!SIZES.has(String(body[key]))) throw new ClientError("size must be s|m|e");
      out[key] = String(body[key]);
    } else if (key === "stage") {
      if (!STAGES.has(String(body[key]))) throw new ClientError("stage is not a valid pipeline stage");
      out[key] = String(body[key]);
    } else if (key === "setup_fee" || key === "amc" || key === "won_amount") {
      const n = Number(body[key]) || 0;
      if (n < 0) throw new ClientError(`${key} cannot be negative`);
      out[key] = Math.round(n);
    } else if (key === "addons") {
      out[key] = JSON.stringify(Array.isArray(body[key]) ? body[key] : []);
    } else if (key === "next_follow_up") {
      out[key] = body[key] ? String(body[key]) : null;
    } else {
      out[key] = body[key] === null ? null : String(body[key]);
    }
  }
  out.updated_at = new Date().toISOString();
  return out;
}

async function summary(leads: any[]) {
  const byStage: Record<string, number> = {};
  for (const s of STAGES) byStage[s] = 0;
  let wonRevenue = 0;
  let liveAmc = 0;
  let dueFollowUps = 0;
  const now = Date.now();
  const soon = now + 24 * 60 * 60 * 1000;
  for (const l of leads) {
    byStage[l.stage] = (byStage[l.stage] ?? 0) + 1;
    if (l.stage === "won") wonRevenue += Number(l.won_amount || l.setup_fee || 0);
    if (["signed", "paid", "won"].includes(l.stage)) liveAmc += Number(l.amc || 0);
    if (!["won", "lost"].includes(l.stage) && l.next_follow_up) {
      const t = new Date(l.next_follow_up).getTime();
      if (!Number.isNaN(t) && t <= soon && t >= now - 2 * 24 * 60 * 60 * 1000) dueFollowUps++;
    }
  }
  return { byStage, wonRevenue, liveAmc, dueFollowUps, totalLeads: leads.length };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await requireAdmin(req);
  if (!auth.ok) return json(auth.body, auth.status);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON body" }, 400); }

  const action = String(body?.action ?? "");
  try {
    switch (action) {
      case "list": {
        const { data, error } = await supabase.from("leads").select("*").order("updated_at", { ascending: false });
        if (error) throw new Error(error.message);
        return json({ leads: data ?? [], summary: await summary(data ?? []) });
      }
      case "create": {
        const updates = normalize(body);
        if (!updates.company) throw new ClientError("company is required");
        const { data, error } = await supabase.from("leads").insert(updates).select().single();
        if (error) throw new Error(error.message);
        return json({ lead: data });
      }
      case "update": {
        const id = String(body?.id ?? "");
        if (!id) throw new ClientError("id is required");
        const updates = normalize(body);
        const { data, error } = await supabase.from("leads").update(updates).eq("id", id).select().single();
        if (error) throw new Error(error.message);
        return json({ lead: data });
      }
      case "delete": {
        const id = String(body?.id ?? "");
        if (!id) throw new ClientError("id is required");
        const { error } = await supabase.from("leads").delete().eq("id", id);
        if (error) throw new Error(error.message);
        return json({ ok: true });
      }
      case "move": {
        const id = String(body?.id ?? "");
        const stage = String(body?.stage ?? "");
        if (!id) throw new ClientError("id is required");
        if (!STAGES.has(stage)) throw new ClientError("stage is not valid");
        const { data, error } = await supabase
          .from("leads")
          .update({ stage, updated_at: new Date().toISOString() })
          .eq("id", id)
          .select()
          .single();
        if (error) throw new Error(error.message);
        return json({ lead: data });
      }
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    const status = e instanceof ClientError ? 400 : 500;
    return json({ error: e instanceof Error ? e.message : "Internal error" }, status);
  }
});