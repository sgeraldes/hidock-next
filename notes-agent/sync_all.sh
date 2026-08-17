#!/bin/bash
# sync_all.sh — Sincroniza HiNotes → local → vault Markdown, todo de una.
# Pensado para correr a mano o desde un job programado (launchd/cron).
#
# El AccessToken se lee de ~/.hidock/hinotes_token (una sola línea).
# Cuando el token expire, actualiza ESE archivo con uno nuevo (DevTools → AccessToken).

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
TOKEN_FILE="$HOME/.hidock/hinotes_token"
LOG="$HOME/.hidock/sync.log"

if [ ! -f "$TOKEN_FILE" ]; then
  echo "❌ Falta $TOKEN_FILE con tu AccessToken de HiNotes." | tee -a "$LOG"
  exit 1
fi
export HINOTES_TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"

echo "===== sync $(date '+%Y-%m-%d %H:%M:%S') =====" >> "$LOG"

# 1) Verifica el token; si expiró, avisa y sale sin romper nada.
if ! python3 "$DIR/hinotes_sync.py" probe >/dev/null 2>>"$LOG"; then
  echo "⚠️  Token inválido/expirado. Actualiza $TOKEN_FILE." | tee -a "$LOG"
  exit 2
fi

# 2) Descarga (incremental: sólo baja el contenido de notas nuevas gracias al cache).
python3 "$DIR/hinotes_sync.py" fetch   >> "$LOG" 2>&1
# 3) Importa a la base local.
python3 "$DIR/hinotes_sync.py" import  >> "$LOG" 2>&1
# 4) Unifica tags.
python3 "$DIR/canon_tags.py"           >> "$LOG" 2>&1
# 5) Re-exporta el vault Markdown.
python3 "$DIR/hidock_notes.py" export --all >> "$LOG" 2>&1

echo "✅ sync ok $(date '+%H:%M:%S')" >> "$LOG"
echo "Sincronización completa. Log: $LOG"
