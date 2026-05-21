-- Supabase's default privileges grant EXECUTE on new public functions directly
-- to the `anon` role, so `revoke ... from public` alone leaves anon able to call
-- the RPCs. Players sign in anonymously and carry the `authenticated` role, so
-- revoking from the no-JWT `anon` role is safe defense-in-depth (the RPCs also
-- reject auth.uid() IS NULL).
revoke all on function public.roll_dice(uuid)               from anon;
revoke all on function public.create_room(text)             from anon;
revoke all on function public.rematch(uuid)                 from anon;
revoke all on function public.forfeit(uuid)                 from anon;
revoke all on function public.join_room_by_code(text, text) from anon;

-- Pin a stable search_path on the updated_at trigger function (advisor 0011).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
