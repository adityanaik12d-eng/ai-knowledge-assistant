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

const ALLOWED_PROFILE_FIELDS = new Set(["role", "department", "suspended", "full_name"]);

function pickProfileFields(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_PROFILE_FIELDS) {
    if (key in body) out[key] = body[key];
  }
  return out;
}

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

async function listDocuments(): Promise<unknown[]> {
  const { data, error } = await supabase
    .from("document_stats")
    .select("*")
    .order("firstUploaded", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function activityLog(limit: number): Promise<unknown[]> {
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  limit = Math.min(limit, 200);

  const [docsRes, msgsRes] = await Promise.all([
    supabase
      .from("document_stats")
      .select("*")
      .order("firstUploaded", { ascending: true })
      .limit(1000),
    supabase
      .from("messages")
      .select("id, user_id, content, conversation_id, created_at")
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);
  if (docsRes.error) throw new Error(docsRes.error.message);
  if (msgsRes.error) throw new Error(msgsRes.error.message);

  const events: Array<Record<string, unknown>> = [];
  for (const d of docsRes.data ?? []) {
    events.push({
      id: `${d.title}|${d.uploaded_by ?? ""}|upload`,
      created_at: d.firstUploaded,
      action: "upload",
      user_id: d.uploaded_by ?? null,
      detail: { title: d.title, chunkCount: d.chunkCount, totalChars: d.totalChars },
    });
  }
  for (const m of msgsRes.data ?? []) {
    events.push({
      id: `${m.id}|chat`,
      created_at: m.created_at,
      action: "chat",
      user_id: m.user_id,
      detail: { conversation_id: m.conversation_id, preview: String(m.content ?? "").slice(0, 120) },
    });
  }
  events.sort((a, b) => new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime());
  return events.slice(0, limit);
}

async function usageStats(): Promise<Record<string, number>> {
  const [profilesRes, conversationsRes, messagesRes, documentsRes] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("conversations").select("id", { count: "exact", head: true }),
    supabase.from("messages").select("id", { count: "exact", head: true }),
    supabase.from("documents").select("id", { count: "exact", head: true }),
  ]);
  const log = await activityLog(1000);
  return {
    totalUsers: profilesRes.count ?? 0,
    totalConversations: conversationsRes.count ?? 0,
    totalMessages: messagesRes.count ?? 0,
    totalDocuments: documentsRes.count ?? 0,
    totalActivityEvents: log.length,
  };
}

async function addUser(body: Record<string, unknown>): Promise<{ id: string; email: string }> {
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("A valid email address is required");
  }
  if (password.length < 6) {
    throw new Error("Password must be at least 6 characters long");
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: body?.full_name ?? null },
  });
  if (createError || !created?.user) {
    throw new Error(createError?.message ?? "Failed to create user");
  }

  const role = body?.role === "admin" ? "admin" : "employee";
  const department = typeof body?.department === "string" && body.department ? String(body.department) : "unassigned";
  const fullName = typeof body?.full_name === "string" && body.full_name ? String(body.full_name) : created.user.email;

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ role, department, full_name: fullName, email })
    .eq("id", created.user.id);
  if (profileError) throw new Error(profileError.message);

  return { id: created.user.id, email };
}

async function updateUser(body: Record<string, unknown>): Promise<void> {
  const userId = String(body?.userId ?? "");
  const updates = pickProfileFields(body);
  if (!userId || Object.keys(updates).length === 0) {
    throw new Error("userId and at least one field are required");
  }
  const { error } = await supabase.from("profiles").update(updates).eq("id", userId);
  if (error) throw new Error(error.message);
}

async function deleteUserById(userId: string): Promise<void> {
  if (!userId) throw new Error("userId is required");
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);
}

async function bulkUpdateUsers(body: Record<string, unknown>): Promise<void> {
  const ids = Array.isArray(body.userIds) ? body.userIds.map(String).filter(Boolean) : [];
  const updates = pickProfileFields(body);
  if (ids.length === 0 || Object.keys(updates).length === 0) {
    throw new Error("userIds and at least one field are required");
  }
  const { error } = await supabase.from("profiles").update(updates).in("id", ids);
  if (error) throw new Error(error.message);
}

async function bulkDeleteUsers(body: Record<string, unknown>): Promise<number> {
  const ids = Array.isArray(body.userIds) ? body.userIds.map(String).filter(Boolean) : [];
  if (ids.length === 0) throw new Error("userIds is required");
  for (const id of ids) {
    await deleteUserById(id);
  }
  return ids.length;
}

async function deleteDocument(body: Record<string, unknown>): Promise<void> {
  const title = String(body?.title ?? "").trim();
  const uploadedBy = body?.uploaded_by ? String(body.uploaded_by) : null;
  if (!title) throw new Error("title is required");

  let query = supabase.from("documents").delete().eq("title", title);
  if (uploadedBy) query = query.eq("uploaded_by", uploadedBy);
  const { error } = await query;
  if (error) throw new Error(error.message);
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return json(auth.body, auth.status);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad JSON body" }, 400);
  }

  const action = String(body?.action ?? "");
  try {
    switch (action) {
      case "list_documents":
        return json({ documents: await listDocuments() });
      case "activity_log":
        return json({ events: await activityLog(Number(body?.limit)) });
      case "usage_stats":
        return json({ stats: await usageStats() });
      case "add_user":
        return json({ user: await addUser(body) });
      case "update_user":
        await updateUser(body);
        return json({ ok: true });
      case "delete_user":
        await deleteUserById(String(body?.userId ?? ""));
        return json({ ok: true });
      case "bulk_update_users":
        await bulkUpdateUsers(body);
        return json({ ok: true });
      case "bulk_delete_users":
        return json({ ok: true, deleted: await bulkDeleteUsers(body) });
      case "delete_document":
        await deleteDocument(body);
        return json({ ok: true });
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Internal error" }, 500);
  }
}

Deno.serve(handler);