-- Endurece privilegios: solo lo necesario para el CRM.
-- authenticated conserva select/insert/update/delete en leads y plantillas
-- y select en allowed_users (ver 20261127000000_init.sql).

revoke truncate, references, trigger on public.leads, public.plantillas from authenticated;

revoke all on public.leads, public.plantillas, public.allowed_users from anon;
