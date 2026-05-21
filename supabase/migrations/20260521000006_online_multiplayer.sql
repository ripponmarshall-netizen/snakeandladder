-- 3-4 player online support. Generalizes the previously 2-player-only schema and
-- RPCs to up to four seats, mirroring what localGame.js already does offline.
-- Rooms carry a max_players target (2..4) chosen at creation; the game auto-starts
-- (status flips to 'active') once that many players have joined. The games row gains
-- player3_position / player4_position, and roll_dice rotates turns through whichever
-- roles are actually present (skipping any who forfeited). Three extra boards are
-- seeded so create_room's random pick can use them server-side.

-- ── Schema additions ────────────────────────────────────────────────────────
alter table public.games
  add column if not exists player3_position int not null default 0,
  add column if not exists player4_position int not null default 0;

alter table public.rooms
  add column if not exists max_players int not null default 2;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rooms_max_players_range'
  ) then
    alter table public.rooms
      add constraint rooms_max_players_range check (max_players between 2 and 4);
  end if;
end$$;

alter table public.room_players
  add column if not exists forfeited boolean not null default false;

-- ── roll_dice: N-player rotation ────────────────────────────────────────────
create or replace function public.roll_dice(p_room_id uuid)
returns public.games
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g public.games;
  caller_role text;
  player_count int;
  v_max int;
  v_jumps jsonb;
  v_roll int;
  v_pos int;
  v_raw int;
  v_dest int;
  v_new int;
  v_winner text;
  v_next text;
  v_roles text[];
  v_idx int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- Lock the room's game row; a concurrent roll blocks here then re-reads.
  select * into g from public.games where room_id = p_room_id for update;
  if g.id is null then
    raise exception 'Game not found';
  end if;
  if g.winner is not null then
    raise exception 'Game is already over';
  end if;

  select role into caller_role
  from public.room_players
  where room_id = p_room_id and user_id = auth.uid()
  limit 1;
  if caller_role is null then
    raise exception 'You are not a player in this room';
  end if;

  select max_players into v_max from public.rooms where id = p_room_id;
  select count(*) into player_count from public.room_players where room_id = p_room_id;
  if player_count < v_max then
    raise exception 'Waiting for players';
  end if;

  if caller_role <> g.current_turn then
    raise exception 'Not your turn';
  end if;

  select jumps into v_jumps from public.boards where id = g.board_id;
  if v_jumps is null then
    raise exception 'Board not found';
  end if;

  v_roll := floor(random() * 6)::int + 1;
  v_pos := case caller_role
             when 'player1' then g.player1_position
             when 'player2' then g.player2_position
             when 'player3' then g.player3_position
             else g.player4_position
           end;
  v_raw := v_pos + v_roll;
  v_winner := null;

  if v_raw > 100 then
    v_new := v_pos;                       -- overshoot: bounce, stay put
  else
    v_dest := (v_jumps ->> (v_raw::text))::int;   -- snake/ladder lookup
    v_new := coalesce(v_dest, v_raw);
    if v_new = 100 then
      v_winner := caller_role;
    end if;
  end if;

  -- Next turn: the following non-forfeited role in seat order (wraps around).
  select array_agg(rp.role order by rp.role) into v_roles
  from public.room_players rp
  where rp.room_id = p_room_id and rp.forfeited = false;

  v_idx := array_position(v_roles, g.current_turn);
  if v_idx is null then
    v_next := v_roles[1];
  else
    v_next := v_roles[(v_idx % array_length(v_roles, 1)) + 1];
  end if;

  update public.games set
    player1_position = case when caller_role = 'player1' then v_new else player1_position end,
    player2_position = case when caller_role = 'player2' then v_new else player2_position end,
    player3_position = case when caller_role = 'player3' then v_new else player3_position end,
    player4_position = case when caller_role = 'player4' then v_new else player4_position end,
    last_roll        = v_roll,
    current_turn     = case when v_winner is not null then current_turn else v_next end,
    winner           = v_winner,
    version          = version + 1
  where id = g.id
  returning * into g;

  if v_winner is not null then
    update public.rooms set status = 'finished' where id = p_room_id;
  end if;

  return g;
