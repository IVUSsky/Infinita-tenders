// Каталог на Infinita — зарежда data/catalog.json (export от Odoo TEST, scripts/export-catalog.sql).
// Дава компактно резюме (за решение релевантна/не) и фокусиран срез по CPV (за дълбок мач).
import { readFileSync } from "node:fs";
import { INFINITA_CPV } from "../config/cpv.js";

const CATALOG_PATH = process.env.CATALOG_PATH || "./data/catalog.json";

let _cats = null;
function load() {
  if (_cats) return _cats;
  _cats = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) || [];
  return _cats;
}

// Компактен списък категории (дедупликиран по име, със сумарен брой) — целият каталог в ~5KB.
export function categorySummary() {
  const byName = new Map();
  for (const c of load()) {
    const n = (c.name || "").trim();
    if (!n) continue;
    byName.set(n, (byName.get(n) || 0) + Number(c.count || 0));
  }
  return [...byName.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

// Категории, релевантни на даден CPV код — по ключови думи от config/cpv.js (lines).
export function relevantSlice(cpvCodes = "") {
  const codes = String(cpvCodes).split(",").map((s) => s.trim());
  const keywords = new Set();
  for (const entry of INFINITA_CPV) {
    if (codes.includes(entry.code)) entry.lines.forEach((l) => keywords.add(l.toLowerCase()));
  }
  if (!keywords.size) return [];

  const byName = new Map();
  for (const c of load()) {
    const name = (c.name || "").toLowerCase();
    if (![...keywords].some((k) => name.includes(k.split(" ")[0]))) continue;
    const cur = byName.get(c.name);
    if (cur) {
      cur.count += Number(c.count || 0);
      for (const s of c.samples || []) if (cur.samples.length < 10 && !cur.samples.includes(s)) cur.samples.push(s);
    } else {
      byName.set(c.name, { name: c.name, count: Number(c.count || 0), samples: (c.samples || []).slice(0, 10) });
    }
  }
  return [...byName.values()].sort((a, b) => b.count - a.count);
}
