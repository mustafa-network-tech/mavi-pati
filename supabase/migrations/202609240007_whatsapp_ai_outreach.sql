-- WhatsApp + AI outreach MVP: listing owners, AI listing analysis, appointment slots,
-- webhook idempotency and service-only functions used by the AI conversation pipeline.
-- Forward-only and additive; earlier migrations are not modified.
begin;

-- Phone numbers are stored as international digits (TR local formats become 90XXXXXXXXXX)
-- so that WhatsApp sender ids (wa_id) can be matched against leads.
create function private.normalize_phone(raw_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare digits text := regexp_replace(coalesce(raw_phone, ''), '[^0-9]+', '', 'g');
begin
  if digits = '' then return null; end if;
  if digits ~ '^00' then return substr(digits, 3); end if;
  if digits ~ '^0[1-9][0-9]{9}$' then return '9' || digits; end if;
  if digits ~ '^[1-9][0-9]{9}$' then return '90' || digits; end if;
  return digits;
end;
$$;

create or replace function private.normalize_lead_phone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.phone := nullif(trim(new.phone), '');
  new.email := nullif(lower(trim(new.email)), '');
  new.phone_normalized := private.normalize_phone(new.phone);
  return new;
end;
$$;

update public.leads
set phone_normalized = private.normalize_phone(phone)
where phone is not null
  and phone_normalized is distinct from private.normalize_phone(phone);

-- Listing owners are leads with the OWNER role; explicit refusals are terminal.
alter table public.leads
  add column contact_role text not null default 'BUYER' check (contact_role in ('BUYER', 'OWNER')),
  add column do_not_contact boolean not null default false,
  add column do_not_contact_at timestamptz;

alter table public.leads drop constraint leads_status_check;
alter table public.leads add constraint leads_status_check check (status in (
  'NEW', 'REVIEWING', 'APPROVED', 'CONTACTED', 'QUALIFIED', 'APPOINTMENT_SCHEDULED',
  'WON', 'LOST', 'REJECTED', 'ARCHIVED'
));

create index leads_phone_lookup_idx on public.leads(phone_normalized) where phone_normalized is not null;

alter table public.listings add column owner_lead_id uuid;
alter table public.listings add constraint listings_owner_lead_fk
  foreign key (owner_lead_id, business_id) references public.leads(id, business_id);

grant insert(contact_role) on public.leads to authenticated;
grant insert(owner_lead_id), update(owner_lead_id) on public.listings to authenticated;

alter table public.conversations
  add column listing_id uuid,
  add column last_inbound_at timestamptz,
  add constraint conversations_listing_fk
    foreign key (listing_id, business_id) references public.listings(id, business_id);
create index conversations_listing_idx on public.conversations(business_id, listing_id, started_at desc)
  where listing_id is not null;

create unique index messages_provider_message_id_unique
on public.messages(provider_message_id) where provider_message_id is not null;

create or replace function public.update_lead_status(target_lead_id uuid, next_status text)
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
    when 'REJECTED' then next_status = 'ARCHIVED'
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
    when 'crm' then entitlement.crm_enabled
    when 'appointments' then entitlement.appointments_enabled
    when 'whatsapp' then entitlement.whatsapp_enabled
    when 'ai_voice' then entitlement.ai_voice_enabled
    when 'ai_analysis' then entitlement.ai_analysis_enabled
    else false
  end into enabled
  from public.business_entitlements entitlement
  where entitlement.business_id = target_business_id
    and (entitlement.valid_from is null or entitlement.valid_from <= now())
    and (entitlement.valid_until is null or entitlement.valid_until > now());
  return coalesce(enabled, false);
end;
$$;

-- Existing contact entry points now respect do_not_contact.
create or replace function public.create_manual_whatsapp_draft(target_lead_id uuid, message_content text)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare current_lead public.leads;
declare created_conversation public.conversations;
declare created_message public.messages;
begin
  select * into current_lead from public.leads where id = target_lead_id;
  if current_lead.id is null or not private.can_write_assigned_record(current_lead.business_id, current_lead.assigned_member_id) then
    raise exception 'Lead access denied' using errcode = '42501';
  end if;
  if not private.feature_is_enabled(current_lead.business_id, 'whatsapp')
     or not current_lead.whatsapp_allowed or current_lead.do_not_contact
     or current_lead.phone_normalized is null then
    raise exception 'WhatsApp is unavailable for this lead' using errcode = '42501';
  end if;
  if char_length(trim(message_content)) not between 1 and 10000 then
    raise exception 'Invalid message' using errcode = '22023';
  end if;
  insert into public.conversations(business_id, lead_id, assigned_member_id, channel, provider)
  values(current_lead.business_id, current_lead.id, current_lead.assigned_member_id, 'WHATSAPP', 'MANUAL_DEEP_LINK')
  returning * into created_conversation;
  insert into public.messages(business_id, conversation_id, sender_type, direction, content, status)
  values(current_lead.business_id, created_conversation.id, 'ADVISOR', 'OUTBOUND', trim(message_content), 'DRAFT')
  returning * into created_message;
  return created_message;
end;
$$;

create or replace function public.schedule_callback(target_lead_id uuid, callback_at timestamptz)
returns public.calls
language plpgsql
security definer
set search_path = ''
as $$
declare current_lead public.leads;
declare created_conversation public.conversations;
declare created_call public.calls;
begin
  select * into current_lead from public.leads where id = target_lead_id;
  if current_lead.id is null or not private.can_write_assigned_record(current_lead.business_id, current_lead.assigned_member_id) then
    raise exception 'Lead access denied' using errcode = '42501';
  end if;
  if not private.feature_is_enabled(current_lead.business_id, 'ai_voice')
     or not current_lead.call_allowed or current_lead.do_not_contact then
    raise exception 'AI voice is unavailable for this lead' using errcode = '42501';
  end if;
  if callback_at <= now() then raise exception 'Callback must be in the future' using errcode = '22023'; end if;
  insert into public.conversations(business_id, lead_id, assigned_member_id, channel, provider)
  values(current_lead.business_id, current_lead.id, current_lead.assigned_member_id, 'VOICE', 'UNCONFIGURED')
  returning * into created_conversation;
  insert into public.calls(business_id, conversation_id, lead_id, initiated_by_member_id, provider, purpose, scheduled_for)
  values(current_lead.business_id, created_conversation.id, current_lead.id, private.current_business_member_id(current_lead.business_id), 'UNCONFIGURED', 'CALLBACK', callback_at)
  returning * into created_call;
  return created_call;
end;
$$;

-- AI listing analysis, one current analysis per listing. Written only by the server.
create table public.listing_ai_analysis (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  listing_id uuid not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'COMPLETED', 'FAILED')),
  analysis_json jsonb,
  summary text check (summary is null or char_length(summary) <= 2000),
  model text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (listing_id),
  foreign key (listing_id, business_id) references public.listings(id, business_id)
);

