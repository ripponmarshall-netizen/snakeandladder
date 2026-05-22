-- Server-authoritative power-ups for online mode. A room can be created with
-- power-ups enabled; the game then carries `power_state` (hidden tiles, per-role
-- inventory/shield/frozen) and `last_power_event` (an array of events the client
-- replays for FX). roll_dice takes the armed power-up id and resolves everything
-- server-side.
--
-- IMPORTANT: this MIRRORS the offline rules in localGame.js (stepRoll/applyMystery)
-- and gameLogic.js (resolveMoveWithPowerUps). Keep them in sync: power-up ids,
-- inventory cap (2), tile counts (6 power / 3 mystery), and the MYSTERY outcome
-- order ['advance','retreat','grant','extra'].

-- ── Schema ──────────────────────────────────────────────────────────────────
alter table public.rooms add column if not exists power_ups boolean not null default false;
alter table public.games add column if not exists power_state jsonb not null default '{}'::jsonb;
alter table public.games add column if not exists last_power_event jsonb;

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- Remove the first occurrence of `val` from a jsonb string array.
create or replace function public._pu_remove_one(arr jsonb, val text)
returns jsonb
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  result jsonb := '[]'::jsonb;
  elem text;
  removed boolean := false;
begin
  for elem in select jsonb_array_elements_text(coalesce(arr, '[]'::jsonb)) loop
    if not removed and elem = val then
      removed := true;
    else
      result := result || to_jsonb(elem);
    end if;
  end loop;
  return result;
end;
$$;

-- Generate hidden tiles: `p_power` power tiles + `p_mystery` mystery tiles,
-- avoiding 1, 100 and every snake/ladder endpoint (mirrors generateSpecialTiles).
create or replace function public._pu_gen_tiles(p_jumps jsonb, p_power int, p_mystery int)
returns jsonb
language plpgsql
volatile
set search_path to 'public'
as $$
declare
  used int[] := array[1, 100];
  k text;
  tiles jsonb := '{}'::jsonb;
  sq int;
  guard int := 0;
  placed int := 0;
  total int := p_power + p_mystery;
  kind text;
begin
  for k in select jsonb_object_keys(coalesce(p_jumps, '{}'::jsonb)) loop
    used := used || k::int;
    used := used || (p_jumps ->> k)::int;
  end loop;
  while placed < total and guard < 4000 loop
    guard := guard + 1;
    sq := 2 + floor(random() * 97)::int; -- 2..98
    if sq = any(used) or tiles ? sq::text then continue; end if;
    kind := case when placed < p_power then 'power' else 'mystery' end;
    tiles := jsonb_set(tiles, array[sq::text], to_jsonb(kind), true);
    placed := placed + 1;
  end loop;
  return tiles;
end;
$$;

-- ── create_room: optional power-ups ─────────────────────────────────────────
drop function if exists public.create_room(text, int);
create or replace function public.create_room(p_player_name text, p_max_players int default 2, p_power_ups boolean default false)
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
  v_jumps jsonb;
  v_state jsonb := '{}'::jsonb;
  i int;
  attempt int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
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
  if v_code is null then raise exception 'Could not allocate a unique room code'; end if;

  select id into v_board from public.boards order by random() limit 1;
  if v_board is null then raise exception 'No boards configured'; end if;

  insert into public.rooms (code, created_by, status, max_players, power_ups)
    values (v_code, v_uid, 'waiting', v_max, coalesce(p_power_ups, false)) returning * into v_room;

  insert into public.room_players (room_id, user_id, player_name, role)
    values (v_room.id, v_uid, trim(p_player_name), 'player1') returning * into v_player;

  if coalesce(p_power_ups, false) then
    select jumps into v_jumps from public.boards where id = v_board;
    v_state := jsonb_build_object(
      'tiles', public._pu_gen_tiles(v_jumps, 6, 3),
      'inventory', jsonb_build_object('player1', '[]'::jsonb, 'player2', '[]'::jsonb, 'player3', '[]'::jsonb, 'player4', '[]'::jsonb),
      'shield', jsonb_build_object('player1', false, 'player2', false, 'player3', false, 'player4', false),
      'frozen', jsonb_build_object('player1', false, 'player2', false, 'player3', false, 'player4', false)
    );
  end if;

  insert into public.games (room_id, board_id, current_turn, player1_position, player2_position, power_state)
    values (v_room.id, v_board, 'player1', 0, 0, v_state) returning * into v_game;

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

