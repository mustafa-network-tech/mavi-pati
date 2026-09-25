-- MK Pati clinic core: pet owners, patients, examinations, treatments, vaccinations,
-- appointments and the clinic activity log.
-- Every row carries business_id; composite foreign keys keep references inside one clinic.
-- Examinations and treatments are clinical records: CLINIC_STAFF cannot read them.
-- Rows are never deleted by users; they are archived or cancelled.
begin;

create table public.owners (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  full_name text not null check (char_length(full_name) between 2 and 160),
  phone text check (phone is null or char_length(phone) <= 40),
  phone_normalized text,
  email text check (email is null or char_length(email) <= 254),
  address text check (address is null or char_length(address) <= 500),
  notes text check (notes is null or char_length(notes) <= 5000),
  archived_at timestamptz,
  created_by_user_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id)
);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  owner_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  species text not null check (species in ('DOG', 'CAT', 'BIRD', 'RABBIT', 'RODENT', 'REPTILE', 'HORSE', 'CATTLE', 'OTHER')),
  breed text check (breed is null or char_length(breed) <= 100),
  sex text not null default 'UNKNOWN' check (sex in ('MALE', 'FEMALE', 'UNKNOWN')),
  birth_date date,
  birth_date_estimated boolean not null default false,
  color text check (color is null or char_length(color) <= 80),
  weight_kg numeric(6,2) check (weight_kg is null or (weight_kg > 0 and weight_kg < 2000)),
  microchip_number text check (microchip_number is null or microchip_number ~ '^[0-9A-Za-z]{6,23}$'),
  neuter_status text not null default 'UNKNOWN' check (neuter_status in ('INTACT', 'NEUTERED', 'UNKNOWN')),
  photo_path text check (photo_path is null or char_length(photo_path) <= 500),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DECEASED', 'ARCHIVED')),
  notes text check (notes is null or char_length(notes) <= 5000),
  created_by_user_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (owner_id, business_id) references public.owners(id, business_id)
);

create table public.examinations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  patient_id uuid not null,
  veterinarian_member_id uuid not null,
  examined_at timestamptz not null default now(),
  complaint text not null check (char_length(complaint) between 2 and 1000),
  anamnesis text check (anamnesis is null or char_length(anamnesis) <= 10000),
  findings text check (findings is null or char_length(findings) <= 10000),
  assessment text check (assessment is null or char_length(assessment) <= 10000),
  procedures text check (procedures is null or char_length(procedures) <= 5000),
  follow_up_at date,
  extra_notes text check (extra_notes is null or char_length(extra_notes) <= 5000),
  created_by_user_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (patient_id, business_id) references public.patients(id, business_id),
  foreign key (veterinarian_member_id, business_id) references public.business_members(id, business_id)
);

create table public.treatments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  patient_id uuid not null,
  examination_id uuid,
  procedure_name text not null check (char_length(procedure_name) between 2 and 200),
  performed_at timestamptz not null default now(),
  veterinarian_member_id uuid not null,
  description text check (description is null or char_length(description) <= 5000),
  clinical_note text check (clinical_note is null or char_length(clinical_note) <= 5000),
  created_by_user_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (patient_id, business_id) references public.patients(id, business_id),
  foreign key (examination_id, business_id) references public.examinations(id, business_id),
  foreign key (veterinarian_member_id, business_id) references public.business_members(id, business_id)
);

create table public.vaccinations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  patient_id uuid not null,
  vaccine_name text not null check (char_length(vaccine_name) between 2 and 160),
  status text not null default 'ADMINISTERED' check (status in ('SCHEDULED', 'ADMINISTERED', 'CANCELED')),
  administered_at date,
  next_due_at date,
  veterinarian_member_id uuid,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by_user_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (patient_id, business_id) references public.patients(id, business_id),
  foreign key (veterinarian_member_id, business_id) references public.business_members(id, business_id),
  check (status <> 'ADMINISTERED' or administered_at is not null),
  check (status <> 'SCHEDULED' or next_due_at is not null),
  check (next_due_at is null or administered_at is null or next_due_at >= administered_at)
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  patient_id uuid not null,
  owner_id uuid not null,
  veterinarian_member_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELED', 'NO_SHOW')),
  reason text not null check (char_length(reason) between 2 and 500),
  notes text check (notes is null or char_length(notes) <= 2000),
  canceled_at timestamptz,
  created_by_user_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (patient_id, business_id) references public.patients(id, business_id),
  foreign key (owner_id, business_id) references public.owners(id, business_id),
  foreign key (veterinarian_member_id, business_id) references public.business_members(id, business_id),
  check (ends_at > starts_at and ends_at - starts_at <= interval '12 hours')
);

