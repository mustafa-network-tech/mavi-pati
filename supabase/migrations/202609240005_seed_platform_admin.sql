-- Grant PLATFORM_ADMIN to the initial platform operator.
begin;

do $$
declare admin_user_id constant uuid := '902ad129-9b65-4175-9650-79b0488774de';
begin
  if not exists (select 1 from auth.users where id = admin_user_id) then
    raise notice 'auth user % not found; skipping platform admin grant', admin_user_id;
    return;
  end if;

  insert into public.platform_users (user_id, role, status)
  values (admin_user_id, 'PLATFORM_ADMIN', 'ACTIVE')
  on conflict (user_id) do update
    set role = 'PLATFORM_ADMIN',
        status = 'ACTIVE',
        updated_at = now();
end
$$;

commit;
