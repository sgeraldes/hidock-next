#!/usr/bin/env python3
"""
canon_tags.py — Unifica tags duplicados/sinónimos en la base local de HiDock.

Aplica un mapeo canónico (case-insensitive) sobre `user_tags`, deduplica dentro de
cada nota y preserva el orden. Solo toca tags que estén en el mapeo; el resto se
conserva tal cual (salvo colapsar duplicados por mayúsculas/espacios).

Uso:
    python3 canon_tags.py --dry-run   # muestra qué cambiaría, sin escribir
    python3 canon_tags.py             # aplica los cambios
"""
import argparse
import collections
import json
import os
import sqlite3

DB = os.environ.get("HIDOCK_DB", os.path.join(os.path.expanduser("~"), ".hidock", "audio_metadata.db"))

# canónico -> lista de variantes (todo se compara en minúsculas/strip).
CLUSTERS = {
    "Lealtad y Retención": [
        "programa de lealtad", "fidelización de clientes", "fidelización",
        "retención de clientes", "retención", "lealtad", "programa de fidelización",
        "retención de clientes", "customer retention", "loyalty program",
    ],
    "E-commerce": ["comercio electrónico", "ecommerce", "e-commerce", "e commerce"],
    "Estrategia de Marketing": ["estrategias de marketing", "estrategia de marketing"],
    "Análisis de Desempeño": [
        "análisis de rendimiento", "análisis de desempeño", "métricas de desempeño",
        "análisis de performance", "revisión de desempeño", "reunión de desempeño",
    ],
    "Campañas de Marketing": [
        "campañas publicitarias", "campaña publicitaria", "campañas promocionales",
        "campaña promocional", "campaña de marketing", "campañas de marketing",
        "campañas", "campaña",
    ],
    "Paid Media": ["medios pagados", "paid media", "publicidad pagada"],
    "Automatización": ["automatización de procesos", "automatización"],
    "Producción de Video": ["producción de videos", "producción de video"],
    "Análisis de Datos": ["análisis de datos", "analítica de datos", "gestión de datos", "integración de datos"],
    "Segmentación de Clientes": ["segmentación de audiencia", "segmentación de clientes", "segmentación"],
    "SEO": ["seo", "optimización seo", "posicionamiento seo"],
    "Reunión de Marketing": ["reunión de marketing", "reuniones de marketing"],
    "Reunión de Equipo": ["reunión de equipo", "reuniones de equipo", "reuniones de equipo"],
    "Presupuesto": ["planificación presupuestaria", "gestión de presupuesto", "presupuesto",
                    "reunión presupuestaria", "gestión de presupuesto"],
    "Experiencia del Cliente": ["experiencia del cliente", "experiencia de cliente"],
    "Análisis de Ventas": ["análisis de ventas", "estrategia de ventas", "estrategia comercial"],
}

# Construye índice variante(lower) -> canónico
VARIANT_TO_CANON = {}
for canon, variants in CLUSTERS.items():
    VARIANT_TO_CANON[canon.lower()] = canon
    for v in variants:
        VARIANT_TO_CANON[v.strip().lower()] = canon


def canonize(tags):
    seen, out = set(), []
    for t in tags:
        key = str(t).strip().lower()
        canon = VARIANT_TO_CANON.get(key, str(t).strip())
        if canon.lower() not in seen:
            seen.add(canon.lower())
            out.append(canon)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    conn = sqlite3.connect(DB)
    rows = conn.execute("SELECT filename, user_tags FROM audio_metadata").fetchall()

    before = collections.Counter()
    after = collections.Counter()
    changed = 0
    updates = []
    for fn, raw in rows:
        tags = json.loads(raw or "[]")
        before.update(tags)
        new = canonize(tags)
        after.update(new)
        if new != tags:
            changed += 1
            updates.append((json.dumps(new, ensure_ascii=False), fn))

    print(f"Tags únicos antes: {len(before)}  →  después: {len(after)}")
    print(f"Notas afectadas: {changed}")
    print("\nTop tags después de unificar:")
    for tag, n in after.most_common(15):
        print(f"  {n:3}  {tag}")

    if args.dry_run:
        print("\n(dry-run: no se escribió nada)")
        return

    for new_tags, fn in updates:
        conn.execute("UPDATE audio_metadata SET user_tags=?, updated_at=CURRENT_TIMESTAMP WHERE filename=?",
                     (new_tags, fn))
    conn.commit()
    print(f"\n✅ Aplicado a {changed} notas.")


if __name__ == "__main__":
    main()
