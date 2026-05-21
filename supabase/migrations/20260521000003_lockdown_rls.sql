-- Anti-cheat lockdown. Before this, any signed-in player could write arbitrary
-- game state ("room players can update games" etc.). All writes now go through
-- the SECURITY DEFINER RPCs, which bypass RLS, so we drop every client write
-- policy and keep only SELECT (reads + realtime). Game state is not secret —
-- both positions are shown in the UI — so reads stay open to signed-in players.

-- games: remove ALL direct write paths (the core fix).
drop policy if exists "anon can insert any games"     on public.games;
drop policy if exists "room creators can create games" on public.games;
drop policy if exists "room creators can update games" on public.games;
drop policy if exists "room players can update games"  on public.games;

-- rooms: creation/status changes happen inside RPCs now.
drop policy if exists "anon can update rooms"               on public.rooms;
drop policy if exists "room creators can update their rooms" on public.rooms;
drop policy if exists "users can create their own rooms"     on public.rooms;

-- room_players: joining happens inside create_room / join_room_by_code RPCs,
-- which also assign the role server-side (clients can no longer pick a role).
drop policy if exists "users can insert their own room membership" on public.room_players;

-- Tidy up function execution grants flagged by the security advisor.
revoke all on function public.join_room_by_code(text, text) from public, anon;
grant execute on function public.join_room_by_code(text, text) to authenticated;
revoke all on function public.games_realtime_broadcast_trigger() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
