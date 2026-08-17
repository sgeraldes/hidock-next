#!/usr/bin/env python3
"""
hinotes_sync.py — Puente entre la nube HiNotes (hinotes.hidock.com) y lo local.

Descarga las notas y carpetas de tu cuenta de HiNotes usando tu AccessToken y:
  - las guarda como JSON crudo (para inspección / backup completo),
  - las importa a la base local de HiDock (`~/.hidock/audio_metadata.db`),
    de modo que el agente `notes-organizer` pueda trabajarlas y exportarlas a Markdown.

Solo stdlib (urllib) — no requiere instalar nada.

Cómo obtener tu AccessToken (una sola vez):
  1. Entra a https://hinotes.hidock.com e inicia sesión.
  2. Abre DevTools (F12 o Cmd+Opt+I) → pestaña "Network".
  3. Haz clic en "Notes" para que se dispare una petición.
  4. Clic en cualquier request → pestaña "Headers" → busca el header "AccessToken".
  5. Copia el valor de 64 caracteres.

Uso:
  export HINOTES_TOKEN=<tu token de 64 chars>
  python3 hinotes_sync.py probe          # verifica token + muestra tu info
  python3 hinotes_sync.py fetch          # descarga notas+carpetas a JSON crudo
  python3 hinotes_sync.py import         # importa el JSON descargado a la base local
  python3 hinotes_sync.py fetch --import # todo de una
"""
import argparse
import json
import os
import sqlite3
import sys
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone

BASE_URL = "https://hinotes.hidock.com"
DEFAULT_DB = os.path.join(os.path.expanduser("~"), ".hidock", "audio_metadata.db")
RAW_DIR = os.path.join(os.path.expanduser("~"), ".hidock", "hinotes_raw")


def token():
    t = os.environ.get("HINOTES_TOKEN", "").strip()
    if not t:
        die("Falta el AccessToken. Ponlo con:  export HINOTES_TOKEN=<token de 64 chars>\n"
            "Cómo obtenerlo: DevTools (F12) → Network → click en Notes → Headers → 'AccessToken'.")
    if len(t) != 64 or not t.isalnum():
        die(f"El token no tiene el formato esperado (64 chars alfanuméricos); recibí {len(t)} chars.")
    return t


def die(msg, code=1):
    print(json.dumps({"error": msg}, ensure_ascii=False, indent=2))
    sys.exit(code)


def out(obj):
    print(json.dumps(obj, ensure_ascii=False, indent=2, default=str))


def api(endpoint, method="POST", body=None, content_type="application/x-www-form-urlencoded"):
    """Llama al API de HiNotes. Devuelve el campo `data` en éxito, o lanza."""
    url = f"{BASE_URL}{endpoint}"
    data = b""
    headers = {"AccessToken": token(), "Content-Type": content_type,
               "Accept": "application/json"}
    if body is not None:
        if content_type == "application/json":
            data = json.dumps(body).encode("utf-8")
        else:
            data = urllib.parse.urlencode(body).encode("utf-8") if body else b""
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 401:
            die("401: token inválido o expirado. Vuelve a copiar el AccessToken desde DevTools.")
        die(f"HTTP {e.code} en {endpoint}: {e.read().decode('utf-8', 'replace')[:300]}")
    except urllib.error.URLError as e:
        die(f"Error de red llamando {endpoint}: {e.reason}")
    if payload.get("error") not in (0, None):
        die(f"API HiNotes error en {endpoint}: {payload.get('message')} (raw: {json.dumps(payload)[:300]})")
    return payload.get("data")


# --------------------------------------------------------------------------- #
def cmd_probe(args):
    info = api("/v1/user/info")
    out({"ok": True, "user": info})


NOTES_DIR = os.path.join(RAW_DIR, "notes")  # cache de note/info por nota (resumible)


def _sleep(seconds):
    # time.sleep no está bloqueado en scripts normales; solo lo evitamos en workflows.
    import time
    time.sleep(seconds)


