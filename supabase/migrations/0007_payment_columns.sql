-- 0007_payment_columns.sql
-- Add Razorpay subscription columns to profiles for the premium billing flow.

alter table public.profiles
  add column if not exists razorpay_customer_id text,
  add column if not exists razorpay_subscription_id text,
  add column if not exists subscription_status text default 'none',
  add column if not exists premium_expires_at timestamptz;