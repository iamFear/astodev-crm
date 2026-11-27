-- Astodev CRM: esquema inicial.
-- Acceso: solo usuarios autenticados que estén en public.allowed_users.
-- Para habilitar a alguien (como admin, en el SQL Editor):
--   insert into public.allowed_users (user_id) values ('<uuid>');

-- ---------- allowlist ----------
create table public.allowed_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz default now()
);

create or replace function public.is_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.allowed_users where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_allowed() from public, anon;
grant execute on function public.is_allowed() to authenticated;

-- ---------- leads ----------
create table public.leads (
  id text primary key,
  nombre text not null,
  segmento text not null check (segmento in ('salud_estetica', 'arquitectura_ingenieria', 'otro')),
  prioridad smallint,
  categoria text default '',
  barrio text default '',
  telefono text default '',
  web text default '',
  rating numeric,
  resenas integer,
  maps_url text default '',
  observacion text default '',
  estado text not null default 'por_contactar'
    check (estado in ('por_contactar', 'contactado', 'respondio', 'diagnostico', 'llamada', 'propuesta', 'cliente', 'descartado')),
  proximo_seguimiento date,
  ultimo_contacto date,
  seguimientos integer not null default 0,
  lote integer,
  valor bigint,
  plan text default '',
  origen text default 'manual',
  notas jsonb not null default '[]',
  creado date default current_date,
  actualizado timestamptz not null default now()
);

create index leads_estado_idx on public.leads (estado);
create index leads_proximo_seguimiento_idx on public.leads (proximo_seguimiento);

-- ---------- plantillas ----------
create table public.plantillas (
  id text primary key default 'default',
  msg1 text,
  msg2_salud text,
  msg2_arq text,
  seguimiento text,
  cierre text,
  actualizado timestamptz default now()
);

-- ---------- actualizado = now() ----------
create or replace function public.set_actualizado()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado = now();
  return new;
end;
$$;

create trigger leads_set_actualizado
  before update on public.leads
  for each row execute function public.set_actualizado();

create trigger plantillas_set_actualizado
  before update on public.plantillas
  for each row execute function public.set_actualizado();

-- ---------- RLS ----------
alter table public.allowed_users enable row level security;
alter table public.leads enable row level security;
alter table public.plantillas enable row level security;

-- allowed_users: cada quien ve solo su fila; sin escritura desde la API.
create policy "allowed_users: leer fila propia"
  on public.allowed_users for select to authenticated
  using (user_id = (select auth.uid()));

-- leads
create policy "leads: select" on public.leads for select to authenticated
  using (public.is_allowed());
create policy "leads: insert" on public.leads for insert to authenticated
  with check (public.is_allowed());
create policy "leads: update" on public.leads for update to authenticated
  using (public.is_allowed()) with check (public.is_allowed());
create policy "leads: delete" on public.leads for delete to authenticated
  using (public.is_allowed());

-- plantillas
create policy "plantillas: select" on public.plantillas for select to authenticated
  using (public.is_allowed());
create policy "plantillas: insert" on public.plantillas for insert to authenticated
  with check (public.is_allowed());
create policy "plantillas: update" on public.plantillas for update to authenticated
  using (public.is_allowed()) with check (public.is_allowed());
create policy "plantillas: delete" on public.plantillas for delete to authenticated
  using (public.is_allowed());

-- ---------- privilegios ----------
revoke all on public.allowed_users from anon;
revoke all on public.leads from anon;
revoke all on public.plantillas from anon;

-- authenticated: allowed_users solo lectura; el resto lo filtra RLS.
revoke all on public.allowed_users from authenticated;
grant select on public.allowed_users to authenticated;
grant select, insert, update, delete on public.leads to authenticated;
grant select, insert, update, delete on public.plantillas to authenticated;

-- ---------- realtime (la app escucha cambios en leads) ----------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leads'
  ) then
    alter publication supabase_realtime add table public.leads;
  end if;
end;
$$;
