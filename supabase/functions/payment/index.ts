// payment edge function — Cashfree-backed premium billing.
// Modes:
//  - Auth'd user requests: { action: "create_order" | "check_status", plan }
//  - Webhook POSTs from Cashfree (detected via x-webhook-signature header).
//
// Premium access is granted for a fixed period per plan on successful payment:
//   monthly -> 30 days, quarterly -> 91 days, yearly -> 365 days.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CASHFREE_APP_ID = Deno.env.get("CASHFREE_APP_ID") ?? "";
const CASHFREE_SECRET_KEY = Deno.env.get("CASHFREE_SECRET_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("CASHFREE_WEBHOOK_SECRET") || CASHFREE_SECRET_KEY;
const CASHFREE_ENV = (Deno.env.get("CASHFREE_ENV") ?? "sandbox").toLowerCase();
const APP_URL = Deno.env.get("APP_URL") ?? "https://ai-knowledge-assistant-lyart.vercel.app";

const CASHFREE_BASE = CASHFREE_ENV === "production"
  ? "https://api.cashfree.com/pg"
  : "https://sandbox.cashfree.com/pg";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-signature, x-webhook-timestamp",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

class ClientError extends Error {}
class ProviderError extends Error {}

// plan -> { amount (INR rupees), days of premium }
const PLANS: Record<string, { amount: number; days: number; label: string }> = {
  monthly: { amount: 499, days: 30, label: "Monthly" },
  quarterly: { amount: 1299, days: 91, label: "Quarterly" },
  yearly: { amount: 3999, days: 365, label: "Yearly" },
};

async function cashfreeFetch(path: string, method = "GET", body?: unknown): Promise<any> {
  const res = await fetch(`${CASHFREE_BASE}${path}`, {
    method,
    headers: {
      "x-client-id": CASHFREE_APP_ID,
      "x-client-secret": CASHFREE_SECRET_KEY,
      "x-api-version": "2023-08-01",
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    console.error(`Cashfree ${method} ${path} failed (${res.status}): ${text}`);
    throw new ProviderError("Payment service is temporarily unavailable. Please try again in a moment.");
  }
  return data;
}

async function requireUser(req: Request): Promise<{ userId: string; email: string; fullName: string } | Response> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Unauthorized" }, 401);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return json({ error: "Unauthorized" }, 401);
  const fullName = (data.user.user_metadata?.full_name ?? "") as string;
  return { userId: data.user.id, email: data.user.email ?? "", fullName };
}

function planFromOrderId(orderId: string): string | null {
  const parts = orderId.split("_");
  // ord_<plan>_<user8>_<ts>
  const plan = parts[1];
  return plan && plan in PLANS ? plan : null;
}

async function createOrder(userId: string, email: string, fullName: string, planKey: string, phone: string) {
  const plan = PLANS[planKey];
  const orderId = `ord_${planKey}_${userId.slice(0, 8)}_${Date.now()}`;

  const order = await cashfreeFetch("/orders", "POST", {
    order_id: orderId,
    order_amount: plan.amount,
    order_currency: "INR",
    customer_details: {
      customer_id: userId,
      customer_email: email,
      customer_name: fullName || email,
      customer_phone: phone,
    },
    order_meta: {
      return_url: `${APP_URL}/chat`,
    },
    order_note: `AI Knowledge Assistant Premium — ${plan.label} (${plan.days} days)`,
  });

  await supabase.from("profiles").update({
    payment_customer_id: userId,
    payment_order_id: orderId,
    premium_plan: planKey,
    subscription_status: "created",
  }).eq("id", userId);

  return {
    order_id: orderId,
    payment_session_id: order?.payment_session_id ?? "",
    mode: CASHFREE_ENV === "production" ? "production" : "sandbox",
  };
}

async function grantPremium(userId: string, planKey: string) {
  const plan = PLANS[planKey];
  if (!plan) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("premium_expires_at")
    .eq("id", userId)
    .maybeSingle();

  const now = Date.now();
  const current = profile?.premium_expires_at ? new Date(profile.premium_expires_at).getTime() : 0;
  const base = current > now ? current : now;
  const expires = new Date(base + plan.days * 24 * 60 * 60 * 1000).toISOString();

  await supabase.from("profiles").update({
    role: "premium",
    subscription_status: "active",
    premium_plan: planKey,
    premium_expires_at: expires,
  }).eq("id", userId);
}

async function checkStatus(userId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, subscription_status, payment_order_id, premium_plan, premium_expires_at")
    .eq("id", userId)
    .maybeSingle();

  if (!profile?.payment_order_id) {
    return json({ role: profile?.role ?? "free", subscription_active: false });
  }

  let orderStatus: string | null = null;
  try {
    const order = await cashfreeFetch(`/orders/${profile.payment_order_id}`);
    orderStatus = order?.order_status ?? null;
    if (orderStatus === "PAID") {
      const planKey = profile.premium_plan || planFromOrderId(profile.payment_order_id) || "monthly";
      await grantPremium(userId, planKey);
      const { data: fresh } = await supabase
        .from("profiles")
        .select("premium_expires_at")
        .eq("id", userId)
        .maybeSingle();
      return json({
        role: "premium",
        subscription_active: true,
        premium_expires_at: fresh?.premium_expires_at ?? null,
      });
    }
  } catch {
    // provider lookup failed — fall back to DB truth
  }

  return json({
    role: profile.role ?? "free",
    subscription_active: profile.subscription_status === "active",
    subscription_status: profile.subscription_status ?? null,
    order_status: orderStatus,
    premium_expires_at: profile.premium_expires_at ?? null,
  });
}

async function verifyWebhookSignature(bodyText: string, signature: string | null, timestamp: string | null): Promise<boolean> {
  if (!signature || !timestamp || !WEBHOOK_SECRET) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + bodyText));
  const bytes = new Uint8Array(mac);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary) === signature;
}

