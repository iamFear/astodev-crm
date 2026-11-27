import assert from 'node:assert/strict';
import { patchFor, moveToPatch, undoPatchFor, applyPatch, addDays } from '../src/ui/actions.js';

// Misma conversión que src/data.js toRow para fechas.
function dbRow(p) {
  var o = Object.assign({}, p);
  ['proximo_seguimiento', 'ultimo_contacto', 'creado'].forEach(function (k) { if (k in o && o[k] === '') o[k] = null; });
  return o;
}

const T = '2026-11-27';
const lead = { id: 'a', estado: 'por_contactar', ultimo_contacto: '', proximo_seguimiento: '', seguimientos: 0, notas: [{ fecha: '2026-11-01', texto: 'x' }] };
const lead2 = { id: 'b', estado: 'contactado', ultimo_contacto: '2026-11-20', proximo_seguimiento: '2026-11-23', seguimientos: 1, notas: [] };

// Contactado + deshacer: vuelve al original, fechas vacías explícitamente null
{
  const p = patchFor('contactado', lead, T);
  assert.deepEqual(p, { estado: 'contactado', ultimo_contacto: T, proximo_seguimiento: addDays(T, 3) });
  const undo = undoPatchFor(lead, p);
  assert.deepEqual(Object.keys(undo).sort(), Object.keys(p).sort());
  const row = dbRow(undo);
  assert.deepEqual(row, { estado: 'por_contactar', ultimo_contacto: null, proximo_seguimiento: null });
  assert.ok(Object.values(row).every((v) => v !== undefined));
  const restored = applyPatch(applyPatch(lead, p), undo);
  assert.deepEqual(restored, lead);
}
// Seguimiento y descartar sobre lead con fechas previas
for (const kind of ['respondio', 'seguimiento', 'descartar']) {
  const p = patchFor(kind, lead2, T);
  const undo = undoPatchFor(lead2, p);
  assert.deepEqual(applyPatch(applyPatch(lead2, p), undo), lead2, kind);
}
// Movimientos de pipeline
for (const est of ['por_contactar', 'contactado', 'respondio', 'diagnostico', 'llamada', 'propuesta', 'cliente', 'descartado']) {
  for (const l of [lead, lead2]) {
    const p = moveToPatch(l, est, T);
    assert.deepEqual(applyPatch(applyPatch(l, p), undoPatchFor(l, p)), l, est);
  }
}
// Notas: el deshacer restaura el arreglo previo
{
  const p = { notas: lead.notas.concat([{ fecha: T, texto: 'auto' }]) };
  const undo = undoPatchFor(lead, p);
  assert.deepEqual(undo.notas, lead.notas);
  assert.notEqual(undo.notas, lead.notas);
}
// Valores ausentes (undefined) nunca se filtran
{
  const undo = undoPatchFor({ id: 'c', estado: 'por_contactar' }, { estado: 'contactado', ultimo_contacto: T, proximo_seguimiento: T });
  assert.equal(dbRow(undo).ultimo_contacto, null);
  assert.equal(dbRow(undo).proximo_seguimiento, null);
}
console.log('actions: ok');
