#!/usr/bin/env python3
"""
hidock_notes.py — Herramienta CLI para el agente organizador de notas de HiDock.

Da acceso determinista y seguro (solo stdlib) a la base de datos de HiDock
(`~/.hidock/audio_metadata.db`) y exporta notas a un vault Markdown.

El agente (LLM) decide QUÉ escribir (títulos, tags, resúmenes, action items);
este script hace CÓMO leer/escribir de forma fiable, sin que el agente redacte
SQL a mano. Todas las escrituras tocan solo los campos `user_*` y `display_title`
— nunca la transcripción original ni el análisis de IA de HiDock.

Uso:
    python hidock_notes.py stats
    python hidock_notes.py list [--status STATUS] [--untagged] [--limit N]
    python hidock_notes.py show <filename>
    python hidock_notes.py search "texto"
    python hidock_notes.py pending            # notas que faltan por organizar
    python hidock_notes.py set <filename> [--title T] [--tags a,b,c]
                                 [--notes N] [--description D]
                                 [--action-items "item1;item2"]
    python hidock_notes.py export <filename|--all> [--out DIR]

Salida en JSON para que el agente la parsee de forma fiable.
"""
import argparse
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone

DEFAULT_DB = os.path.join(os.path.expanduser("~"), ".hidock", "audio_metadata.db")
DEFAULT_VAULT = os.path.join(os.path.expanduser("~"), "HiNotes-Vault")

# Campos que el agente puede modificar. La transcripción y el análisis de IA
# de HiDock quedan intactos.
JSON_FIELDS = {"ai_participants", "ai_action_items", "ai_topics", "ai_key_quotes",
               "user_participants", "user_action_items", "user_tags"}


def db_path():
    return os.environ.get("HIDOCK_DB", DEFAULT_DB)


def connect():
    path = db_path()
    if not os.path.exists(path):
        die(f"No existe la base de HiDock en {path}. "
            f"Abre la app de HiDock, descarga y procesa (transcribe) al menos "
            f"una grabación primero, o define HIDOCK_DB si está en otra ruta.")
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def die(msg, code=1):
    print(json.dumps({"error": msg}, ensure_ascii=False, indent=2))
    sys.exit(code)


def out(obj):
    print(json.dumps(obj, ensure_ascii=False, indent=2, default=str))


def parse_json_field(value):
    if not value:
        return None
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return value


def row_to_dict(row, full=False):
    d = dict(row)
    for f in JSON_FIELDS:
        if f in d:
            d[f] = parse_json_field(d[f])
    if not full:
        # Vista compacta para listados: sin transcripción completa.
        text = d.get("transcription_text") or ""
        d["transcription_preview"] = (text[:280] + "…") if len(text) > 280 else text
        d.pop("transcription_text", None)
    return d


# --------------------------------------------------------------------------- #
# Comandos de lectura
# --------------------------------------------------------------------------- #
def cmd_stats(args):
    conn = connect()
    cur = conn.cursor()
    total = cur.execute("SELECT COUNT(*) FROM audio_metadata").fetchone()[0]
    by_status = {r[0]: r[1] for r in cur.execute(
        "SELECT processing_status, COUNT(*) FROM audio_metadata GROUP BY processing_status")}
    transcribed = cur.execute(
        "SELECT COUNT(*) FROM audio_metadata "
        "WHERE transcription_text IS NOT NULL AND transcription_text != ''").fetchone()[0]
    untagged = cur.execute(
        "SELECT COUNT(*) FROM audio_metadata "
        "WHERE (user_tags IS NULL OR user_tags = '' OR user_tags = '[]') "
        "AND transcription_text IS NOT NULL AND transcription_text != ''").fetchone()[0]
    untitled = cur.execute(
        "SELECT COUNT(*) FROM audio_metadata "
        "WHERE (user_title IS NULL OR user_title = '') "
        "AND transcription_text IS NOT NULL AND transcription_text != ''").fetchone()[0]
    out({
        "db_path": db_path(),
        "total_notes": total,
        "transcribed": transcribed,
        "by_status": by_status,
        "needs_organizing": {"untagged": untagged, "untitled": untitled},
    })


def cmd_list(args):
    conn = connect()
    q = ("SELECT filename, date_created, duration_seconds, processing_status, "
         "user_title, display_title, user_tags, ai_summary "
         "FROM audio_metadata")
    where, params = [], []
    if args.status:
        where.append("processing_status = ?")
        params.append(args.status)
    if args.untagged:
        where.append("(user_tags IS NULL OR user_tags = '' OR user_tags = '[]')")
        where.append("transcription_text IS NOT NULL AND transcription_text != ''")
    if where:
        q += " WHERE " + " AND ".join(where)
    q += " ORDER BY date_created DESC"
    if args.limit:
        q += f" LIMIT {int(args.limit)}"
    rows = [row_to_dict(r) for r in conn.execute(q, params)]
    out({"count": len(rows), "notes": rows})


