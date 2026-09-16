-- Additive migration: existing rows remain Turkish and no content is deleted.
begin;
alter table public.assistant_knowledge add column language_code text not null default 'tr' check(language_code ~ '^[a-z]{2,3}(-[A-Za-z0-9]+)*$');
alter table public.unanswered_questions add column language_code text not null default 'tr' check(language_code ~ '^[a-z]{2,3}(-[A-Za-z0-9]+)*$');
alter table public.assistant_interactions add column language_code text not null default 'tr' check(language_code ~ '^[a-z]{2,3}(-[A-Za-z0-9]+)*$');
alter table public.clinics add column supported_languages text[] not null default array['tr'];
alter table public.clinics add column default_language text not null default 'tr';
alter table public.clinics add column name_translations jsonb not null default '{}'::jsonb;
alter table public.clinics add constraint clinic_default_language_supported check(default_language=any(supported_languages));
alter table public.assistant_knowledge drop constraint assistant_knowledge_clinic_id_canonical_question_key;
alter table public.assistant_knowledge add constraint knowledge_clinic_language_question_unique unique(clinic_id,language_code,canonical_question);
create index knowledge_clinic_language_active_idx on public.assistant_knowledge(clinic_id,language_code,is_active);
create index unanswered_clinic_language_idx on public.unanswered_questions(clinic_id,language_code,created_at);
grant select(language_code) on public.assistant_knowledge to anon,authenticated;
grant select(supported_languages,default_language,name_translations) on public.clinics to anon,authenticated;
commit;
