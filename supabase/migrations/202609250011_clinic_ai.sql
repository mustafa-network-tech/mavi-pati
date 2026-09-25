-- MK Pati AI Clinic Advisor: conversation records and the monthly request quota.
-- Text and in-app voice share one quota, one policy and the same data access rules.
-- The AI runtime never gets SQL or service-role access: the server reads clinic data
-- with the signed-in user's RLS-bound client and records exchanges here.
begin;

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  patient_id uuid,
  created_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (patient_id, business_id) references public.patients(id, business_id)
);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  conversation_id uuid not null,
  role text not null check (role in ('USER', 'ASSISTANT')),
  channel text not null default 'TEXT' check (channel in ('TEXT', 'VOICE')),
  content text not null check (char_length(content) between 1 and 8000),
  intent text check (intent is null or char_length(intent) <= 60),
  model text check (model is null or char_length(model) <= 100),
  total_tokens integer check (total_tokens is null or total_tokens >= 0),
  safety_flag text check (safety_flag is null or char_length(safety_flag) <= 60),
  created_at timestamptz not null default now(),
  foreign key (conversation_id, business_id) references public.ai_conversations(id, business_id)
);

create index ai_conversations_user_idx on public.ai_conversations(business_id, user_id, created_at desc);
create index ai_messages_conversation_idx on public.ai_messages(business_id, conversation_id, created_at);

create function private.can_use_ai(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.business_is_operational(target_business_id)
    and private.feature_is_enabled(target_business_id, 'ai_assistant')
    and private.is_active_business_member(target_business_id)
$$;

-- A user sees their own conversations; the clinic admin can review the clinic's.
create function private.can_read_ai_conversation(target_conversation_id uuid, target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_read_business_data(target_business_id) and exists (
    select 1 from public.ai_conversations conversation
    where conversation.id = target_conversation_id
      and conversation.business_id = target_business_id
      and (conversation.user_id = (select auth.uid()) or private.is_clinic_admin(target_business_id))
  )
$$;

create function private.owns_ai_conversation(target_conversation_id uuid, target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ai_conversations conversation
    where conversation.id = target_conversation_id
      and conversation.business_id = target_business_id
      and conversation.user_id = (select auth.uid())
  )
$$;

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
revoke all on table public.ai_conversations, public.ai_messages from anon, authenticated;
grant select on table public.ai_conversations, public.ai_messages to authenticated;
grant insert(business_id, patient_id) on public.ai_conversations to authenticated;
grant insert(business_id, conversation_id, role, channel, content, intent, model, total_tokens, safety_flag)
  on public.ai_messages to authenticated;

create policy ai_conversations_select_authorized on public.ai_conversations for select to authenticated
using (
  (select private.can_read_business_data(business_id))
  and (user_id = (select auth.uid()) or (select private.is_clinic_admin(business_id)))
);
create policy ai_conversations_insert_self on public.ai_conversations for insert to authenticated
with check (user_id = (select auth.uid()) and (select private.can_use_ai(business_id)));

create policy ai_messages_select_authorized on public.ai_messages for select to authenticated
using ((select private.can_read_ai_conversation(conversation_id, business_id)));
create policy ai_messages_insert_owner on public.ai_messages for insert to authenticated
with check (
  (select private.can_use_ai(business_id))
  and (select private.owns_ai_conversation(conversation_id, business_id))
);

-- Atomically consumes one AI request from the clinic's monthly quota and returns what is left.
-- Voice transcriptions also count as one request and are tracked separately for statistics.
create function public.consume_ai_quota(target_business_id uuid, is_voice boolean default false)
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
begin
  if not private.can_use_ai(target_business_id) then
    raise exception 'AI access denied' using errcode = '42501';
  end if;
  if is_voice and not private.feature_is_enabled(target_business_id, 'ai_voice') then
    raise exception 'AI voice access denied' using errcode = '42501';
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
  return (request_limit - used)::integer;
end;
$$;

create function public.record_ai_tokens(target_business_id uuid, token_count integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_use_ai(target_business_id) then
    raise exception 'AI access denied' using errcode = '42501';
  end if;
  if token_count is null or token_count not between 0 and 1000000 then
    raise exception 'Invalid token count' using errcode = '22023';
  end if;
  insert into public.business_usage(business_id, metric, period_start, period_end, used_quantity)
  values (target_business_id, 'AI_TOKENS', date_trunc('month', now()), date_trunc('month', now()) + interval '1 month', token_count)
  on conflict (business_id, metric, period_start, period_end)
  do update set used_quantity = public.business_usage.used_quantity + excluded.used_quantity;
end;
$$;

revoke all on function private.can_use_ai(uuid) from public, anon, authenticated;
revoke all on function private.can_read_ai_conversation(uuid, uuid) from public, anon, authenticated;
revoke all on function private.owns_ai_conversation(uuid, uuid) from public, anon, authenticated;
grant execute on function private.can_use_ai(uuid) to authenticated;
grant execute on function private.can_read_ai_conversation(uuid, uuid) to authenticated;
grant execute on function private.owns_ai_conversation(uuid, uuid) to authenticated;

revoke all on function public.consume_ai_quota(uuid, boolean) from public, anon, authenticated;
revoke all on function public.record_ai_tokens(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid, boolean) to authenticated;
grant execute on function public.record_ai_tokens(uuid, integer) to authenticated;

commit;