-- Audit trail. Metadata holds no clinical content; clinical entries are hidden from staff.
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  patient_id uuid,
  entity_type text not null check (entity_type in ('OWNER', 'PATIENT', 'EXAMINATION', 'TREATMENT', 'VACCINATION', 'APPOINTMENT')),
  entity_id uuid not null,
  action text not null check (char_length(action) between 3 and 100),
  actor_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (patient_id, business_id) references public.patients(id, business_id)
);

create index owners_business_name_idx on public.owners(business_id, full_name);
create index owners_phone_idx on public.owners(business_id, phone_normalized) where phone_normalized is not null;
create index patients_business_name_idx on public.patients(business_id, name);
create index patients_owner_idx on public.patients(business_id, owner_id);
create unique index patients_microchip_unique on public.patients(business_id, microchip_number)
  where microchip_number is not null;
create index examinations_patient_idx on public.examinations(business_id, patient_id, examined_at desc);
create index examinations_follow_up_idx on public.examinations(business_id, follow_up_at) where follow_up_at is not null;
create index treatments_patient_idx on public.treatments(business_id, patient_id, performed_at desc);
create index vaccinations_patient_idx on public.vaccinations(business_id, patient_id, administered_at desc);
create index vaccinations_due_idx on public.vaccinations(business_id, next_due_at) where next_due_at is not null;
create index appointments_calendar_idx on public.appointments(business_id, starts_at, status);
create index appointments_vet_idx on public.appointments(business_id, veterinarian_member_id, starts_at);
create index appointments_patient_idx on public.appointments(business_id, patient_id, starts_at desc);
create index activity_logs_business_idx on public.activity_logs(business_id, created_at desc);
create index activity_logs_patient_idx on public.activity_logs(business_id, patient_id, created_at desc)
  where patient_id is not null;

create trigger owners_set_updated_at before update on public.owners
for each row execute function private.set_updated_at();
create trigger patients_set_updated_at before update on public.patients
for each row execute function private.set_updated_at();
create trigger examinations_set_updated_at before update on public.examinations
for each row execute function private.set_updated_at();
create trigger treatments_set_updated_at before update on public.treatments
for each row execute function private.set_updated_at();
create trigger vaccinations_set_updated_at before update on public.vaccinations
for each row execute function private.set_updated_at();
create trigger appointments_set_updated_at before update on public.appointments
for each row execute function private.set_updated_at();

