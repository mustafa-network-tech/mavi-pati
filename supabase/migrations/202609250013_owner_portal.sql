-- MK Pati owner portal: pet owners sign in (by clinic invitation), talk to MK Pati AI
-- in writing or by in-app voice, and send appointment / medication REQUESTS that the
-- clinic reviews. Nothing an owner or the AI sends is final until clinic staff act on it;
-- medication requests need a clinic admin or veterinarian.
--
-- Owners never get direct table policies on clinic data: they read through
-- owner_portal_overview(), which returns owner-safe columns only (no internal notes,
-- no examinations or treatments).
begin;

alter table public.business_entitlements
  add column owner_portal_enabled boolean not null default false;

alter table public.business_usage drop constraint business_usage_metric_check;
alter table public.business_usage add constraint business_usage_metric_check
  check (metric in ('AI_REQUEST', 'AI_VOICE_REQUEST', 'AI_TOKENS', 'AI_OWNER_REQUEST'));

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
    when 'owner_portal' then entitlement.clinic_enabled and entitlement.owner_portal_enabled
    else false
  end into enabled
  from public.business_entitlements entitlement
  where entitlement.business_id = target_business_id
    and (entitlement.valid_from is null or entitlement.valid_from <= now())
    and (entitlement.valid_until is null or entitlement.valid_until > now());
  return coalesce(enabled, false);
end;
$$;

create table public.owner_portal_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  owner_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED')),
  ai_requests_day date,
  ai_requests_today integer not null default 0 check (ai_requests_today >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (owner_id, business_id) references public.owners(id, business_id)
);
create unique index owner_portal_accounts_active_user on public.owner_portal_accounts(user_id) where status = 'ACTIVE';
create unique index owner_portal_accounts_active_owner on public.owner_portal_accounts(owner_id) where status = 'ACTIVE';

create table public.owner_invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  owner_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_by_user_id uuid not null default auth.uid() references auth.users(id),
  used_at timestamptz,
  used_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (owner_id, business_id) references public.owners(id, business_id)
);

create table public.owner_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  owner_id uuid not null,
  patient_id uuid not null,
  request_type text not null check (request_type in ('APPOINTMENT', 'MEDICATION')),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED')),
  details text not null check (char_length(details) between 3 and 2000),
  preferred_date date,
  preferred_time text check (preferred_time is null or char_length(preferred_time) <= 100),
  medication_name text check (medication_name is null or char_length(medication_name) between 2 and 200),
  channel text not null default 'FORM' check (channel in ('FORM', 'AI_TEXT', 'AI_VOICE')),
  created_by_user_id uuid not null default auth.uid() references auth.users(id),
  reviewed_by_member_id uuid,
  reviewed_at timestamptz,
  clinic_response text check (clinic_response is null or char_length(clinic_response) <= 1000),
  appointment_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (owner_id, business_id) references public.owners(id, business_id),
  foreign key (patient_id, business_id) references public.patients(id, business_id),
  foreign key (reviewed_by_member_id, business_id) references public.business_members(id, business_id),
  foreign key (appointment_id, business_id) references public.appointments(id, business_id),
  check (request_type <> 'MEDICATION' or medication_name is not null)
);
create index owner_requests_clinic_idx on public.owner_requests(business_id, status, created_at desc);
create index owner_requests_owner_idx on public.owner_requests(business_id, owner_id, created_at desc);

create trigger owner_portal_accounts_set_updated_at before update on public.owner_portal_accounts
for each row execute function private.set_updated_at();
create trigger owner_requests_set_updated_at before update on public.owner_requests
for each row execute function private.set_updated_at();

-- One login is either platform, clinic team or pet owner: never two of them.
create function private.enforce_portal_account_separation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'ACTIVE' and (
    exists (select 1 from public.platform_users p where p.user_id = new.user_id)
    or exists (select 1 from public.business_members m where m.user_id = new.user_id and m.status <> 'REVOKED')
  ) then
    raise exception 'Clinic or platform users cannot be owner portal accounts' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger owner_portal_accounts_separation
