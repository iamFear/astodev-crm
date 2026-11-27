import * as data from '../data.js';

const root = () => document.getElementById('auth-root');

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  kids.flat().forEach((c) => c != null && e.append(c));
  return e;
}

function field(id, label, type, extra = {}) {
  return el('div', { class: 'field' },
    el('label', { for: id, text: label }),
    el('input', { class: 'in', id, type, required: true, ...extra }));
}

function card(...kids) {
  const r = root();
  r.textContent = '';
  r.hidden = false;
  r.append(el('div', { class: 'auth-card' },
    el('h1', { class: 'brand' }, 'Astodev ', el('span', { text: 'CRM' })),
    ...kids));
}

function setMsg(node, text, kind) {
  node.textContent = text || '';
  node.className = 'auth-msg' + (kind ? ' ' + kind : '');
}

function errText(e) {
  const m = (e && e.message) || '';
  if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/email not confirmed/i.test(m)) return 'Primero confirma tu correo con el enlace que te enviamos.';
  if (/already registered/i.test(m)) return 'Ese correo ya tiene una cuenta. Inicia sesión.';
  if (/password should be at least/i.test(m)) return 'La contraseña es demasiado corta (mínimo 6 caracteres).';
  if (/rate limit/i.test(m)) return 'Demasiados intentos. Espera un momento e inténtalo de nuevo.';
  return m || 'Ocurrió un error. Inténtalo de nuevo.';
}

export function hideAuth() { root().hidden = true; root().textContent = ''; }

export function showConfigError() {
  card(el('h2', { text: 'Falta la configuración' }),
    el('p', { text: 'Define VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en las variables de entorno y vuelve a compilar.' }));
}

/** mode: 'login' | 'signup' | 'forgot'; initialMsg: {text, kind} */
export function showLogin(mode = 'login', initialMsg) {
  const signup = mode === 'signup', forgot = mode === 'forgot';
  const msg = el('div', { class: 'auth-msg', role: 'status', 'aria-live': 'polite' });
  const email = field('a-email', 'Correo', 'email', { autocomplete: 'email' });
  const pass = forgot ? null : field('a-pass', 'Contraseña', 'password',
    { autocomplete: signup ? 'new-password' : 'current-password', minlength: signup ? 6 : null });
  const submit = el('button', { class: 'btn primary', type: 'submit', text: forgot ? 'Enviar enlace' : signup ? 'Crear cuenta' : 'Entrar' });
  const form = el('form', { novalidate: true }, email, pass, submit, msg);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const em = email.querySelector('input').value.trim();
    const pw = pass ? pass.querySelector('input').value : '';
    if (!em || (!forgot && !pw)) { setMsg(msg, 'Completa los campos.', 'err'); return; }
    if (signup && pw.length < 6) { setMsg(msg, 'La contraseña debe tener al menos 6 caracteres.', 'err'); return; }
    submit.disabled = true;
    setMsg(msg, 'Un momento…');
    try {
      if (forgot) {
        const { error } = await data.resetPassword(em);
        if (error) throw error;
        setMsg(msg, 'Si el correo existe, te enviamos un enlace para cambiar la contraseña.', 'ok');
      } else if (signup) {
        const { data: d, error } = await data.signUp(em, pw);
        if (error) throw error;
        if (d.session) return; // confirmación de correo desactivada: onAuthChange continúa
        setMsg(msg, 'Revisa tu correo y confirma tu cuenta con el enlace. Luego inicia sesión.', 'ok');
      } else {
        const { error } = await data.signIn(em, pw);
        if (error) throw error;
        return; // onAuthChange continúa
      }
    } catch (e) {
      setMsg(msg, errText(e), 'err');
    }
    submit.disabled = false;
  });

  const go = (m) => showLogin(m);
  const link = (text, m) => { const b = el('button', { class: 'link-btn', type: 'button', text }); b.addEventListener('click', () => go(m)); return b; };
  const links = forgot
    ? [link('Volver a iniciar sesión', 'login')]
    : [link(signup ? 'Ya tengo cuenta' : 'Crear cuenta', signup ? 'login' : 'signup'), signup ? null : link('Olvidé mi contraseña', 'forgot')];

  card(
    el('h2', { text: forgot ? 'Recuperar contraseña' : signup ? 'Crear cuenta' : 'Iniciar sesión' }),
    el('p', { text: forgot ? 'Te enviaremos un enlace para elegir una nueva contraseña.' : 'Accede a tu CRM de prospección.' }),
    form,
    el('div', { class: 'auth-links' }, links));
  if (initialMsg) setMsg(msg, initialMsg.text, initialMsg.kind);
  email.querySelector('input').focus();
}

export function showRecovery() {
  const msg = el('div', { class: 'auth-msg', role: 'status', 'aria-live': 'polite' });
  const pass = field('a-newpass', 'Nueva contraseña', 'password', { autocomplete: 'new-password', minlength: 6 });
  const pass2 = field('a-newpass2', 'Repite la contraseña', 'password', { autocomplete: 'new-password', minlength: 6 });
  const submit = el('button', { class: 'btn primary', type: 'submit', text: 'Guardar contraseña' });
  const form = el('form', { novalidate: true }, pass, pass2, submit, msg);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const a = pass.querySelector('input').value, b = pass2.querySelector('input').value;
    if (a.length < 6) { setMsg(msg, 'La contraseña debe tener al menos 6 caracteres.', 'err'); return; }
    if (a !== b) { setMsg(msg, 'Las contraseñas no coinciden.', 'err'); return; }
    submit.disabled = true;
    setMsg(msg, 'Guardando…');
    const { error } = await data.updatePassword(a);
    if (error) { setMsg(msg, errText(error), 'err'); submit.disabled = false; return; }
    setMsg(msg, 'Contraseña actualizada.', 'ok');
    setTimeout(() => window.dispatchEvent(new CustomEvent('crm:recovered')), 600);
  });
  card(el('h2', { text: 'Nueva contraseña' }), el('p', { text: 'Elige una contraseña nueva para tu cuenta.' }), form);
  pass.querySelector('input').focus();
}

export function showNoAccess(user) {
  const copy = el('button', { class: 'btn', type: 'button', text: 'Copiar' });
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(user.id); copy.textContent = 'Copiado'; }
    catch (e) {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('a-uid'));
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
      copy.textContent = 'Selecciona y copia';
    }
    setTimeout(() => { copy.textContent = 'Copiar'; }, 2000);
  });
  const out = el('button', { class: 'btn ghost', type: 'button', text: 'Cerrar sesión' });
  out.addEventListener('click', () => data.signOut());
  card(
    el('h2', { text: 'Sin acceso todavía' }),
    el('p', { text: 'Tu cuenta aún no tiene acceso. Pídele al administrador que la habilite.' }),
    el('p', { text: 'Tu identificador de usuario (compártelo con el administrador):' }),
    el('div', { class: 'uid-row' }, el('code', { id: 'a-uid', text: user.id }), copy),
    out);
}

export function showLoading() {
  card(el('p', { text: 'Cargando…' }));
}

export function showFatal(text) {
  const retry = el('button', { class: 'btn', type: 'button', text: 'Reintentar' });
  retry.addEventListener('click', () => window.location.reload());
  card(el('h2', { text: 'No se pudo conectar' }), el('p', { text: text }), retry);
}
