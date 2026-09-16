create extension if not exists pgcrypto;
create table public.clinics (id uuid primary key default gen_random_uuid(),slug text unique not null,name text not null,description text,phone text,whatsapp text,address text,logo_url text,is_active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.assistant_knowledge (id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics(id),category text not null,title text not null,canonical_question text not null,answer_text text not null,keywords text[] not null default '{}',alternative_questions text[] not null default '{}',priority integer not null default 0,is_active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(clinic_id,canonical_question));
create table public.unanswered_questions (id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics(id),visitor_name text,visitor_phone text,question_text text not null check(length(question_text) between 3 and 1000),normalized_question text not null,status text not null default 'pending' check(status in ('pending','contacted','resolved')),created_at timestamptz not null default now());
create table public.assistant_interactions (id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics(id),question_text text not null,matched_knowledge_id uuid,answer_text text,match_score numeric,was_answered boolean not null,created_at timestamptz not null default now());
alter table public.assistant_knowledge add constraint knowledge_tenant_unique unique(id,clinic_id);
alter table public.assistant_interactions add constraint interaction_knowledge_tenant_fk foreign key(matched_knowledge_id,clinic_id) references public.assistant_knowledge(id,clinic_id);
create index on public.assistant_knowledge(clinic_id,is_active);
create index on public.unanswered_questions(clinic_id,status,created_at);
create index on public.assistant_interactions(clinic_id,created_at);
alter table public.clinics enable row level security;
alter table public.assistant_knowledge enable row level security;
alter table public.unanswered_questions enable row level security;
alter table public.assistant_interactions enable row level security;
revoke all on public.clinics,public.assistant_knowledge,public.unanswered_questions,public.assistant_interactions from anon,authenticated;
grant select(id,slug,name,description,phone,whatsapp,address,is_active) on public.clinics to anon,authenticated;
grant select(id,clinic_id,category,canonical_question,answer_text,keywords,alternative_questions,priority,is_active) on public.assistant_knowledge to anon,authenticated;
create policy active_public_clinics on public.clinics for select to anon,authenticated using(is_active);
create policy active_public_knowledge on public.assistant_knowledge for select to anon,authenticated using(is_active and exists(select 1 from public.clinics c where c.id=clinic_id and c.is_active));
-- Shared PostgreSQL quota survives serverless instances. No raw IPs are stored.
create table public.request_quotas(key text primary key,window_start timestamptz not null,hits integer not null);
alter table public.request_quotas enable row level security;
revoke all on public.request_quotas from anon,authenticated;
create function public.consume_request_quota(bucket_key text) returns boolean language plpgsql security definer set search_path='' as $$
declare total integer;
begin
 delete from public.request_quotas where window_start < now()-interval '1 day';
 insert into public.request_quotas as q(key,window_start,hits) values(bucket_key,now(),1)
 on conflict(key) do update set hits=case when q.window_start<now()-interval '1 minute' then 1 else q.hits+1 end,window_start=case when q.window_start<now()-interval '1 minute' then now() else q.window_start end returning hits into total;
 return total<=10;
end;$$;
revoke all on function public.consume_request_quota(text) from public,anon,authenticated;
grant execute on function public.consume_request_quota(text) to service_role;
