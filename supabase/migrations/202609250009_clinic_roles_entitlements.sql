-- MK Pati transition, step 2: clinic roles, per-role seat limits and clinic entitlements.
-- Table names (businesses, business_members, ...) are kept on purpose: a business is a clinic.
-- OFFICE_ADMIN -> CLINIC_ADMIN, ADVISOR -> VETERINARIAN, new role CLINIC_STAFF.
begin;

-- Retire the real-estate era functions whose signatures or semantics change.
drop trigger if exists business_members_enforce_advisor_limit on public.business_members;
drop function if exists private.enforce_advisor_limit();
drop function if exists private.crm_is_enabled(uuid);
drop function if exists public.request_advisor_membership(text);
drop function if exists public.review_advisor_request(uuid, boolean);
drop function if exists public.approve_business(uuid, uuid, text, timestamptz, integer);
drop function if exists public.configure_business_access(
  uuid, uuid, text, timestamptz, integer, boolean, boolean, boolean, boolean,
  boolean, boolean, boolean, integer, integer, integer, text
);

-- Roles.
alter table public.business_members drop constraint business_members_role_check;
update public.business_members set role = 'CLINIC_ADMIN' where role = 'OFFICE_ADMIN';
update public.business_members set role = 'VETERINARIAN' where role = 'ADVISOR';
alter table public.business_members add constraint business_members_role_check
  check (role in ('CLINIC_ADMIN', 'VETERINARIAN', 'CLINIC_STAFF'));

-- Entitlements: clinic modules, per-role seats and one monthly AI request quota.
-- ai_voice_enabled is kept but now means in-app voice conversation (not phone calls),
-- so it is reset and must be re-enabled deliberately by a platform admin.
alter table public.business_entitlements
  add column max_veterinarians integer not null default 0 check (max_veterinarians >= 0),
  add column max_staff integer not null default 0 check (max_staff >= 0),
  add column clinic_enabled boolean not null default false,
  add column ai_assistant_enabled boolean not null default false,
  add column monthly_ai_request_limit integer not null default 0 check (monthly_ai_request_limit >= 0);

update public.business_entitlements
set max_veterinarians = max_advisors,
    clinic_enabled = crm_enabled,
    ai_assistant_enabled = ai_analysis_enabled,
    monthly_ai_request_limit = monthly_ai_analysis_limit,
    ai_voice_enabled = false;

alter table public.business_entitlements
  drop column max_advisors,
  drop column crm_enabled,
  drop column whatsapp_enabled,
  drop column ai_analysis_enabled,
  drop column imports_enabled,
  drop column monthly_ai_call_minutes,
  drop column monthly_ai_analysis_limit,
  drop column monthly_lead_limit;

alter table public.business_usage drop constraint business_usage_metric_check;
alter table public.business_usage add constraint business_usage_metric_check
  check (metric in ('AI_REQUEST', 'AI_VOICE_REQUEST', 'AI_TOKENS'));