def cmd_fetch(args):
    os.makedirs(RAW_DIR, exist_ok=True)
    os.makedirs(NOTES_DIR, exist_ok=True)

    # 1) Carpetas (para mapear folderId -> nombre).
    folders = api("/v1/folder/list") or []
    with open(os.path.join(RAW_DIR, "folders.json"), "w", encoding="utf-8") as f:
        json.dump(folders, f, ensure_ascii=False, indent=2)

    # 2) Listado paginado de todas las notas (metadata + conciseSummary).
    stubs, page, total_pages = [], 0, 1
    while page < total_pages:
        data = api("/v2/note/list", body={"pageIndex": page, "size": 10}) or {}
        stubs.extend(data.get("content", []))
        total_pages = data.get("totalPages", 1)
        page += 1
        if page % 5 == 0:
            print(f"  …listando: {len(stubs)}/{data.get('totalElements','?')} notas",
                  file=sys.stderr)
        _sleep(0.15)
    with open(os.path.join(RAW_DIR, "notes.json"), "w", encoding="utf-8") as f:
        json.dump(stubs, f, ensure_ascii=False, indent=2)

    # 3) Contenido completo por nota vía note/info (resumible: cachea cada una).
    fetched_full, cached = 0, 0
    if not args.list_only:
        for i, s in enumerate(stubs):
            nid = str(s.get("id"))
            dest = os.path.join(NOTES_DIR, f"{nid}.json")
            if os.path.exists(dest) and not args.refresh:
                cached += 1
                continue
            info = api("/v2/note/info", body={"id": nid})
            with open(dest, "w", encoding="utf-8") as f:
                json.dump(info, f, ensure_ascii=False, indent=2)
            fetched_full += 1
            if fetched_full % 25 == 0:
                print(f"  …contenido: {i + 1}/{len(stubs)}", file=sys.stderr)
            _sleep(0.15)

    out({"folders": len(folders), "notes_listed": len(stubs),
         "content_downloaded": fetched_full, "content_cached": cached,
         "raw_dir": RAW_DIR,
         "next": "python3 hinotes_sync.py import"})
    if args.do_import:
        _import()


def _folder_map():
    path = os.path.join(RAW_DIR, "folders.json")
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        folders = json.load(f)
    return {str(fo.get("id")): fo.get("name") for fo in folders if isinstance(fo, dict)}


def _epoch_ms_to_iso(v):
    try:
        ms = int(v)
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()
    except (TypeError, ValueError):
        return str(v)


def cmd_import(args):
    _import()


