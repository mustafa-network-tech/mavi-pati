-- MK Emlak Asistani CRM core.
-- Requires 202609240001_platform_foundation.sql.
begin;

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  assigned_member_id uuid,
  name text not null check (char_length(name) between 2 and 160),
  phone text,
  phone_normalized text,
  email text,
  source text not null default 'MANUAL' check (source in ('MANUAL', 'CSV', 'EXCEL', 'ADVISOR', 'WEB_FORM', 'API')),
  source_reference text,
  source_url text,
  city text,
  district text,
  status text not null default 'NEW' check (status in ('NEW', 'REVIEWING', 'APPROVED', 'CONTACTED', 'QUALIFIED', 'APPOINTMENT_SCHEDULED', 'WON', 'LOST', 'ARCHIVED')),
  priority text not null default 'NORMAL' check (priority in ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  ai_score integer check (ai_score between 0 and 100),
  ai_score_explanation jsonb,
  preferred_contact_method text check (preferred_contact_method in ('WHATSAPP', 'PHONE', 'EMAIL')),
  whatsapp_allowed boolean not null default false,
  call_allowed boolean not null default false,
  last_contact_at timestamptz,
  next_follow_up_at timestamptz,
  created_by_user_id uuid not null default auth.uid() references auth.users(id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (assigned_member_id, business_id)
    references public.business_members(id, business_id),
  check (phone is not null or email is not null)
);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  assigned_member_id uuid,
  external_reference text,
  source text not null default 'MANUAL' check (source in ('MANUAL', 'CSV', 'EXCEL', 'ADVISOR', 'API')),
  source_url text,
  title text not null check (char_length(title) between 3 and 240),
  description text,
  property_type text not null check (char_length(property_type) between 2 and 80),
  transaction_type text not null check (transaction_type in ('SALE', 'RENT')),
  price numeric(16,2) check (price is null or price >= 0),
  currency text not null default 'TRY' check (currency ~ '^[A-Z]{3}$'),
  city text,
  district text,
  neighborhood text,
  gross_area numeric(10,2) check (gross_area is null or gross_area > 0),
  net_area numeric(10,2) check (net_area is null or net_area > 0),
  room_count text,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'INACTIVE', 'SOLD', 'RENTED', 'ARCHIVED')),
  created_by_user_id uuid not null default auth.uid() references auth.users(id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (assigned_member_id, business_id)
    references public.business_members(id, business_id)
);

create unique index listings_external_reference_unique
on public.listings(business_id, source, external_reference)
where external_reference is not null;

create table public.lead_listings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  lead_id uuid not null,
  listing_id uuid not null,
  interest_level text not null default 'MEDIUM' check (interest_level in ('LOW', 'MEDIUM', 'HIGH')),
  status text not null default 'INTERESTED' check (status in ('INTERESTED', 'SHORTLISTED', 'REJECTED', 'VISITED', 'OFFERED')),
  created_by_user_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, lead_id, listing_id),
  foreign key (lead_id, business_id) references public.leads(id, business_id),
  foreign key (listing_id, business_id) references public.listings(id, business_id)
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  lead_id uuid,
  listing_id uuid,
  author_user_id uuid not null default auth.uid() references auth.users(id),
  content text not null check (char_length(content) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (lead_id, business_id) references public.leads(id, business_id),
  foreign key (listing_id, business_id) references public.listings(id, business_id),
  check (num_nonnulls(lead_id, listing_id) = 1)
);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  lead_id uuid,
  listing_id uuid,
  member_id uuid,
  actor_type text not null default 'USER' check (actor_type in ('USER', 'AI', 'SYSTEM')),
  actor_user_id uuid references auth.users(id),
  action text not null check (char_length(action) between 3 and 100),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (lead_id, business_id) references public.leads(id, business_id),
  foreign key (listing_id, business_id) references public.listings(id, business_id),
  foreign key (member_id, business_id) references public.business_members(id, business_id),
  check (num_nonnulls(lead_id, listing_id, member_id) <= 1)
);

