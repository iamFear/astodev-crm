#!/usr/bin/env python3
"""Genera supabase/seed.local.sql a partir del seed JSON del vault (solo stdlib).

El archivo resultante contiene datos reales del negocio: está en .gitignore.
Uso: python3 scripts/build_seed_sql.py [directorio_seed]
"""
import glob
import json
import os
import sys

DEFAULT_SEED = '/Users/ibrejcha/astodev/Astodev/Herramientas/crm/seed'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'supabase', 'seed.local.sql')

LEAD_COLS = [
    'id', 'nombre', 'segmento', 'prioridad', 'categoria', 'barrio', 'telefono', 'web',
    'rating', 'resenas', 'maps_url', 'observacion', 'estado', 'proximo_seguimiento',
    'ultimo_contacto', 'seguimientos', 'lote', 'valor', 'plan', 'origen', 'notas',
    'creado', 'actualizado',
]
DATE_COLS = {'proximo_seguimiento', 'ultimo_contacto', 'creado'}
TPL_COLS = ['msg1', 'msg2_salud', 'msg2_arq', 'seguimiento', 'cierre']


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def lit(col, v):
    if col == 'notas':
        return q(json.dumps(v if v is not None else [], ensure_ascii=False)) + '::jsonb'
    if v is None or (col in DATE_COLS and v == ''):
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return repr(v)
    if col == 'actualizado':
        return q(v) + '::timestamptz'
    if col in DATE_COLS:
        return q(v) + '::date'
    return q(v)


def main():
    seed = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SEED
    files = sorted(glob.glob(os.path.join(seed, 'leads', '*.json')))
    out = ['-- Generado por scripts/build_seed_sql.py. Contiene datos reales: NO subir a git.', 'begin;', '']
    for f in files:
        with open(f, encoding='utf-8') as fh:
            d = json.load(fh)
        cols = [c for c in LEAD_COLS if c in d]
        out.append('insert into public.leads (%s) values (%s) on conflict (id) do nothing;' % (
            ', '.join(cols), ', '.join(lit(c, d[c]) for c in cols)))
    n_tpl = 0
    tpl_path = os.path.join(seed, 'config', 'plantillas.json')
    if os.path.exists(tpl_path):
        with open(tpl_path, encoding='utf-8') as fh:
            t = json.load(fh)
        cols = [c for c in TPL_COLS if c in t]
        out.append('')
        out.append("insert into public.plantillas (id, %s) values ('default', %s) on conflict (id) do nothing;" % (
            ', '.join(cols), ', '.join(q(t[c]) for c in cols)))
        n_tpl = 1
    out += ['', 'commit;', '']
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(out))
    print('leads: %d, plantillas: %d -> %s' % (len(files), n_tpl, OUT))


if __name__ == '__main__':
    main()
