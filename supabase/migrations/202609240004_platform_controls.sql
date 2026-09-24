-- Platform-admin lifecycle, feature and quota controls.
begin;

create function public.configure_business_access(
  target_business_id uuid,
  actor_platform_user_id uuid,
  next_business_status text,
  next_expires_at timestamptz,
  next_max_advisors integer,
  enable_crm boolean,
  enable_appointments boolean,
  enable_whatsapp boolean,
  enable_ai_analysis boolean,
  enable_ai_voice boolean,
  enable_imports boolean,
  enable_reports boolean,
  next_ai_call_minutes integer,
  next_ai_analysis_limit integer,
  next_lead_limit integer,
  status_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare previous_business jsonb;
declare previous_entitlement jsonb;
declare active_advisors integer;
begin
  if not private.is_platform_admin(actor_platform_user_id) then
    raise exception 'Platform admin required' using errcode = '42501';
  end if;
  if next_business_status not in ('TRIAL', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REJECTED') then
    raise exception 'Invalid business status' using errcode = '22023';
  end if;
  if next_max_advisors < 0 or next_ai_call_minutes < 0
     or next_ai_analysis_limit < 0 or next_lead_limit < 0 then
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
  select count(*) into active_advisors from public.business_members
  where business_id = target_business_id and role = 'ADVISOR' and status in ('PENDING', 'ACTIVE');
  if active_advisors > next_max_advisors then
    raise exception 'Advisor limit is below current advisor count' using errcode = '22023';
  end if;

  update public.businesses
  set status = next_business_status,
      access_starts_at = case when next_business_status in ('TRIAL', 'ACTIVE') then coalesce(access_starts_at, now()) else access_starts_at end,
      access_expires_at = next_expires_at,
      suspended_at = case when next_business_status = 'SUSPENDED' then now() else null end,
      suspension_reason = case when next_business_status in ('SUSPENDED', 'REJECTED') then nullif(trim(status_reason), '') else null end
  where id = target_business_id;

  insert into public.business_entitlements(
    business_id, max_advisors, crm_enabled, appointments_enabled, whatsapp_enabled,
    ai_analysis_enabled, ai_voice_enabled, imports_enabled, reports_enabled,
    monthly_ai_call_minutes, monthly_ai_analysis_limit, monthly_lead_limit,
    valid_from, valid_until, updated_by_platform_admin
  ) values (
    target_business_id, next_max_advisors, enable_crm, enable_appointments, enable_whatsapp,
    enable_ai_analysis, enable_ai_voice, enable_imports, enable_reports,
    next_ai_call_minutes, next_ai_analysis_limit, next_lead_limit,
    now(), next_expires_at, actor_platform_user_id
  ) on conflict (business_id) do update set
    max_advisors = excluded.max_advisors,
    crm_enabled = excluded.crm_enabled,
    appointments_enabled = excluded.appointments_enabled,
    whatsapp_enabled = excluded.whatsapp_enabled,
    ai_analysis_enabled = excluded.ai_analysis_enabled,
    ai_voice_enabled = excluded.ai_voice_enabled,
    imports_enabled = excluded.imports_enabled,
    reports_enabled = excluded.reports_enabled,
    monthly_ai_call_minutes = excluded.monthly_ai_call_minutes,
    monthly_ai_analysis_limit = excluded.monthly_ai_analysis_limit,
    monthly_lead_limit = excluded.monthly_lead_limit,
    valid_until = excluded.valid_until,
    updated_by_platform_admin = excluded.updated_by_platform_admin;

  update public.business_members
  set status = 'ACTIVE', activated_at = coalesce(activated_at, now())
  where business_id = target_business_id
    and role = 'OFFICE_ADMIN'
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

revoke all on function public.configure_business_access(
  uuid, uuid, text, timestamptz, integer, boolean, boolean, boolean, boolean,
  boolean, boolean, boolean, integer, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.configure_business_access(
  uuid, uuid, text, timestamptz, integer, boolean, boolean, boolean, boolean,
  boolean, boolean, boolean, integer, integer, integer, text
) to service_role;

commit;
