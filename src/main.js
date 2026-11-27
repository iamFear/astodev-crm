import './styles.css';
import * as data from './data.js';
import * as auth from './ui/auth.js';
import { startApp } from './ui/app.js';

// Tema antes de pintar (también aplica a la pantalla de login).
try {
  const t = localStorage.getItem('crm.theme');
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
} catch (e) { /* sin storage */ }

const appRoot = document.getElementById('app-root');
let recovering = false;
let currentUser = null;
let resolving = 0;

async function resolve(session) {
  const ticket = ++resolving;
  if (recovering) return;
  if (!session) {
    if (currentUser) { window.location.reload(); return; } // limpia el estado del usuario anterior
    currentUser = null;
    appRoot.hidden = true;
    auth.showLogin('login');
    return;
  }
  // Si es el mismo usuario ya dentro (p. ej. refresco de token), no reiniciar nada.
  if (currentUser && currentUser.id === session.user.id && !appRoot.hidden) return;
  appRoot.hidden = true;
  auth.showLoading();
  try {
    const ok = await data.hasAccess(session.user.id);
    if (ticket !== resolving) return;
    currentUser = session.user;
    if (!ok) { auth.showNoAccess(session.user); return; }
    auth.hideAuth();
    appRoot.hidden = false;
    startApp();
  } catch (e) {
    if (ticket !== resolving) return;
    auth.showFatal('No pudimos comprobar tu acceso. Revisa tu conexión e inténtalo de nuevo.');
  }
}

async function boot() {
  if (!data.configured) { auth.showConfigError(); return; }

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await data.signOut();
    window.location.hash = '';
  });
  window.addEventListener('crm:recovered', async () => {
    recovering = false;
    resolve(await data.getSession());
  });

  data.onAuthChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      recovering = true;
      appRoot.hidden = true;
      auth.showRecovery();
      return;
    }
    if (event === 'SIGNED_OUT') { resolve(null); return; }
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'USER_UPDATED') {
      // Diferido: no llamar a supabase dentro del callback de auth.
      setTimeout(() => resolve(session), 0);
    }
  });
}

boot();
