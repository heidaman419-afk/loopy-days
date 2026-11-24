create table if not exists public.ld_records (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  store text not null,
  data jsonb not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  server_seq bigint not null default 0
);
create sequence if not exists public.ld_records_seq;
create index if not exists ld_records_user_seq on public.ld_records (user_id, server_seq);

create or replace function public.ld_records_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id then raise exception 'user_id cannot change'; end if;
    if new.updated_at < old.updated_at then return old; end if;
  end if;
  new.server_seq := nextval('public.ld_records_seq');
  return new;
end $$;

drop trigger if exists ld_records_stamp on public.ld_records;
create trigger ld_records_stamp before insert or update on public.ld_records
  for each row execute function public.ld_records_stamp();

alter table public.ld_records enable row level security;
drop policy if exists "own rows" on public.ld_records;
create policy "own rows" on public.ld_records for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.ld_records from anon;
grant select, insert, update on public.ld_records to authenticated;
grant usage on sequence public.ld_records_seq to authenticated;
