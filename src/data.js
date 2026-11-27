// Toda la comunicación con Supabase vive aquí.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const configured = Boolean(url && key);

export const supabase = createClient(url || 'http://localhost:54321', key || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

/* ---------- auth ---------- */
export const getSession = () => supabase.auth.getSession().then((r) => r.data.session);
export const onAuthChange = (cb) => supabase.auth.onAuthStateChange((event, session) => cb(event, session));
export const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password });
export const signUp = (email, password) =>
  supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
export const resetPassword = (email) =>
  supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
export const updatePassword = (password) => supabase.auth.updateUser({ password });
export const signOut = () => supabase.auth.signOut();

/* ---------- acceso (allowlist) ---------- */
// allowed_users solo permite leer la fila propia: si existe, la cuenta está habilitada.
export async function hasAccess(userId) {
  const { data, error } = await supabase
    .from('allowed_users')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/* ---------- mapeo UI <-> DB ---------- */
const DATE_FIELDS = ['proximo_seguimiento', 'ultimo_contacto', 'creado'];
const TEXT_FIELDS = ['categoria', 'barrio', 'telefono', 'web', 'maps_url', 'observacion', 'plan', 'origen'];

function fromRow(r) {
  const o = { ...r };
  DATE_FIELDS.forEach((k) => { if (o[k] == null) o[k] = ''; });
  TEXT_FIELDS.forEach((k) => { if (o[k] == null) o[k] = ''; });
  if (!Array.isArray(o.notas)) o.notas = [];
  return o;
}

function toRow(p) {
  const o = { ...p };
  DATE_FIELDS.forEach((k) => { if (k in o && o[k] === '') o[k] = null; });
  delete o.actualizado; // lo fija el trigger
  Object.keys(o).forEach((k) => { if (o[k] === undefined) delete o[k]; });
  return o;
}

function check({ data, error }) {
  if (error) throw error;
  return data;
}

/* ---------- leads ---------- */
export async function fetchLeads() {
  // PostgREST limita a 1000 filas por defecto: paginamos.
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = check(await supabase.from('leads').select('*').order('id').range(from, from + 999));
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows.map(fromRow);
}

export async function updateLead(id, patch) {
  check(await supabase.from('leads').update(toRow(patch)).eq('id', id).select('id').single());
}

export async function insertLead(doc) {
  check(await supabase.from('leads').insert(toRow(doc)).select('id').single());
}

/* ---------- plantillas ---------- */
export async function fetchPlantillas() {
  return check(await supabase.from('plantillas').select('*').eq('id', 'default').maybeSingle());
}

export async function saveTpl(tpl) {
  check(await supabase.from('plantillas').upsert({ id: 'default', ...tpl }).select('id').single());
}

/* ---------- realtime (opcional; si falla, quedan refetch al enfocar) ---------- */
export function subscribeLeads(onChange) {
  return supabase
    .channel('leads-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => onChange())
    .subscribe();
}