create index leads_business_status_idx on public.leads(business_id, status, created_at desc);
create index leads_assigned_idx on public.leads(business_id, assigned_member_id, status);
create index leads_phone_idx on public.leads(business_id, phone_normalized) where phone_normalized is not null;
create index listings_business_status_idx on public.listings(business_id, status, created_at desc);
create index listings_assigned_idx on public.listings(business_id, assigned_member_id, status);
create index lead_listings_lead_idx on public.lead_listings(business_id, lead_id);
create index lead_listings_listing_idx on public.lead_listings(business_id, listing_id);
create index notes_lead_idx on public.notes(business_id, lead_id, created_at desc) where lead_id is not null;
create index notes_listing_idx on public.notes(business_id, listing_id, created_at desc) where listing_id is not null;
create index activity_logs_lead_idx on public.activity_logs(business_id, lead_id, created_at desc) where lead_id is not null;
create index activity_logs_listing_idx on public.activity_logs(business_id, listing_id, created_at desc) where listing_id is not null;

create trigger leads_set_updated_at before update on public.leads
for each row execute function private.set_updated_at();
create trigger listings_set_updated_at before update on public.listings
for each row execute function private.set_updated_at();
create trigger lead_listings_set_updated_at before update on public.lead_listings
for each row execute function private.set_updated_at();
create trigger notes_set_updated_at before update on public.notes
for each row execute function private.set_updated_at();

