-- MK Emlak Asistani platform foundation.
-- Additive only: the legacy veterinary tables remain unchanged.
begin;

create extension if not exists pgcrypto;
create schema if not exists private;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'Kullanıcı' check (char_length(full_name) between 2 and 150),
  phone text,
  locale text not null default 'tr' check (locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]+)*$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.platform_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'PLATFORM_ADMIN' check (role = 'PLATFORM_ADMIN'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 3 and 80),
  legal_name text,
  display_name text not null check (char_length(display_name) between 2 and 160),
  status text not null default 'PENDING' check (status in ('PENDING', 'TRIAL', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REJECTED')),
  default_locale text not null default 'tr' check (default_locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]+)*$'),
  timezone text not null default 'Europe/Istanbul',
  phone text,
  email text,
  address text,
  access_starts_at timestamptz,
  access_expires_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  suspended_at timestamptz,
  suspension_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (access_expires_at is null or access_starts_at is null or access_expires_at > access_starts_at)
);

create table public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('OFFICE_ADMIN', 'ADVISOR')),
  status text not null default 'PENDING' check (status in ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED')),
  invited_by uuid references auth.users(id),
  invited_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id),
  unique (id, business_id)
);

create table public.business_entitlements (
  business_id uuid primary key references public.businesses(id),
  max_advisors integer not null default 0 check (max_advisors >= 0),
  crm_enabled boolean not null default false,
  appointments_enabled boolean not null default false,
  whatsapp_enabled boolean not null default false,
  ai_analysis_enabled boolean not null default false,
  ai_voice_enabled boolean not null default false,
  imports_enabled boolean not null default false,
  reports_enabled boolean not null default false,
  monthly_ai_call_minutes integer not null default 0 check (monthly_ai_call_minutes >= 0),
  monthly_ai_analysis_limit integer not null default 0 check (monthly_ai_analysis_limit >= 0),
  monthly_lead_limit integer not null default 0 check (monthly_lead_limit >= 0),
  valid_from timestamptz,
  valid_until timestamptz,
  updated_by_platform_admin uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until is null or valid_from is null or valid_until > valid_from)
);

create table public.business_usage (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  metric text not null check (metric in ('AI_CALL_SECONDS', 'AI_ANALYSIS', 'WHATSAPP_MESSAGE', 'LEADS_IMPORTED', 'APPOINTMENTS_CREATED')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  used_quantity bigint not null default 0 check (used_quantity >= 0),
  reserved_quantity bigint not null default 0 check (reserved_quantity >= 0),
  updated_at timestamptz not null default now(),
  unique (business_id, metric, period_start, period_end),
  check (period_end > period_start)
);

create table public.platform_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id),
  business_id uuid references public.businesses(id),
  action text not null check (char_length(action) between 3 and 100),
  target_type text not null check (char_length(target_type) between 2 and 80),
  target_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index business_members_user_idx on public.business_members(user_id, status);
create index business_members_business_role_idx on public.business_members(business_id, role, status);
create index businesses_status_idx on public.businesses(status, access_expires_at);
create index business_usage_period_idx on public.business_usage(business_id, period_start, period_end);
create index platform_audit_business_idx on public.platform_audit_logs(business_id, created_at desc);
create index platform_audit_actor_idx on public.platform_audit_logs(actor_user_id, created_at desc);

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
create trigger platform_users_set_updated_at before update on public.platform_users
for each row execute function private.set_updated_at();
create trigger businesses_set_updated_at before update on public.businesses
for each row execute function private.set_updated_at();
create trigger business_members_set_updated_at before update on public.business_members
for each row execute function private.set_updated_at();
create trigger business_entitlements_set_updated_at before update on public.business_entitlements
for each row execute function private.set_updated_at();
create trigger business_usage_set_updated_at before update on public.business_usage
for each row execute function private.set_updated_at();