-- Role helpers. Policies from earlier migrations reference is_office_admin by OID,
-- so it is redefined in place (legacy name, now means "active clinic admin").
create function private.current_member_role(target_business_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select member.role
  from public.business_members member
  where member.business_id = target_business_id
    and member.user_id = (select auth.uid())
    and member.status = 'ACTIVE'
  limit 1
$$;

create function private.is_clinic_admin(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_member_role(target_business_id) = 'CLINIC_ADMIN', false)
$$;

create or replace function private.is_office_admin(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_clinic_admin(target_business_id)
$$;

-- Clinical records (examinations, treatments) are limited to admins and veterinarians.
create function private.is_clinical_member(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_member_role(target_business_id) in ('CLINIC_ADMIN', 'VETERINARIAN'), false)
$$;

create or replace function private.feature_is_enabled(target_business_id uuid, feature_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare enabled boolean;
begin
  select case feature_name
    when 'clinic' then entitlement.clinic_enabled
    when 'appointments' then entitlement.clinic_enabled and entitlement.appointments_enabled
    when 'ai_assistant' then entitlement.ai_assistant_enabled
    when 'ai_voice' then entitlement.ai_assistant_enabled and entitlement.ai_voice_enabled
    when 'reports' then entitlement.reports_enabled
    else false
  end into enabled
  from public.business_entitlements entitlement
  where entitlement.business_id = target_business_id
    and (entitlement.valid_from is null or entitlement.valid_from <= now())
    and (entitlement.valid_until is null or entitlement.valid_until > now());
  return coalesce(enabled, false);
end;
$$;

-- Colleagues see each other's names (veterinarian pickers, appointment lists).
create or replace function private.can_view_profile(target_user_id uuid)
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
      and caller.status = 'ACTIVE'
      and target.user_id = target_user_id
      and target.status <> 'REVOKED'
  )
$$;

create policy business_members_select_colleagues
on public.business_members for select to authenticated
using (status = 'ACTIVE' and (select private.can_read_business_data(business_id)));

-- Seat limits per role; a pending request reserves a seat.
create function private.enforce_member_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  seat_limit integer;
  occupied_seats integer;
begin
  if new.role not in ('VETERINARIAN', 'CLINIC_STAFF') or new.status not in ('PENDING', 'ACTIVE') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.role = new.role and old.business_id = new.business_id
     and old.status in ('PENDING', 'ACTIVE') then
    return new;
  end if;

  perform 1 from public.businesses where id = new.business_id for update;
  if not private.business_is_operational(new.business_id) then
    raise exception 'Business is not operational' using errcode = 'P0001';
  end if;

  select case new.role when 'VETERINARIAN' then entitlement.max_veterinarians else entitlement.max_staff end
    into seat_limit
    from public.business_entitlements entitlement
    where entitlement.business_id = new.business_id;
  if seat_limit is null then
    raise exception 'Business entitlements are missing' using errcode = 'P0001';
  end if;

  select count(*)::integer into occupied_seats
  from public.business_members member
  where member.business_id = new.business_id
    and member.role = new.role
    and member.status in ('PENDING', 'ACTIVE')
    and member.id <> new.id;
  if occupied_seats >= seat_limit then
    raise exception 'Seat limit reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger business_members_enforce_seat_limit
before insert or update of role, status, business_id on public.business_members
for each row execute function private.enforce_member_seat_limit();

create or replace function public.submit_business_application(
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
    where member.user_id = caller_id and member.status <> 'REVOKED'
  ) then
    raise exception 'Membership already exists' using errcode = '23505';
  end if;

  insert into public.businesses(display_name, slug, phone, email)
  values (normalized_name, normalized_slug, nullif(trim(requested_phone), ''), nullif(trim(requested_email), ''))
  returning id into new_business_id;

  insert into public.business_members(business_id, user_id, role, status)
  values (new_business_id, caller_id, 'CLINIC_ADMIN', 'PENDING');

  insert into public.business_entitlements(business_id)
  values (new_business_id);

  return new_business_id;
end;
$$;

create function public.request_clinic_membership(requested_slug text, requested_role text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target_business_id uuid;
  new_member_id uuid;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if requested_role not in ('VETERINARIAN', 'CLINIC_STAFF') then
    raise exception 'Invalid role' using errcode = '22023';
  end if;

  select business.id into target_business_id
  from public.businesses business
  where business.slug = lower(trim(requested_slug));
  if target_business_id is null or not private.business_is_operational(target_business_id) then
    raise exception 'Clinic not found' using errcode = 'P0002';
  end if;

  -- A user belongs to one clinic; a rejected request cannot be resubmitted by the user.
  if exists (
    select 1 from public.business_members member
    where member.user_id = caller_id
      and (member.status <> 'REVOKED' or member.business_id = target_business_id)
  ) then
    raise exception 'Membership already exists' using errcode = '23505';
  end if;

  insert into public.business_members(business_id, user_id, role, status)
  values (target_business_id, caller_id, requested_role, 'PENDING')
  returning id into new_member_id;

  return new_member_id;
end;
$$;

create function public.review_member_request(target_member_id uuid, approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_business_id uuid;
begin
  select member.business_id into target_business_id
  from public.business_members member
  where member.id = target_member_id
    and member.role in ('VETERINARIAN', 'CLINIC_STAFF')
    and member.status = 'PENDING'
  for update;
  if target_business_id is null then
    raise exception 'Member request not found' using errcode = 'P0002';
  end if;
  if not private.is_clinic_admin(target_business_id) then
    raise exception 'Clinic admin required' using errcode = '42501';
  end if;

  if approve then
    if not private.business_is_operational(target_business_id) then
      raise exception 'Business is not operational' using errcode = 'P0001';
    end if;
    update public.business_members
    set status = 'ACTIVE',
        activated_at = now(),
        invited_by = (select auth.uid()),
        invited_at = coalesce(invited_at, now())
    where id = target_member_id;
  else
    update public.business_members set status = 'REVOKED' where id = target_member_id;
  end if;
end;
$$;

-- Clinic admins suspend, reactivate or remove veterinarians and staff (never themselves).
create function public.update_member_status(target_member_id uuid, next_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.business_members;
begin
  if next_status not in ('ACTIVE', 'SUSPENDED', 'REVOKED') then
    raise exception 'Invalid member status' using errcode = '22023';
  end if;
  select * into target from public.business_members where id = target_member_id for update;
  if target.id is null or target.role not in ('VETERINARIAN', 'CLINIC_STAFF')
     or target.status not in ('ACTIVE', 'SUSPENDED') then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  if not private.is_clinic_admin(target.business_id) or target.user_id = (select auth.uid()) then
    raise exception 'Clinic admin required' using errcode = '42501';
  end if;
  update public.business_members
  set status = next_status,
      activated_at = case when next_status = 'ACTIVE' then coalesce(activated_at, now()) else activated_at end
  where id = target_member_id;
end;
$$;

create function public.approve_business(
  target_business_id uuid,
  actor_platform_user_id uuid,
  approved_status text,
  expires_at timestamptz,
  veterinarian_limit integer,
  staff_limit integer
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
  if veterinarian_limit < 0 or staff_limit < 0 then
    raise exception 'Seat limits cannot be negative' using errcode = '22023';
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
  set max_veterinarians = veterinarian_limit,
      max_staff = staff_limit,
      clinic_enabled = true,
      appointments_enabled = true,
      valid_from = coalesce(valid_from, now()),
      valid_until = expires_at,
      updated_by_platform_admin = actor_platform_user_id
  where business_id = target_business_id;

  update public.business_members
  set status = 'ACTIVE', activated_at = coalesce(activated_at, now())
  where business_id = target_business_id and role = 'CLINIC_ADMIN' and status = 'PENDING';

  insert into public.platform_audit_logs(
    actor_user_id, business_id, action, target_type, target_id, before_data, after_data
  )
  select actor_platform_user_id, business.id, 'BUSINESS_APPROVED', 'BUSINESS', business.id,
         previous_business, to_jsonb(business)
  from public.businesses business where business.id = target_business_id;
end;
$$;

create function public.configure_business_access(
  target_business_id uuid,
  actor_platform_user_id uuid,
  next_business_status text,
  next_expires_at timestamptz,
  next_max_veterinarians integer,
  next_max_staff integer,
  enable_clinic boolean,
  enable_appointments boolean,
  enable_ai_assistant boolean,
  enable_ai_voice boolean,
  enable_reports boolean,
  next_ai_request_limit integer,
  status_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare previous_business jsonb;
declare previous_entitlement jsonb;
begin
  if not private.is_platform_admin(actor_platform_user_id) then
    raise exception 'Platform admin required' using errcode = '42501';
  end if;
  if next_business_status not in ('TRIAL', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REJECTED') then
    raise exception 'Invalid business status' using errcode = '22023';
  end if;
  if next_max_veterinarians < 0 or next_max_staff < 0 or next_ai_request_limit < 0 then
    raise exception 'Limits cannot be negative' using errcode = '22023';
  end if;
  if next_business_status in ('TRIAL', 'ACTIVE') and (next_expires_at is null or next_expires_at <= now()) then
    raise exception 'Operational access requires a future expiration' using errcode = '22023';
  end if;

  select to_jsonb(business) into previous_business
  from public.businesses business where business.id = target_business_id for update;
  if previous_business is null then raise exception 'Business not found' using errcode = 'P0002'; end if;
  select to_jsonb(entitlement) into previous_entitlement
  from public.business_entitlements entitlement where entitlement.business_id = target_business_id for update;

  if (select count(*) from public.business_members
      where business_id = target_business_id and role = 'VETERINARIAN' and status in ('PENDING', 'ACTIVE')) > next_max_veterinarians
     or (select count(*) from public.business_members
      where business_id = target_business_id and role = 'CLINIC_STAFF' and status in ('PENDING', 'ACTIVE')) > next_max_staff then
    raise exception 'Seat limit is below current member count' using errcode = '22023';
  end if;

  update public.businesses
  set status = next_business_status,
      access_starts_at = case when next_business_status in ('TRIAL', 'ACTIVE') then coalesce(access_starts_at, now()) else access_starts_at end,
      access_expires_at = next_expires_at,
      suspended_at = case when next_business_status = 'SUSPENDED' then now() else null end,
      suspension_reason = case when next_business_status in ('SUSPENDED', 'REJECTED') then nullif(trim(status_reason), '') else null end
  where id = target_business_id;

  insert into public.business_entitlements(
    business_id, max_veterinarians, max_staff, clinic_enabled, appointments_enabled,
    ai_assistant_enabled, ai_voice_enabled, reports_enabled, monthly_ai_request_limit,
    valid_from, valid_until, updated_by_platform_admin
  ) values (
    target_business_id, next_max_veterinarians, next_max_staff, enable_clinic, enable_appointments,
    enable_ai_assistant, enable_ai_voice, enable_reports, next_ai_request_limit,
    now(), next_expires_at, actor_platform_user_id
  ) on conflict (business_id) do update set
    max_veterinarians = excluded.max_veterinarians,
    max_staff = excluded.max_staff,
    clinic_enabled = excluded.clinic_enabled,
    appointments_enabled = excluded.appointments_enabled,
    ai_assistant_enabled = excluded.ai_assistant_enabled,
    ai_voice_enabled = excluded.ai_voice_enabled,
    reports_enabled = excluded.reports_enabled,
    monthly_ai_request_limit = excluded.monthly_ai_request_limit,
    valid_until = excluded.valid_until,
    updated_by_platform_admin = excluded.updated_by_platform_admin;

  update public.business_members
  set status = 'ACTIVE', activated_at = coalesce(activated_at, now())
  where business_id = target_business_id
    and role = 'CLINIC_ADMIN'
    and status = 'PENDING'
    and next_business_status in ('TRIAL', 'ACTIVE');

  insert into public.platform_audit_logs(
    actor_user_id, business_id, action, target_type, target_id, before_data, after_data
  )
  select actor_platform_user_id, target_business_id, 'BUSINESS_ACCESS_CONFIGURED', 'BUSINESS', target_business_id,
    jsonb_build_object('business', previous_business, 'entitlement', previous_entitlement),
    jsonb_build_object('business', to_jsonb(business), 'entitlement', to_jsonb(entitlement))
  from public.businesses business
  join public.business_entitlements entitlement on entitlement.business_id = business.id
  where business.id = target_business_id;
end;
$$;

revoke all on function private.current_member_role(uuid) from public, anon, authenticated;
revoke all on function private.is_clinic_admin(uuid) from public, anon, authenticated;
revoke all on function private.is_clinical_member(uuid) from public, anon, authenticated;
revoke all on function private.enforce_member_seat_limit() from public, anon, authenticated;
grant execute on function private.current_member_role(uuid) to authenticated;
grant execute on function private.is_clinic_admin(uuid) to authenticated;
grant execute on function private.is_clinical_member(uuid) to authenticated;

revoke all on function public.request_clinic_membership(text, text) from public, anon, authenticated;
revoke all on function public.review_member_request(uuid, boolean) from public, anon, authenticated;
revoke all on function public.update_member_status(uuid, text) from public, anon, authenticated;
grant execute on function public.request_clinic_membership(text, text) to authenticated;
grant execute on function public.review_member_request(uuid, boolean) to authenticated;
grant execute on function public.update_member_status(uuid, text) to authenticated;

revoke all on function public.approve_business(uuid, uuid, text, timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.approve_business(uuid, uuid, text, timestamptz, integer, integer) to service_role;
revoke all on function public.configure_business_access(
  uuid, uuid, text, timestamptz, integer, integer, boolean, boolean, boolean, boolean, boolean, integer, text
) from public, anon, authenticated;
grant execute on function public.configure_business_access(
  uuid, uuid, text, timestamptz, integer, integer, boolean, boolean, boolean, boolean, boolean, integer, text
) to service_role;

commit;