create trigger listing_ai_analysis_set_updated_at before update on public.listing_ai_analysis
for each row execute function private.set_updated_at();

-- Availability entered by the office; the AI may only offer these slots.
create table public.appointment_slots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  member_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'AVAILABLE' check (status in ('AVAILABLE', 'BOOKED', 'CANCELED')),
  appointment_id uuid,
  created_by_user_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (member_id, business_id) references public.business_members(id, business_id),
  foreign key (appointment_id, business_id) references public.appointments(id, business_id),
  check (ends_at > starts_at)
);
create index appointment_slots_available_idx on public.appointment_slots(business_id, status, starts_at);

create trigger appointment_slots_set_updated_at before update on public.appointment_slots
for each row execute function private.set_updated_at();

-- Provider webhook idempotency. No payloads are stored.
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_type text not null check (event_type in ('MESSAGE', 'STATUS')),
  provider_event_id text not null,
  business_id uuid references public.businesses(id),
  conversation_id uuid,
  status text not null default 'RECEIVED' check (status in ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED')),
  detail text check (detail is null or char_length(detail) <= 500),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_event_id)
);

alter table public.listing_ai_analysis enable row level security;
alter table public.appointment_slots enable row level security;
alter table public.webhook_events enable row level security;

revoke all on table public.listing_ai_analysis, public.appointment_slots, public.webhook_events
  from anon, authenticated;
grant select on table public.listing_ai_analysis, public.appointment_slots to authenticated;

create policy listing_ai_analysis_select_authorized
on public.listing_ai_analysis for select to authenticated
using ((select private.can_read_listing(listing_id, business_id)));

create policy appointment_slots_select_authorized
on public.appointment_slots for select to authenticated
using (
  (select private.can_read_business_data(business_id))
  and (
    (select private.is_office_admin(business_id))
    or member_id = (select private.current_business_member_id(business_id))
  )
);

create function private.member_is_busy(
  target_member_id uuid,
  range_starts_at timestamptz,
  range_ends_at timestamptz,
  ignored_slot_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.appointment_slots slot
    where slot.member_id = target_member_id
      and slot.status <> 'CANCELED'
      and slot.id is distinct from ignored_slot_id
      and tstzrange(slot.starts_at, slot.ends_at) && tstzrange(range_starts_at, range_ends_at)
  ) or exists (
    select 1 from public.appointments appointment
    where appointment.advisor_member_id = target_member_id
      and appointment.status in ('SCHEDULED', 'CONFIRMED')
      and tstzrange(appointment.starts_at, appointment.ends_at) && tstzrange(range_starts_at, range_ends_at)
  )
