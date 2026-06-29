// Express API — фуния от поръчки за фронтенд дашборда.
import "dotenv/config";
import express from "express";
import cors from "cors";
import { readFileSync } from "node:fs";
import { db } from "./database/db.js";
import { runDiscovery } from "./agents/discovery.js";
import { runClassifier } from "./agents/classifier.js";
import { runDocumenter } from "./agents/documenter.js";
import { upcomingDeadlines } from "./agents/deadlines.js";

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

// Ръчни тригери (за бутони в дашборда)
app.post("/api/discover", async (_req, res) => res.json(await runDiscovery()));
app.post("/api/classify", async (_req, res) => res.json(await runClassifier()));
app.post("/api/document", async (_req, res) => res.json(await runDocumenter()));

// По избор: върти дневния конвейер в същия процес (за Railway — една услуга).
if (process.env.ENABLE_CRON === "true") {
  const cron = (await import("node-cron")).default;
  const schedule = process.env.CRON_SCHEDULE || "0 7 * * *";
  cron.schedule(schedule, async () => {
    console.log(`[cron] старт ${new Date().toISOString()}`);
    await runDiscovery();
    await runClassifier();
    await runDocumenter();
    const { runDeadlines } = await import("./agents/deadlines.js");
    await runDeadlines();
    console.log("[cron] готово");
  });
  console.log(`[cron] планиран в процеса: ${schedule}`);
}

const PORT = process.env.PORT || 4010;
app.listen(PORT, () => console.log(`infinita-tenders API на :${PORT}`));