def cmd_show(args):
    conn = connect()
    row = conn.execute("SELECT * FROM audio_metadata WHERE filename = ?",
                       (args.filename,)).fetchone()
    if not row:
        die(f"No se encontró la nota '{args.filename}'.")
    out(row_to_dict(row, full=True))


def cmd_search(args):
    conn = connect()
    like = f"%{args.query}%"
    rows = [row_to_dict(r) for r in conn.execute(
        "SELECT filename, date_created, user_title, display_title, user_tags, ai_summary, "
        "transcription_text FROM audio_metadata "
        "WHERE transcription_text LIKE ? OR ai_summary LIKE ? OR user_title LIKE ? "
        "OR user_notes LIKE ? OR user_tags LIKE ? "
        "ORDER BY date_created DESC",
        (like, like, like, like, like))]
    out({"query": args.query, "count": len(rows), "notes": rows})


def cmd_pending(args):
    """Notas transcritas pero sin organizar (sin título o sin tags)."""
    conn = connect()
    rows = [row_to_dict(r) for r in conn.execute(
        "SELECT filename, date_created, duration_seconds, ai_summary, "
        "transcription_text, user_title, user_tags FROM audio_metadata "
        "WHERE transcription_text IS NOT NULL AND transcription_text != '' "
        "AND ((user_title IS NULL OR user_title = '') "
        "     OR (user_tags IS NULL OR user_tags = '' OR user_tags = '[]')) "
        "ORDER BY date_created DESC")]
    out({"count": len(rows), "notes": rows})


# --------------------------------------------------------------------------- #
# Comando de escritura (solo campos user_* + display_title)
# --------------------------------------------------------------------------- #
def cmd_set(args):
    conn = connect()
    row = conn.execute("SELECT * FROM audio_metadata WHERE filename = ?",
                       (args.filename,)).fetchone()
    if not row:
        die(f"No se encontró la nota '{args.filename}'.")

    updates, params = [], []

    if args.title is not None:
        updates.append("user_title = ?")
        params.append(args.title)
    if args.description is not None:
        updates.append("user_description = ?")
        params.append(args.description)
    if args.notes is not None:
        updates.append("user_notes = ?")
        params.append(args.notes)
    if args.tags is not None:
        tags = [t.strip() for t in args.tags.split(",") if t.strip()]
        updates.append("user_tags = ?")
        params.append(json.dumps(tags, ensure_ascii=False))
    if args.action_items is not None:
        items = [i.strip() for i in args.action_items.split(";") if i.strip()]
        updates.append("user_action_items = ?")
        params.append(json.dumps(items, ensure_ascii=False))

    if not updates:
        die("Nada que actualizar: pasa al menos --title/--tags/--notes/etc.")

    # Recalcular display_title (user_title > ai_summary > filename).
    new_title = args.title if args.title is not None else row["user_title"]
    display = new_title or row["ai_summary"] or row["filename"]
    updates.append("display_title = ?")
    params.append(display)
    updates.append("updated_at = ?")
    params.append(datetime.now(timezone.utc).isoformat())

    params.append(args.filename)
    conn.execute(f"UPDATE audio_metadata SET {', '.join(updates)} WHERE filename = ?",
                 params)
    conn.commit()
    updated = conn.execute("SELECT * FROM audio_metadata WHERE filename = ?",
                           (args.filename,)).fetchone()
    out({"updated": args.filename, "note": row_to_dict(updated, full=True)})


# --------------------------------------------------------------------------- #
# Exportación a vault Markdown
# --------------------------------------------------------------------------- #
def slugify(text):
    text = (text or "nota").strip().lower()
    text = re.sub(r"[^\w\s-]", "", text, flags=re.UNICODE)
    text = re.sub(r"[\s_-]+", "-", text).strip("-")
    return text[:60] or "nota"


def yaml_list(items):
    if not items:
        return "[]"
    return "\n" + "\n".join(f"  - {json.dumps(str(i), ensure_ascii=False)}" for i in items)


