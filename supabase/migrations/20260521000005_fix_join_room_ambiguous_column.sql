-- Fix a latent bug in the pre-existing join_room_by_code: its TABLE output
-- parameter `room_id` is ambiguous with room_players.room_id inside the body
-- ("column reference room_id is ambiguous"). The original client never called
-- this RPC (it inserted rows directly), so the bug never fired; the upgraded
-- client routes all joins through it, so we qualify every table column.
create or replace function public.join_room_by_code(room_code text, player_name_input text)
returns table(room_id uuid, room_code_out text, membership_id uuid, assigned_role text, room_status text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  found_room public.rooms%rowtype;
  existing_membership public.room_players%rowtype;
  member_count integer;
  chosen_role text;
  new_membership public.room_players%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if room_code is null or length(trim(room_code)) = 0 then
    raise exception 'Room code is required';
  end if;
  if player_name_input is null or length(trim(player_name_input)) = 0 then
    raise exception 'Player name is required';
  end if;

  select * into found_room from public.rooms r where r.code = upper(trim(room_code)) limit 1;
  if found_room.id is null then
    raise exception 'Room not found';
  end if;

  select * into existing_membership
  from public.room_players rp
  where rp.room_id = found_room.id and rp.user_id = auth.uid()
  limit 1;

  if existing_membership.id is not null then
    room_id := found_room.id;
    room_code_out := found_room.code;
    membership_id := existing_membership.id;
    assigned_role := existing_membership.role;
    room_status := found_room.status;
    return next;
    return;
  end if;

  select count(*) into member_count from public.room_players rp where rp.room_id = found_room.id;
  if member_count >= 2 then
    raise exception 'Room is full';
  end if;

  if exists (select 1 from public.room_players rp where rp.room_id = found_room.id and rp.role = 'player1') then
    chosen_role := 'player2';
  else
    chosen_role := 'player1';
  end if;

  insert into public.room_players (room_id, user_id, player_name, role)
  values (found_room.id, auth.uid(), trim(player_name_input), chosen_role)
  returning * into new_membership;

  if (member_count + 1) >= 2 then
    update public.rooms set status = 'active' where id = found_room.id;
    found_room.status := 'active';
  end if;

  room_id := found_room.id;
  room_code_out := found_room.code;
  membership_id := new_membership.id;
  assigned_role := new_membership.role;
  room_status := found_room.status;
  return next;
end;
$$;

revoke all on function public.join_room_by_code(text, text) from public, anon;
grant execute on function public.join_room_by_code(text, text) to authenticated;
