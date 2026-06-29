// lowdb JSON база (както в Skyrent / infinita-logistic).
import { JSONFilePreset } from "lowdb/node";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH || "./data/db.json";

mkdirSync(dirname(DB_PATH), { recursive: true });

const defaultData = {
  tenders: [], // всички открити поръчки (нормализирани)
  runs: [], // лог на discovery пусканията
};

export const db = await JSONFilePreset(DB_PATH, defaultData);

// Upsert по id; запазва ръчни промени по статуса (напр. RELEVANT/SKIP), ако вече съществува.
export async function upsertTenders(notices) {
  const existing = new Map(db.data.tenders.map((t) => [t.id, t]));
  let added = 0;
  for (const n of notices) {
    if (existing.has(n.id)) {
      const cur = existing.get(n.id);
      // не пипай статус/оценка, ако вече са обработени
      Object.assign(cur, { ...n, status: cur.status, score: cur.score, match: cur.match });
    } else {
      existing.set(n.id, n);
      added++;
    }
  }
  db.data.tenders = [...existing.values()];
  await db.write();
  return { added, total: db.data.tenders.length };
}

export async function logRun(entry) {
  db.data.runs.unshift({ at: new Date().toISOString(), ...entry });
  db.data.runs = db.data.runs.slice(0, 200);
  await db.write();
}
