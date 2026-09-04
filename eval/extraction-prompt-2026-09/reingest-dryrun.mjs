// READ-ONLY dry-run for the re-ingest scope. Derives scope at runtime:
// every transcript that currently has a graph_ingested_transcripts marker.
// Reports the recording IDs + per-recording removal counts. Deletes NOTHING.
import Database from '/Users/kellypearson/Documents/Codex/2026-08-27/referenced-chatgpt-conversation-this-is-an/hidock-next/packages/database/node_modules/better-sqlite3/lib/index.js';
const db = new Database(process.env.HOME + '/HiDock/data/hidock.db', { readonly: true });

// SCOPE: transcripts with an ingest marker, mapped to their recording.
const scope = db.prepare(`
  SELECT git.transcript_id AS tid, t.recording_id AS rid,
         COALESCE(kc.user_title, m.subject, kc.title, r.filename, '(none)') AS title,
         length(t.full_text) AS len,
         kc.id AS capture_id
  FROM graph_ingested_transcripts git
  JOIN transcripts t ON t.id = git.transcript_id
  LEFT JOIN recordings r ON r.id = t.recording_id
  LEFT JOIN knowledge_captures kc ON kc.source_recording_id = t.recording_id
  LEFT JOIN meetings m ON m.id = r.meeting_id
  ORDER BY r.date_recorded ASC
`).all();

let totNodes=0, totEdges=0, totDec=0, totAct=0, totMarkers=scope.length, totEdgeSources=0;
console.log(`\n=== RE-INGEST DRY RUN (read-only, nothing deleted) ===`);
console.log(`Scope derived at runtime: ${scope.length} transcripts with a graph_ingested_transcripts marker.\n`);
console.log('rid'.padEnd(38), 'nodes','edges','dec','act','  title');
for (const r of scope) {
  const nodes = db.prepare('SELECT COUNT(*) n FROM graph_nodes WHERE source_recording_id=?').get(r.rid).n;
  const edgeSrc = db.prepare('SELECT COUNT(*) n FROM graph_edge_sources WHERE recording_id=?').get(r.rid).n;
  // edges attributable to this recording (via edge sources) — reported for transparency
  const dec = r.capture_id ? db.prepare('SELECT COUNT(*) n FROM decisions WHERE knowledge_capture_id=?').get(r.capture_id).n : 0;
  const act = r.capture_id ? db.prepare('SELECT COUNT(*) n FROM action_items WHERE knowledge_capture_id=?').get(r.capture_id).n : 0;
  totNodes+=nodes; totEdgeSources+=edgeSrc; totDec+=dec; totAct+=act;
  console.log(r.rid.padEnd(38), String(nodes).padStart(5), String(edgeSrc).padStart(5), String(dec).padStart(3), String(act).padStart(3), ' ', (r.title||'').slice(0,42));
}
console.log(`\n=== TOTALS that the real run would remove, then recreate via re-ingest ===`);
console.log(`  recordings in scope        : ${scope.length}`);
console.log(`  graph_ingested markers     : ${totMarkers}`);
console.log(`  graph_nodes (by src rec)   : ${totNodes}`);
console.log(`  graph_edge_sources rows    : ${totEdgeSources}`);
console.log(`  promoted decisions rows    : ${totDec}`);
console.log(`  promoted action_items rows : ${totAct}`);
console.log(`\nRecording IDs in scope (${scope.length}):`);
console.log(scope.map(r=>r.rid).join('\n'));

// whole-DB sanity totals (context)
const g = db.prepare('SELECT (SELECT COUNT(*) FROM graph_nodes) nodes,(SELECT COUNT(*) FROM graph_edges) edges,(SELECT COUNT(*) FROM decisions) dec,(SELECT COUNT(*) FROM action_items) act,(SELECT COUNT(*) FROM graph_ingested_transcripts) markers').get();
console.log(`\n=== whole-DB context (unchanged by dry run) ===`);
console.log(`  total graph_nodes=${g.nodes} graph_edges=${g.edges} decisions=${g.dec} action_items=${g.act} markers=${g.markers}`);
db.close();