$$;

create function public.create_appointment_slot(
  target_member_id uuid,
  slot_starts_at timestamptz,
  slot_ends_at timestamptz
)
returns public.appointment_slots
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_business_id uuid;
  created_slot public.appointment_slots;
begin
  select member.business_id into target_business_id
  from public.business_members member
  where member.id = target_member_id
    and member.status = 'ACTIVE'
    and member.role in ('ADVISOR', 'OFFICE_ADMIN');
  if target_business_id is null then
    raise exception 'Active office member required' using errcode = '22023';
  end if;
  if not private.is_office_admin(target_business_id) then
    raise exception 'Office admin required' using errcode = '42501';
  end if;
  if not private.business_is_operational(target_business_id)
     or not private.feature_is_enabled(target_business_id, 'appointments') then
    raise exception 'Appointments feature disabled' using errcode = '42501';
  end if;
  if slot_ends_at <= slot_starts_at or slot_starts_at <= now()
     or slot_ends_at - slot_starts_at > interval '8 hours' then
    raise exception 'Invalid slot' using errcode = '22023';
  end if;

  perform 1 from public.business_members where id = target_member_id for update;
  if private.member_is_busy(target_member_id, slot_starts_at, slot_ends_at) then
    raise exception 'Slot overlaps an existing slot or appointment' using errcode = '22023';
  end if;

  insert into public.appointment_slots(business_id, member_id, starts_at, ends_at)
  values (target_business_id, target_member_id, slot_starts_at, slot_ends_at)
  returning * into created_slot;
  return created_slot;
end;
$$;

create function public.cancel_appointment_slot(target_slot_id uuid)
returns public.appointment_slots
language plpgsql
security definer
set search_path = ''
as $$
declare current_slot public.appointment_slots;
begin
  select * into current_slot from public.appointment_slots where id = target_slot_id for update;
  if current_slot.id is null or not private.is_office_admin(current_slot.business_id) then
    raise exception 'Slot access denied' using errcode = '42501';
  end if;
  if current_slot.status <> 'AVAILABLE' then
    raise exception 'Only available slots can be canceled' using errcode = '22023';
  end if;
  update public.appointment_slots set status = 'CANCELED'
  where id = target_slot_id returning * into current_slot;
  return current_slot;
end;
$$;

-- Service-only: books an office-defined slot for the lead of an AI conversation.
-- Idempotent per conversation; the slot row lock prevents double booking.
create function public.book_appointment_slot(
  target_slot_id uuid,
  target_conversation_id uuid,
  appointment_title text
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_conversation public.conversations;
  current_lead public.leads;
  current_slot public.appointment_slots;
  existing_appointment public.appointments;
  created_appointment public.appointments;
  business_timezone text;
begin
  select * into current_conversation from public.conversations
  where id = target_conversation_id for update;
  if current_conversation.id is null then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;

  select * into existing_appointment from public.appointments
  where conversation_id = current_conversation.id and status in ('SCHEDULED', 'CONFIRMED')
  order by created_at desc limit 1;
  if existing_appointment.id is not null then
    return existing_appointment;
  end if;

  if current_conversation.status <> 'OPEN' then
    raise exception 'Conversation is not active' using errcode = '22023';
  end if;
  select * into current_lead from public.leads where id = current_conversation.lead_id;
  if current_lead.do_not_contact then
    raise exception 'Lead does not want contact' using errcode = '42501';
  end if;
  if not private.business_is_operational(current_conversation.business_id)
     or not private.feature_is_enabled(current_conversation.business_id, 'appointments') then
    raise exception 'Appointments feature disabled' using errcode = '42501';
  end if;

  select * into current_slot from public.appointment_slots
  where id = target_slot_id and business_id = current_conversation.business_id
  for update;
  if current_slot.id is null or current_slot.status <> 'AVAILABLE' or current_slot.starts_at <= now() then
    raise exception 'Slot not available' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.business_members member
    where member.id = current_slot.member_id and member.status = 'ACTIVE'
  ) or private.member_is_busy(current_slot.member_id, current_slot.starts_at, current_slot.ends_at, current_slot.id) then
    raise exception 'Slot not available' using errcode = '22023';
  end if;

  select business.timezone into business_timezone
  from public.businesses business where business.id = current_conversation.business_id;

  insert into public.appointments(
    business_id, lead_id, listing_id, advisor_member_id, conversation_id, title,
    starts_at, ends_at, timezone, created_by_user_id
  ) values (
    current_conversation.business_id, current_lead.id, current_conversation.listing_id,
    current_slot.member_id, current_conversation.id, left(trim(appointment_title), 240),
    current_slot.starts_at, current_slot.ends_at, business_timezone, current_slot.created_by_user_id
  ) returning * into created_appointment;

  update public.appointment_slots
  set status = 'BOOKED', appointment_id = created_appointment.id
  where id = current_slot.id;

  if current_lead.status not in ('WON', 'LOST', 'REJECTED', 'ARCHIVED') then
    update public.leads set status = 'APPOINTMENT_SCHEDULED' where id = current_lead.id;
  end if;

  insert into public.activity_logs(business_id, lead_id, actor_type, action, metadata)
  values (current_conversation.business_id, current_lead.id, 'AI', 'APPOINTMENT_CREATED',
    jsonb_build_object('appointment_id', created_appointment.id, 'slot_id', current_slot.id,
      'conversation_id', current_conversation.id));
  return created_appointment;
