import Database from '/Users/kellypearson/Documents/Codex/2026-08-27/referenced-chatgpt-conversation-this-is-an/hidock-next/packages/database/node_modules/better-sqlite3/lib/index.js';
import { currentPrompt } from './prompts.mjs';
import { appendFileSync, existsSync, readFileSync } from 'fs';

const DB = process.env.HOME + '/HiDock/data/hidock.db';
const MODEL = 'llama3.2';
const OLLAMA = 'http://localhost:11434/api/generate';
const NDJSON = '/tmp/extract-eval/results-a.ndjson';   // arm A, all 18
const PROGRESS = '/tmp/extract-eval/progress-a.txt';

const db = new Database(DB, { readonly: true });
const rows = db.prepare(`
  SELECT t.id AS tid, t.recording_id AS rid, t.full_text AS full_text,
         COALESCE(kc.user_title, m.subject, kc.title, r.filename) AS title,
         r.date_recorded AS date
  FROM transcripts t
  JOIN recordings r ON r.id = t.recording_id
  LEFT JOIN knowledge_captures kc ON kc.source_recording_id = r.id
  LEFT JOIN meetings m ON m.id = r.meeting_id
  WHERE t.full_text IS NOT NULL AND length(t.full_text) > 0
  ORDER BY r.date_recorded ASC
`).all();
db.close();

// Seed from the partial arm-A run (8 already done) so we don't redo them.
const done = new Set();
if (existsSync(NDJSON)) for (const line of readFileSync(NDJSON,'utf8').split('\n')) {
  if (!line.trim()) continue; try { done.add(JSON.parse(line).rid); } catch {}
}

function parse(raw) {
  let s = (raw||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'').trim();
  const m = s.match(/\{[\s\S]*\}/); if (m) s = m[0];
  try { const o = JSON.parse(s);
    return {
      decisions: Array.isArray(o.decisions)? o.decisions.filter(x=>typeof x==='string'&&x.trim()):[],
      action_items: Array.isArray(o.action_items)? o.action_items.filter(a=>a&&typeof a.text==='string'&&a.text.trim()).map(a=>({text:a.text.trim(), owner:(typeof a.owner==='string'&&a.owner.trim())?a.owner.trim():undefined})):[],
    };
  } catch { return { decisions:[], action_items:[], _parseError:true }; }
}
async function ask(prompt) {
  const res = await fetch(OLLAMA, { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ model: MODEL, prompt, stream:false, options:{ temperature:0 } }) });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  return (await res.json()).response || '';
}

let i = 0;
for (const r of rows) {
  i++;
  if (done.has(r.rid)) { appendFileSync(PROGRESS, `[${i}/${rows.length}] SKIP ${r.title}\n`); continue; }
  const meta = { meetingId: r.rid, title: r.title, date: r.date };
  let a;
  try { a = parse(await ask(currentPrompt(r.full_text, meta))); } catch(e){ a={decisions:[],action_items:[],_err:String(e)}; }
  appendFileSync(NDJSON, JSON.stringify({ title:r.title, rid:r.rid, textLen:r.full_text.length, a }) + '\n');
  appendFileSync(PROGRESS, `[${i}/${rows.length}] ${(r.title||'').slice(0,45)} A(d${a.decisions.length}/a${a.action_items.length})${a._err?' ERR':''}\n`);
}
appendFileSync(PROGRESS, 'ALL DONE\n');
