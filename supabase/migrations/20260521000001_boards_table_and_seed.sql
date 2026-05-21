-- Canonical board data, owned by the server so the move RPC can resolve
-- snakes/ladders without trusting anything the client sends. This mirrors
-- boards.js (which the client keeps only for rendering); gameLogic.test.js
-- asserts the two copies stay in sync.

create table if not exists public.boards (
  id text primary key,
  name text not null,
  jumps jsonb not null
);

-- RLS is enabled (an event trigger auto-enables it anyway). No client policy:
-- only the SECURITY DEFINER move RPCs read this table, and they bypass RLS.
alter table public.boards enable row level security;

insert into public.boards (id, name, jumps) values
  ('board-1', 'Classic Rise',    '{"3":22,"5":14,"11":26,"20":29,"27":46,"36":55,"43":77,"50":91,"17":4,"19":7,"21":9,"32":14,"54":34,"62":18,"64":60,"87":24,"95":75,"99":78}'::jsonb),
  ('board-2', 'Steep Climb',     '{"2":21,"8":30,"15":44,"28":47,"39":58,"51":72,"61":82,"70":92,"16":6,"24":10,"33":12,"49":31,"56":36,"68":48,"88":67,"97":76}'::jsonb),
  ('board-3', 'Tight Turns',     '{"4":23,"9":31,"18":37,"25":44,"40":59,"53":74,"66":85,"71":93,"14":5,"22":11,"35":16,"48":27,"57":38,"69":50,"84":63,"96":79}'::jsonb),
  ('board-4', 'Long Fall',       '{"6":24,"13":34,"19":40,"26":45,"38":57,"47":68,"58":79,"73":94,"17":3,"29":8,"41":20,"55":35,"64":42,"76":54,"89":70,"98":81}'::jsonb),
  ('board-5', 'Balanced Chaos',  '{"7":27,"12":33,"23":42,"31":52,"46":67,"59":80,"63":86,"72":95,"16":4,"28":9,"37":18,"49":30,"56":35,"74":53,"88":69,"97":83}'::jsonb)
on conflict (id) do update set name = excluded.name, jumps = excluded.jumps;