-- ── roll_dice: full power-up resolution (mirrors localGame.stepRoll) ─────────
drop function if exists public.roll_dice(uuid);
create or replace function public.roll_dice(p_room_id uuid, p_power_up text default null)
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
  v_power_ups boolean;
  v_jumps jsonb;
  v_state jsonb;
  v_inv jsonb;
  v_roll int;
  v_eff int;
  v_pos int;
  v_raw int;
  v_dest int;
  v_new int;
  v_landsq int;
  v_shield boolean;
  v_used_swap boolean := false;
  v_extra boolean := false;
  v_swap boolean := false;
  v_winner text;
  v_roles text[];
  v_idx int;
  v_n int;
  v_k int;
  v_cand text;
  v_next text;
  v_leader text;
  v_leadpos int;
  v_leader_pos int;
  v_caller_final int;
  v_leader_final int;
  v_target text;
  v_tile text;
  v_grant text;
  v_mkind text;
  v_events jsonb := '[]'::jsonb;
  v_p1 int; v_p2 int; v_p3 int; v_p4 int;
  r text;
  rp_pos int;
  pool text[] := array['shield', 'doubleRoll', 'swap', 'extraRoll', 'freeze'];
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into g from public.games where room_id = p_room_id for update;
  if g.id is null then raise exception 'Game not found'; end if;
  if g.winner is not null then raise exception 'Game is already over'; end if;

  select role into caller_role from public.room_players
    where room_id = p_room_id and user_id = auth.uid() limit 1;
  if caller_role is null then raise exception 'You are not a player in this room'; end if;

  select max_players, power_ups into v_max, v_power_ups from public.rooms where id = p_room_id;
  select count(*) into player_count from public.room_players where room_id = p_room_id;
  if player_count < v_max then raise exception 'Waiting for players'; end if;
  if caller_role <> g.current_turn then raise exception 'Not your turn'; end if;

  select jumps into v_jumps from public.boards where id = g.board_id;
  if v_jumps is null then raise exception 'Board not found'; end if;

  v_state := coalesce(g.power_state, '{}'::jsonb);
  v_inv := coalesce(v_state -> 'inventory' -> caller_role, '[]'::jsonb);
  v_shield := coalesce((v_state -> 'shield' ->> caller_role)::boolean, false);

  v_roll := floor(random() * 6)::int + 1;
  v_eff := v_roll;
  v_pos := case caller_role
             when 'player1' then g.player1_position
             when 'player2' then g.player2_position
             when 'player3' then g.player3_position
             else g.player4_position
           end;

  -- Active (non-forfeited) roles in seat order.
  select array_agg(rp.role order by rp.role) into v_roles
  from public.room_players rp where rp.room_id = p_room_id and rp.forfeited = false;

  -- Current leader among the other active roles (for swap / freeze).
  v_leader := null; v_leadpos := -1;
  foreach r in array v_roles loop
    if r <> caller_role then
      rp_pos := case r
                  when 'player1' then g.player1_position
                  when 'player2' then g.player2_position
                  when 'player3' then g.player3_position
                  else g.player4_position
                end;
      if rp_pos > v_leadpos then v_leadpos := rp_pos; v_leader := r; end if;
    end if;
  end loop;

  -- Apply the armed power-up (only if enabled and actually held).
  if v_power_ups and p_power_up is not null and (v_inv @> to_jsonb(p_power_up)) then
    if p_power_up = 'doubleRoll' then
      v_eff := v_roll + (floor(random() * 6)::int + 1);
      v_inv := public._pu_remove_one(v_inv, 'doubleRoll');
      v_events := v_events || jsonb_build_object('kind', 'use', 'id', 'doubleRoll', 'role', caller_role, 'total', v_eff);
    elsif p_power_up = 'shield' then
      v_shield := true;
      v_inv := public._pu_remove_one(v_inv, 'shield');
      v_events := v_events || jsonb_build_object('kind', 'use', 'id', 'shield', 'role', caller_role);
    elsif p_power_up = 'swap' then
      v_used_swap := true;
      v_inv := public._pu_remove_one(v_inv, 'swap');
      v_events := v_events || jsonb_build_object('kind', 'use', 'id', 'swap', 'role', caller_role);
    elsif p_power_up = 'extraRoll' then
      v_extra := true;
      v_inv := public._pu_remove_one(v_inv, 'extraRoll');
      v_events := v_events || jsonb_build_object('kind', 'use', 'id', 'extraRoll', 'role', caller_role);
    elsif p_power_up = 'freeze' and v_leader is not null then
      v_target := v_leader;
      v_state := jsonb_set(v_state, array['frozen', v_target], 'true'::jsonb);
      v_inv := public._pu_remove_one(v_inv, 'freeze');
      v_events := v_events || jsonb_build_object('kind', 'use', 'id', 'freeze', 'role', caller_role, 'target', v_target);
    end if;
  end if;

  -- Resolve the move (overshoot bounce, snake/ladder, shield negates next snake).
  v_raw := v_pos + v_eff;
  if v_raw > 100 then
    v_new := v_pos;
  else
    v_dest := (v_jumps ->> (v_raw::text))::int;
    if v_dest is not null and v_dest < v_raw and v_shield then
      v_new := v_raw;
      v_shield := false;
      v_events := v_events || jsonb_build_object('kind', 'shieldBlock', 'role', caller_role, 'at', v_raw);
    else
      v_new := coalesce(v_dest, v_raw);
    end if;
  end if;

  -- Tile effects (not when bounced, not when landing exactly on 100).
  if v_power_ups and v_raw <= 100 and v_new <> 100 then
    v_landsq := v_new;
    v_tile := v_state -> 'tiles' ->> (v_landsq::text);
    if v_tile = 'power' then
      if jsonb_array_length(v_inv) < 2 then
        v_grant := pool[floor(random() * 5)::int + 1];
        v_inv := v_inv || to_jsonb(v_grant);
        v_events := v_events || jsonb_build_object('kind', 'acquire', 'role', caller_role, 'id', v_grant, 'at', v_landsq);
      end if;
    elsif v_tile = 'mystery' then
      v_mkind := (array['advance', 'retreat', 'grant', 'extra'])[floor(random() * 4)::int + 1];
      if v_mkind = 'advance' then
        v_new := least(100, v_new + 4);
      elsif v_mkind = 'retreat' then
        v_new := greatest(0, v_new - 4);
      elsif v_mkind = 'grant' then
        if jsonb_array_length(v_inv) < 2 then
          v_grant := pool[floor(random() * 5)::int + 1];
          v_inv := v_inv || to_jsonb(v_grant);
        end if;
      else
        v_extra := true;
      end if;
      v_events := v_events || jsonb_build_object('kind', 'mystery', 'role', caller_role, 'at', v_landsq, 'outcome', v_mkind, 'to', v_new);
    end if;
  end if;

  -- Swap with the leader (after move/mystery, if not bounced).
  v_caller_final := v_new;
  if v_used_swap and v_raw <= 100 and v_leader is not null then
    v_leader_pos := case v_leader
                      when 'player1' then g.player1_position
                      when 'player2' then g.player2_position
                      when 'player3' then g.player3_position
                      else g.player4_position
                    end;
    v_leader_final := v_new;
    v_caller_final := v_leader_pos;
    v_swap := true;
  end if;

  -- Winner (only the caller's and, on swap, the leader's positions changed).
  v_winner := null;
  if v_caller_final = 100 then
    v_winner := caller_role;
  elsif v_swap and v_leader_final = 100 then
    v_winner := v_leader;
  end if;

  -- Final positions.
  v_p1 := case when caller_role = 'player1' then v_caller_final
               when v_swap and v_leader = 'player1' then v_leader_final
               else g.player1_position end;
  v_p2 := case when caller_role = 'player2' then v_caller_final
               when v_swap and v_leader = 'player2' then v_leader_final
               else g.player2_position end;
  v_p3 := case when caller_role = 'player3' then v_caller_final
               when v_swap and v_leader = 'player3' then v_leader_final
               else g.player3_position end;
  v_p4 := case when caller_role = 'player4' then v_caller_final
               when v_swap and v_leader = 'player4' then v_leader_final
               else g.player4_position end;

  -- Turn advancement: winner/extraRoll keep the turn; else next active role,
  -- skipping (and clearing) frozen roles.
  if v_winner is not null or v_extra then
    v_next := g.current_turn;
  else
    v_n := array_length(v_roles, 1);
    v_idx := array_position(v_roles, g.current_turn);
    if v_idx is null then v_idx := v_n; end if;
    v_next := null;
    for v_k in 1..v_n loop
      v_idx := (v_idx % v_n) + 1;
      v_cand := v_roles[v_idx];
      if coalesce((v_state -> 'frozen' ->> v_cand)::boolean, false) then
        v_state := jsonb_set(v_state, array['frozen', v_cand], 'false'::jsonb);
        v_events := v_events || jsonb_build_object('kind', 'frozenSkip', 'role', v_cand);
      else
        v_next := v_cand;
        exit;
      end if;
    end loop;
    if v_next is null then v_next := g.current_turn; end if;
  end if;

  -- Persist caller inventory + shield back into power_state (paths only exist
  -- when power-ups are enabled; jsonb_set is a no-op otherwise).
  if v_power_ups then
    v_state := jsonb_set(v_state, array['inventory', caller_role], v_inv);
    v_state := jsonb_set(v_state, array['shield', caller_role], to_jsonb(v_shield));
  end if;

  update public.games set
    player1_position = v_p1,
    player2_position = v_p2,
    player3_position = v_p3,
    player4_position = v_p4,
    last_roll        = v_roll,
    current_turn     = case when v_winner is not null then current_turn else v_next end,
    winner           = v_winner,
    power_state      = v_state,
    last_power_event = case when jsonb_array_length(v_events) > 0 then v_events else null end,
    version          = version + 1
  where id = g.id
  returning * into g;

  if v_winner is not null then
    update public.rooms set status = 'finished' where id = p_room_id;
  end if;

  return g;