before insert or update of user_id, status on public.owner_portal_accounts
for each row execute function private.enforce_portal_account_separation();

create function private.enforce_not_portal_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_table_name = 'platform_users' or new.status <> 'REVOKED') and exists (
    select 1 from public.owner_portal_accounts a where a.user_id = new.user_id and a.status = 'ACTIVE'
  ) then
    raise exception 'Owner portal accounts cannot be clinic or platform users' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger business_members_not_portal_owner
before insert or update of user_id, status on public.business_members
for each row execute function private.enforce_not_portal_owner();
create trigger platform_users_not_portal_owner
before insert or update of user_id on public.platform_users
for each row execute function private.enforce_not_portal_owner();

-- The owner record the signed-in user is linked to in this clinic (null otherwise).
create function private.portal_owner_id(target_business_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select account.owner_id
  from public.owner_portal_accounts account
  where account.business_id = target_business_id
    and account.user_id = (select auth.uid())
    and account.status = 'ACTIVE'
  limit 1
$$;

create function private.portal_access(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.portal_owner_id(target_business_id) is not null
    and private.business_is_operational(target_business_id)
    and private.feature_is_enabled(target_business_id, 'owner_portal')
$$;

alter table public.owner_portal_accounts enable row level security;
alter table public.owner_invitations enable row level security;
alter table public.owner_requests enable row level security;
revoke all on table public.owner_portal_accounts, public.owner_invitations, public.owner_requests from anon, authenticated;
grant select on table public.owner_portal_accounts, public.owner_requests to authenticated;

create policy owner_portal_accounts_select on public.owner_portal_accounts for select to authenticated
using (user_id = (select auth.uid()) or (select private.can_read_business_data(business_id)));

create policy owner_requests_select on public.owner_requests for select to authenticated
using (
  owner_id = (select private.portal_owner_id(business_id))
  or (select private.can_read_business_data(business_id))
);

-- Invitations: the raw token is returned once; only its SHA-256 hash is stored.
create function public.create_owner_invitation(target_owner_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_business_id uuid;
  raw_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  select owner.business_id into target_business_id
  from public.owners owner where owner.id = target_owner_id and owner.archived_at is null;
  if target_business_id is null or not private.can_write_clinic(target_business_id) then
    raise exception 'Owner access denied' using errcode = '42501';
  end if;
  if not private.feature_is_enabled(target_business_id, 'owner_portal') then
    raise exception 'Owner portal disabled' using errcode = '42501';
  end if;
  update public.owner_invitations
  set expires_at = now()
  where owner_id = target_owner_id and used_at is null and expires_at > now();
  insert into public.owner_invitations(business_id, owner_id, token_hash, expires_at)
  values (target_business_id, target_owner_id, encode(sha256(convert_to(raw_token, 'UTF8')), 'hex'), now() + interval '7 days');
  return raw_token;
end;
$$;

-- Early check for the invitation page (no data about the clinic's records is revealed).
create function public.owner_invitation_clinic(invite_token text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select business.display_name
  from public.owner_invitations invitation
  join public.businesses business on business.id = invitation.business_id
  where invitation.token_hash = encode(sha256(convert_to(coalesce(invite_token, ''), 'UTF8')), 'hex')
    and invitation.used_at is null
    and invitation.expires_at > now()
    and private.business_is_operational(invitation.business_id)
    and private.feature_is_enabled(invitation.business_id, 'owner_portal')
$$;

create function public.accept_owner_invitation(invite_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  invitation public.owner_invitations;
  existing public.owner_portal_accounts;
  clinic_slug text;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into invitation
  from public.owner_invitations
  where token_hash = encode(sha256(convert_to(coalesce(invite_token, ''), 'UTF8')), 'hex')
  for update;
  if invitation.id is null or invitation.used_at is not null or invitation.expires_at <= now() then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  if not private.business_is_operational(invitation.business_id)
     or not private.feature_is_enabled(invitation.business_id, 'owner_portal') then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;

  select * into existing from public.owner_portal_accounts
  where owner_id = invitation.owner_id and status = 'ACTIVE';
  if existing.id is not null and existing.user_id <> caller_id then
    raise exception 'Owner already has a portal account' using errcode = '23505';
  end if;
  if existing.id is null then
    insert into public.owner_portal_accounts(business_id, owner_id, user_id)
    values (invitation.business_id, invitation.owner_id, caller_id);
  end if;
  update public.owner_invitations set used_at = now(), used_by_user_id = caller_id where id = invitation.id;
  select slug into clinic_slug from public.businesses where id = invitation.business_id;
  return clinic_slug;
end;
$$;

create function public.revoke_owner_portal_access(target_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target_business_id uuid;
begin
  select owner.business_id into target_business_id from public.owners owner where owner.id = target_owner_id;
  if target_business_id is null or not private.can_write_clinic(target_business_id) then
    raise exception 'Owner access denied' using errcode = '42501';
  end if;
  update public.owner_portal_accounts
  set status = 'REVOKED', revoked_at = now()
  where owner_id = target_owner_id and status = 'ACTIVE';
  update public.owner_invitations
  set expires_at = now()
  where owner_id = target_owner_id and used_at is null and expires_at > now();
end;
$$;

-- Everything an owner may see, owner-safe columns only.
create function public.owner_portal_overview(target_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  linked_owner uuid := private.portal_owner_id(target_business_id);
begin
  if linked_owner is null or not private.portal_access(target_business_id) then
    raise exception 'Owner portal access denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'owner', (select jsonb_build_object('full_name', owner.full_name) from public.owners owner where owner.id = linked_owner),
    'clinic', (
      select jsonb_build_object('display_name', business.display_name, 'phone', business.phone, 'email', business.email,
        'address', business.address, 'timezone', business.timezone,
        'appointments_enabled', private.feature_is_enabled(business.id, 'appointments'),
        'ai_enabled', private.feature_is_enabled(business.id, 'ai_assistant'),
        'ai_voice_enabled', private.feature_is_enabled(business.id, 'ai_voice'))
      from public.businesses business where business.id = target_business_id
    ),
    'pets', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'species', p.species, 'breed', p.breed,
        'sex', p.sex, 'birth_date', p.birth_date, 'birth_date_estimated', p.birth_date_estimated,
        'neuter_status', p.neuter_status, 'weight_kg', p.weight_kg) order by p.name)
      from public.patients p
      where p.business_id = target_business_id and p.owner_id = linked_owner and p.status = 'ACTIVE'
    ), '[]'::jsonb),
    'vaccinations', coalesce((
      select jsonb_agg(jsonb_build_object('patient_id', v.patient_id, 'vaccine_name', v.vaccine_name, 'status', v.status,
        'administered_at', v.administered_at, 'next_due_at', v.next_due_at) order by coalesce(v.next_due_at, v.administered_at) desc)
      from public.vaccinations v
      join public.patients p on p.id = v.patient_id and p.business_id = v.business_id
      where v.business_id = target_business_id and p.owner_id = linked_owner and p.status = 'ACTIVE' and v.status <> 'CANCELED'
    ), '[]'::jsonb),
    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'patient_id', a.patient_id, 'starts_at', a.starts_at,
        'ends_at', a.ends_at, 'status', a.status, 'reason', a.reason) order by a.starts_at desc)
      from public.appointments a
      where a.business_id = target_business_id and a.owner_id = linked_owner
        and a.starts_at >= now() - interval '180 days'
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'patient_id', r.patient_id, 'request_type', r.request_type,
        'status', r.status, 'details', r.details, 'preferred_date', r.preferred_date, 'preferred_time', r.preferred_time,
        'medication_name', r.medication_name, 'clinic_response', r.clinic_response, 'created_at', r.created_at,
        'appointment_id', r.appointment_id) order by r.created_at desc)
      from public.owner_requests r
      where r.business_id = target_business_id and r.owner_id = linked_owner
    ), '[]'::jsonb)
  );