-- Access helpers.
create function private.can_write_clinic(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.business_is_operational(target_business_id)
    and private.feature_is_enabled(target_business_id, 'clinic')
    and private.is_active_business_member(target_business_id)
$$;

create function private.can_read_clinical(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_read_business_data(target_business_id)
    and private.is_clinical_member(target_business_id)
$$;

create function private.can_write_clinical(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_write_clinic(target_business_id)
    and private.is_clinical_member(target_business_id)
$$;

-- Data hygiene and integrity triggers.
create function private.normalize_owner_contact()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.full_name := trim(new.full_name);
  new.phone := nullif(trim(new.phone), '');
  new.email := nullif(lower(trim(new.email)), '');
  new.phone_normalized := private.normalize_phone(new.phone);
  return new;
end;
$$;

create trigger owners_normalize_contact
before insert or update of full_name, phone, email on public.owners
for each row execute function private.normalize_owner_contact();

create function private.normalize_patient()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := trim(new.name);
  new.microchip_number := nullif(upper(regexp_replace(coalesce(new.microchip_number, ''), '\s+', '', 'g')), '');
  if new.birth_date is not null and new.birth_date > current_date then
    raise exception 'Birth date cannot be in the future' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger patients_normalize
before insert or update of name, microchip_number, birth_date on public.patients
for each row execute function private.normalize_patient();

-- Records name a veterinarian: an active clinic admin or veterinarian of the same clinic.
create function private.ensure_practitioner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.veterinarian_member_id is not null and not exists (
    select 1 from public.business_members member
    where member.id = new.veterinarian_member_id
      and member.business_id = new.business_id
      and member.role in ('CLINIC_ADMIN', 'VETERINARIAN')
      and member.status = 'ACTIVE'
  ) then
    raise exception 'Veterinarian must be an active clinician of the same clinic' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger examinations_ensure_practitioner
before insert or update of veterinarian_member_id on public.examinations
for each row execute function private.ensure_practitioner();
create trigger treatments_ensure_practitioner
before insert or update of veterinarian_member_id on public.treatments
for each row execute function private.ensure_practitioner();
create trigger vaccinations_ensure_practitioner
before insert or update of veterinarian_member_id on public.vaccinations
for each row execute function private.ensure_practitioner();
create trigger appointments_ensure_practitioner
before insert or update of veterinarian_member_id on public.appointments
for each row execute function private.ensure_practitioner();

create function private.ensure_treatment_examination()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.examination_id is not null and not exists (
    select 1 from public.examinations examination
    where examination.id = new.examination_id
      and examination.business_id = new.business_id
      and examination.patient_id = new.patient_id
  ) then
    raise exception 'Examination belongs to another patient' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger treatments_ensure_examination
before insert or update of examination_id on public.treatments
for each row execute function private.ensure_treatment_examination();

-- The owner is always the patient's current owner; a veterinarian cannot be double-booked.
create function private.prepare_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select patient.owner_id into new.owner_id
  from public.patients patient
  where patient.id = new.patient_id and patient.business_id = new.business_id;
  if new.owner_id is null then
    raise exception 'Patient not found' using errcode = '22023';
  end if;

  if new.status = 'CANCELED' then
    new.canceled_at := coalesce(new.canceled_at, now());
  else
    new.canceled_at := null;
  end if;

  if new.veterinarian_member_id is not null
     and new.status in ('SCHEDULED', 'CONFIRMED', 'CHECKED_IN')
     and exists (
       select 1 from public.appointments other
       where other.business_id = new.business_id
         and other.veterinarian_member_id = new.veterinarian_member_id
         and other.id <> new.id
         and other.status in ('SCHEDULED', 'CONFIRMED', 'CHECKED_IN')
         and tstzrange(other.starts_at, other.ends_at) && tstzrange(new.starts_at, new.ends_at)
     ) then
    raise exception 'Veterinarian is not available' using errcode = '23P01';
  end if;
  return new;
end;
$$;

create trigger appointments_prepare
before insert or update of patient_id, veterinarian_member_id, starts_at, ends_at, status on public.appointments
for each row execute function private.prepare_appointment();

create function private.log_clinic_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  entity text := case tg_table_name
    when 'owners' then 'OWNER'
    when 'patients' then 'PATIENT'
    when 'examinations' then 'EXAMINATION'
    when 'treatments' then 'TREATMENT'
    when 'vaccinations' then 'VACCINATION'
    when 'appointments' then 'APPOINTMENT'
  end;
  row_data jsonb := to_jsonb(new);
  event_action text;
begin
  if tg_op = 'INSERT' then
    event_action := entity || '_CREATED';
  elsif tg_table_name in ('patients', 'appointments', 'vaccinations')
        and (to_jsonb(old) ->> 'status') is distinct from (row_data ->> 'status') then
    event_action := entity || '_' || (row_data ->> 'status');
  else
    event_action := entity || '_UPDATED';
  end if;

  insert into public.activity_logs(business_id, patient_id, entity_type, entity_id, action, actor_user_id)
  values (
    new.business_id,
    case when tg_table_name = 'patients' then new.id
         when tg_table_name = 'owners' then null
         else (row_data ->> 'patient_id')::uuid end,
    entity,
    new.id,
    event_action,
    coalesce((select auth.uid()), (row_data ->> 'created_by_user_id')::uuid)
  );
  return new;
end;
$$;

create trigger owners_log_activity after insert or update on public.owners
for each row execute function private.log_clinic_activity();
create trigger patients_log_activity after insert or update on public.patients
for each row execute function private.log_clinic_activity();
create trigger examinations_log_activity after insert or update on public.examinations
for each row execute function private.log_clinic_activity();
create trigger treatments_log_activity after insert or update on public.treatments
for each row execute function private.log_clinic_activity();
create trigger vaccinations_log_activity after insert or update on public.vaccinations
for each row execute function private.log_clinic_activity();
create trigger appointments_log_activity after insert or update on public.appointments
for each row execute function private.log_clinic_activity();

-- Row level security.
alter table public.owners enable row level security;
alter table public.patients enable row level security;
alter table public.examinations enable row level security;
alter table public.treatments enable row level security;
alter table public.vaccinations enable row level security;
alter table public.appointments enable row level security;
alter table public.activity_logs enable row level security;

revoke all on table public.owners, public.patients, public.examinations, public.treatments,
  public.vaccinations, public.appointments, public.activity_logs from anon, authenticated;
grant select on table public.owners, public.patients, public.examinations, public.treatments,
  public.vaccinations, public.appointments, public.activity_logs to authenticated;

grant insert(business_id, full_name, phone, email, address, notes) on public.owners to authenticated;
grant update(full_name, phone, email, address, notes, archived_at) on public.owners to authenticated;

grant insert(
  business_id, owner_id, name, species, breed, sex, birth_date, birth_date_estimated, color,
  weight_kg, microchip_number, neuter_status, photo_path, status, notes
) on public.patients to authenticated;
grant update(
  owner_id, name, species, breed, sex, birth_date, birth_date_estimated, color,
  weight_kg, microchip_number, neuter_status, photo_path, status, notes
) on public.patients to authenticated;

grant insert(
  business_id, patient_id, veterinarian_member_id, examined_at, complaint, anamnesis,
  findings, assessment, procedures, follow_up_at, extra_notes
) on public.examinations to authenticated;
grant update(
  veterinarian_member_id, examined_at, complaint, anamnesis, findings, assessment,
  procedures, follow_up_at, extra_notes
) on public.examinations to authenticated;

grant insert(
  business_id, patient_id, examination_id, procedure_name, performed_at,
  veterinarian_member_id, description, clinical_note
) on public.treatments to authenticated;
grant update(
  examination_id, procedure_name, performed_at, veterinarian_member_id, description, clinical_note
) on public.treatments to authenticated;

grant insert(
  business_id, patient_id, vaccine_name, status, administered_at, next_due_at,
  veterinarian_member_id, notes
) on public.vaccinations to authenticated;
grant update(
  vaccine_name, status, administered_at, next_due_at, veterinarian_member_id, notes
) on public.vaccinations to authenticated;

grant insert(
  business_id, patient_id, veterinarian_member_id, starts_at, ends_at, status, reason, notes
) on public.appointments to authenticated;
grant update(
  veterinarian_member_id, starts_at, ends_at, status, reason, notes
) on public.appointments to authenticated;

create policy owners_select_member on public.owners for select to authenticated
using ((select private.can_read_business_data(business_id)));
create policy owners_insert_member on public.owners for insert to authenticated
with check ((select private.can_write_clinic(business_id)));
create policy owners_update_member on public.owners for update to authenticated
using ((select private.can_write_clinic(business_id)))
with check ((select private.can_write_clinic(business_id)));

create policy patients_select_member on public.patients for select to authenticated
using ((select private.can_read_business_data(business_id)));
create policy patients_insert_member on public.patients for insert to authenticated
with check ((select private.can_write_clinic(business_id)));
create policy patients_update_member on public.patients for update to authenticated
using ((select private.can_write_clinic(business_id)))
with check ((select private.can_write_clinic(business_id)));

create policy examinations_select_clinical on public.examinations for select to authenticated
using ((select private.can_read_clinical(business_id)));
create policy examinations_insert_clinical on public.examinations for insert to authenticated
with check ((select private.can_write_clinical(business_id)));
create policy examinations_update_author on public.examinations for update to authenticated
using (
  (select private.can_write_clinical(business_id))
  and (created_by_user_id = (select auth.uid()) or (select private.is_clinic_admin(business_id)))
)
with check ((select private.can_write_clinical(business_id)));

create policy treatments_select_clinical on public.treatments for select to authenticated
using ((select private.can_read_clinical(business_id)));
create policy treatments_insert_clinical on public.treatments for insert to authenticated
with check ((select private.can_write_clinical(business_id)));
create policy treatments_update_author on public.treatments for update to authenticated
using (
  (select private.can_write_clinical(business_id))
  and (created_by_user_id = (select auth.uid()) or (select private.is_clinic_admin(business_id)))
)
with check ((select private.can_write_clinical(business_id)));

create policy vaccinations_select_member on public.vaccinations for select to authenticated
using ((select private.can_read_business_data(business_id)));
create policy vaccinations_insert_member on public.vaccinations for insert to authenticated
with check ((select private.can_write_clinic(business_id)));
create policy vaccinations_update_member on public.vaccinations for update to authenticated
using ((select private.can_write_clinic(business_id)))
with check ((select private.can_write_clinic(business_id)));

create policy appointments_select_member on public.appointments for select to authenticated
using ((select private.can_read_business_data(business_id)));
create policy appointments_insert_member on public.appointments for insert to authenticated
with check (
  (select private.can_write_clinic(business_id))
  and (select private.feature_is_enabled(business_id, 'appointments'))
);
create policy appointments_update_member on public.appointments for update to authenticated
using (
  (select private.can_write_clinic(business_id))
  and (select private.feature_is_enabled(business_id, 'appointments'))
)
with check (
  (select private.can_write_clinic(business_id))
  and (select private.feature_is_enabled(business_id, 'appointments'))
);

create policy activity_logs_select_member on public.activity_logs for select to authenticated
using (
  (select private.can_read_business_data(business_id))
  and (entity_type not in ('EXAMINATION', 'TREATMENT') or (select private.is_clinical_member(business_id)))
);

-- Patient photos in a private bucket, path "<business_id>/<patient_id>/<file>".
-- Only applied where Supabase Storage exists (skipped in local PGlite tests).
create function private.storage_business_id(object_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(object_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(object_name, '/', 1)::uuid
  end
$$;

do $storage$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('patient-photos', 'patient-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

    execute $policy$
      create policy patient_photos_select on storage.objects for select to authenticated
      using (bucket_id = 'patient-photos'
        and (select private.can_read_business_data(private.storage_business_id(name))))
    $policy$;
    execute $policy$
      create policy patient_photos_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'patient-photos'
        and (select private.can_write_clinic(private.storage_business_id(name))))
    $policy$;
    execute $policy$
      create policy patient_photos_delete on storage.objects for delete to authenticated
      using (bucket_id = 'patient-photos'
        and (select private.can_write_clinic(private.storage_business_id(name))))
    $policy$;
  end if;
end
$storage$;

revoke all on function private.can_write_clinic(uuid) from public, anon, authenticated;
revoke all on function private.can_read_clinical(uuid) from public, anon, authenticated;
revoke all on function private.can_write_clinical(uuid) from public, anon, authenticated;
revoke all on function private.normalize_owner_contact() from public, anon, authenticated;
revoke all on function private.normalize_patient() from public, anon, authenticated;
revoke all on function private.ensure_practitioner() from public, anon, authenticated;
revoke all on function private.ensure_treatment_examination() from public, anon, authenticated;
revoke all on function private.prepare_appointment() from public, anon, authenticated;
revoke all on function private.log_clinic_activity() from public, anon, authenticated;
revoke all on function private.storage_business_id(text) from public, anon, authenticated;
grant execute on function private.can_write_clinic(uuid) to authenticated;
grant execute on function private.can_read_clinical(uuid) to authenticated;
grant execute on function private.can_write_clinical(uuid) to authenticated;
grant execute on function private.storage_business_id(text) to authenticated;

commit;
