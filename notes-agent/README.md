# Agente organizador de notas (HiNotes)

Un subagente de Claude Code que organiza las transcripciones que **HiDock** guarda en
`~/.hidock/audio_metadata.db`: las titula, etiqueta, extrae action items, enlaza notas
relacionadas y las exporta a un vault Markdown (compatible con Obsidian).

## Piezas

- **`notes-agent/hinotes_sync.py`** — puente que baja tus notas de la nube **HiNotes**
  (hinotes.hidock.com) a la base local, usando tu AccessToken. Úsalo si tus notas ya
  viven en la app/web de HiNotes (no en un dispositivo por USB).
- **`notes-agent/hidock_notes.py`** — CLI (solo stdlib) que lee/escribe la base de HiDock
  de forma segura y exporta Markdown. Solo modifica campos `user_*`; nunca la transcripción
  ni el análisis de IA originales.
- **`.claude/agents/notes-organizer.md`** — definición del subagente que usa ese CLI.

## Flujo A — notas ya en la nube HiNotes (lo más común)

```bash
# 1. Consigue tu AccessToken: en https://hinotes.hidock.com → DevTools (F12) →
#    Network → click en "Notes" → Headers → copia el valor de "AccessToken" (64 chars).
export HINOTES_TOKEN=<tu token de 64 chars>

python3 notes-agent/hinotes_sync.py probe    # verifica el token
python3 notes-agent/hinotes_sync.py fetch     # descarga a ~/.hidock/hinotes_raw/*.json
python3 notes-agent/hinotes_sync.py import    # importa a la base local
python3 notes-agent/hidock_notes.py stats     # confirma cuántas notas hay
```

Luego, desde Claude Code: **"organiza mis notas"**.

### Todo-en-uno y sincronización automática

```bash
# Guarda tu token una vez (para el sync automático):
printf '%s' "<tu token>" > ~/.hidock/hinotes_token && chmod 600 ~/.hidock/hinotes_token

# Sincroniza todo de una (fetch → import → unificar tags → exportar vault):
bash notes-agent/sync_all.sh
```

**Automático (macOS launchd):** `~/Library/LaunchAgents/com.hinotes.sync.plist`
corre `sync_all.sh` **diario a las 21:00**.
- Cambiar frecuencia: edita `StartCalendarInterval` en el plist y recarga con
  `launchctl unload ... && launchctl load ...`.
- Desactivar: `launchctl unload ~/Library/LaunchAgents/com.hinotes.sync.plist`.
- ⚠️ El AccessToken **expira**. Cuando pase, el sync sale con código 2 (ver `~/.hidock/sync.log`)
  y hay que pegar un token nuevo en `~/.hidock/hinotes_token`.

### Otras piezas

- `canon_tags.py` — unifica tags duplicados/sinónimos (`--dry-run` para previsualizar).
- `_Dossiers/` en el vault — documentos consolidados generados por el agente
  (ej. `Lealtad-Retencion.md`, `Mis-Tareas.md`).

## Requisitos previos

1. Instalar y usar HiDock (Desktop app) para descargar y **transcribir** grabaciones.
   Eso crea `~/.hidock/audio_metadata.db`. Sin al menos una nota transcrita, no hay nada que organizar.
2. Claude Code (para invocar el subagente).

## Uso

Desde Claude Code, pídele en lenguaje natural:

- "organiza mis notas nuevas"
- "¿qué grabé esta semana? sácame los action items"
- "etiqueta las notas sin tags y expórtalas a Markdown"

Claude delega en el subagente `notes-organizer`, que corre el CLI por debajo.

## Uso manual del CLI (sin agente)

```bash
python3 notes-agent/hidock_notes.py stats
python3 notes-agent/hidock_notes.py pending
python3 notes-agent/hidock_notes.py show REC0001.hda
python3 notes-agent/hidock_notes.py set REC0001.hda --title "1:1 con Ana" --tags "trabajo,1on1" --action-items "Enviar brief;Agendar seguimiento"
python3 notes-agent/hidock_notes.py export --all
```

Variables de entorno:

- `HIDOCK_DB` — ruta a la base (default `~/.hidock/audio_metadata.db`).
- `HIDOCK_VAULT` — carpeta del vault Markdown (default `~/HiNotes-Vault`).