create function private.current_business_member_id(target_business_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select member.id
  from public.business_members member
  where member.business_id = target_business_id
    and member.user_id = (select auth.uid())
    and member.status = 'ACTIVE'
  limit 1
$$;

create function private.can_read_business_data(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_members member
    join public.businesses business on business.id = member.business_id
    where member.business_id = target_business_id
      and member.user_id = (select auth.uid())
      and member.status = 'ACTIVE'
      and business.status in ('TRIAL', 'ACTIVE', 'EXPIRED')
  )
$$;

create function private.crm_is_enabled(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_entitlements entitlement
    where entitlement.business_id = target_business_id
      and entitlement.crm_enabled
      and (entitlement.valid_from is null or entitlement.valid_from <= now())
      and (entitlement.valid_until is null or entitlement.valid_until > now())
  )
$$;

create function private.can_write_assigned_record(
  target_business_id uuid,
  target_assigned_member_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.business_is_operational(target_business_id)
    and private.crm_is_enabled(target_business_id)
    and private.is_active_business_member(target_business_id)
    and (
      private.is_office_admin(target_business_id)
      or target_assigned_member_id = private.current_business_member_id(target_business_id)
    )
$$;

create function private.can_read_lead(target_lead_id uuid, target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_read_business_data(target_business_id) and exists (
    select 1 from public.leads lead
    where lead.id = target_lead_id
      and lead.business_id = target_business_id
      and (
        private.is_office_admin(target_business_id)
        or lead.assigned_member_id = private.current_business_member_id(target_business_id)
      )
  )
$$;

create function private.can_read_listing(target_listing_id uuid, target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_read_business_data(target_business_id) and exists (
    select 1 from public.listings listing
    where listing.id = target_listing_id
      and listing.business_id = target_business_id
      and (
        private.is_office_admin(target_business_id)
        or listing.assigned_member_id = private.current_business_member_id(target_business_id)
      )
  )
$$;

create function private.normalize_lead_phone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.phone := nullif(trim(new.phone), '');
  new.email := nullif(lower(trim(new.email)), '');
  new.phone_normalized := case
    when new.phone is null then null
    else nullif(regexp_replace(new.phone, '[^0-9]+', '', 'g'), '')
  end;
  return new;
end;
$$;

create function private.ensure_assigned_advisor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_member_id is not null and not exists (
    select 1 from public.business_members member
    where member.id = new.assigned_member_id
      and member.business_id = new.business_id
      and member.role = 'ADVISOR'
      and member.status = 'ACTIVE'
  ) then
    raise exception 'Assigned member must be an active advisor in the same business'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger leads_require_active_advisor
before insert or update of assigned_member_id, business_id on public.leads
for each row execute function private.ensure_assigned_advisor();

create trigger listings_require_active_advisor
before insert or update of assigned_member_id, business_id on public.listings
for each row execute function private.ensure_assigned_advisor();

create trigger leads_normalize_contact
before insert or update of phone, email on public.leads
for each row execute function private.normalize_lead_phone();

create function private.log_lead_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_actor uuid := coalesce((select auth.uid()), new.created_by_user_id);
begin
  if tg_op = 'INSERT' then
    insert into public.activity_logs(business_id, lead_id, actor_user_id, action)
    values(new.business_id, new.id, event_actor, 'LEAD_CREATED');
  else
    if new.assigned_member_id is distinct from old.assigned_member_id then
      insert into public.activity_logs(business_id, lead_id, actor_user_id, action, metadata)
      values(new.business_id, new.id, event_actor, 'LEAD_ASSIGNED',
        jsonb_build_object('from', old.assigned_member_id, 'to', new.assigned_member_id));
    end if;
    if new.status is distinct from old.status then
      insert into public.activity_logs(business_id, lead_id, actor_user_id, action, metadata)
      values(new.business_id, new.id, event_actor, 'LEAD_STATUS_CHANGED',
        jsonb_build_object('from', old.status, 'to', new.status));
    end if;
  end if;
  return new;
end;
$$;

create trigger leads_log_activity
after insert or update on public.leads
for each row execute function private.log_lead_activity();

create function private.log_listing_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_actor uuid := coalesce((select auth.uid()), new.created_by_user_id);
begin
  if tg_op = 'INSERT' then
    insert into public.activity_logs(business_id, listing_id, actor_user_id, action)
    values(new.business_id, new.id, event_actor, 'LISTING_CREATED');
  elsif new.assigned_member_id is distinct from old.assigned_member_id then
    insert into public.activity_logs(business_id, listing_id, actor_user_id, action, metadata)
    values(new.business_id, new.id, event_actor, 'LISTING_ASSIGNED',
      jsonb_build_object('from', old.assigned_member_id, 'to', new.assigned_member_id));
  end if;
  return new;
end;
$$;

create trigger listings_log_activity
after insert or update on public.listings
for each row execute function private.log_listing_activity();

create function public.update_lead_status(target_lead_id uuid, next_status text)
returns public.leads
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_lead public.leads;
begin
  select * into current_lead from public.leads where id = target_lead_id for update;
  if current_lead.id is null then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;
  if not private.can_write_assigned_record(current_lead.business_id, current_lead.assigned_member_id) then
    raise exception 'Lead access denied' using errcode = '42501';
  end if;
  if not (case current_lead.status
    when 'NEW' then next_status in ('REVIEWING', 'ARCHIVED')
    when 'REVIEWING' then next_status in ('APPROVED', 'LOST', 'ARCHIVED')
    when 'APPROVED' then next_status in ('CONTACTED', 'LOST', 'ARCHIVED')
    when 'CONTACTED' then next_status in ('QUALIFIED', 'LOST', 'ARCHIVED')
    when 'QUALIFIED' then next_status in ('APPOINTMENT_SCHEDULED', 'WON', 'LOST', 'ARCHIVED')
    when 'APPOINTMENT_SCHEDULED' then next_status in ('QUALIFIED', 'WON', 'LOST', 'ARCHIVED')
    when 'WON' then next_status = 'ARCHIVED'
    when 'LOST' then next_status = 'ARCHIVED'
    else false
  end) then
    raise exception 'Invalid lead status transition' using errcode = '22023';
  end if;

  update public.leads
  set status = next_status,
      archived_at = case when next_status = 'ARCHIVED' then now() else null end
  where id = target_lead_id
  returning * into current_lead;
  return current_lead;
end;
$$;

create function public.assign_lead(target_lead_id uuid, target_member_id uuid default null)
returns public.leads
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_lead public.leads;
begin
  select * into current_lead from public.leads where id = target_lead_id for update;
  if current_lead.id is null then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;
  if not private.business_is_operational(current_lead.business_id)
     or not private.crm_is_enabled(current_lead.business_id)
     or not private.is_office_admin(current_lead.business_id) then
    raise exception 'Office admin access required' using errcode = '42501';
  end if;
  if target_member_id is not null and not exists (
    select 1 from public.business_members member
    where member.id = target_member_id
      and member.business_id = current_lead.business_id
      and member.role = 'ADVISOR'
      and member.status = 'ACTIVE'
  ) then
    raise exception 'Target advisor is invalid' using errcode = '22023';
  end if;

  update public.leads set assigned_member_id = target_member_id
  where id = target_lead_id
  returning * into current_lead;
  return current_lead;
end;
$$;

alter table public.leads enable row level security;
alter table public.listings enable row level security;
alter table public.lead_listings enable row level security;
alter table public.notes enable row level security;
alter table public.activity_logs enable row level security;

revoke all on table public.leads, public.listings, public.lead_listings,
  public.notes, public.activity_logs from anon, authenticated;

grant select on table public.leads, public.listings, public.lead_listings,
  public.notes, public.activity_logs to authenticated;

grant insert(
  business_id, assigned_member_id, name, phone, email, source,
  source_reference, source_url, city, district, priority,
  preferred_contact_method, whatsapp_allowed, call_allowed, next_follow_up_at
) on public.leads to authenticated;
grant update(
  assigned_member_id, name, phone, email, source_reference, source_url,
  city, district, priority, preferred_contact_method, whatsapp_allowed,
  call_allowed, last_contact_at, next_follow_up_at
) on public.leads to authenticated;

grant insert(
  business_id, assigned_member_id, external_reference, source, source_url,
  title, description, property_type, transaction_type, price, currency,
  city, district, neighborhood, gross_area, net_area, room_count
) on public.listings to authenticated;
grant update(
  assigned_member_id, external_reference, source_url, title, description,
  property_type, transaction_type, price, currency, city, district,
  neighborhood, gross_area, net_area, room_count, status
) on public.listings to authenticated;

grant insert(business_id, lead_id, listing_id, interest_level, status)
on public.lead_listings to authenticated;
grant update(interest_level, status) on public.lead_listings to authenticated;
grant insert(business_id, lead_id, listing_id, content) on public.notes to authenticated;
grant update(content) on public.notes to authenticated;

create policy leads_select_authorized
on public.leads for select to authenticated
using (
  (select private.can_read_business_data(business_id))
  and (
    (select private.is_office_admin(business_id))
    or assigned_member_id = (select private.current_business_member_id(business_id))
  )
);

create policy leads_insert_authorized
on public.leads for insert to authenticated
with check ((select private.can_write_assigned_record(business_id, assigned_member_id)));

create policy leads_update_authorized
on public.leads for update to authenticated
using ((select private.can_write_assigned_record(business_id, assigned_member_id)))
with check ((select private.can_write_assigned_record(business_id, assigned_member_id)));

create policy listings_select_authorized
on public.listings for select to authenticated
using (
  (select private.can_read_business_data(business_id))
  and (
    (select private.is_office_admin(business_id))
    or assigned_member_id = (select private.current_business_member_id(business_id))
  )
);

create policy listings_insert_authorized
on public.listings for insert to authenticated
with check ((select private.can_write_assigned_record(business_id, assigned_member_id)));

create policy listings_update_authorized
on public.listings for update to authenticated
using ((select private.can_write_assigned_record(business_id, assigned_member_id)))
with check ((select private.can_write_assigned_record(business_id, assigned_member_id)));

create policy lead_listings_select_authorized
on public.lead_listings for select to authenticated
using (
  (select private.can_read_business_data(business_id))
  and (
    (select private.is_office_admin(business_id))
    or (
      (select private.can_read_lead(lead_id, business_id))
      and (select private.can_read_listing(listing_id, business_id))
    )
  )
);

create policy lead_listings_insert_authorized
on public.lead_listings for insert to authenticated
with check (
  (select private.business_is_operational(business_id))
  and (select private.crm_is_enabled(business_id))
  and (
    (select private.is_office_admin(business_id))
    or (
      (select private.can_read_lead(lead_id, business_id))
      and (select private.can_read_listing(listing_id, business_id))
    )
  )
);

create policy lead_listings_update_authorized
on public.lead_listings for update to authenticated
using (
  (select private.business_is_operational(business_id))
  and (
    (select private.is_office_admin(business_id))
    or (
      (select private.can_read_lead(lead_id, business_id))
      and (select private.can_read_listing(listing_id, business_id))
    )
  )
)
with check (
  (select private.business_is_operational(business_id))
  and (select private.crm_is_enabled(business_id))
  and (
    (select private.is_office_admin(business_id))
    or (
      (select private.can_read_lead(lead_id, business_id))
      and (select private.can_read_listing(listing_id, business_id))
    )
  )
);

create policy notes_select_authorized
on public.notes for select to authenticated
using (
  (lead_id is not null and (select private.can_read_lead(lead_id, business_id)))
  or (listing_id is not null and (select private.can_read_listing(listing_id, business_id)))
);

create policy notes_insert_authorized
on public.notes for insert to authenticated
with check (
  (select private.business_is_operational(business_id))
  and (select private.crm_is_enabled(business_id))
  and (
    (lead_id is not null and (select private.can_read_lead(lead_id, business_id)))
    or (listing_id is not null and (select private.can_read_listing(listing_id, business_id)))
  )
);

create policy notes_update_authorized
on public.notes for update to authenticated
using (
  author_user_id = (select auth.uid())
  and (select private.business_is_operational(business_id))
  and (
    (lead_id is not null and (select private.can_read_lead(lead_id, business_id)))
    or (listing_id is not null and (select private.can_read_listing(listing_id, business_id)))
  )
)
with check (
  author_user_id = (select auth.uid())
  and (select private.business_is_operational(business_id))
  and (
    (lead_id is not null and (select private.can_read_lead(lead_id, business_id)))
    or (listing_id is not null and (select private.can_read_listing(listing_id, business_id)))
  )
);

create policy activity_logs_select_authorized
on public.activity_logs for select to authenticated
using (
  (select private.can_read_business_data(business_id))
  and (
    (lead_id is not null and (select private.can_read_lead(lead_id, business_id)))
    or (listing_id is not null and (select private.can_read_listing(listing_id, business_id)))
    or (member_id is not null and (select private.is_office_admin(business_id)))
    or (num_nonnulls(lead_id, listing_id, member_id) = 0 and (select private.is_office_admin(business_id)))
  )
);

revoke all on function private.current_business_member_id(uuid) from public, anon, authenticated;
revoke all on function private.can_read_business_data(uuid) from public, anon, authenticated;
revoke all on function private.crm_is_enabled(uuid) from public, anon, authenticated;
revoke all on function private.can_write_assigned_record(uuid, uuid) from public, anon, authenticated;
revoke all on function private.can_read_lead(uuid, uuid) from public, anon, authenticated;
revoke all on function private.can_read_listing(uuid, uuid) from public, anon, authenticated;
revoke all on function private.normalize_lead_phone() from public, anon, authenticated;
revoke all on function private.ensure_assigned_advisor() from public, anon, authenticated;
revoke all on function private.log_lead_activity() from public, anon, authenticated;
revoke all on function private.log_listing_activity() from public, anon, authenticated;
grant execute on function private.current_business_member_id(uuid) to authenticated;
grant execute on function private.can_read_business_data(uuid) to authenticated;
grant execute on function private.crm_is_enabled(uuid) to authenticated;
grant execute on function private.can_write_assigned_record(uuid, uuid) to authenticated;
grant execute on function private.can_read_lead(uuid, uuid) to authenticated;
grant execute on function private.can_read_listing(uuid, uuid) to authenticated;

revoke all on function public.update_lead_status(uuid, text) from public, anon, authenticated;
grant execute on function public.update_lead_status(uuid, text) to authenticated;
revoke all on function public.assign_lead(uuid, uuid) from public, anon, authenticated;
grant execute on function public.assign_lead(uuid, uuid) to authenticated;

commit;
