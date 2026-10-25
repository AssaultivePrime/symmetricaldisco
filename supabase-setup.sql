-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
create table if not exists kv (id text primary key, data jsonb not null);
alter table kv enable row level security;   -- no public policies: only the server (service key) can read/write

-- Public bucket for uploaded images/audio (visitors load them straight from here)
insert into storage.buckets (id, name, public) values ('assets', 'assets', true)
on conflict (id) do update set public = true;
