-- Self-service registration: office applications and advisor join requests.
-- Office applications are approved by a platform admin; advisor requests by the office admin.
begin;

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
  values (new_business_id, caller_id, 'OFFICE_ADMIN', 'PENDING');

  insert into public.business_entitlements(business_id)
  values (new_business_id);

  return new_business_id;
end;
$$;

create function public.request_advisor_membership(requested_slug text)
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

  select business.id into target_business_id
  from public.businesses business
  where business.slug = lower(trim(requested_slug));
  if target_business_id is null or not private.business_is_operational(target_business_id) then
    raise exception 'Office not found' using errcode = 'P0002';
  end if;

  -- A user belongs to one office; a rejected request cannot be resubmitted by the user.
  if exists (
    select 1 from public.business_members member
    where member.user_id = caller_id
      and (member.status <> 'REVOKED' or member.business_id = target_business_id)
  ) then
    raise exception 'Membership already exists' using errcode = '23505';
  end if;

  -- The advisor limit trigger reserves a seat for pending requests.
  insert into public.business_members(business_id, user_id, role, status)
  values (target_business_id, caller_id, 'ADVISOR', 'PENDING')
  returning id into new_member_id;

  return new_member_id;
end;
$$;

create function public.review_advisor_request(target_member_id uuid, approve boolean)
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
    and member.role = 'ADVISOR'
    and member.status = 'PENDING'
  for update;
  if target_business_id is null then
    raise exception 'Advisor request not found' using errcode = 'P0002';
  end if;
  if not private.is_office_admin(target_business_id) then
    raise exception 'Office admin required' using errcode = '42501';
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
    update public.business_members
    set status = 'REVOKED'
    where id = target_member_id;
  end if;
end;
$$;

revoke all on function public.request_advisor_membership(text) from public, anon, authenticated;
grant execute on function public.request_advisor_membership(text) to authenticated;
revoke all on function public.review_advisor_request(uuid, boolean) from public, anon, authenticated;
grant execute on function public.review_advisor_request(uuid, boolean) to authenticated;

commit;