async function findUserId(event: any): Promise<string | null> {
  const orderId: string = event?.data?.order?.order_id ?? event?.data?.payment?.order_id ?? "";
  const customerId: string = event?.data?.customer_details?.customer_id ?? event?.data?.order?.customer_details?.customer_id ?? "";
  if (customerId) return customerId;
  if (orderId) {
    const { data } = await supabase
      .from("profiles")
      .select("id")
      .eq("payment_order_id", orderId)
      .maybeSingle();
    return data?.id ?? null;
  }
  return null;
}

async function handleWebhook(event: any) {
  const type: string = event?.type ?? "";
  const successTypes = ["PAYMENT_SUCCESS_WEBHOOK", "PAYMENT_LINK_EVENT", "ORDER_PAID"];
  if (!successTypes.includes(type)) return;

  const orderId: string = event?.data?.order?.order_id ?? event?.data?.payment?.order_id ?? "";
  const status: string = event?.data?.order?.order_status ?? event?.data?.payment?.payment_status ?? "";
  if (status && status !== "PAID" && status !== "SUCCESS") return;

  const userId = await findUserId(event);
  if (!userId) return;

  const planKey = planFromOrderId(orderId) || "monthly";
  await grantPremium(userId, planKey);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const rawBody = await req.text();
  const signature = req.headers.get("x-webhook-signature");

  if (signature) {
    const timestamp = req.headers.get("x-webhook-timestamp");
    const ok = await verifyWebhookSignature(rawBody, signature, timestamp);
    if (!ok) return json({ error: "Invalid signature" }, 401);
    let event: any = {};
    try { event = JSON.parse(rawBody); } catch {}
    try {
      await handleWebhook(event);
      return json({ ok: true });
    } catch (e: any) {
      console.error("webhook handling failed:", e?.message ?? e);
      return json({ error: "Webhook handling failed" }, 500);
    }
  }

  let body: any;
  try { body = JSON.parse(rawBody || "{}"); } catch { return json({ error: "Invalid JSON" }, 400); }

  if (!CASHFREE_APP_ID || !CASHFREE_SECRET_KEY) {
    return json({ error: "Payment gateway not configured yet. Please try again later." }, 503);
  }

  const action = body?.action ?? "";
  const user = await requireUser(req);
  if ("ok" in user) return user;
  const { userId, email, fullName } = user;

  try {
    switch (action) {
      case "create_order": {
        const plan = body?.plan ?? "monthly";
        if (!(plan in PLANS)) return json({ error: `Unknown plan: ${plan}` }, 400);
        const phone = String(body?.phone ?? "").replace(/\D/g, "");
        if (!/^[6-9]\d{9}$/.test(phone)) {
          return json({ error: "Please enter a valid 10-digit mobile number." }, 400);
        }
        const order = await createOrder(userId, email, fullName, plan, phone);
        return json(order);
      }
      case "check_status":
        return await checkStatus(userId);
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e: any) {
    if (e instanceof ClientError) return json({ error: e.message }, 400);
    if (e instanceof ProviderError) return json({ error: e.message }, 503);
    console.error("payment fn error:", e?.message ?? e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});