end;
$$;

-- ── create_room: now takes a max_players target ─────────────────────────────
drop function if exists public.create_room(text);
create or replace function public.create_room(p_player_name text, p_max_players int default 2)
returns table(room_id uuid, room_code text, membership_id uuid, assigned_role text, board_id text, game_id uuid, max_players int)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_board text;
  v_max int;
  v_room public.rooms;
  v_player public.room_players;
  v_game public.games;
  i int;
  attempt int;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_player_name is null or length(trim(p_player_name)) = 0 then
    raise exception 'Player name is required';
  end if;

  v_max := least(greatest(coalesce(p_max_players, 2), 2), 4);

  v_code := null;
  for attempt in 1..20 loop
    declare candidate text := '';
    begin
      for i in 1..6 loop
        candidate := candidate || substr(v_chars, floor(random() * length(v_chars))::int + 1, 1);
      end loop;
      if not exists (select 1 from public.rooms where code = candidate) then
        v_code := candidate;
        exit;
      end if;
    end;
  end loop;
  if v_code is null then
    raise exception 'Could not allocate a unique room code';
  end if;

  select id into v_board from public.boards order by random() limit 1;
  if v_board is null then
    raise exception 'No boards configured';
  end if;

  insert into public.rooms (code, created_by, status, max_players)
    values (v_code, v_uid, 'waiting', v_max) returning * into v_room;

  insert into public.room_players (room_id, user_id, player_name, role)
    values (v_room.id, v_uid, trim(p_player_name), 'player1') returning * into v_player;

  insert into public.games (room_id, board_id, current_turn, player1_position, player2_position)
    values (v_room.id, v_board, 'player1', 0, 0) returning * into v_game;

  room_id := v_room.id;
  room_code := v_room.code;
  membership_id := v_player.id;
  assigned_role := v_player.role;
  board_id := v_board;
  game_id := v_game.id;
  max_players := v_room.max_players;
  return next;
end;
$$;

-- ── join_room_by_code: assign the next free role, auto-start when full ───────
drop function if exists public.join_room_by_code(text, text);
create or replace function public.join_room_by_code(room_code text, player_name_input text)
returns table(room_id uuid, room_code_out text, membership_id uuid, assigned_role text, room_status text, max_players int)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  found_room public.rooms%rowtype;
  existing_membership public.room_players%rowtype;
  member_count integer;
  chosen_role text;
  taken text[];
  candidate text;
  r text;
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
    max_players := found_room.max_players;
    return next;
    return;
  end if;

  select count(*) into member_count from public.room_players rp where rp.room_id = found_room.id;
  if member_count >= found_room.max_players then
    raise exception 'Room is full';
  end if;

  -- First unused role in seat order.
  select array_agg(rp.role) into taken from public.room_players rp where rp.room_id = found_room.id;
  chosen_role := null;
  foreach r in array array['player1', 'player2', 'player3', 'player4'] loop
    if taken is null or not (r = any(taken)) then
      chosen_role := r;
      exit;
    end if;
  end loop;
  if chosen_role is null then
    raise exception 'Room is full';
  end if;

  insert into public.room_players (room_id, user_id, player_name, role)
  values (found_room.id, auth.uid(), trim(player_name_input), chosen_role)
  returning * into new_membership;

  if (member_count + 1) >= found_room.max_players then
    update public.rooms set status = 'active' where id = found_room.id;
    found_room.status := 'active';
  end if;

  room_id := found_room.id;
  room_code_out := found_room.code;
  membership_id := new_membership.id;
  assigned_role := new_membership.role;
  room_status := found_room.status;
  max_players := found_room.max_players;
  return next;
end;
$$;

