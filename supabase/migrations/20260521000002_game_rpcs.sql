-- Server-authoritative game actions. Every state transition lives in a
-- SECURITY DEFINER function so clients can never write game rows directly.
-- Each function validates auth.uid() membership and locks the games row
-- (FOR UPDATE) so concurrent rolls cannot both succeed or skip a turn.

-- ── roll_dice: the canonical move ──────────────────────────────────────────
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
  v_jumps jsonb;
  v_roll int;
  v_pos int;
  v_raw int;
  v_dest int;
  v_new int;
  v_winner text;
  v_next text;
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

  select count(*) into player_count from public.room_players where room_id = p_room_id;
  if player_count < 2 then
    raise exception 'Waiting for a second player';
  end if;

  if caller_role <> g.current_turn then
    raise exception 'Not your turn';
  end if;

  select jumps into v_jumps from public.boards where id = g.board_id;
  if v_jumps is null then
    raise exception 'Board not found';
  end if;

  v_roll := floor(random() * 6)::int + 1;
  v_pos  := case when caller_role = 'player1' then g.player1_position else g.player2_position end;
  v_raw  := v_pos + v_roll;
  v_next := case when g.current_turn = 'player1' then 'player2' else 'player1' end;
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

  if caller_role = 'player1' then
    update public.games set
      player1_position = v_new,
      last_roll        = v_roll,
      current_turn     = case when v_winner is not null then current_turn else v_next end,
      winner           = v_winner,
      version          = version + 1
    where id = g.id
    returning * into g;
  else
    update public.games set
      player2_position = v_new,
      last_roll        = v_roll,
      current_turn     = case when v_winner is not null then current_turn else v_next end,
      winner           = v_winner,
      version          = version + 1
    where id = g.id
    returning * into g;
  end if;

  if v_winner is not null then
    update public.rooms set status = 'finished' where id = p_room_id;
  end if;

  return g;
end;
$$;

-- ── create_room: room + player1 + game in one transaction ───────────────────
create or replace function public.create_room(p_player_name text)
returns table(room_id uuid, room_code text, membership_id uuid, assigned_role text, board_id text, game_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_board text;
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

  insert into public.rooms (code, created_by, status)
    values (v_code, v_uid, 'waiting') returning * into v_room;

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
  return next;
end;
$$;

-- ── rematch: reset the same room's game (only after a finished game) ─────────
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

-- ── forfeit: caller concedes; the opponent wins ─────────────────────────────
create or replace function public.forfeit(p_room_id uuid)
returns public.games
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g public.games;
  caller_role text;
  other_role text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select role into caller_role from public.room_players
    where room_id = p_room_id and user_id = auth.uid() limit 1;
  if caller_role is null then raise exception 'You are not a player in this room'; end if;

  select * into g from public.games where room_id = p_room_id for update;
  if g.id is null then raise exception 'Game not found'; end if;
  if g.winner is not null then raise exception 'Game is already over'; end if;

  other_role := case when caller_role = 'player1' then 'player2' else 'player1' end;

  update public.games set winner = other_role, version = version + 1
    where id = g.id returning * into g;
  update public.rooms set status = 'finished' where id = p_room_id;
  return g;
end;
$$;

-- Only signed-in (incl. anonymous) users may call these; never plain anon REST.
revoke all on function public.roll_dice(uuid)   from public;
revoke all on function public.create_room(text) from public;
revoke all on function public.rematch(uuid)     from public;
revoke all on function public.forfeit(uuid)     from public;
grant execute on function public.roll_dice(uuid)   to authenticated;
grant execute on function public.create_room(text) to authenticated;
grant execute on function public.rematch(uuid)     to authenticated;
grant execute on function public.forfeit(uuid)     to authenticated;
