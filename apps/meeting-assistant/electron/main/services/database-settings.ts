import { getDatabase, mapRows } from "./database";
import type { Setting, SettingType } from "./database-types";

const SETTING_COLS = ["key", "value", "type", "category"];

export function getSetting(key: string): Setting | null {
  const database = getDatabase();
  const result = database.exec(
    `SELECT ${SETTING_COLS.join(", ")} FROM settings WHERE key = ?`,
    [key],
  );
  const rows = mapRows<Setting>(result, SETTING_COLS);
  return rows[0] ?? null;
}

export function setSetting(
  key: string,
  value: string,
  type: SettingType = "string",
  category: string = "general",
): void {
  const database = getDatabase();
  database.run(
    `INSERT INTO settings (key, value, type, category) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, type = excluded.type, category = excluded.category`,
    [key, value, type, category],
  );
}

export function getSettingsByCategory(category: string): Setting[] {
  const database = getDatabase();
  const result = database.exec(
    `SELECT ${SETTING_COLS.join(", ")} FROM settings WHERE category = ? ORDER BY key`,
    [category],
  );
  return mapRows<Setting>(result, SETTING_COLS);
}
