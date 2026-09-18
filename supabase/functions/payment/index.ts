// payment edge function
// Razorpay Subscriptions-based premium billing.
// Modes:
//  - Auth'd user requests: { action: "create_subscription" | "check_status" | "cancel_subscription", plan }
//  - Webhook POSTs from Razorpay (detected via X-Razorpay-Signature header).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";
const WEBHOOK_SECRET = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-razorpay-signature",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

class ClientError extends Error {}

// Price anchors used for plan creation (paise).
const PLANS: Record<string, { amount: number; period: string; interval: number; name: string; description: string }> = {
  monthly: {
    amount: 49900,
    period: "monthly",
    interval: 1,
    name: "Premium Monthly",
    description: "AI Knowledge Assistant Premium — monthly",
  },
  quarterly: {
    amount: 129900,
    period: "monthly",
    interval: 3,
    name: "Premium Quarterly",
    description: "AI Knowledge Assistant Premium — quarterly",
  },
  yearly: {
    amount: 399900,
    period: "yearly",
    interval: 1,
    name: "Premium Yearly",
    description: "AI Knowledge Assistant Premium — yearly",
  },
};

async function razorpayFetch(path: string, method = "GET", body?: unknown): Promise<any> {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: "Basic " + btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`),
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new ClientError(`Razorpay ${method} ${path} failed (${res.status}): ${data?.error?.description ?? text}`);
  }
  return data;
}

// In-memory plan-id cache. Plans are idempotent per key+amount; even if a
// duplicate is created it is harmless and reused only within this instance.
const planCache = new Map<string, string>();

async function getPlanId(planKey: string): Promise<string> {
  if (planCache.has(planKey)) return planCache.get(planKey)!;
  const cfg = PLANS[planKey];
  if (!cfg) throw new ClientError(`Unknown plan: ${planKey}`);
  const plan = await razorpayFetch("/plans", "POST", {
    period: cfg.period,
    interval: cfg.interval,
    item: {
      name: cfg.name,
      description: cfg.description,
      amount: cfg.amount,
      currency: "INR",
    },
  });
  planCache.set(planKey, plan.id);
  return plan.id;
}

async function requireUser(req: Request): Promise<{ userId: string; email: string; fullName: string } | Response> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Unauthorized" }, 401);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return json({ error: "Unauthorized" }, 401);
  const profile = (data.user.user_metadata?.full_name ?? data.user.email ?? "") as string;
  return {
    userId: data.user.id,
    email: data.user.email ?? "",
    fullName: profile ?? "",
  };
}

async function createSubscription(userId: string, email: string, fullName: string, planKey: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, subscription_status, razorpay_customer_id, razorpay_subscription_id")
    .eq("id", userId)
    .maybeSingle();

  if (profile?.role === "premium" && profile?.subscription_status === "active") {
    return;
  }

  let customerId = profile?.razorpay_customer_id ?? "";
  if (!customerId) {
    try {
      const customer = await razorpayFetch("/customers", "POST", {
        email,
        name: fullName || email,
        notes: { user_id: userId },
      });
      customerId = customer.id;
      await supabase.from("profiles").update({ razorpay_customer_id: customerId }).eq("id", userId);
    } catch (e: any) {
      // Customer may already exist under this key — try fetching by email.
      const list = await razorpayFetch(`/customers?count=50`);
      const hit = (list?.items ?? []).find((c: any) => c?.email === email);
      if (hit) {
        customerId = hit.id;
        await supabase.from("profiles").update({ razorpay_customer_id: customerId }).eq("id", userId);
      } else {
        throw e;
      }
    }
  }

  const planId = await getPlanId(planKey);
  const sub = await razorpayFetch("/subscriptions", "POST", {
    plan_id: planId,
    customer_id: customerId,
    total_count: 0,
    customer_notify: 1,
    notes: { user_id: userId, plan: planKey },
  });

  await supabase.from("profiles").update({
    razorpay_subscription_id: sub.id,
    subscription_status: "created",
  }).eq("id", userId);

  return sub.short_url;
}

async function checkStatus(userId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, subscription_status, razorpay_subscription_id, premium_expires_at")
    .eq("id", userId)
    .maybeSingle();

  if (!profile?.razorpay_subscription_id) {
    return json({ role: profile?.role ?? "free", subscription_active: false });
  }

  let rzStatus = profile.subscription_status;
  try {
    const sub = await razorpayFetch(`/subscriptions/${profile.razorpay_subscription_id}`);
    rzStatus = sub?.status ?? rzStatus;
    if (sub?.status === "active" && (profile.role !== "premium" || profile.subscription_status !== "active")) {
      const currentEnd = (sub as any).current_end
        ? new Date((sub as any).current_end * 1000).toISOString()
        : null;
      await supabase.from("profiles").update({
        role: "premium",
        subscription_status: "active",
        premium_expires_at: currentEnd,
      }).eq("id", userId);
      return json({ role: "premium", subscription_active: true, premium_expires_at: currentEnd });
    }
    if (sub?.status && ["cancelled", "halted", "pending"].includes(sub.status) && profile.role === "premium") {
      await supabase.from("profiles").update({ role: "free", subscription_status: sub.status }).eq("id", userId);
    }
  } catch {
    // subscription fetch failed (live<->test key mismatch etc). Keep DB truth.
  }

  const sub2 = await supabase
    .from("profiles")
    .select("role, subscription_status, premium_expires_at")
    .eq("id", userId)
    .maybeSingle();
  return json({
    role: sub2?.role ?? "free",
    subscription_active: sub2?.subscription_status === "active",
    subscription_status: sub2?.subscription_status ?? null,
    premium_expires_at: sub2?.premium_expires_at ?? null,
  });
}

async function cancelSubscription(userId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("razorpay_subscription_id")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.razorpay_subscription_id) return json({ ok: true });

  let cancelled = false;
  try {
    await razorpayFetch(`/subscriptions/${profile.razorpay_subscription_id}/cancel`, "POST", {
      cancel_at_cycle_end: false,
    });
    cancelled = true;
  } catch {
    // already cancelled / not found — proceed to flip role
  }
  await supabase.from("profiles").update({
    subscription_status: cancelled ? "cancelled" : profile.subscription_status,
    premium_expires_at: null,
  }).eq("id", userId);
  if (cancelled || profile.subscription_status !== "active") {
    await supabase.from("profiles").update({ role: "free" }).eq("id", userId);
  }
  return json({ ok: true });
}

async function verifyWebhookSignature(bodyText: string, signature: string | null): Promise<boolean> {
  if (!signature || !WEBHOOK_SECRET) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(bodyText));
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === signature;
}

async function handleWebhook(bodyText: string, event: any) {
  const eventName: string = event?.event ?? "";
  const subEntity = event?.payload?.subscription?.entity ?? null;
  const subId: string = subEntity?.id ?? "";
  const notes: Record<string, unknown> = subEntity?.notes ?? {};
  const userId = (notes?.user_id as string) ?? "";

  if (!subId) return;

  const findUser = async (): Promise<string | null> => {
    if (userId) return userId;
    const { data } = await supabase
      .from("profiles")
      .select("id")
      .eq("razorpay_subscription_id", subId)
      .maybeSingle();
    return data?.id ?? null;
  };

  const uid = await findUser();
  if (!uid) return;

  const currentEnd = subEntity.current_end
    ? new Date(subEntity.current_end * 1000).toISOString()
    : null;

  if (["subscription.activated", "subscription.charged", "subscription.completed"].includes(eventName)) {
    await supabase.from("profiles").update({
      role: "premium",
      razorpay_subscription_id: subId,
      subscription_status: "active",
      premium_expires_at: currentEnd,
    }).eq("id", uid);
  } else if (["subscription.cancelled", "subscription.halted", "subscription.expired"].includes(eventName)) {
    await supabase.from("profiles").update({
      role: "free",
      subscription_status: eventName.replace("subscription.", ""),
      premium_expires_at: null,
    }).eq("id", uid);
  } else if (eventName === "payment.pending" || eventName === "subscription.pending" || eventName === "subscription.authenticated") {
    await supabase.from("profiles").update({
      razorpay_subscription_id: subId,
      subscription_status: "pending",
    }).eq("id", uid);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const rawBody = await req.text();
  const isWebhook = req.headers.get("X-Razorpay-Signature");
  if (isWebhook) {
    const sig = req.headers.get("X-Razorpay-Signature");
    const ok = await verifyWebhookSignature(rawBody, sig);
    if (!ok) return json({ error: "Invalid signature" }, 401);
    let event: any = {};
    try { event = JSON.parse(rawBody); } catch {}
    try {
      await handleWebhook(rawBody, event);
      return json({ ok: true });
    } catch (e: any) {
      return json({ error: "Webhook handling failed", detail: e?.message ?? "unknown" }, 500);
    }
  }

  let body: any;
  try { body = JSON.parse(rawBody || "{}"); } catch { return json({ error: "Invalid JSON" }, 400); }

  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    return json({ error: "Razorpay not configured" }, 503);
  }

  const action = body?.action ?? "";
  const user = await requireUser(req);
  if ("ok" in user) return user;
  const { userId, email, fullName } = user;

  try {
    switch (action) {
      case "create_subscription": {
        const plan = body?.plan ?? "monthly";
        if (!(plan in PLANS)) return json({ error: `Unknown plan: ${plan}` }, 400);
        const shortUrl = await createSubscription(userId, email, fullName, plan);
        if (!shortUrl) {
          return json({ error: "You already have an active Premium subscription." }, 409);
        }
        return json({ short_url: shortUrl, plan });
      }
      case "check_status":
        return await checkStatus(userId);
      case "cancel_subscription":
        return await cancelSubscription(userId);
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e: any) {
    if (e instanceof ClientError) return json({ error: e.message }, 400);
    return json({ error: e?.message ?? "Internal error" }, 500);
  }
});