end;
$$;

-- Service-only: explicit refusal. The lead is never contacted again by AI.
create function public.mark_lead_do_not_contact(target_conversation_id uuid, refusal_reason text default null)
returns public.leads
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_conversation public.conversations;
  current_lead public.leads;
begin
  select * into current_conversation from public.conversations
  where id = target_conversation_id for update;
  if current_conversation.id is null then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;

  update public.leads
  set do_not_contact = true,
      do_not_contact_at = coalesce(do_not_contact_at, now()),
      whatsapp_allowed = false,
      call_allowed = false,
      status = case when status in ('WON', 'ARCHIVED') then status else 'REJECTED' end
  where id = current_conversation.lead_id
  returning * into current_lead;

  update public.conversations
  set status = 'COMPLETED', outcome = 'REJECTED', ended_at = coalesce(ended_at, now())
  where id = current_conversation.id;

  insert into public.activity_logs(business_id, lead_id, actor_type, action, metadata)
  values (current_conversation.business_id, current_lead.id, 'AI', 'LEAD_DO_NOT_CONTACT',
    jsonb_build_object('conversation_id', current_conversation.id,
      'reason', left(coalesce(refusal_reason, ''), 300)));
  return current_lead;
end;
$$;

-- Service-only: hands the conversation to the assigned advisor, else the office admin.
create function public.handoff_conversation(target_conversation_id uuid, handoff_reason text default null)
returns public.conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_conversation public.conversations;
  target_member_id uuid;
begin
  select * into current_conversation from public.conversations
  where id = target_conversation_id for update;
  if current_conversation.id is null then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;
  if current_conversation.status = 'TRANSFERRED' then
    return current_conversation;
  end if;

  select coalesce(
    (select lead.assigned_member_id from public.leads lead
      join public.business_members member on member.id = lead.assigned_member_id
      where lead.id = current_conversation.lead_id and member.status = 'ACTIVE'),
    (select member.id from public.business_members member
      where member.business_id = current_conversation.business_id
        and member.role = 'OFFICE_ADMIN' and member.status = 'ACTIVE'
      order by member.created_at limit 1)
  ) into target_member_id;

  update public.conversations
  set status = 'TRANSFERRED', assigned_member_id = coalesce(target_member_id, assigned_member_id)
  where id = current_conversation.id
  returning * into current_conversation;

  insert into public.activity_logs(business_id, lead_id, actor_type, action, metadata)
  values (current_conversation.business_id, current_conversation.lead_id, 'AI', 'CONVERSATION_HANDOFF',
    jsonb_build_object('conversation_id', current_conversation.id, 'to_member_id', target_member_id,
      'reason', left(coalesce(handoff_reason, ''), 300)));
  return current_conversation;
end;
$$;

revoke all on function private.normalize_phone(text) from public, anon, authenticated;
-- The lead normalization trigger runs with the caller's privileges.
grant execute on function private.normalize_phone(text) to authenticated;
revoke all on function private.member_is_busy(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;

revoke all on function public.create_appointment_slot(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.cancel_appointment_slot(uuid) from public, anon, authenticated;
grant execute on function public.create_appointment_slot(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.cancel_appointment_slot(uuid) to authenticated;

revoke all on function public.book_appointment_slot(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.mark_lead_do_not_contact(uuid, text) from public, anon, authenticated;
revoke all on function public.handoff_conversation(uuid, text) from public, anon, authenticated;
grant execute on function public.book_appointment_slot(uuid, uuid, text) to service_role;
grant execute on function public.mark_lead_do_not_contact(uuid, text) to service_role;
grant execute on function public.handoff_conversation(uuid, text) to service_role;

commit;
