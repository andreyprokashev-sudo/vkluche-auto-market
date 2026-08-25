create or replace function public.accept_current_legal()
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.user_consents(user_id,document_code,document_version,granted,granted_at,metadata) values
  (auth.uid(),'terms','2026-08-25',true,now(),jsonb_build_object('renewal',true)),
  (auth.uid(),'personal_data','2026-08-25',true,now(),jsonb_build_object('renewal',true)),
  (auth.uid(),'privacy','2026-08-25',true,now(),jsonb_build_object('acknowledgement',true,'renewal',true));
end;$$;
revoke execute on function public.accept_current_legal() from public,anon;
grant execute on function public.accept_current_legal() to authenticated;
