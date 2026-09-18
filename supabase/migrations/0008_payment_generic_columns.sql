-- 0008_payment_generic_columns.sql
-- Remove Razorpay-specific naming; make billing columns provider-agnostic
-- (now used by Cashfree).

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'razorpay_customer_id'
  ) then
    alter table public.profiles rename column razorpay_customer_id to payment_customer_id;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'razorpay_subscription_id'
  ) then
    alter table public.profiles rename column razorpay_subscription_id to payment_order_id;
  end if;
end $$;

alter table public.profiles
  add column if not exists payment_customer_id text,
  add column if not exists payment_order_id text,
  add column if not exists premium_plan text;