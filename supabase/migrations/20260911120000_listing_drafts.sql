drop policy if exists "owners_insert_listings" on public.listings;
create policy "owners_insert_listings" on public.listings for insert with check (
  owner_id=auth.uid() and (
    public.current_role()='admin' or (
      public.current_role()='user' and (
        (status='published' and verification_status='submitted') or
        (status='draft' and verification_status='unverified' and active=false)
      )
    )
  )
);
