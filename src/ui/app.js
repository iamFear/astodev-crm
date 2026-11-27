import * as data from '../data.js';

let started = false;

export function startApp() {
  if (started) return;
  started = true;

  /* ---------- constants ---------- */
  var ESTADOS = ['por_contactar', 'contactado', 'respondio', 'diagnostico', 'llamada', 'propuesta', 'cliente', 'descartado'];
  var ESTADO_LABEL = { por_contactar: 'Por contactar', contactado: 'Contactado', respondio: 'Respondió', diagnostico: 'Diagnóstico', llamada: 'Llamada', propuesta: 'Propuesta', cliente: 'Cliente', descartado: 'Descartado' };
  var SEG_LABEL = { salud_estetica: 'Salud y estética', arquitectura_ingenieria: 'Arq. e ingeniería', otro: 'Otro' };
  var CLOSED = { cliente: 1, descartado: 1 };
  var DEFAULT_TPL = {
    msg1: 'Hola, buenos días. ¿Este es el WhatsApp de {nombre}?',
    msg2_salud: 'Gracias. Soy Daniel, de Astodev, en Medellín. Ayudamos a clínicas a que ningún paciente que escribe se quede sin respuesta.\n\nVi que {observacion} Les quería hacer una pregunta corta: cuando alguien nuevo escribe fuera de horario o en un momento de mucho trabajo, ¿cuánto suelen tardar en responderle?',
    msg2_arq: 'Mucho gusto, soy Daniel, de Astodev, en Medellín. Ayudamos a empresas a conseguir clientes a través de su web y su perfil de Google.\n\nVi que {observacion} ¿Hoy tienen alguna forma de saber cuántos clientes les llegan por la web o por Google?',
    seguimiento: 'Hola de nuevo. Les escribo solo para saber si vieron mi pregunta. Si no es el momento, me dicen sin problema.',
    cierre: 'Entiendo que debe ser una época de mucho trabajo. Les dejo mi contacto por si más adelante quieren revisar cómo atienden a quienes les escriben. ¡Éxitos!'
  };
  var TPL_META = [
    ['msg1', 'Mensaje 1 (saludo)'],
    ['msg2_salud', 'Mensaje 2, salud y estética'],
    ['msg2_arq', 'Mensaje 2, arquitectura e ingeniería'],
    ['seguimiento', 'Seguimiento'],
    ['cierre', 'Cierre']
  ];
  var MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  /* ---------- state ---------- */
  var S = {
    db: null,
    status: 'loading', // loading | ready | nodb
    leadsLoaded: false,
    fresh: false,
    timedOut: false,
    error: '',
    leads: [],
    byId: new Map(),
    tpl: Object.assign({}, DEFAULT_TPL),
    tplExists: false,
    filters: { q: '', seg: '', est: '', pri: '', lote: '' },
    sort: { k: 'nombre', dir: 1 },
    nuevosN: 10,
    route: 'hoy'
  };
  var D = null; // open drawer: {kind:'lead'|'new'|'tpl', id, orig, dirty confirm}
  var timeoutId = 0;
  var queues = new Map();

  try { var n0 = parseInt(localStorage.getItem('crm.nuevosN'), 10); if ([5, 10, 20].indexOf(n0) >= 0) S.nuevosN = n0; } catch (e) {}

  /* ---------- helpers ---------- */
  var $ = function (id) { return document.getElementById(id); };

  function h(tag, attrs) {
    var e = document.createElement(tag);
    var after = null;
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'value') after = v;
        else e.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (var i = 2; i < arguments.length; i++) append(e, arguments[i]);
    if (after !== null) e.value = after;
    return e;
  }
  function append(e, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(e, x); }); return; }
    e.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return ymd(new Date()); }
  function addDays(s, n) {
    var p = s.split('-').map(Number);
    return ymd(new Date(p[0], p[1] - 1, p[2] + n));
  }
  function dayDiff(a, b) { // days from a to b
    var pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  }
  function fmtDate(s) {
    if (!s) return '';
    var p = s.split('-');
    return p.length === 3 ? parseInt(p[2], 10) + ' ' + MONTHS[parseInt(p[1], 10) - 1] : s;
  }
  var cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  function fmtCOP(n) { return cop.format(n || 0); }
  function fmtRating(r) { return r == null ? '' : Number(r).toFixed(1).replace('.', ','); }
  function isHttps(u) { return typeof u === 'string' && /^https:\/\//i.test(u); }
  function digits(t) { return String(t || '').replace(/\D/g, ''); }
  function same(a, b) { return JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b); }

  /* ---------- templates ---------- */
  function obsText(l) {
    var o = String(l.observacion || '').trim();
    if (!o) return '';
    if (/^\d/.test(o)) o = 'tienen ' + o;
    else if (/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]/.test(o)) o = o.charAt(0).toLowerCase() + o.slice(1);
    if (!/[.!?…]$/.test(o)) o += '.';
    return o;
  }
  function fillTpl(t, l) {
    var o = obsText(l), s = String(t || '');
    if (!o) s = s.replace(/Vi que \{observacion\}\s*/g, '');
    return s.replace(/\{nombre\}/g, function () { return l.nombre || ''; }).replace(/\{observacion\}/g, function () { return o; });
  }
  function msg2Key(l) { return l.segmento === 'salud_estetica' ? 'msg2_salud' : 'msg2_arq'; }
  function waText(l) {
    if (l.estado === 'por_contactar') return fillTpl(S.tpl.msg1, l);
    if (l.estado === 'contactado') return fillTpl(S.tpl.seguimiento, l);
    return '';
  }
  function waUrl(l, text) {
    var d = digits(l.telefono);
    if (!d) return '';
    return 'https://wa.me/' + d + (text ? '?text=' + encodeURIComponent(text) : '');
  }
  function mapsUrl(l) {
    if (isHttps(l.maps_url)) return l.maps_url;
    if (!l.nombre) return '';
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(l.nombre + (l.barrio ? ' ' + l.barrio : '') + ' Medellín');
  }

  /* ---------- toasts / copy ---------- */
  function toast(msg, opts) {
    opts = opts || {};
    var t = h('div', { class: 'toast' + (opts.err ? ' err' : '') }, h('span', { text: msg }));
    var timer;
    var kill = function () { clearTimeout(timer); if (t.parentNode) t.parentNode.removeChild(t); };
    if (opts.action) {
      t.appendChild(h('button', { type: 'button', text: opts.action.label }));
      t.lastChild.addEventListener('click', function () { kill(); opts.action.fn(); });
    }
    $('toasts').appendChild(t);
    timer = setTimeout(kill, opts.action ? 9000 : 3500);
  }
  function copyText(text, okMsg) {
    var ok = function () { toast(okMsg || 'Copiado'); };
    try {
      navigator.clipboard.writeText(text).then(ok, function () { showFallback(text); });
    } catch (e) { showFallback(text); }
  }
  function showFallback(text) {
    var box = $('fallback');
    box.hidden = false;
    box.textContent = '';
    var ta = h('textarea', { class: 'in', id: 'fallback-text', rows: 5, readonly: true });
    ta.value = text;
    var close = h('button', { class: 'btn sm', id: 'fallback-close', type: 'button', text: 'Cerrar' });
    close.addEventListener('click', function () { box.hidden = true; });
    box.appendChild(h('div', { class: 'dim', text: 'No se pudo copiar solo. El texto quedó seleccionado: cópialo con Ctrl+C o Cmd+C.' }));
    box.appendChild(ta);
    box.appendChild(close);
    ta.focus();
    ta.select();
  }

  /* ---------- data writes ---------- */
  function saveLead(id, patch) {
    var cur = S.byId.get(id);
    if (!S.db || !cur) return Promise.resolve(false);
    var changed = {}, any = false;
    Object.keys(patch).forEach(function (k) { if (!same(cur[k], patch[k])) { changed[k] = patch[k]; any = true; } });
    if (!any) return Promise.resolve(false);
    changed.actualizado = new Date().toISOString();
    var prev = queues.get(id) || Promise.resolve();
    var next = prev.then(function () { return data.updateLead(id, changed); }).then(function () { return true; });
    queues.set(id, next.catch(function () {}));
    return next;
  }
  function failMsg(e) {
    var c = e && e.code;
    if (c === '42501') return 'Tu cuenta no tiene permiso para guardar cambios.';
    if (c === 'PGRST301' || c === 'PGRST303' || (e && e.status === 401)) return 'Tu sesión expiró. Recarga e inicia sesión de nuevo.';
    return 'No se pudo guardar' + (c ? ' (' + c + ')' : '') + '.';
  }
  function quick(id, patch, msg) {
    var cur = S.byId.get(id);
    if (!cur) return;
    var before = {};
    Object.keys(patch).forEach(function (k) { before[k] = cur[k] === undefined ? '' : cur[k]; });
    saveLead(id, patch).then(function (done) {
      if (done) toast(msg, { action: { label: 'Deshacer', fn: function () { saveLead(id, before).catch(function (e) { toast(failMsg(e), { err: true }); }); } } });
    }).catch(function (e) { toast(failMsg(e), { err: true }); });
  }
  function patchFor(kind, l) {
    var t = today();
    if (kind === 'contactado') return { estado: 'contactado', ultimo_contacto: t, proximo_seguimiento: addDays(t, 3) };
    if (kind === 'respondio') return { estado: 'respondio', ultimo_contacto: t, proximo_seguimiento: addDays(t, 2) };
    if (kind === 'seguimiento') return { seguimientos: (l.seguimientos || 0) + 1, ultimo_contacto: t, proximo_seguimiento: addDays(t, 4) };
    if (kind === 'descartar') return { estado: 'descartado', proximo_seguimiento: '' };
    return {};
  }
  function moveTo(l, est) {
    var t = today(), p = { estado: est };
    if (est === 'contactado' || est === 'respondio') p = patchFor(est, l);
    else if (CLOSED[est]) p.proximo_seguimiento = '';
    else if (est !== 'por_contactar') { p.ultimo_contacto = t; if (!l.proximo_seguimiento) p.proximo_seguimiento = addDays(t, 3); }
    quick(l.id, p, l.nombre + ': ' + ESTADO_LABEL[est]);
  }

  /* ---------- derived ---------- */
  function sortNuevos(a, b) {
    var la = a.lote == null ? 1e9 : a.lote, lb = b.lote == null ? 1e9 : b.lote;
    if (la !== lb) return la - lb;
    if ((a.prioridad || 3) !== (b.prioridad || 3)) return (a.prioridad || 3) - (b.prioridad || 3);
    return (b.resenas || 0) - (a.resenas || 0);
  }
  function dueClass(s) {
    if (!s) return '';
    var t = today();
    return s < t ? 'late' : s === t ? 'today' : 'ok';
  }
  function dueLabel(s) {
    var d = dayDiff(today(), s);
    if (d < 0) return 'vencido hace ' + (-d) + ' d';
    if (d === 0) return 'hoy';
    return 'en ' + d + ' d';
  }

  /* ---------- UI atoms ---------- */
  function segChip(l) {
    var c = l.segmento === 'salud_estetica' ? 'salud' : l.segmento === 'arquitectura_ingenieria' ? 'arq' : '';
    return h('span', { class: 'chip ' + c, text: SEG_LABEL[l.segmento] || 'Otro' });
  }
  function estadoPill(l) { return h('span', { class: 'pill e-' + l.estado, text: ESTADO_LABEL[l.estado] || l.estado }); }
  function prioChip(l) { return h('span', { class: 'chip prio' + l.prioridad, text: 'P' + l.prioridad }); }
  function ratingText(l) {
    var s = [];
    if (l.rating != null) s.push(fmtRating(l.rating) + '★');
    if (l.resenas != null) s.push(l.resenas + ' reseñas');
    return s.join(' · ');
  }
  function btn(label, act, id, cls) {
    return h('button', { type: 'button', class: 'btn sm ' + (cls || ''), 'data-act': act, 'data-id': id, text: label });
  }

  function leadCard(l) {
    var dc = (!CLOSED[l.estado] && l.proximo_seguimiento) ? dueClass(l.proximo_seguimiento) : '';
    var card = h('article', { class: 'card ' + dc });
    var head = h('div', { class: 'card-h' },
      h('button', { type: 'button', class: 'name', 'data-act': 'open', 'data-id': l.id, text: l.nombre }),
      segChip(l), prioChip(l), estadoPill(l));
    var meta = h('div', { class: 'meta' });
    var rt = ratingText(l);
    if (rt) meta.appendChild(h('span', { class: 'mono', text: rt }));
    if (l.barrio) meta.appendChild(h('span', { text: l.barrio }));
    if (l.proximo_seguimiento && !CLOSED[l.estado]) meta.appendChild(h('span', { class: 'due ' + dc, text: 'Seguimiento ' + fmtDate(l.proximo_seguimiento) + ' · ' + dueLabel(l.proximo_seguimiento) }));
    if (l.seguimientos) meta.appendChild(h('span', { class: 'mono', text: l.seguimientos + ' seg. enviados' }));
    card.appendChild(head);
    card.appendChild(meta);
    if (l.observacion) card.appendChild(h('p', { class: 'obs', text: l.observacion }));

    var act = h('div', { class: 'actions' });
    var url = waUrl(l, waText(l));
    if (url) act.appendChild(h('a', { class: 'btn sm primary', href: url, target: '_blank', rel: 'noopener', text: 'Abrir WhatsApp' }));
    else act.appendChild(h('span', { class: 'btn sm', 'aria-disabled': 'true', text: 'Sin teléfono' }));
    act.appendChild(btn('Copiar mensaje 2', 'copy-m2', l.id));
    var over = (l.seguimientos || 0) >= 2;
    if (l.estado === 'por_contactar') {
      act.appendChild(btn('Contactado', 'contactado', l.id, 'teal'));
    } else if (!CLOSED[l.estado]) {
      if (l.estado === 'contactado') act.appendChild(btn('Respondió', 'respondio', l.id, 'teal'));
      if (!over) act.appendChild(btn('Seguimiento enviado', 'seguimiento', l.id));
      else act.appendChild(btn('Cerrar', 'cerrar', l.id, 'danger'));
    }
    if (!CLOSED[l.estado]) act.appendChild(btn('Descartar', 'descartar', l.id, 'ghost'));
    act.appendChild(btn('Detalle', 'open', l.id, 'ghost'));
    card.appendChild(act);
    if (over && !CLOSED[l.estado]) card.appendChild(h('div', { class: 'hint', text: 'Ya van 2 seguimientos sin avance. Sugerencia: cerrar. "Cerrar" copia el mensaje de cierre y descarta el lead.' }));
    return card;
  }

  /* ---------- views ---------- */
  function stateCard() {
    if (S.status === 'nodb') {
      return h('section', { class: 'state-card' },
        h('h2', { text: 'No se pudo abrir la base de datos' }),
        h('p', { text: 'Recarga la página o vuelve a iniciar sesión.' }));
    }
    if (!S.leadsLoaded && (S.timedOut || S.error)) {
      return h('section', { class: 'state-card' },
        h('h2', { text: 'No se pudieron cargar los leads' }),
        h('p', { text: S.error ? 'La base de datos respondió con un error (' + S.error + '). Recarga la página en un momento.' : 'La base de datos no respondió en 10 segundos. Revisa tu conexión; si vuelve, los leads aparecerán solos.' }));
    }
    if (!S.leadsLoaded) {
      return h('section', { class: 'state-card' },
        h('h2', { text: 'Cargando tus leads' }),
        h('p', { text: 'Aquí aparecerán tus seguimientos del día y los prospectos nuevos para contactar.' }),
        h('p', { text: 'Para agregar el primero, ve a Leads y pulsa «Agregar lead».' }),
        h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }));
    }
    return null;
  }
  function emptyLeads() {
    return h('section', { class: 'state-card' },
      h('h2', { text: 'Todavía no hay leads' }),
      h('p', { text: 'Aquí aparecerán tus seguimientos del día y los prospectos nuevos para contactar.' }),
      h('p', { text: 'Agrega el primero desde Leads con «Agregar lead».' }),
      h('a', { class: 'btn primary', id: 'empty-add', href: '#leads', text: 'Ir a Leads' }));
  }
  function bannerStale() {
    if (S.leadsLoaded && S.timedOut && !S.fresh) return h('div', { class: 'banner err', text: 'No se pudo confirmar con la base de datos. Lo que ves puede estar desactualizado.' });
    return null;
  }

  function viewHoy() {
    var t = today();
    var frag = document.createDocumentFragment();
    var late = S.leads.filter(function (l) { return !CLOSED[l.estado] && l.proximo_seguimiento && l.proximo_seguimiento < t; });
    var due = S.leads.filter(function (l) { return !CLOSED[l.estado] && l.proximo_seguimiento && l.proximo_seguimiento <= t; })
      .sort(function (a, b) { return a.proximo_seguimiento < b.proximo_seguimiento ? -1 : a.proximo_seguimiento > b.proximo_seguimiento ? 1 : (a.prioridad || 3) - (b.prioridad || 3); });
    var todayN = due.length - late.length;
    var porC = S.leads.filter(function (l) { return l.estado === 'por_contactar'; });
    var props = S.leads.filter(function (l) { return l.estado === 'propuesta'; });
    var sum = props.reduce(function (a, l) { return a + (l.valor || 0); }, 0);

    frag.appendChild(h('div', { class: 'summary' },
      stat('s-late', late.length, 'seguimientos vencidos'),
      stat('s-today', todayN, 'para hoy'),
      stat('s-new', porC.length, 'nuevos por contactar'),
      stat('s-prop', fmtCOP(sum), 'en ' + props.length + (props.length === 1 ? ' propuesta abierta' : ' propuestas abiertas'))));

    frag.appendChild(h('div', { class: 'sec-h' }, h('h2', { text: 'Seguimientos (' + due.length + ')' })));
    if (!due.length) frag.appendChild(h('div', { class: 'empty' }, h('strong', { text: 'Sin seguimientos pendientes' }), 'Cuando un lead tenga fecha de seguimiento hoy o antes, aparecerá aquí.'));
    else frag.appendChild(h('div', { class: 'list' }, due.map(leadCard)));

    var sel = h('select', { class: 'in', id: 'sel-nuevos', 'aria-label': 'Cantidad de nuevos', style: 'width:auto;min-height:32px;padding:3px 8px', value: String(S.nuevosN) },
      [5, 10, 20].map(function (n) { return h('option', { value: n, text: String(n) }); }));
    sel.value = String(S.nuevosN);
    frag.appendChild(h('div', { class: 'sec-h' },
      h('h2', { text: 'Nuevos para hoy' }),
      h('label', { class: 'ctl', for: 'sel-nuevos' }, 'Mostrar ', sel)));
    var nuevos = porC.slice().sort(sortNuevos).slice(0, S.nuevosN);
    if (!nuevos.length) frag.appendChild(h('div', { class: 'empty' }, h('strong', { text: 'No hay leads por contactar' }), 'Agrega más desde Leads.'));
    else frag.appendChild(h('div', { class: 'list' }, nuevos.map(leadCard)));
    return frag;
  }
  function stat(cls, n, label) {
    return h('div', { class: 'stat ' + cls }, h('div', { class: 'n', text: String(n) }), h('div', { class: 'l', text: label }));
  }

  function viewPipeline() {
    var frag = document.createDocumentFragment();
    var porC = S.leads.filter(function (l) { return l.estado === 'por_contactar'; }).length;
    frag.appendChild(h('div', { class: 'queue-note' },
      h('span', null, h('strong', { class: 'mono', text: String(porC) }), ' por contactar (se trabajan desde Hoy)'),
      h('a', { class: 'btn sm', href: '#leads', text: 'Ver lista' })));
    var board = h('div', { class: 'board', id: 'board', tabindex: '0', 'aria-label': 'Pipeline, desplaza horizontalmente' });
    ESTADOS.slice(1).forEach(function (est) {
      var items = S.leads.filter(function (l) { return l.estado === est; });
      var sum = items.reduce(function (a, l) { return a + (l.valor || 0); }, 0);
      var col = h('section', { class: 'col', 'aria-label': ESTADO_LABEL[est] },
        h('div', { class: 'col-h' }, h('span', { class: 't', text: ESTADO_LABEL[est] }), h('span', { class: 'n', text: String(items.length) })),
        h('div', { class: 'col-sum', text: sum ? fmtCOP(sum) : '' }));
      items.sort(function (a, b) { return (a.proximo_seguimiento || '9') < (b.proximo_seguimiento || '9') ? -1 : 1; });
      items.forEach(function (l) {
        var dc = !CLOSED[l.estado] && l.proximo_seguimiento ? dueClass(l.proximo_seguimiento) : '';
        var sel = h('select', { class: 'in', id: 'mv-' + l.id, 'data-change': 'move', 'data-id': l.id, 'aria-label': 'Mover ' + l.nombre, style: 'min-height:34px;padding:3px 8px;font-size:13px' },
          ESTADOS.map(function (e) { return h('option', { value: e, text: ESTADO_LABEL[e] }); }));
        sel.value = l.estado;
        col.appendChild(h('div', { class: 'mini' },
          h('button', { type: 'button', class: 'name', 'data-act': 'open', 'data-id': l.id, text: l.nombre }),
          h('div', { class: 'row' }, segChip(l), prioChip(l),
            l.valor ? h('span', { class: 'chip', text: fmtCOP(l.valor) }) : null,
            l.proximo_seguimiento && !CLOSED[l.estado] ? h('span', { class: 'due ' + dc, text: fmtDate(l.proximo_seguimiento) }) : null),
          sel));
      });
      if (!items.length) col.appendChild(h('div', { class: 'faint', style: 'font-size:12.5px;padding:4px 2px', text: 'Vacío' }));
      board.appendChild(col);
    });
    frag.appendChild(board);
    return frag;
  }

  var COLS = [
    ['nombre', 'Nombre'], ['segmento', 'Segmento'], ['prioridad', 'Prio'], ['estado', 'Estado'],
    ['lote', 'Lote'], ['resenas', 'Reseñas'], ['proximo_seguimiento', 'Próx. seg.'], ['barrio', 'Barrio']
  ];
  function filteredLeads() {
    var f = S.filters, q = f.q.trim().toLowerCase();
    var r = S.leads.filter(function (l) {
      if (f.seg && l.segmento !== f.seg) return false;
      if (f.est && l.estado !== f.est) return false;
      if (f.pri && String(l.prioridad) !== f.pri) return false;
      if (f.lote === 'none' ? l.lote != null : (f.lote && String(l.lote) !== f.lote)) return false;
      if (q && (l.nombre + ' ' + l.barrio + ' ' + l.categoria).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var k = S.sort.k, dir = S.sort.dir;
    r.sort(function (a, b) {
      var va = a[k], vb = b[k], c;
      if (k === 'estado') { va = ESTADOS.indexOf(va); vb = ESTADOS.indexOf(vb); }
      var ea = va == null || va === '', eb = vb == null || vb === '';
      if (ea || eb) c = ea && eb ? 0 : ea ? 1 : -1; // empties last regardless of direction
      else {
        if (k === 'resenas') c = (vb - va) * -1; else c = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es');
        c *= dir;
      }
      return c || String(a.nombre).localeCompare(String(b.nombre), 'es');
    });
    return r;
  }
  function viewLeads() {
    var frag = document.createDocumentFragment();
    var lotes = [];
    S.leads.forEach(function (l) { if (l.lote != null && lotes.indexOf(l.lote) < 0) lotes.push(l.lote); });
    lotes.sort(function (a, b) { return a - b; });
    function sel(id, label, opts, val) {
      var s = h('select', { class: 'in', id: id, 'data-filter': id }, opts.map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
      s.value = val;
      return h('div', { class: 'field' }, h('label', { for: id, text: label }), s);
    }
    var q = h('input', { class: 'in', id: 'flt-q', type: 'search', placeholder: 'Nombre, barrio o categoría', autocomplete: 'off', 'data-filter': 'flt-q' });
    q.value = S.filters.q;
    frag.appendChild(h('div', { class: 'toolbar' },
      h('div', { class: 'field grow' }, h('label', { for: 'flt-q', text: 'Buscar' }), q),
      sel('flt-seg', 'Segmento', [['', 'Todos']].concat(Object.keys(SEG_LABEL).map(function (k) { return [k, SEG_LABEL[k]]; })), S.filters.seg),
      sel('flt-est', 'Estado', [['', 'Todos']].concat(ESTADOS.map(function (k) { return [k, ESTADO_LABEL[k]]; })), S.filters.est),
      sel('flt-pri', 'Prioridad', [['', 'Todas'], ['1', 'P1'], ['2', 'P2'], ['3', 'P3']], S.filters.pri),
      sel('flt-lote', 'Lote', [['', 'Todos'], ['none', 'Sin lote']].concat(lotes.map(function (n) { return [String(n), 'Lote ' + n]; })), S.filters.lote),
      h('button', { class: 'btn primary', id: 'btn-add', type: 'button', 'data-act': 'new', text: 'Agregar lead' })));
    var rows = filteredLeads();
    frag.appendChild(h('p', { class: 'count mono', text: rows.length + ' de ' + S.leads.length + ' leads' }));
    var thead = h('tr', null, COLS.map(function (c) {
      var on = S.sort.k === c[0];
      var b = h('button', { type: 'button', 'data-sort': c[0], 'aria-label': 'Ordenar por ' + c[1] }, c[1], on ? (S.sort.dir > 0 ? ' ▲' : ' ▼') : '');
      return h('th', { scope: 'col', 'aria-sort': on ? (S.sort.dir > 0 ? 'ascending' : 'descending') : 'none' }, b);
    }));
    var tbody = h('tbody');
    rows.forEach(function (l) {
      var dc = !CLOSED[l.estado] && l.proximo_seguimiento ? dueClass(l.proximo_seguimiento) : '';
      var tr = h('tr', { 'data-row': l.id },
        h('td', { class: 'nm' }, h('button', { type: 'button', 'data-act': 'open', 'data-id': l.id, text: l.nombre })),
        h('td', null, segChip(l)),
        h('td', { class: 'num', text: 'P' + l.prioridad }),
        h('td', null, estadoPill(l)),
        h('td', { class: 'num', text: l.lote != null ? String(l.lote) : '' }),
        h('td', { class: 'num', text: (l.rating != null ? fmtRating(l.rating) + '★ ' : '') + (l.resenas != null ? '(' + l.resenas + ')' : '') }),
        h('td', null, l.proximo_seguimiento && !CLOSED[l.estado] ? h('span', { class: 'due ' + dc, text: fmtDate(l.proximo_seguimiento) }) : ''),
        h('td', { text: l.barrio || '' }));
      tbody.appendChild(tr);
    });
    if (!rows.length) tbody.appendChild(h('tr', null, h('td', { colspan: COLS.length, class: 'dim', text: 'Ningún lead coincide con los filtros.' })));
    frag.appendChild(h('div', { class: 'tbl-wrap' }, h('table', null, h('thead', null, thead), tbody)));
    return frag;
  }

  function funnel(title, list, isTotal) {
    var rank = { por_contactar: 0, contactado: 1, respondio: 2, diagnostico: 3, llamada: 4, propuesta: 5, cliente: 6 };
    function r(l) { return l.estado === 'descartado' ? (l.ultimo_contacto ? 1 : 0) : rank[l.estado]; }
    var steps = [['Contactados', 1], ['Respondieron', 2], ['Diagnóstico', 3], ['Llamada', 4], ['Propuesta', 5], ['Cliente', 6]];
    var counts = steps.map(function (s) { return list.filter(function (l) { return r(l) >= s[1]; }).length; });
    var base = counts[0];
    var box = h('section', { class: 'funnel', 'aria-label': 'Embudo ' + title },
      h('h3', null, h('span', { text: title }), h('span', { class: 'mono faint', text: list.length + ' leads' })));
    steps.forEach(function (s, i) {
      var pct = base ? Math.round(counts[i] / base * 100) : 0;
      var fill = h('i', { class: i === 5 ? 'b' : '' });
      fill.style.width = (base ? counts[i] / base * 100 : 0) + '%';
      box.appendChild(h('div', { class: 'frow' },
        h('span', { class: 'lab', text: s[0] }),
        h('div', { class: 'track', role: 'img', 'aria-label': s[0] + ': ' + counts[i] + ' (' + pct + '%)' }, fill),
        h('span', { class: 'val', text: counts[i] + ' · ' + pct + '%' })));
    });
    return box;
  }
  function viewMetricas() {
    var frag = document.createDocumentFragment();
    var t = today(), from = addDays(t, -6);
    var contacted = S.leads.filter(function (l) { return l.estado !== 'por_contactar' && !(l.estado === 'descartado' && !l.ultimo_contacto); });
    var resp = S.leads.filter(function (l) { return ['respondio', 'diagnostico', 'llamada', 'propuesta', 'cliente'].indexOf(l.estado) >= 0; });
    var rate = contacted.length ? Math.round(resp.length / contacted.length * 100) : 0;
    var last7 = S.leads.filter(function (l) { return l.ultimo_contacto && l.ultimo_contacto >= from && l.ultimo_contacto <= t; }).length;
    var props = S.leads.filter(function (l) { return l.estado === 'propuesta'; });
    var sum = props.reduce(function (a, l) { return a + (l.valor || 0); }, 0);
    var clientes = S.leads.filter(function (l) { return l.estado === 'cliente'; });
    var won = clientes.reduce(function (a, l) { return a + (l.valor || 0); }, 0);
    frag.appendChild(h('div', { class: 'kpis' },
      stat('s-new', rate + '%', 'tasa de respuesta (' + resp.length + ' de ' + contacted.length + ')'),
      stat('s-today', last7, 'contactados en los últimos 7 días'),
      stat('s-prop', fmtCOP(sum), 'en ' + props.length + ' propuestas abiertas'),
      stat('s-new', clientes.length, 'clientes' + (won ? ' · ' + fmtCOP(won) : ''))));
    frag.appendChild(funnel('Todos los segmentos', S.leads, true));
    Object.keys(SEG_LABEL).forEach(function (k) {
      var list = S.leads.filter(function (l) { return l.segmento === k; });
      if (list.length) frag.appendChild(funnel(SEG_LABEL[k], list));
    });
    frag.appendChild(h('p', { class: 'note', text: 'Las cifras salen de los registros de este CRM, no de WhatsApp. Cada barra cuenta los leads que llegaron a esa etapa o a una posterior; el porcentaje es sobre los contactados. Un lead descartado cuenta como contactado si tiene fecha de último contacto, pero no como respondió.' }));
    return frag;
  }

  /* ---------- render ---------- */
  var VIEWS = { hoy: viewHoy, pipeline: viewPipeline, leads: viewLeads, metricas: viewMetricas };
  function render() {
    var ae = document.activeElement, fid = ae && ae.id && $('view').contains(ae) ? ae.id : null;
    var sel = fid && ae.selectionStart != null ? [ae.selectionStart, ae.selectionEnd] : null;
    var scrollX = $('board') ? $('board').scrollLeft : 0;
    ['hoy', 'pipeline', 'leads', 'metricas'].forEach(function (r) {
      var a = $('nav-' + r);
      if (r === S.route) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var view = $('view');
    view.textContent = '';
    var sc = stateCard();
    var b = bannerStale();
    if (b) view.appendChild(b);
    if (sc) view.appendChild(sc);
    else if (!S.leads.length && S.route !== 'leads') view.appendChild(emptyLeads());
    else view.appendChild(VIEWS[S.route]());
    if (S.status === 'ready' && S.leadsLoaded && !S.leads.length && S.route === 'leads') {
      // leads view still shows the empty table plus add button
    }
    if (fid && $(fid)) {
      $(fid).focus();
      if (sel) { try { $(fid).setSelectionRange(sel[0], sel[1]); } catch (e) {} }
    }
    if ($('board')) $('board').scrollLeft = scrollX;
  }

  function route() {
    var r = (location.hash || '').replace('#', '');
    S.route = VIEWS[r] ? r : 'hoy';
    render();
    window.scrollTo(0, 0);
  }

  /* ---------- drawer ---------- */
  var lastFocus = null;
  function openDrawer(kind, id) {
    var l = id ? S.byId.get(id) : null;
    if (kind === 'lead' && !l) return;
    lastFocus = document.activeElement;
    D = { kind: kind, id: id, orig: null, confirming: false };
    $('overlay').hidden = false;
    document.body.style.overflow = 'hidden';
    buildDrawer();
    $('drawer-close').focus();
  }
  function closeDrawer(force) {
    if (!D) return;
    if (!force && isDirty()) { D.confirming = true; showConfirm(); return; }
    D = null;
    $('overlay').hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
  }
  function showConfirm() {
    var b = $('drawer-body');
    var old = $('confirm-bar');
    if (old) old.remove();
    var bar = h('div', { class: 'confirm', id: 'confirm-bar', role: 'alert' },
      h('span', { text: 'Hay cambios sin guardar. ¿Cerrar sin guardar?' }),
      h('button', { class: 'btn sm danger', id: 'confirm-discard', type: 'button', text: 'Cerrar sin guardar' }),
      h('button', { class: 'btn sm', id: 'confirm-keep', type: 'button', text: 'Seguir editando' }));
    b.insertBefore(bar, b.firstChild);
    bar.querySelector('#confirm-discard').addEventListener('click', function () { closeDrawer(true); });
    bar.querySelector('#confirm-keep').addEventListener('click', function () { bar.remove(); D.confirming = false; });
    b.scrollTop = 0;
    $('confirm-keep').focus();
  }

  var FIELDS = [
    ['nombre', 'Nombre', 'text', true],
    ['segmento', 'Segmento', 'select', false, Object.keys(SEG_LABEL).map(function (k) { return [k, SEG_LABEL[k]]; })],
    ['prioridad', 'Prioridad', 'select', false, [['1', 'P1'], ['2', 'P2'], ['3', 'P3']]],
    ['estado', 'Estado', 'select', false, ESTADOS.map(function (k) { return [k, ESTADO_LABEL[k]]; })],
    ['categoria', 'Categoría', 'text'],
    ['barrio', 'Barrio', 'text'],
    ['telefono', 'Teléfono', 'tel', true],
    ['web', 'Web', 'text'],
    ['maps_url', 'Enlace de Google Maps', 'text', true],
    ['rating', 'Rating', 'num'],
    ['resenas', 'Reseñas', 'num'],
    ['observacion', 'Observación (se usa en el mensaje 2)', 'area', true],
    ['proximo_seguimiento', 'Próximo seguimiento', 'date'],
    ['ultimo_contacto', 'Último contacto', 'date'],
    ['seguimientos', 'Seguimientos enviados', 'num'],
    ['lote', 'Lote', 'num'],
    ['valor', 'Valor propuesta (COP)', 'num'],
    ['plan', 'Plan', 'select', false, [['', 'Sin plan'], ['Esencial', 'Esencial'], ['Completo', 'Completo']]],
    ['origen', 'Origen', 'select', false, [['maps', 'Google Maps'], ['whatsapp_previo', 'WhatsApp previo'], ['referido', 'Referido'], ['manual', 'Manual']]]
  ];
  var NEW_FIELDS = ['nombre', 'segmento', 'telefono', 'web', 'observacion', 'origen'];

  function readForm(kind) {
    var out = {}, err = {};
    FIELDS.forEach(function (f) {
      var el = $('f-' + f[0]);
      if (!el) return;
      var v = el.value.trim();
      switch (f[0]) {
        case 'prioridad': out.prioridad = parseInt(v, 10) || 3; break;
        case 'telefono': {
          if (!v) { out.telefono = ''; break; }
          var d = digits(v);
          if (d.length === 10 && d.charAt(0) === '3') d = '57' + d;
          if (d.length < 10 || d.length > 15) err.telefono = 'Teléfono no válido. Ejemplo: +573001234567';
          out.telefono = '+' + d;
          break;
        }
        case 'web':
          if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
          out.web = v; break;
        case 'maps_url':
          if (v && !/^https?:\/\//i.test(v)) err.maps_url = 'Debe empezar con https://';
          out.maps_url = v; break;
        case 'rating': case 'resenas': case 'lote': case 'valor': case 'seguimientos': {
          var n = v === '' ? null : Number(v.replace(',', '.'));
          if (n !== null && !isFinite(n)) { err[f[0]] = 'Escribe un número'; n = null; }
          out[f[0]] = f[0] === 'seguimientos' ? (n == null ? 0 : n) : n; break;
        }
        default: out[f[0]] = v;
      }
    });
    if (!out.nombre) err.nombre = 'El nombre es obligatorio';
    return { data: out, err: err };
  }
  function isDirty() {
    if (!D) return false;
    if (D.kind === 'tpl') {
      return TPL_META.some(function (m) { var el = $('t-' + m[0]); return el && el.value !== (S.tpl[m[0]] || ''); });
    }
    var r = readForm(D.kind).data;
    if (D.kind === 'new') return !!(r.nombre || r.telefono || r.web || r.observacion || ($('f-nota-inicial') && $('f-nota-inicial').value.trim()));
    return Object.keys(r).some(function (k) { return !same(r[k], D.orig[k]); });
  }

  function fieldEl(f, val) {
    var id = 'f-' + f[0], kind = f[2], el;
    if (kind === 'select') {
      el = h('select', { class: 'in', id: id }, f[4].map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
      el.value = String(val == null ? '' : val);
    } else if (kind === 'area') {
      el = h('textarea', { class: 'in', id: id, rows: 3 }); el.value = val || '';
    } else {
      el = h('input', { class: 'in', id: id, type: kind === 'date' ? 'date' : kind === 'num' ? 'text' : 'text', inputmode: kind === 'num' ? 'decimal' : kind === 'tel' ? 'tel' : null, autocomplete: 'off' });
      el.value = val == null ? '' : String(val);
    }
    return h('div', { class: 'field' + (f[3] ? ' full' : '') }, h('label', { for: id, text: f[1] }), el, h('div', { class: 'err-text', id: 'e-' + f[0], hidden: true }));
  }
  function showErrors(err) {
    FIELDS.forEach(function (f) {
      var e = $('e-' + f[0]);
      if (!e) return;
      if (err[f[0]]) { e.hidden = false; e.textContent = err[f[0]]; } else { e.hidden = true; e.textContent = ''; }
    });
  }

  function buildDrawer() {
    var body = $('drawer-body'), foot = $('drawer-foot');
    body.textContent = ''; foot.textContent = '';
    if (D.kind === 'tpl') return buildTplDrawer(body, foot);
    var isNew = D.kind === 'new';
    var l = isNew ? { nombre: '', segmento: 'salud_estetica', prioridad: 2, estado: 'por_contactar', origen: 'manual', seguimientos: 0 } : S.byId.get(D.id);
    D.orig = Object.assign({}, l);
    $('drawer-title').textContent = isNew ? 'Agregar lead' : l.nombre;

    if (!isNew) {
      var wa = waUrl(l, waText(l)), mp = mapsUrl(l);
      var links = h('div', { class: 'dsec' }, h('h3', { text: 'Enlaces' }), h('div', { class: 'actions', style: 'margin-top:0' },
        wa ? h('a', { class: 'btn sm primary', id: 'lnk-wa', href: wa, target: '_blank', rel: 'noopener', text: 'WhatsApp' }) : h('span', { class: 'btn sm', 'aria-disabled': 'true', text: 'Sin teléfono' }),
        mp ? h('a', { class: 'btn sm', id: 'lnk-maps', href: mp, target: '_blank', rel: 'noopener', text: 'Google Maps' }) : null,
        isHttps(l.web) ? h('a', { class: 'btn sm', id: 'lnk-web', href: l.web, target: '_blank', rel: 'noopener', text: 'Sitio web' }) : null));
      body.appendChild(links);
      var cp = h('div', { class: 'dsec' }, h('h3', { text: 'Copiar mensaje' }), h('div', { class: 'actions', style: 'margin-top:0' },
        h('button', { class: 'btn sm', id: 'cp-msg1', type: 'button', 'data-copy': 'msg1', text: 'Mensaje 1' }),
        h('button', { class: 'btn sm', id: 'cp-msg2', type: 'button', 'data-copy': msg2Key(l), text: 'Mensaje 2' }),
        h('button', { class: 'btn sm', id: 'cp-seg', type: 'button', 'data-copy': 'seguimiento', text: 'Seguimiento' }),
        h('button', { class: 'btn sm', id: 'cp-cierre', type: 'button', 'data-copy': 'cierre', text: 'Cierre' })));
      body.appendChild(cp);
    }

    var grid = h('div', { class: 'grid2' });
    FIELDS.forEach(function (f) { grid.appendChild(fieldEl(f, l[f[0]])); });
    body.appendChild(h('div', { class: 'dsec' }, h('h3', { text: 'Datos' }), grid,
      isNew ? null : h('p', { class: 'faint mono', style: 'font-size:11.5px;margin:10px 0 0', text: 'Creado ' + (l.creado || '') + ' · ID ' + l.id })));

    if (isNew) {
      body.appendChild(h('div', { class: 'dsec' }, h('h3', { text: 'Nota inicial' }),
        h('div', { class: 'field' }, h('label', { for: 'f-nota-inicial', text: 'Nota (opcional)' }), h('textarea', { class: 'in', id: 'f-nota-inicial', rows: 2 }))));
    } else {
      body.appendChild(h('div', { class: 'dsec' }, h('h3', { text: 'Notas' }),
        h('div', { class: 'addnote' },
          h('div', { class: 'field' }, h('label', { for: 'f-nota', text: 'Nueva nota' }), h('input', { class: 'in', id: 'f-nota', type: 'text', autocomplete: 'off' })),
          h('button', { class: 'btn', id: 'btn-nota', type: 'button', text: 'Agregar nota' })),
        h('ul', { class: 'timeline', id: 'timeline' })));
      renderNotes();
      $('btn-nota').addEventListener('click', addNote);
      $('f-nota').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addNote(); } });
    }

    foot.appendChild(h('span', { class: 'msg', id: 'drawer-msg', text: '' }));
    foot.appendChild(h('button', { class: 'btn primary', id: 'btn-save', type: 'button', text: isNew ? 'Crear lead' : 'Guardar cambios' }));
    $('btn-save').addEventListener('click', isNew ? createLead : saveForm);
  }
  function renderNotes() {
    var ul = $('timeline'), l = D && S.byId.get(D.id);
    if (!ul || !l) return;
    ul.textContent = '';
    var notas = Array.isArray(l.notas) ? l.notas.slice().reverse() : [];
    if (!notas.length) ul.appendChild(h('li', { class: 'faint', text: 'Sin notas todavía.' }));
    notas.forEach(function (n) { ul.appendChild(h('li', null, h('span', { class: 'd', text: n.fecha || '' }), n.texto || '')); });
  }
  function addNote() {
    var el = $('f-nota'), txt = el.value.trim();
    if (!txt || !D) return;
    var l = S.byId.get(D.id);
    var notas = (Array.isArray(l.notas) ? l.notas : []).concat([{ fecha: today(), texto: txt }]);
    el.value = '';
    saveLead(D.id, { notas: notas }).then(function () { toast('Nota agregada'); }).catch(function (e) { el.value = txt; toast(failMsg(e), { err: true }); });
  }
  function saveForm() {
    var res = readForm('lead');
    showErrors(res.err);
    if (Object.keys(res.err).length) { $('drawer-msg').textContent = 'Revisa los campos marcados.'; return; }
    var patch = {};
    Object.keys(res.data).forEach(function (k) { if (!same(res.data[k], D.orig[k])) patch[k] = res.data[k]; });
    if (!Object.keys(patch).length) { $('drawer-msg').textContent = 'Sin cambios.'; return; }
    var id = D.id;
    $('btn-save').disabled = true;
    saveLead(id, patch).then(function () {
      if (D && D.id === id) { Object.assign(D.orig, patch); $('drawer-msg').textContent = 'Guardado.'; $('btn-save').disabled = false; }
      toast('Cambios guardados');
    }).catch(function (e) {
      if (D) { $('btn-save').disabled = false; $('drawer-msg').textContent = failMsg(e); }
      toast(failMsg(e), { err: true });
    });
  }
  function createLead() {
    var res = readForm('new');
    showErrors(res.err);
    if (Object.keys(res.err).length) { $('drawer-msg').textContent = 'Revisa los campos marcados.'; return; }
    var d = res.data, nota = $('f-nota-inicial').value.trim();
    var id = 'm-' + Date.now();
    var doc = {
      id: id, nombre: d.nombre, segmento: d.segmento, prioridad: d.prioridad, categoria: d.categoria, barrio: d.barrio,
      telefono: d.telefono, web: d.web, rating: d.rating, resenas: d.resenas, maps_url: d.maps_url, observacion: d.observacion,
      estado: d.estado, proximo_seguimiento: d.proximo_seguimiento, ultimo_contacto: d.ultimo_contacto, seguimientos: d.seguimientos,
      lote: d.lote, valor: d.valor, plan: d.plan, origen: d.origen, notas: nota ? [{ fecha: today(), texto: nota }] : [],
      creado: today(), actualizado: new Date().toISOString()
    };
    $('btn-save').disabled = true;
    data.insertLead(doc).then(function () {
      toast('Lead creado');
      closeDrawer(true);
    }).catch(function (e) {
      if (D) { $('btn-save').disabled = false; $('drawer-msg').textContent = failMsg(e); }
      toast(failMsg(e), { err: true });
    });
  }

  function buildTplDrawer(body, foot) {
    $('drawer-title').textContent = 'Plantillas de mensajes';
    body.appendChild(h('p', { class: 'dim', style: 'margin-top:0', text: 'Usa {nombre} y {observacion}. En el mensaje 2, «Vi que {observacion}» se completa con la observación del lead.' }));
    TPL_META.forEach(function (m) {
      var ta = h('textarea', { class: 'in', id: 't-' + m[0], rows: m[0].indexOf('msg2') === 0 ? 7 : 3 });
      ta.value = S.tpl[m[0]] || '';
      body.appendChild(h('div', { class: 'field', style: 'margin-bottom:12px' }, h('label', { for: 't-' + m[0], text: m[1] }), ta));
    });
    foot.appendChild(h('span', { class: 'msg', id: 'drawer-msg', text: '' }));
    foot.appendChild(h('button', { class: 'btn ghost', id: 'btn-tpl-reset', type: 'button', text: 'Restaurar originales' }));
    foot.appendChild(h('button', { class: 'btn primary', id: 'btn-tpl-save', type: 'button', text: 'Guardar plantillas' }));
    $('btn-tpl-reset').addEventListener('click', function () {
      TPL_META.forEach(function (m) { $('t-' + m[0]).value = DEFAULT_TPL[m[0]]; });
      $('drawer-msg').textContent = 'Originales cargadas. Pulsa Guardar para aplicarlas.';
    });
    $('btn-tpl-save').addEventListener('click', saveTpl);
  }
  function saveTpl() {
    if (!S.db) return;
    var patch = {}, full = {};
    TPL_META.forEach(function (m) {
      var v = $('t-' + m[0]).value;
      full[m[0]] = v;
      if (v !== S.tpl[m[0]]) patch[m[0]] = v;
    });
    if (S.tplExists && !Object.keys(patch).length) { $('drawer-msg').textContent = 'Sin cambios.'; return; }
    $('btn-tpl-save').disabled = true;
    data.saveTpl(full).then(function () { toast('Plantillas guardadas'); closeDrawer(true); }).catch(function (e) {
      if (D) { $('btn-tpl-save').disabled = false; $('drawer-msg').textContent = failMsg(e); }
      toast(failMsg(e), { err: true });
    });
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-act],[data-sort],[data-copy]') : null;
    if (!t) return;
    if (t.hasAttribute('data-sort')) {
      var k = t.getAttribute('data-sort');
      if (S.sort.k === k) S.sort.dir = -S.sort.dir; else { S.sort.k = k; S.sort.dir = 1; }
      render();
      return;
    }
    if (t.hasAttribute('data-copy')) {
      var l0 = D && S.byId.get(D.id);
      if (l0) copyText(fillTpl(S.tpl[t.getAttribute('data-copy')], l0), 'Mensaje copiado');
      return;
    }
    var act = t.getAttribute('data-act'), id = t.getAttribute('data-id'), l = id ? S.byId.get(id) : null;
    if (act === 'new') { openDrawer('new'); return; }
    if (!l) return;
    if (act === 'open') openDrawer('lead', id);
    else if (act === 'copy-m2') copyText(fillTpl(S.tpl[msg2Key(l)], l), 'Mensaje 2 copiado');
    else if (act === 'cerrar') {
      copyText(fillTpl(S.tpl.cierre, l), 'Mensaje de cierre copiado. Lead descartado.');
      saveLead(id, patchFor('descartar', l)).catch(function (er) { toast(failMsg(er), { err: true }); });
    } else if (act === 'descartar') quick(id, patchFor('descartar', l), l.nombre + ': descartado');
    else if (act === 'contactado' || act === 'respondio') quick(id, patchFor(act, l), l.nombre + ': ' + ESTADO_LABEL[act].toLowerCase());
    else if (act === 'seguimiento') quick(id, patchFor('seguimiento', l), 'Seguimiento ' + ((l.seguimientos || 0) + 1) + ' registrado');
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'sel-nuevos') {
      S.nuevosN = parseInt(t.value, 10) || 10;
      try { localStorage.setItem('crm.nuevosN', String(S.nuevosN)); } catch (er) {}
      render();
    } else if (t.getAttribute && t.getAttribute('data-change') === 'move') {
      var l = S.byId.get(t.getAttribute('data-id'));
      if (l && t.value !== l.estado) moveTo(l, t.value);
    } else if (t.getAttribute && t.getAttribute('data-filter') && t.tagName === 'SELECT') {
      S.filters[t.id.replace('flt-', '')] = t.value;
      render();
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'flt-q' && e.target.getAttribute('data-filter')) { S.filters.q = e.target.value; render(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && D) { e.preventDefault(); closeDrawer(false); }
    if (e.key === 'Tab' && D) { // keep focus inside the drawer
      var f = $('drawer').querySelectorAll('a[href],button:not([disabled]),input,select,textarea');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!$('drawer').contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }
  });
  $('backdrop').addEventListener('click', function () { closeDrawer(false); });
  $('drawer-close').addEventListener('click', function () { closeDrawer(false); });
  $('btn-plantillas').addEventListener('click', function () { openDrawer('tpl'); });
  document.querySelector('#view').addEventListener('click', function (e) {
    var tr = e.target.closest && e.target.closest('tr[data-row]');
    if (tr && !e.target.closest('button,a')) openDrawer('lead', tr.getAttribute('data-row'));
  });
  window.addEventListener('hashchange', route);

  /* theme */
  function applyTheme(t) {
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    $('btn-theme').textContent = t === 'dark' ? 'Tema: oscuro' : t === 'light' ? 'Tema: claro' : 'Tema: auto';
  }
  var theme = 'auto';
  try { theme = localStorage.getItem('crm.theme') || 'auto'; } catch (e) {}
  applyTheme(theme);
  $('btn-theme').addEventListener('click', function () {
    theme = theme === 'auto' ? 'dark' : theme === 'dark' ? 'light' : 'auto';
    try { localStorage.setItem('crm.theme', theme); } catch (e) {}
    applyTheme(theme);
  });

  /* ---------- data loading (Supabase) ---------- */
  function onLeads(rows) {
    S.leads = rows;
    S.byId = new Map(S.leads.map(function (l) { return [l.id, l]; }));
    S.leadsLoaded = true;
    S.error = '';
    S.fresh = true; S.timedOut = false; clearTimeout(timeoutId);
    render();
    if (D && D.kind === 'lead') { if (S.byId.get(D.id)) renderNotes(); }
  }
  function onLeadsErr(e) {
    clearTimeout(timeoutId);
    S.error = (e && (e.code || e.message)) || 'error';
    render();
  }
  function onTpl(row) {
    S.tplExists = !!row;
    var d = row || {};
    S.tpl = Object.assign({}, DEFAULT_TPL);
    Object.keys(DEFAULT_TPL).forEach(function (k) { if (typeof d[k] === 'string' && d[k]) S.tpl[k] = d[k]; });
    // no re-render mientras se edita el panel de plantillas
    if (!(D && D.kind === 'tpl')) render();
  }

  function refetchLeads() { return data.fetchLeads().then(onLeads, onLeadsErr); }
  function refetchTpl() { return data.fetchPlantillas().then(onTpl, function () {}); }
  var refetchTimer = 0;
  function refetchSoon() {
    clearTimeout(refetchTimer);
    refetchTimer = setTimeout(function () {
      // no pisar el drawer de un lead con cambios sin guardar: renderNotes/render ya respetan D
      refetchLeads();
    }, 300);
  }

  function start() {
    route();
    timeoutId = setTimeout(function () {
      if (!S.fresh) { S.timedOut = true; render(); }
    }, 10000);
    S.db = true;
    S.status = 'ready';
    refetchLeads();
    refetchTpl();
    data.subscribeLeads(refetchSoon);
    window.addEventListener('focus', function () { refetchLeads(); refetchTpl(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { refetchLeads(); refetchTpl(); }
    });
  }
  start();
}