create function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_name text;
begin
  requested_name := trim(coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  insert into public.profiles(user_id, full_name)
  values (
    new.id,
    case when char_length(requested_name) between 2 and 150 then requested_name else 'Kullanıcı' end
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

create function private.enforce_platform_tenant_separation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.business_members member
    where member.user_id = new.user_id and member.status <> 'REVOKED'
  ) then
    raise exception 'Platform users cannot be tenant members' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create function private.enforce_tenant_platform_separation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'REVOKED' and exists (
    select 1 from public.platform_users platform_user
    where platform_user.user_id = new.user_id
  ) then
    raise exception 'Platform users cannot be tenant members' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger platform_users_prevent_tenant_membership
before insert or update of user_id, status on public.platform_users
for each row execute function private.enforce_platform_tenant_separation();

create trigger business_members_prevent_platform_user
before insert or update of user_id, status on public.business_members
for each row execute function private.enforce_tenant_platform_separation();

create function private.can_view_business(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.business_members member
    where member.business_id = target_business_id
      and member.user_id = (select auth.uid())
      and member.status in ('PENDING', 'ACTIVE', 'SUSPENDED')
  )
$$;

create function private.is_active_business_member(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.business_members member
    where member.business_id = target_business_id
      and member.user_id = (select auth.uid())
      and member.status = 'ACTIVE'
  )
$$;

create function private.is_office_admin(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.business_members member
    where member.business_id = target_business_id
      and member.user_id = (select auth.uid())
      and member.role = 'OFFICE_ADMIN'
      and member.status = 'ACTIVE'
  )
$$;

create function private.is_platform_admin(target_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id is not null and exists (
    select 1
    from public.platform_users platform_user
    where platform_user.user_id = target_user_id
      and platform_user.role = 'PLATFORM_ADMIN'
      and platform_user.status = 'ACTIVE'
  )
$$;

create function private.business_is_operational(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.businesses business
    where business.id = target_business_id
      and business.status in ('TRIAL', 'ACTIVE')
      and (business.access_starts_at is null or business.access_starts_at <= now())
      and (business.access_expires_at is null or business.access_expires_at > now())
  )
$$;

create function private.can_view_profile(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) = target_user_id or exists (
    select 1
    from public.business_members caller
    join public.business_members target on target.business_id = caller.business_id
    where caller.user_id = (select auth.uid())
      and caller.role = 'OFFICE_ADMIN'
      and caller.status = 'ACTIVE'
      and target.user_id = target_user_id
      and target.status <> 'REVOKED'
  )
$$;

create function private.enforce_advisor_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  advisor_limit integer;
  occupied_seats integer;
  becomes_counted boolean;
  was_counted boolean := false;
begin
  becomes_counted := new.role = 'ADVISOR' and new.status in ('PENDING', 'ACTIVE');
  if tg_op = 'UPDATE' then
    was_counted := old.role = 'ADVISOR' and old.status in ('PENDING', 'ACTIVE');
  end if;
  if not becomes_counted or was_counted then
    return new;
  end if;

  perform 1 from public.businesses where id = new.business_id for update;
  if not private.business_is_operational(new.business_id) then
    raise exception 'Business is not operational' using errcode = 'P0001';
  end if;

  select entitlement.max_advisors
    into advisor_limit
    from public.business_entitlements entitlement
    where entitlement.business_id = new.business_id;
  if advisor_limit is null then
    raise exception 'Business entitlements are missing' using errcode = 'P0001';
  end if;

  select count(*)::integer
    into occupied_seats
    from public.business_members member
    where member.business_id = new.business_id
      and member.role = 'ADVISOR'
      and member.status in ('PENDING', 'ACTIVE')
      and member.id <> new.id;
  if occupied_seats >= advisor_limit then
    raise exception 'Advisor limit reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger business_members_enforce_advisor_limit
before insert or update of role, status, business_id on public.business_members
for each row execute function private.enforce_advisor_limit();

create function public.submit_business_application(
  requested_display_name text,
  requested_slug text,
  requested_phone text default null,
  requested_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  new_business_id uuid;
  normalized_slug text := lower(trim(requested_slug));
  normalized_name text := trim(requested_display_name);
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if char_length(normalized_name) not between 2 and 160 then
    raise exception 'Invalid business name' using errcode = '22023';
  end if;
  if normalized_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or char_length(normalized_slug) not between 3 and 80 then
    raise exception 'Invalid business slug' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.business_members member
    join public.businesses business on business.id = member.business_id
    where member.user_id = caller_id
      and member.role = 'OFFICE_ADMIN'
      and member.status in ('PENDING', 'ACTIVE')
      and business.status in ('PENDING', 'TRIAL', 'ACTIVE', 'SUSPENDED', 'EXPIRED')
  ) then
    raise exception 'An office application already exists' using errcode = '23505';
  end if;

  insert into public.businesses(display_name, slug, phone, email)
  values (normalized_name, normalized_slug, nullif(trim(requested_phone), ''), nullif(trim(requested_email), ''))
  returning id into new_business_id;

  insert into public.business_members(business_id, user_id, role, status)
  values (new_business_id, caller_id, 'OFFICE_ADMIN', 'PENDING');

  insert into public.business_entitlements(business_id)
  values (new_business_id);

  return new_business_id;
end;
$$;

create function public.approve_business(
  target_business_id uuid,
  actor_platform_user_id uuid,
  approved_status text,
  expires_at timestamptz,
  advisor_limit integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_business jsonb;
begin
  if not private.is_platform_admin(actor_platform_user_id) then
    raise exception 'Platform admin required' using errcode = '42501';
  end if;
  if approved_status not in ('TRIAL', 'ACTIVE') then
    raise exception 'Invalid approval status' using errcode = '22023';
  end if;
  if expires_at <= now() then
    raise exception 'Expiration must be in the future' using errcode = '22023';
  end if;
  if advisor_limit < 0 then
    raise exception 'Advisor limit cannot be negative' using errcode = '22023';
  end if;

  select to_jsonb(business) into previous_business
  from public.businesses business
  where business.id = target_business_id
  for update;
  if previous_business is null then
    raise exception 'Business not found' using errcode = 'P0002';
  end if;

  update public.businesses
  set status = approved_status,
      access_starts_at = coalesce(access_starts_at, now()),
      access_expires_at = expires_at,
      approved_at = now(),
      approved_by = actor_platform_user_id,
      suspended_at = null,
      suspension_reason = null
  where id = target_business_id;

  update public.business_entitlements
  set max_advisors = advisor_limit,
      crm_enabled = true,
      valid_from = coalesce(valid_from, now()),
      valid_until = expires_at,
      updated_by_platform_admin = actor_platform_user_id
  where business_id = target_business_id;

  update public.business_members
  set status = 'ACTIVE', activated_at = coalesce(activated_at, now())
  where business_id = target_business_id and role = 'OFFICE_ADMIN' and status = 'PENDING';

  insert into public.platform_audit_logs(
    actor_user_id, business_id, action, target_type, target_id, before_data, after_data
  )
  select actor_platform_user_id, business.id, 'BUSINESS_APPROVED', 'BUSINESS', business.id,
         previous_business, to_jsonb(business)
  from public.businesses business where business.id = target_business_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.platform_users enable row level security;
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.business_entitlements enable row level security;
alter table public.business_usage enable row level security;
alter table public.platform_audit_logs enable row level security;

revoke all on table public.profiles, public.platform_users, public.businesses,
  public.business_members, public.business_entitlements, public.business_usage,
  public.platform_audit_logs from anon, authenticated;

grant select on table public.profiles, public.platform_users, public.businesses,
  public.business_members, public.business_entitlements to authenticated;
grant select on table public.business_usage to authenticated;
grant update(full_name, phone, locale) on public.profiles to authenticated;
grant update(display_name, legal_name, default_locale, timezone, phone, email, address) on public.businesses to authenticated;

create policy profiles_select_authorized
on public.profiles for select to authenticated
using ((select private.can_view_profile(user_id)));

create policy profiles_update_self
on public.profiles for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy platform_users_select_self
on public.platform_users for select to authenticated
using ((select auth.uid()) = user_id);

create policy businesses_select_member
on public.businesses for select to authenticated
using ((select private.can_view_business(id)));

create policy businesses_update_office_profile
on public.businesses for update to authenticated
using (
  (select private.is_office_admin(id))
  and (select private.business_is_operational(id))
)
with check (
  (select private.is_office_admin(id))
  and (select private.business_is_operational(id))
);

create policy business_members_select_authorized
on public.business_members for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_office_admin(business_id))
);

create policy business_entitlements_select_member
on public.business_entitlements for select to authenticated
using ((select private.can_view_business(business_id)));

create policy business_usage_select_office_admin
on public.business_usage for select to authenticated
using ((select private.is_office_admin(business_id)));

revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.can_view_business(uuid) to authenticated;
grant execute on function private.is_active_business_member(uuid) to authenticated;
grant execute on function private.is_office_admin(uuid) to authenticated;
grant execute on function private.business_is_operational(uuid) to authenticated;
grant execute on function private.can_view_profile(uuid) to authenticated;

revoke all on function public.submit_business_application(text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_business_application(text, text, text, text) to authenticated;
revoke all on function public.approve_business(uuid, uuid, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.approve_business(uuid, uuid, text, timestamptz, integer) to service_role;

commit;
