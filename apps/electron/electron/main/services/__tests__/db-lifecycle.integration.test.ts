
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import initSqlJs from 'sql.js'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'

// We will test the raw SCHEMA string and migration logic directly
// to avoid mocking the actual database service which has side effects.
const SCHEMA_FILE = join(__dirname, '../database.ts')
const MIGRATION_SQL_FILE = join(__dirname, '../../services/migrations/v11-knowledge-captures.sql')

describe('Database Lifecycle Integration', () => {
  let SQL: any
  let db: any
  let schemaContent: string

  beforeEach(async () => {
    SQL = await initSqlJs()
    db = new SQL.Database()
    
    // Extract the SCHEMA string from database.ts using a regex
    const databaseTs = readFileSync(SCHEMA_FILE, 'utf-8')
    const schemaMatch = databaseTs.match(/const SCHEMA = `([\s\S]*?)`/m)
    if (!schemaMatch) throw new Error('Could not find SCHEMA in database.ts')
    schemaContent = schemaMatch[1]
  })

  afterEach(() => {
    db.close()
  })

  it('should initialize a fresh database without foreign key errors', () => {
    // This executes the entire SCHEMA. If the order is wrong or tables are missing, it will throw.
    expect(() => db.run(schemaContent)).not.toThrow()
    
    // Verify critical Knowledge tables exist
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'")
    const tableNames = tables[0].values.map((v: any) => v[0])
    
    expect(tableNames).toContain('knowledge_captures')
    expect(tableNames).toContain('audio_sources')
    expect(tableNames).toContain('action_items')
    expect(tableNames).toContain('conversation_context')
    expect(tableNames).toContain('actionables')
  })

  it('should maintain data integrity through V11 migration', () => {
    // 1. Setup V10-like database (missing Knowledge tables)
    db.run(`
      CREATE TABLE recordings (id TEXT PRIMARY KEY, filename TEXT, date_recorded TEXT, status TEXT);
      CREATE TABLE transcripts (id TEXT PRIMARY KEY, recording_id TEXT, full_text TEXT, summary TEXT, action_items TEXT);
      INSERT INTO recordings (id, filename, date_recorded, status) VALUES ('r1', 'test.wav', '2025-01-01', 'transcribed');
      INSERT INTO transcripts (id, recording_id, full_text, summary, action_items) VALUES ('t1', 'r1', 'text', 'sum', '["item1"]');
    `)

    // 2. Simulate the V11 migration logic from database.ts
    const migrationSql = readFileSync(MIGRATION_SQL_FILE, 'utf-8')
    const statements = migrationSql
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0)

    for (const sql of statements) {
        try {
            db.run(sql)
        } catch (e: any) {
            if (!e.message.includes('already exists') && !e.message.includes('duplicate column name')) {
                throw e
            }
        }
    }

    // 3. Verify Alterations
    const columns = db.exec("PRAGMA table_info(recordings)")[0].values.map((v: any) => v[1])
    expect(columns).toContain('migration_status')
    expect(columns).toContain('migrated_to_capture_id')

    // 4. Verify Integrity (Foreign Key check)
    // Try to insert an actionable referencing a non-existent capture - should fail if FKs are active
    db.run("PRAGMA foreign_keys = ON")
    expect(() => {
        db.run("INSERT INTO actionables (id, type, title, source_knowledge_id) VALUES ('a1', 'task', 'title', 'invalid-id')")
    }).toThrow(/FOREIGN KEY constraint failed/)
  })
})