def _import():
    notes_path = os.path.join(RAW_DIR, "notes.json")
    if not os.path.exists(notes_path):
        die("No hay notes.json. Corre primero: python3 hinotes_sync.py fetch")
    with open(notes_path, encoding="utf-8") as f:
        stubs = json.load(f)
    if not stubs:
        die("notes.json está vacío.")

    fmap = _folder_map()
    db = os.environ.get("HIDOCK_DB", DEFAULT_DB)
    os.makedirs(os.path.dirname(db), exist_ok=True)
    conn = sqlite3.connect(db)
    _ensure_schema(conn)

    imported, skipped, no_content = 0, 0, 0
    now = datetime.now(timezone.utc).isoformat()
    for s in stubs:
        nid = str(s.get("id"))
        # Contenido completo desde el cache de note/info (si se descargó).
        full = {}
        cache = os.path.join(NOTES_DIR, f"{nid}.json")
        if os.path.exists(cache):
            with open(cache, encoding="utf-8") as f:
                full = json.load(f) or {}

        title = full.get("title") or s.get("title") or f"Nota {nid}"
        # markdown es el contenido rico (transcripción + notas estructuradas).
        content = full.get("markdown") or full.get("html") or ""
        if not content:
            no_content += 1
        summary = full.get("conciseSummary") or s.get("conciseSummary") or full.get("summary")
        created = _epoch_ms_to_iso(s.get("createTime") or full.get("createTime"))
        dur_ms = s.get("duration") or full.get("duration") or 0
        try:
            duration = float(dur_ms) / 1000.0  # la API entrega ms
        except (TypeError, ValueError):
            duration = 0.0
        lang = s.get("language") or full.get("language")

        # Tags: nombre de carpeta + tags propios de la nota.
        tags = []
        folder_name = fmap.get(str(s.get("folderId") or full.get("folderId")))
        if folder_name:
            tags.append(folder_name)
        raw_tags = full.get("tags") or s.get("tags")
        if isinstance(raw_tags, list):
            tags += [t.get("name") if isinstance(t, dict) else str(t) for t in raw_tags]
        elif isinstance(raw_tags, str) and raw_tags.strip():
            tags += [t.strip() for t in raw_tags.split(",") if t.strip()]

        filename = f"hinote-{nid}"
        try:
            conn.execute("""
                INSERT INTO audio_metadata
                    (filename, file_path, file_size, duration_seconds, date_created,
                     processing_status, transcription_text, transcription_language,
                     ai_summary, user_title, user_tags, display_title, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(filename) DO UPDATE SET
                    transcription_text=excluded.transcription_text,
                    ai_summary=excluded.ai_summary,
                    date_created=excluded.date_created,
                    duration_seconds=excluded.duration_seconds,
                    display_title=excluded.display_title,
                    updated_at=excluded.updated_at
            """, (
                filename, f"hinotes://{nid}", 0, duration, created,
                "completed", content, lang, summary or "",
                title, json.dumps(tags, ensure_ascii=False),
                title or summary or filename, now,
            ))
            imported += 1
        except sqlite3.Error as e:
            skipped += 1
            print(f"  ⚠️  {filename}: {e}", file=sys.stderr)
    conn.commit()
    out({"imported": imported, "skipped": skipped,
         "sin_contenido_completo": no_content, "db": db,
         "next": "python3 hidock_notes.py stats  →  luego 'organiza mis notas' en Claude Code."})


def _ensure_schema(conn):
    """Crea el esquema de HiDock si la base aún no existe (mismo esquema que la app)."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS audio_metadata (
            filename TEXT PRIMARY KEY, file_path TEXT NOT NULL, file_size INTEGER NOT NULL,
            duration_seconds REAL NOT NULL, date_created TIMESTAMP NOT NULL,
            processing_status TEXT NOT NULL DEFAULT 'not_processed',
            processing_started_at TIMESTAMP, processing_completed_at TIMESTAMP, processing_error TEXT,
            transcription_text TEXT, transcription_confidence REAL, transcription_language TEXT,
            ai_summary TEXT, ai_participants TEXT, ai_action_items TEXT, ai_topics TEXT,
            ai_sentiment TEXT, ai_key_quotes TEXT,
            user_title TEXT, user_description TEXT, user_participants TEXT, user_action_items TEXT,
            user_tags TEXT, user_notes TEXT, display_title TEXT, display_description TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    """)
    conn.commit()


def build_parser():
    p = argparse.ArgumentParser(description="Sincroniza notas de HiNotes cloud a local.")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("probe", help="Verifica el token y muestra tu info de usuario.")
    fp = sub.add_parser("fetch", help="Descarga notas+carpetas+contenido a JSON crudo.")
    fp.add_argument("--import", dest="do_import", action="store_true",
                    help="Importa a la base local justo después de descargar.")
    fp.add_argument("--list-only", dest="list_only", action="store_true",
                    help="Solo metadata (sin bajar el contenido completo por nota).")
    fp.add_argument("--refresh", action="store_true",
                    help="Re-descarga el contenido aunque ya esté en cache.")
    sub.add_parser("import", help="Importa el JSON descargado a la base local.")
    return p


def main():
    args = build_parser().parse_args()
    {"probe": cmd_probe, "fetch": cmd_fetch, "import": cmd_import}[args.cmd](args)


if __name__ == "__main__":
    main()
