// Lógica pura de acciones rápidas y su deshacer (sin DOM ni red).
export const CLOSED = { cliente: 1, descartado: 1 };
export const DATE_KEYS = ['proximo_seguimiento', 'ultimo_contacto'];

function pad(n) { return (n < 10 ? '0' : '') + n; }
export function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
export function addDays(s, n) {
  var p = s.split('-').map(Number);
  return ymd(new Date(p[0], p[1] - 1, p[2] + n));
}

export function patchFor(kind, l, t) {
  if (kind === 'contactado') return { estado: 'contactado', ultimo_contacto: t, proximo_seguimiento: addDays(t, 3) };
  if (kind === 'respondio') return { estado: 'respondio', ultimo_contacto: t, proximo_seguimiento: addDays(t, 2) };
  if (kind === 'seguimiento') return { seguimientos: (l.seguimientos || 0) + 1, ultimo_contacto: t, proximo_seguimiento: addDays(t, 4) };
  if (kind === 'descartar') return { estado: 'descartado', proximo_seguimiento: '' };
  return {};
}

export function moveToPatch(l, est, t) {
  var p = { estado: est };
  if (est === 'contactado' || est === 'respondio') p = patchFor(est, l, t);
  else if (CLOSED[est]) p.proximo_seguimiento = '';
  else if (est !== 'por_contactar') {
    p.ultimo_contacto = t;
    if (!l.proximo_seguimiento) p.proximo_seguimiento = addDays(t, 3);
  }
  return p;
}

// Valores previos exactos de cada campo que el patch va a tocar.
// Nunca devuelve undefined: fechas vacías -> '' (la capa de datos las envía como null),
// notas -> copia del arreglo previo.
export function undoPatchFor(l, patch) {
  var before = {};
  Object.keys(patch).forEach(function (k) {
    var v = l[k];
    if (k === 'notas') before[k] = Array.isArray(v) ? v.map(function (n) { return Object.assign({}, n); }) : [];
    else if (DATE_KEYS.indexOf(k) >= 0) before[k] = v == null ? '' : v;
    else before[k] = v === undefined ? null : v;
  });
  return before;
}

// Aplica un patch a una copia del lead (como lo dejaría la base de datos).
export function applyPatch(l, patch) {
  var o = Object.assign({}, l);
  Object.keys(patch).forEach(function (k) { o[k] = patch[k]; });
  return o;
}
