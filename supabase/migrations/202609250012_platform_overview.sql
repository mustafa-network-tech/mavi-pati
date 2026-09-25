-- Platform Admin overview: per-clinic users, patients, subscription and AI usage.
-- Aggregates only; no patient or clinical content leaves the tenant.
begin;

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
  ai_tokens_this_month bigint
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
    coalesce((select u.used_quantity from public.business_usage u where u.business_id = business.id and u.metric = 'AI_TOKENS' and u.period_start = date_trunc('month', now())), 0)
  from public.businesses business
  left join public.business_entitlements entitlement on entitlement.business_id = business.id
  order by business.created_at desc;
end;
$$;

revoke all on function public.platform_clinic_overview(uuid) from public, anon, authenticated;
grant execute on function public.platform_clinic_overview(uuid) to service_role;

commit;
