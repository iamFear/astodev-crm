# Astodev CRM

CRM de prospección de Astodev: vistas Hoy, Pipeline, Leads y Métricas, ficha de lead, plantillas de mensajes y tema claro/oscuro. Es una app estática (Vite + JavaScript vanilla) con datos y autenticación en Supabase.

## Configuración

1. Crea un proyecto en Supabase y copia la URL y la clave publicable (Project Settings > API).
2. Copia `.env.example` a `.env` y completa:
   ```
   VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```
3. Aplica la migración `supabase/migrations/20261127000000_init.sql` (SQL Editor de Supabase o `supabase db push`).
4. En Authentication > URL Configuration agrega la URL de la app (local y de producción) como Site URL / Redirect URLs. Se usa para confirmar correo y recuperar contraseña.
5. Regístrate en la app con «Crear cuenta», confirma el correo y copia el identificador de usuario que se muestra en la pantalla «Sin acceso todavía».
6. Habilítate en el SQL Editor:
   ```sql
   insert into public.allowed_users (user_id) values ('<uuid>');
   ```
   Solo los usuarios de `allowed_users` pueden leer o escribir leads y plantillas (RLS).

## Datos iniciales (opcional)

`python3 scripts/build_seed_sql.py` lee el seed del vault y genera `supabase/seed.local.sql` (`INSERT ... ON CONFLICT DO NOTHING`). Ejecútalo en el SQL Editor. Ese archivo contiene datos reales y está en `.gitignore`: no lo subas al repositorio.

## Desarrollo

Requiere Node 20 o superior.

```
npm install
npm run dev       # http://localhost:5173
npm run build     # genera dist/
npm run preview   # sirve dist/ en local
```

Los cambios se sincronizan por Realtime (tabla `leads`) y se recargan al volver a enfocar la ventana.

## Despliegue en Vercel

1. Importa el repositorio en Vercel.
2. Framework preset: **Vite** (build `npm run build`, salida `dist`).
3. Agrega las variables de entorno `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`.
4. Despliega y agrega la URL resultante a las Redirect URLs de Supabase.

No hace falta `vercel.json`: la app usa rutas con hash (`#hoy`, `#leads`...).
