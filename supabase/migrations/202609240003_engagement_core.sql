-- MK Emlak Asistani communication, calls and appointments.
-- Provider-neutral records; no provider secrets are stored in public tables.
begin;

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  lead_id uuid not null,
  assigned_member_id uuid,
  channel text not null check (channel in ('WHATSAPP', 'VOICE', 'WEB_CHAT')),
  provider text not null,
  provider_conversation_id text,
  status text not null default 'OPEN' check (status in ('OPEN', 'COMPLETED', 'FAILED', 'TRANSFERRED', 'CANCELED')),
  outcome text,
  summary text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_by_user_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (lead_id, business_id) references public.leads(id, business_id),
  foreign key (assigned_member_id, business_id) references public.business_members(id, business_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  conversation_id uuid not null,
  sender_type text not null check (sender_type in ('ADVISOR', 'LEAD', 'AI', 'SYSTEM')),
  direction text not null check (direction in ('INBOUND', 'OUTBOUND')),
  content text not null check (char_length(content) between 1 and 10000),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED')),
  provider_message_id text,
  sent_at timestamptz,
  delivered_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (conversation_id, business_id) references public.conversations(id, business_id)
);

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  conversation_id uuid not null,
  lead_id uuid not null,
  listing_id uuid,
  initiated_by_member_id uuid,
  provider text not null,
  provider_call_id text,
  direction text not null default 'OUTBOUND' check (direction in ('INBOUND', 'OUTBOUND')),
  purpose text not null default 'INTRO' check (purpose in ('INTRO', 'FOLLOW_UP', 'CALLBACK', 'APPOINTMENT_REMINDER')),
  status text not null default 'REQUESTED' check (status in ('REQUESTED', 'QUEUED', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELED')),
  scheduled_for timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  transcript text,
  recording_url text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  unique (conversation_id),
  foreign key (conversation_id, business_id) references public.conversations(id, business_id),
  foreign key (lead_id, business_id) references public.leads(id, business_id),
  foreign key (listing_id, business_id) references public.listings(id, business_id),
  foreign key (initiated_by_member_id, business_id) references public.business_members(id, business_id)
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  lead_id uuid not null,
  listing_id uuid,
  advisor_member_id uuid not null,
  conversation_id uuid,
  title text not null check (char_length(title) between 3 and 240),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'Europe/Istanbul',
  location text,
  notes text,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELED', 'NO_SHOW')),
  reschedule_count integer not null default 0 check (reschedule_count >= 0),
  canceled_at timestamptz,
  cancellation_reason text,
  created_by_user_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (lead_id, business_id) references public.leads(id, business_id),
  foreign key (listing_id, business_id) references public.listings(id, business_id),
  foreign key (advisor_member_id, business_id) references public.business_members(id, business_id),
  foreign key (conversation_id, business_id) references public.conversations(id, business_id),
  check (ends_at > starts_at)
);

create index conversations_lead_idx on public.conversations(business_id, lead_id, started_at desc);
create index messages_conversation_idx on public.messages(business_id, conversation_id, created_at);
create index calls_schedule_idx on public.calls(business_id, status, scheduled_for);
create index appointments_calendar_idx on public.appointments(business_id, starts_at, status);
create index appointments_advisor_idx on public.appointments(business_id, advisor_member_id, starts_at);

create trigger conversations_set_updated_at before update on public.conversations
for each row execute function private.set_updated_at();
create trigger calls_set_updated_at before update on public.calls
for each row execute function private.set_updated_at();
create trigger appointments_set_updated_at before update on public.appointments
for each row execute function private.set_updated_at();

create function private.feature_is_enabled(target_business_id uuid, feature_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare enabled boolean;
begin
  select case feature_name
    when 'appointments' then entitlement.appointments_enabled
    when 'whatsapp' then entitlement.whatsapp_enabled
    when 'ai_voice' then entitlement.ai_voice_enabled
    else false
  end into enabled
  from public.business_entitlements entitlement
  where entitlement.business_id = target_business_id
    and (entitlement.valid_from is null or entitlement.valid_from <= now())
    and (entitlement.valid_until is null or entitlement.valid_until > now());
  return coalesce(enabled, false);
end;
$$;

create function private.can_read_conversation(target_conversation_id uuid, target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations conversation
    where conversation.id = target_conversation_id
      and conversation.business_id = target_business_id
      and private.can_read_lead(conversation.lead_id, target_business_id)
  )
$$;

create function private.require_active_advisor(target_business_id uuid, target_member_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.business_members member
    where member.id = target_member_id
      and member.business_id = target_business_id
      and member.role = 'ADVISOR'
      and member.status = 'ACTIVE'
  ) then
    raise exception 'Active advisor required' using errcode = '22023';
  end if;
end;
$$;

create function public.create_appointment(
  target_lead_id uuid,
  target_listing_id uuid,
  target_advisor_member_id uuid,
  appointment_title text,
  appointment_starts_at timestamptz,
  appointment_ends_at timestamptz,
  appointment_location text default null,
  appointment_notes text default null
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare current_lead public.leads;
declare created_appointment public.appointments;
begin
  select * into current_lead from public.leads where id = target_lead_id for update;
  if current_lead.id is null or not private.can_write_assigned_record(current_lead.business_id, current_lead.assigned_member_id) then
    raise exception 'Lead access denied' using errcode = '42501';
  end if;
  if not private.feature_is_enabled(current_lead.business_id, 'appointments') then
    raise exception 'Appointments feature disabled' using errcode = '42501';
  end if;
  perform private.require_active_advisor(current_lead.business_id, target_advisor_member_id);
  if target_listing_id is not null and not private.can_read_listing(target_listing_id, current_lead.business_id) then
    raise exception 'Listing access denied' using errcode = '42501';
  end if;
  if char_length(trim(appointment_title)) < 3 or appointment_ends_at <= appointment_starts_at then
    raise exception 'Invalid appointment details' using errcode = '22023';
  end if;

  insert into public.appointments(
    business_id, lead_id, listing_id, advisor_member_id, title,
    starts_at, ends_at, location, notes
  ) values (
    current_lead.business_id, current_lead.id, target_listing_id,
    target_advisor_member_id, trim(appointment_title), appointment_starts_at,
    appointment_ends_at, nullif(trim(appointment_location), ''), nullif(trim(appointment_notes), '')
  ) returning * into created_appointment;

  if current_lead.status = 'QUALIFIED' then
    update public.leads set status = 'APPOINTMENT_SCHEDULED' where id = current_lead.id;
  end if;
  insert into public.activity_logs(business_id, lead_id, actor_user_id, action, metadata)
  values(current_lead.business_id, current_lead.id, (select auth.uid()), 'APPOINTMENT_CREATED', jsonb_build_object('appointment_id', created_appointment.id));
  return created_appointment;
end;
$$;

create function public.reschedule_appointment(
  target_appointment_id uuid,
  new_starts_at timestamptz,
  new_ends_at timestamptz
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare current_appointment public.appointments;
begin
  select * into current_appointment from public.appointments where id = target_appointment_id for update;
  if current_appointment.id is null or not private.can_read_lead(current_appointment.lead_id, current_appointment.business_id) then
    raise exception 'Appointment access denied' using errcode = '42501';
  end if;
  if not private.business_is_operational(current_appointment.business_id)
     or not private.feature_is_enabled(current_appointment.business_id, 'appointments')
     or new_ends_at <= new_starts_at then
    raise exception 'Appointment cannot be rescheduled' using errcode = '22023';
  end if;
  update public.appointments
  set starts_at = new_starts_at, ends_at = new_ends_at, status = 'SCHEDULED',
      reschedule_count = reschedule_count + 1, canceled_at = null, cancellation_reason = null
  where id = current_appointment.id returning * into current_appointment;
  insert into public.activity_logs(business_id, lead_id, actor_user_id, action, metadata)
  values(current_appointment.business_id, current_appointment.lead_id, (select auth.uid()), 'APPOINTMENT_RESCHEDULED', jsonb_build_object('appointment_id', current_appointment.id));
  return current_appointment;
end;
$$;

create function public.cancel_appointment(target_appointment_id uuid, cancel_reason text default null)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare current_appointment public.appointments;
begin
  select * into current_appointment from public.appointments where id = target_appointment_id for update;
  if current_appointment.id is null or not private.can_read_lead(current_appointment.lead_id, current_appointment.business_id) then
    raise exception 'Appointment access denied' using errcode = '42501';
  end if;
  if not private.business_is_operational(current_appointment.business_id) then
    raise exception 'Business is not operational' using errcode = '42501';
  end if;
  update public.appointments set status = 'CANCELED', canceled_at = now(), cancellation_reason = nullif(trim(cancel_reason), '')
  where id = current_appointment.id returning * into current_appointment;
  insert into public.activity_logs(business_id, lead_id, actor_user_id, action, metadata)
  values(current_appointment.business_id, current_appointment.lead_id, (select auth.uid()), 'APPOINTMENT_CANCELED', jsonb_build_object('appointment_id', current_appointment.id));
  return current_appointment;
end;
$$;

create function public.create_manual_whatsapp_draft(target_lead_id uuid, message_content text)
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
     or not current_lead.whatsapp_allowed or current_lead.phone_normalized is null then
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

create function public.schedule_callback(target_lead_id uuid, callback_at timestamptz)
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
  if not private.feature_is_enabled(current_lead.business_id, 'ai_voice') or not current_lead.call_allowed then
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

create function public.save_conversation_summary(target_conversation_id uuid, summary_text text, outcome_text text default null)
returns public.conversations
language plpgsql
security definer
set search_path = ''
as $$
declare current_conversation public.conversations;
begin
  select * into current_conversation from public.conversations where id = target_conversation_id for update;
  if current_conversation.id is null or not private.can_read_lead(current_conversation.lead_id, current_conversation.business_id) then
    raise exception 'Conversation access denied' using errcode = '42501';
  end if;
  if char_length(trim(summary_text)) not between 1 and 10000 then raise exception 'Invalid summary' using errcode = '22023'; end if;
  update public.conversations set summary = trim(summary_text), outcome = nullif(trim(outcome_text), '')
  where id = target_conversation_id returning * into current_conversation;
  return current_conversation;
end;
$$;

create function public.transfer_to_human(target_conversation_id uuid, target_member_id uuid)
returns public.conversations
language plpgsql
security definer
set search_path = ''
as $$
declare current_conversation public.conversations;
begin
  select * into current_conversation from public.conversations where id = target_conversation_id for update;
  if current_conversation.id is null or not private.can_read_lead(current_conversation.lead_id, current_conversation.business_id) then
    raise exception 'Conversation access denied' using errcode = '42501';
  end if;
  perform private.require_active_advisor(current_conversation.business_id, target_member_id);
  update public.conversations set assigned_member_id = target_member_id, status = 'TRANSFERRED'
  where id = target_conversation_id returning * into current_conversation;
  return current_conversation;
end;
$$;

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.calls enable row level security;
alter table public.appointments enable row level security;

revoke all on table public.conversations, public.messages, public.calls, public.appointments from anon, authenticated;
grant select on table public.conversations, public.messages, public.calls, public.appointments to authenticated;

create policy conversations_select_authorized on public.conversations for select to authenticated
using ((select private.can_read_lead(lead_id, business_id)));
create policy messages_select_authorized on public.messages for select to authenticated
using ((select private.can_read_conversation(conversation_id, business_id)));
create policy calls_select_authorized on public.calls for select to authenticated
using ((select private.can_read_lead(lead_id, business_id)));
create policy appointments_select_authorized on public.appointments for select to authenticated
using ((select private.can_read_lead(lead_id, business_id)));

revoke all on function private.feature_is_enabled(uuid, text) from public, anon, authenticated;
revoke all on function private.can_read_conversation(uuid, uuid) from public, anon, authenticated;
revoke all on function private.require_active_advisor(uuid, uuid) from public, anon, authenticated;
grant execute on function private.feature_is_enabled(uuid, text) to authenticated;
grant execute on function private.can_read_conversation(uuid, uuid) to authenticated;

revoke all on function public.create_appointment(uuid, uuid, uuid, text, timestamptz, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.reschedule_appointment(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.cancel_appointment(uuid, text) from public, anon, authenticated;
revoke all on function public.create_manual_whatsapp_draft(uuid, text) from public, anon, authenticated;
revoke all on function public.schedule_callback(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.save_conversation_summary(uuid, text, text) from public, anon, authenticated;
revoke all on function public.transfer_to_human(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_appointment(uuid, uuid, uuid, text, timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.reschedule_appointment(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.cancel_appointment(uuid, text) to authenticated;
grant execute on function public.create_manual_whatsapp_draft(uuid, text) to authenticated;
grant execute on function public.schedule_callback(uuid, timestamptz) to authenticated;
grant execute on function public.save_conversation_summary(uuid, text, text) to authenticated;
grant execute on function public.transfer_to_human(uuid, uuid) to authenticated;

commit;
