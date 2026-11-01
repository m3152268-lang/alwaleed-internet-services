-- شركة الوليد: تكملة آمنة مبدئية لقاعدة Supabase
-- لا يحذف أي جدول أو سجل موجود. راجع السياسات الحالية قبل تطبيقها.
-- المالك المعتمد: m3152268@gmail.com

create table if not exists public.daily_profit_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  income numeric(12,2) not null default 0 check (income >= 0),
  expenses numeric(12,2) not null default 0 check (expenses >= 0),
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists daily_profit_entries_date_idx
  on public.daily_profit_entries(entry_date desc, created_at desc);

alter table public.daily_profit_entries enable row level security;

-- تقييد بيانات العملاء والمدفوعات: المالك أو المستخدم المعتمد فقط.
-- تُزال السياسات العامة المعروفة التي كانت تسمح لكل مستخدم مسجل بالوصول.
drop policy if exists "authenticated users can manage clients" on public.clients;
drop policy if exists "approved users manage clients" on public.clients;
create policy "approved users manage clients"
on public.clients for all to authenticated
using (
  lower(coalesce(auth.jwt() ->> 'email','')) = 'm3152268@gmail.com'
  or exists (
    select 1 from public.user_profiles p
    where p.user_id = auth.uid() and p.role = 'approved'
  )
)
with check (
  lower(coalesce(auth.jwt() ->> 'email','')) = 'm3152268@gmail.com'
  or exists (
    select 1 from public.user_profiles p
    where p.user_id = auth.uid() and p.role = 'approved'
  )
);

drop policy if exists "authenticated users can manage payments" on public.payments;
drop policy if exists "approved users manage payments" on public.payments;
create policy "approved users manage payments"
on public.payments for all to authenticated
using (
  lower(coalesce(auth.jwt() ->> 'email','')) = 'm3152268@gmail.com'
  or exists (
    select 1 from public.user_profiles p
    where p.user_id = auth.uid() and p.role = 'approved'
  )
)
with check (
  lower(coalesce(auth.jwt() ->> 'email','')) = 'm3152268@gmail.com'
  or exists (
    select 1 from public.user_profiles p
    where p.user_id = auth.uid() and p.role = 'approved'
  )
);

-- تأكد من منح صلاحيات الجدول للمستخدمين المسجلين؛ RLS يحدد من يُسمح له فعليًا.
grant select, insert, update, delete on public.clients to authenticated;
grant select, insert, update, delete on public.payments to authenticated;
grant select, insert, update, delete on public.daily_profit_entries to authenticated;

-- الأرباح للمالك والمستخدمين المعتمدين فقط.
drop policy if exists "authenticated manage daily profits" on public.daily_profit_entries;
drop policy if exists "approved users manage daily profits" on public.daily_profit_entries;
create policy "approved users manage daily profits"
on public.daily_profit_entries for all to authenticated
using (
  lower(coalesce(auth.jwt() ->> 'email','')) = 'm3152268@gmail.com'
  or exists (select 1 from public.user_profiles p where p.user_id = auth.uid() and p.role = 'approved')
)
with check (
  lower(coalesce(auth.jwt() ->> 'email','')) = 'm3152268@gmail.com'
  or exists (select 1 from public.user_profiles p where p.user_id = auth.uid() and p.role = 'approved')
);

-- أمان جداول ملفات المستخدمين والطلبات: لا تسمح للمستخدم بتعديل موافقته بنفسه.
alter table public.user_profiles enable row level security;
alter table public.login_requests enable row level security;

drop policy if exists "read own profile or owner" on public.user_profiles;
create policy "read own profile or owner"
on public.user_profiles for select to authenticated
using (
  user_id = auth.uid()
  or lower(coalesce(auth.jwt() ->> 'email','')) = 'm3152268@gmail.com'
);

drop policy if exists "read own login requests or owner" on public.login_requests;
create policy "read own login requests or owner"
on public.login_requests for select to authenticated
using (
  user_id = auth.uid()
  or lower(coalesce(auth.jwt() ->> 'email','')) = 'm3152268@gmail.com'
);

drop policy if exists "submit own login request" on public.login_requests;
create policy "submit own login request"
on public.login_requests for insert to authenticated
with check (user_id = auth.uid());

-- لا نضيف سياسة تحديث للموافقة من المتصفح. يجب أن يتم القرار عبر Edge Function.