-- ── rematch: reset all four positions ───────────────────────────────────────
create or replace function public.rematch(p_room_id uuid)
returns public.games
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g public.games;
  caller_role text;
  v_board text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select role into caller_role from public.room_players
    where room_id = p_room_id and user_id = auth.uid() limit 1;
  if caller_role is null then raise exception 'You are not a player in this room'; end if;

  select * into g from public.games where room_id = p_room_id for update;
  if g.id is null then raise exception 'Game not found'; end if;
  if g.winner is null then raise exception 'Game is not finished yet'; end if;

  select id into v_board from public.boards order by random() limit 1;

  update public.games set
    player1_position = 0,
    player2_position = 0,
    player3_position = 0,
    player4_position = 0,
    last_roll        = null,
    winner           = null,
    current_turn     = 'player1',
    board_id         = coalesce(v_board, board_id),
    version          = version + 1
  where id = g.id
  returning * into g;

  update public.rooms set status = 'active' where id = p_room_id;
  return g;
end;
$$;

-- ── forfeit: caller drops out; last remaining player wins ───────────────────
create or replace function public.forfeit(p_room_id uuid)
returns public.games
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g public.games;
  caller_role text;
  v_roles text[];
  v_next text;
  active_count int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select role into caller_role from public.room_players
    where room_id = p_room_id and user_id = auth.uid() limit 1;
  if caller_role is null then raise exception 'You are not a player in this room'; end if;

  select * into g from public.games where room_id = p_room_id for update;
  if g.id is null then raise exception 'Game not found'; end if;
  if g.winner is not null then raise exception 'Game is already over'; end if;

  update public.room_players set forfeited = true
    where room_id = p_room_id and role = caller_role;

  select array_agg(rp.role order by rp.role) into v_roles
  from public.room_players rp
  where rp.room_id = p_room_id and rp.forfeited = false;

  active_count := coalesce(array_length(v_roles, 1), 0);

  if active_count <= 1 then
    update public.games set
      winner  = case when active_count = 1 then v_roles[1] else null end,
      version = version + 1
    where id = g.id returning * into g;
    update public.rooms set status = 'finished' where id = p_room_id;
  else
    if g.current_turn = caller_role then
      -- Next active role after the caller by seat order, wrapping to the first.
      select min(rp.role) into v_next
        from public.room_players rp
        where rp.room_id = p_room_id and rp.forfeited = false and rp.role > caller_role;
      if v_next is null then v_next := v_roles[1]; end if;
    else
      v_next := g.current_turn;
    end if;
    update public.games set
      current_turn = v_next,
      version      = version + 1
    where id = g.id returning * into g;
  end if;

  return g;
end;
$$;

-- ── Seed three additional boards (mirrors boards.js) ────────────────────────
insert into public.boards (id, name, jumps) values
  ('board-6', 'Sky Bridge',  '{"3":24,"7":28,"13":46,"19":38,"33":54,"42":63,"51":88,"65":84,"37":18,"49":30,"58":39,"64":43,"76":47,"89":68,"94":55,"99":77}'::jsonb),
  ('board-7', 'Twin Peaks',  '{"5":16,"9":31,"14":35,"22":45,"39":59,"44":66,"57":77,"71":92,"26":8,"34":12,"48":27,"62":41,"73":53,"85":64,"91":69,"98":78}'::jsonb),
  ('board-8', 'Avalanche',   '{"4":25,"12":32,"18":49,"27":47,"36":56,"45":75,"61":81,"68":89,"24":5,"38":17,"52":33,"64":44,"79":58,"88":67,"95":73,"99":78}'::jsonb)
on conflict (id) do update set name = excluded.name, jumps = excluded.jumps;

-- ── Grants (re-apply for the new/replaced signatures) ───────────────────────
revoke all on function public.roll_dice(uuid)                    from public, anon;
revoke all on function public.create_room(text, int)             from public, anon;
revoke all on function public.join_room_by_code(text, text)      from public, anon;
revoke all on function public.rematch(uuid)                      from public, anon;
revoke all on function public.forfeit(uuid)                      from public, anon;
grant execute on function public.roll_dice(uuid)                 to authenticated;
grant execute on function public.create_room(text, int)          to authenticated;
grant execute on function public.join_room_by_code(text, text)   to authenticated;
grant execute on function public.rematch(uuid)                   to authenticated;
grant execute on function public.forfeit(uuid)                   to authenticated;
