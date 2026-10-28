// Express API — фуния от поръчки за фронтенд дашборда.
import "dotenv/config";
import express from "express";
import cors from "cors";
import { readFileSync } from "node:fs";
import { db } from "./database/db.js";
import { runDiscovery } from "./agents/discovery.js";
import { runClassifier } from "./agents/classifier.js";
import { runDocumenter } from "./agents/documenter.js";
import { upcomingDeadlines, runDeadlines } from "./agents/deadlines.js";
import { buildMarket, readMarket } from "./analytics/market.js";
import { KEYWORD_GROUPS, EXCLUDED_TERMS, activeKeywords } from "./config/keywords.js";
import { SEARCH_CPV, INFINITA_CPV } from "./config/cpv.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true, tenders: db.data.tenders.length }));

// Списък поръчки с филтър по статус: NEW | RELEVANT | SKIP
app.get("/api/tenders", (req, res) => {
  const { status } = req.query;
  let items = db.data.tenders;
  if (status) items = items.filter((t) => t.status === status);
  items = [...items].sort((a, b) => (b.publicationDate || "").localeCompare(a.publicationDate || ""));
  res.json({ count: items.length, items });
});

app.get("/api/deadlines", (req, res) => {
  const within = Number(req.query.days || 7);
  res.json({ items: upcomingDeadlines({ withinDays: within }) });
});

app.get("/api/runs", (_req, res) => res.json({ runs: db.data.runs.slice(0, 50) }));

// С какво точно търсим — групи ключови думи, CPV мрежи и отхвърлените думи с причината.
// Отговаря на въпроса „по кои думи търсим“ без да се чете кодът.
app.get("/api/keywords", (_req, res) => {
  const active = activeKeywords();
  // Последната обиколка — колко попадения е дала всяка дума реално.
  const lastRun = db.data.runs.find((r) => r.type === "discovery");
  const hits = Object.fromEntries(
    (lastRun?.stats || []).filter((s) => s.kind === "keyword").map((s) => [s.key, s.error ? "грешка" : s.total]),
  );
  res.json({
    cpvNets: SEARCH_CPV,
    cpvCatalogMap: INFINITA_CPV,
    broadEnabled: process.env.DISCOVERY_BROAD === "1",
    activeCount: active.length,
    groups: KEYWORD_GROUPS.map((g) => ({
      group: g.group,
      label: g.label,
      terms: g.terms.map((t) => ({ term: t, lastRunHits: hits[t] ?? null })),
      broad: (g.broad || []).map((t) => ({ term: t, lastRunHits: hits[t] ?? null, active: active.includes(t) })),
    })),
    excluded: EXCLUDED_TERMS,
    lastRunAt: lastRun?.at || null,
  });
});

// Черновата (markdown) за конкретна поръчка
app.get("/api/tenders/:id/draft", (req, res) => {
  const t = db.data.tenders.find((x) => x.id === req.params.id);
  if (!t?.draft?.path) return res.status(404).json({ error: "няма чернова" });
  try {
    res.type("text/markdown").send(readFileSync(t.draft.path, "utf8"));
  } catch {
    res.status(404).json({ error: "файлът липсва" });
  }
});

// --- Пазарен анализ (назад във времето: кой спечели, на каква цена, срещу колко оферти) ---

// Обобщенията без редовете — това зарежда дашбордът.
app.get("/api/market", (_req, res) => {
  const m = readMarket();
  if (!m) return res.status(404).json({ error: "няма изчислен анализ — пусни POST /api/market/refresh" });
  const { rows, ...rest } = m;
  res.json(rest);
});

// Редовете, по избор филтрирани: ?class=APARAT&status=Отворена
app.get("/api/market/rows", (req, res) => {
  const m = readMarket();
  if (!m) return res.status(404).json({ error: "няма изчислен анализ" });
  let rows = m.rows;
  if (req.query.class) rows = rows.filter((r) => r.class === req.query.class);
  if (req.query.status) rows = rows.filter((r) => r.status === req.query.status);
  if (req.query.winner) rows = rows.filter((r) => (r.winners || "").toLowerCase().includes(String(req.query.winner).toLowerCase()));
  res.json({ count: rows.length, rows });
});

// Преизчислява от TED. Бавно (минути) — затова отговаря веднага и работи на заден план.
let marketRunning = false;
app.post("/api/market/refresh", (req, res) => {
  if (marketRunning) return res.status(409).json({ error: "вече тече преизчисляване" });
  marketRunning = true;
  const opts = {};
  if (req.body?.from) opts.from = req.body.from;
  if (req.body?.to) opts.to = req.body.to;
  buildMarket(opts)
    .catch((err) => console.error("[market] провал:", err.message))
    .finally(() => { marketRunning = false; });
  res.json({ ok: true, started: true, note: "преизчисляването тече; след няколко минути GET /api/market ще върне новите данни" });
});

app.get("/api/market/status", (_req, res) => {
  const m = readMarket();
  res.json({ running: marketRunning, generatedAt: m?.generatedAt || null, stats: m?.stats || null });
});

// Ръчни тригери (за бутони в дашборда)
app.post("/api/discover", async (_req, res) => res.json(await runDiscovery()));
app.post("/api/classify", async (_req, res) => res.json(await runClassifier()));
app.post("/api/document", async (_req, res) => res.json(await runDocumenter()));
// Ръчно пуска проверката на сроковете + изпраща имейла (за тест)
app.post("/api/deadlines", async (req, res) => res.json(await runDeadlines(req.body?.withinDays ? { withinDays: Number(req.body.withinDays) } : {})));

// Отписва поръчка (отпада) — изключва я от дашборда и автоматичните имейли.
app.post("/api/tenders/:id/dismiss", async (req, res) => {
  const t = db.data.tenders.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: "няма такава поръчка" });
  if (t.status !== "DISMISSED") {
    t.prevStatus = t.status;
    t.status = "DISMISSED";
    await db.write();
  }
  res.json({ ok: true, id: t.id, status: t.status });
});
// Връща отписана поръчка обратно към предишния ѝ статус.
app.post("/api/tenders/:id/restore", async (req, res) => {
  const t = db.data.tenders.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: "няма такава поръчка" });
  if (t.status === "DISMISSED") {
    t.status = t.prevStatus || "RELEVANT";
    delete t.prevStatus;
    await db.write();
  }
  res.json({ ok: true, id: t.id, status: t.status });
});

// По избор: върти дневния конвейер в същия процес (за Railway — една услуга).
if (process.env.ENABLE_CRON === "true") {
  const cron = (await import("node-cron")).default;
  const schedule = process.env.CRON_SCHEDULE || "0 10 * * 1-5"; // работни дни 10:00
  const timezone = process.env.TZ || "Europe/Sofia";
  cron.schedule(
    schedule,
    async () => {
      console.log(`[cron] старт ${new Date().toISOString()}`);
      await runDiscovery();
      await runClassifier();
      await runDocumenter();
      const { runDeadlines } = await import("./agents/deadlines.js");
      await runDeadlines();
      console.log("[cron] готово");
    },
    { timezone }
  );
  console.log(`[cron] планиран в процеса: ${schedule} (${timezone})`);
}

const PORT = process.env.PORT || 4010;
app.listen(PORT, () => console.log(`infinita-tenders API на :${PORT}`));