end;
$$;

create function public.submit_owner_request(
  target_business_id uuid,
  target_patient_id uuid,
  requested_type text,
  request_details text,
  requested_date date default null,
  requested_time text default null,
  requested_medication text default null,
  request_channel text default 'FORM'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_owner uuid := private.portal_owner_id(target_business_id);
  new_request_id uuid;
begin
  if linked_owner is null or not private.portal_access(target_business_id) then
    raise exception 'Owner portal access denied' using errcode = '42501';
  end if;
  if requested_type not in ('APPOINTMENT', 'MEDICATION') or request_channel not in ('FORM', 'AI_TEXT', 'AI_VOICE') then
    raise exception 'Invalid request' using errcode = '22023';
  end if;
  if requested_type = 'APPOINTMENT' and not private.feature_is_enabled(target_business_id, 'appointments') then
    raise exception 'Appointments disabled' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.patients p
    where p.id = target_patient_id and p.business_id = target_business_id
      and p.owner_id = linked_owner and p.status = 'ACTIVE'
  ) then
    raise exception 'Pet not found' using errcode = 'P0002';
  end if;
  if requested_date is not null and requested_date < current_date then
    raise exception 'Preferred date is in the past' using errcode = '22023';
  end if;
  if (select count(*) from public.owner_requests r
      where r.owner_id = linked_owner and r.status = 'PENDING') >= 5 then
    raise exception 'Too many pending requests' using errcode = 'P0001';
  end if;

  insert into public.owner_requests(
    business_id, owner_id, patient_id, request_type, details, preferred_date,
    preferred_time, medication_name, channel
  ) values (
    target_business_id, linked_owner, target_patient_id, requested_type, trim(request_details), requested_date,
    nullif(trim(requested_time), ''),
    case when requested_type = 'MEDICATION' then nullif(trim(requested_medication), '') end,
    request_channel
  ) returning id into new_request_id;
  return new_request_id;