def note_to_markdown(d):
    tags = d.get("user_tags") or []
    if isinstance(tags, str):
        tags = [tags]
    participants = d.get("user_participants") or d.get("ai_participants") or []
    action_items = d.get("user_action_items") or d.get("ai_action_items") or []
    topics = d.get("ai_topics") or []
    title = d.get("user_title") or d.get("display_title") or d.get("ai_summary") or d.get("filename")
    date = d.get("date_created") or ""
    dur = d.get("duration_seconds")

    fm = ["---",
          f"title: {json.dumps(str(title), ensure_ascii=False)}",
          f"aliases:{yaml_list([str(title)])}",
          f"source_file: {json.dumps(d.get('filename'), ensure_ascii=False)}",
          f"date: {json.dumps(str(date), ensure_ascii=False)}",
          f"duration_seconds: {dur if dur is not None else 'null'}",
          f"tags:{yaml_list(tags)}",
          f"participants:{yaml_list(participants)}",
          f"topics:{yaml_list(topics)}",
          "---", ""]

    transcript = d.get("transcription_text") or ""
    # Contenido "rico" (notas estructuradas de HiNotes) trae sus propios encabezados
    # y su propio resumen — en ese caso no repetimos un "## Resumen" aparte.
    is_rich = "\n#" in transcript or transcript.strip().startswith("#")

    body = [f"# {title}", ""]
    summary = d.get("user_description") or d.get("ai_summary")
    if summary and not is_rich:
        body += ["## Resumen", "", summary, ""]
    elif summary and is_rich:
        # Resumen conciso como callout breve, sin duplicar el detallado interno.
        body += ["> [!summary] En breve", f"> {summary}", ""]
    if action_items:
        body += ["## Action items", ""]
        body += [f"- [ ] {i}" for i in action_items]
        body += [""]
    if d.get("user_notes"):
        body += ["## Notas", "", d["user_notes"], ""]
    key_quotes = d.get("ai_key_quotes") or []
    if key_quotes:
        body += ["## Citas clave", ""]
        body += [f"> {q}" for q in key_quotes]
        body += [""]
    if transcript:
        heading = "## Contenido" if is_rich else "## Transcripción"
        body += [heading, "", transcript, ""]

    return "\n".join(fm + body)


def export_one(row, vault):
    d = row_to_dict(row, full=True)
    date = str(d.get("date_created") or "")[:10] or "sin-fecha"
    folder = os.path.join(vault, date[:7] or "sin-fecha")  # YYYY-MM
    os.makedirs(folder, exist_ok=True)
    title = d.get("user_title") or d.get("display_title") or d.get("filename")
    fname = f"{date}-{slugify(title)}.md"
    path = os.path.join(folder, fname)
    with open(path, "w", encoding="utf-8") as f:
        f.write(note_to_markdown(d))
    return path


def cmd_export(args):
    conn = connect()
    vault = args.out or os.environ.get("HIDOCK_VAULT", DEFAULT_VAULT)
    if args.all:
        rows = conn.execute(
            "SELECT * FROM audio_metadata "
            "WHERE transcription_text IS NOT NULL AND transcription_text != '' "
            "ORDER BY date_created DESC").fetchall()
    else:
        if not args.filename:
            die("Pasa un <filename> o --all.")
        rows = conn.execute("SELECT * FROM audio_metadata WHERE filename = ?",
                            (args.filename,)).fetchall()
        if not rows:
            die(f"No se encontró la nota '{args.filename}'.")
    paths = [export_one(r, vault) for r in rows]
    out({"vault": vault, "exported": len(paths), "files": paths})


# --------------------------------------------------------------------------- #
def build_parser():
    p = argparse.ArgumentParser(description="Herramienta CLI del agente de notas HiDock.")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("stats", help="Resumen de la base y qué falta organizar.")

    lp = sub.add_parser("list", help="Lista notas (vista compacta).")
    lp.add_argument("--status")
    lp.add_argument("--untagged", action="store_true")
    lp.add_argument("--limit", type=int)

    sp = sub.add_parser("show", help="Muestra una nota completa.")
    sp.add_argument("filename")

    se = sub.add_parser("search", help="Busca en transcripción, resumen, tags, notas.")
    se.add_argument("query")

    sub.add_parser("pending", help="Notas transcritas pero sin organizar.")

    st = sub.add_parser("set", help="Actualiza campos de usuario de una nota.")
    st.add_argument("filename")
    st.add_argument("--title")
    st.add_argument("--description")
    st.add_argument("--notes")
    st.add_argument("--tags", help="Lista separada por comas: trabajo,reunion,q3")
    st.add_argument("--action-items", dest="action_items",
                    help="Lista separada por punto y coma: 'enviar informe;llamar a Ana'")

    ex = sub.add_parser("export", help="Exporta nota(s) al vault Markdown.")
    ex.add_argument("filename", nargs="?")
    ex.add_argument("--all", action="store_true")
    ex.add_argument("--out", help="Directorio del vault (default ~/HiNotes-Vault).")

    return p


def main():
    args = build_parser().parse_args()
    handlers = {
        "stats": cmd_stats, "list": cmd_list, "show": cmd_show,
        "search": cmd_search, "pending": cmd_pending, "set": cmd_set,
        "export": cmd_export,
    }
    handlers[args.cmd](args)


if __name__ == "__main__":
    main()