end;
$$;

-- ── rematch: also reset power-up state (regenerate tiles, clear inventory) ───
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
  v_power_ups boolean;
  v_jumps jsonb;
  v_state jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select role into caller_role from public.room_players
    where room_id = p_room_id and user_id = auth.uid() limit 1;
  if caller_role is null then raise exception 'You are not a player in this room'; end if;

  select * into g from public.games where room_id = p_room_id for update;
  if g.id is null then raise exception 'Game not found'; end if;
  if g.winner is null then raise exception 'Game is not finished yet'; end if;

  select id into v_board from public.boards order by random() limit 1;
  select power_ups into v_power_ups from public.rooms where id = p_room_id;

  if coalesce(v_power_ups, false) then
    select jumps into v_jumps from public.boards where id = coalesce(v_board, g.board_id);
    v_state := jsonb_build_object(
      'tiles', public._pu_gen_tiles(v_jumps, 6, 3),
      'inventory', jsonb_build_object('player1', '[]'::jsonb, 'player2', '[]'::jsonb, 'player3', '[]'::jsonb, 'player4', '[]'::jsonb),
      'shield', jsonb_build_object('player1', false, 'player2', false, 'player3', false, 'player4', false),
      'frozen', jsonb_build_object('player1', false, 'player2', false, 'player3', false, 'player4', false)
    );
  end if;

  update public.games set
    player1_position = 0,
    player2_position = 0,
    player3_position = 0,
    player4_position = 0,
    last_roll        = null,
    winner           = null,
    current_turn     = 'player1',
    board_id         = coalesce(v_board, board_id),
    power_state      = v_state,
    last_power_event = null,
    version          = version + 1
  where id = g.id
  returning * into g;

  update public.rooms set status = 'active' where id = p_room_id;
  return g;
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on function public._pu_remove_one(jsonb, text)        from public, anon;
revoke all on function public._pu_gen_tiles(jsonb, int, int)     from public, anon;
revoke all on function public.create_room(text, int, boolean)    from public, anon;
revoke all on function public.roll_dice(uuid, text)              from public, anon;
revoke all on function public.rematch(uuid)                      from public, anon;
grant execute on function public.create_room(text, int, boolean) to authenticated;
grant execute on function public.roll_dice(uuid, text)           to authenticated;
grant execute on function public.rematch(uuid)                   to authenticated;