end;
$$;

create function public.cancel_owner_request(target_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare request public.owner_requests;
begin
  select * into request from public.owner_requests where id = target_request_id for update;
  if request.id is null or request.owner_id is distinct from private.portal_owner_id(request.business_id)
     or request.status <> 'PENDING' then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  update public.owner_requests set status = 'CANCELED' where id = target_request_id;
end;
$$;

-- Clinic side. Medication decisions are clinical: admins and veterinarians only.
create function public.respond_owner_request(target_request_id uuid, decision text, response text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare request public.owner_requests;
begin
  select * into request from public.owner_requests where id = target_request_id for update;
  if request.id is null or not private.can_write_clinic(request.business_id) then
    raise exception 'Request access denied' using errcode = '42501';
  end if;
  if request.status <> 'PENDING' then
    raise exception 'Request already handled' using errcode = '22023';
  end if;
  if decision not in ('APPROVED', 'REJECTED')
     or (decision = 'APPROVED' and request.request_type = 'APPOINTMENT') then
    raise exception 'Invalid decision' using errcode = '22023';
  end if;
  if request.request_type = 'MEDICATION' and not private.is_clinical_member(request.business_id) then
    raise exception 'Clinician required' using errcode = '42501';
  end if;
  update public.owner_requests
  set status = decision,
      clinic_response = nullif(trim(response), ''),
      reviewed_by_member_id = private.current_business_member_id(request.business_id),
      reviewed_at = now()
  where id = target_request_id;
end;
$$;

create function public.approve_appointment_request(
  target_request_id uuid,
  appointment_starts_at timestamptz,
  appointment_ends_at timestamptz,
  target_veterinarian_member_id uuid default null,
  response text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.owner_requests;
  new_appointment_id uuid;
begin
  select * into request from public.owner_requests where id = target_request_id for update;
  if request.id is null or not private.can_write_clinic(request.business_id)
     or not private.feature_is_enabled(request.business_id, 'appointments') then
    raise exception 'Request access denied' using errcode = '42501';
  end if;
  if request.status <> 'PENDING' or request.request_type <> 'APPOINTMENT' then
    raise exception 'Request already handled' using errcode = '22023';
  end if;
  -- Owner, practitioner and double-booking checks run in the appointment triggers.
  insert into public.appointments(
    business_id, patient_id, veterinarian_member_id, starts_at, ends_at, status, reason, created_by_user_id
  ) values (
    request.business_id, request.patient_id, target_veterinarian_member_id, appointment_starts_at,
    appointment_ends_at, 'CONFIRMED', left('Sahip talebi: ' || request.details, 500), (select auth.uid())
  ) returning id into new_appointment_id;
  update public.owner_requests
  set status = 'APPROVED',
      appointment_id = new_appointment_id,
      clinic_response = nullif(trim(response), ''),
      reviewed_by_member_id = private.current_business_member_id(request.business_id),
      reviewed_at = now()
  where id = target_request_id;
  return new_appointment_id;
end;
$$;

-- AI access now includes portal owners; owners also have a per-account daily cap so
-- one account cannot drain the clinic's monthly quota.
create or replace function private.can_use_ai(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.business_is_operational(target_business_id)
    and private.feature_is_enabled(target_business_id, 'ai_assistant')
    and (private.is_active_business_member(target_business_id) or private.portal_access(target_business_id))
$$;

create or replace function public.consume_ai_quota(target_business_id uuid, is_voice boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_period_start timestamptz := date_trunc('month', now());
  current_period_end timestamptz := date_trunc('month', now()) + interval '1 month';
  request_limit integer;
  used bigint;
  owner_caller boolean;
begin
  if not private.can_use_ai(target_business_id) then
    raise exception 'AI access denied' using errcode = '42501';
  end if;
  if is_voice and not private.feature_is_enabled(target_business_id, 'ai_voice') then
    raise exception 'AI voice access denied' using errcode = '42501';
  end if;
  owner_caller := not private.is_active_business_member(target_business_id);

  if owner_caller then
    update public.owner_portal_accounts
    set ai_requests_today = case when ai_requests_day = current_date then ai_requests_today + 1 else 1 end,
        ai_requests_day = current_date
    where business_id = target_business_id
      and user_id = (select auth.uid())
      and status = 'ACTIVE'
      and (ai_requests_day is distinct from current_date or ai_requests_today < 40)
    returning ai_requests_today into used;
    if used is null then
      raise exception 'Owner daily AI limit reached' using errcode = 'P0001';
    end if;
    used := null;
  end if;

  select entitlement.monthly_ai_request_limit into request_limit
  from public.business_entitlements entitlement
  where entitlement.business_id = target_business_id;

  insert into public.business_usage(business_id, metric, period_start, period_end)
  values (target_business_id, 'AI_REQUEST', current_period_start, current_period_end)
  on conflict (business_id, metric, period_start, period_end) do nothing;

  update public.business_usage
  set used_quantity = used_quantity + 1
  where business_id = target_business_id
    and metric = 'AI_REQUEST'
    and period_start = current_period_start
    and period_end = current_period_end
    and used_quantity < coalesce(request_limit, 0)
  returning used_quantity into used;
  if used is null then
    raise exception 'AI quota exceeded' using errcode = 'P0001';
  end if;

  if is_voice then
    insert into public.business_usage(business_id, metric, period_start, period_end, used_quantity)
    values (target_business_id, 'AI_VOICE_REQUEST', current_period_start, current_period_end, 1)
    on conflict (business_id, metric, period_start, period_end)
    do update set used_quantity = public.business_usage.used_quantity + 1;
  end if;
  if owner_caller then
    insert into public.business_usage(business_id, metric, period_start, period_end, used_quantity)
    values (target_business_id, 'AI_OWNER_REQUEST', current_period_start, current_period_end, 1)
    on conflict (business_id, metric, period_start, period_end)
    do update set used_quantity = public.business_usage.used_quantity + 1;
  end if;
  return (request_limit - used)::integer;
end;
$$;

-- Platform admin: owner portal switch.
drop function public.configure_business_access(
  uuid, uuid, text, timestamptz, integer, integer, boolean, boolean, boolean, boolean, boolean, integer, text
);

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
  enable_owner_portal boolean,
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
    ai_assistant_enabled, ai_voice_enabled, reports_enabled, owner_portal_enabled, monthly_ai_request_limit,
    valid_from, valid_until, updated_by_platform_admin
  ) values (
    target_business_id, next_max_veterinarians, next_max_staff, enable_clinic, enable_appointments,
    enable_ai_assistant, enable_ai_voice, enable_reports, enable_owner_portal, next_ai_request_limit,
    now(), next_expires_at, actor_platform_user_id
  ) on conflict (business_id) do update set
    max_veterinarians = excluded.max_veterinarians,
    max_staff = excluded.max_staff,
    clinic_enabled = excluded.clinic_enabled,
    appointments_enabled = excluded.appointments_enabled,
    ai_assistant_enabled = excluded.ai_assistant_enabled,
    ai_voice_enabled = excluded.ai_voice_enabled,
    reports_enabled = excluded.reports_enabled,
    owner_portal_enabled = excluded.owner_portal_enabled,
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

drop function public.platform_clinic_overview(uuid);

create function public.platform_clinic_overview(actor_platform_user_id uuid)
returns table (
  business_id uuid,
  display_name text,
  slug text,
  status text,
  access_expires_at timestamptz,
  clinic_admins integer,
  veterinarians integer,
  staff integer,
  pending_members integer,
  max_veterinarians integer,
  max_staff integer,
  owners integer,
  patients integer,
  appointments_this_month integer,
  ai_assistant_enabled boolean,
  ai_voice_enabled boolean,
  ai_request_limit integer,
  ai_requests_this_month bigint,
  ai_voice_requests_this_month bigint,
  ai_tokens_this_month bigint,
  owner_portal_enabled boolean,
  portal_accounts integer,
  pending_owner_requests integer,
  ai_owner_requests_this_month bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin(actor_platform_user_id) then
    raise exception 'Platform admin required' using errcode = '42501';
  end if;
  return query
  select
    business.id,
    business.display_name,
    business.slug,
    business.status,
    business.access_expires_at,
    (select count(*)::integer from public.business_members m where m.business_id = business.id and m.role = 'CLINIC_ADMIN' and m.status = 'ACTIVE'),
    (select count(*)::integer from public.business_members m where m.business_id = business.id and m.role = 'VETERINARIAN' and m.status = 'ACTIVE'),
    (select count(*)::integer from public.business_members m where m.business_id = business.id and m.role = 'CLINIC_STAFF' and m.status = 'ACTIVE'),
    (select count(*)::integer from public.business_members m where m.business_id = business.id and m.status = 'PENDING'),
    coalesce(entitlement.max_veterinarians, 0),
    coalesce(entitlement.max_staff, 0),
    (select count(*)::integer from public.owners o where o.business_id = business.id and o.archived_at is null),
    (select count(*)::integer from public.patients p where p.business_id = business.id and p.status = 'ACTIVE'),
    (select count(*)::integer from public.appointments a where a.business_id = business.id and a.starts_at >= date_trunc('month', now())),
    coalesce(entitlement.ai_assistant_enabled, false),
    coalesce(entitlement.ai_assistant_enabled and entitlement.ai_voice_enabled, false),
    coalesce(entitlement.monthly_ai_request_limit, 0),
    coalesce((select u.used_quantity from public.business_usage u where u.business_id = business.id and u.metric = 'AI_REQUEST' and u.period_start = date_trunc('month', now())), 0),
    coalesce((select u.used_quantity from public.business_usage u where u.business_id = business.id and u.metric = 'AI_VOICE_REQUEST' and u.period_start = date_trunc('month', now())), 0),
    coalesce((select u.used_quantity from public.business_usage u where u.business_id = business.id and u.metric = 'AI_TOKENS' and u.period_start = date_trunc('month', now())), 0),
    coalesce(entitlement.owner_portal_enabled, false),
    (select count(*)::integer from public.owner_portal_accounts a where a.business_id = business.id and a.status = 'ACTIVE'),
    (select count(*)::integer from public.owner_requests r where r.business_id = business.id and r.status = 'PENDING'),
    coalesce((select u.used_quantity from public.business_usage u where u.business_id = business.id and u.metric = 'AI_OWNER_REQUEST' and u.period_start = date_trunc('month', now())), 0)
  from public.businesses business
  left join public.business_entitlements entitlement on entitlement.business_id = business.id
  order by business.created_at desc;
end;
$$;

revoke all on function private.enforce_portal_account_separation() from public, anon, authenticated;
revoke all on function private.enforce_not_portal_owner() from public, anon, authenticated;
revoke all on function private.portal_owner_id(uuid) from public, anon, authenticated;
revoke all on function private.portal_access(uuid) from public, anon, authenticated;
grant execute on function private.portal_owner_id(uuid) to authenticated;
grant execute on function private.portal_access(uuid) to authenticated;

revoke all on function public.create_owner_invitation(uuid) from public, anon, authenticated;
revoke all on function public.owner_invitation_clinic(text) from public, anon, authenticated;
revoke all on function public.accept_owner_invitation(text) from public, anon, authenticated;
revoke all on function public.revoke_owner_portal_access(uuid) from public, anon, authenticated;
revoke all on function public.owner_portal_overview(uuid) from public, anon, authenticated;
revoke all on function public.submit_owner_request(uuid, uuid, text, text, date, text, text, text) from public, anon, authenticated;
revoke all on function public.cancel_owner_request(uuid) from public, anon, authenticated;
revoke all on function public.respond_owner_request(uuid, text, text) from public, anon, authenticated;
revoke all on function public.approve_appointment_request(uuid, timestamptz, timestamptz, uuid, text) from public, anon, authenticated;
grant execute on function public.create_owner_invitation(uuid) to authenticated;
grant execute on function public.owner_invitation_clinic(text) to anon, authenticated;
grant execute on function public.accept_owner_invitation(text) to authenticated;
grant execute on function public.revoke_owner_portal_access(uuid) to authenticated;
grant execute on function public.owner_portal_overview(uuid) to authenticated;
grant execute on function public.submit_owner_request(uuid, uuid, text, text, date, text, text, text) to authenticated;
grant execute on function public.cancel_owner_request(uuid) to authenticated;
grant execute on function public.respond_owner_request(uuid, text, text) to authenticated;
grant execute on function public.approve_appointment_request(uuid, timestamptz, timestamptz, uuid, text) to authenticated;

revoke all on function public.configure_business_access(
  uuid, uuid, text, timestamptz, integer, integer, boolean, boolean, boolean, boolean, boolean, boolean, integer, text
) from public, anon, authenticated;
grant execute on function public.configure_business_access(
  uuid, uuid, text, timestamptz, integer, integer, boolean, boolean, boolean, boolean, boolean, boolean, integer, text
) to service_role;
revoke all on function public.platform_clinic_overview(uuid) from public, anon, authenticated;
grant execute on function public.platform_clinic_overview(uuid) to service_role;

commit;
