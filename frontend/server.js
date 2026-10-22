// Един адрес за всичко: този сървър раздава готовия интерфейс от dist/
// и препраща /api/* към backend-а. Така дашбордът и API-то живеят на един URL
// и браузърът няма cross-origin заявки.
//
// API_ORIGIN = адресът на backend услугата (без наклонена черта накрая).
// На Railway най-добре е вътрешният адрес: http://<услуга>.railway.internal:<порт>
// Публичният URL също работи, само минава през интернет.

import express from "express";
import { createReadStream, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "dist");
const PORT = process.env.PORT || 3000;
const API_ORIGIN = (process.env.API_ORIGIN || "http://localhost:4010").replace(/\/+$/, "");

const app = express();

app.get("/healthz", (_req, res) => res.json({ ok: true, api: API_ORIGIN }));

// --- проксито към backend-а ---
app.use("/api", async (req, res) => {
  const target = API_ORIGIN + "/api" + req.url;
  const headers = { ...req.headers };
  delete headers.host;          // иначе backend-ът вижда чуждо Host
  delete headers["content-length"]; // тялото се препраща наново

  // Изчисляването на пазарния анализ е дълго — даваме му време.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10 * 60 * 1000);

  try {
    const hasBody = !["GET", "HEAD"].includes(req.method);
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req : undefined,
      duplex: hasBody ? "half" : undefined,
      signal: ac.signal,
      redirect: "manual",
    });
    res.status(upstream.status);
    upstream.headers.forEach((v, k) => {
      if (!/^(content-encoding|transfer-encoding|connection)$/i.test(k)) res.setHeader(k, v);
    });
    if (upstream.body) {
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) res.status(502);
    res.end(JSON.stringify({ error: "backend-ът не отговаря", detail: String(err?.message || err), target }));
  } finally {
    clearTimeout(timer);
  }
});

// --- статичният интерфейс ---
app.use(express.static(DIST, { index: false, maxAge: "1h" }));

// всичко останало отива към index.html (едностранично приложение)
app.use((req, res) => {
  const index = join(DIST, "index.html");
  if (!existsSync(index)) return res.status(500).send("липсва dist/ — изпълни npm run build");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  createReadStream(index).pipe(res);
});

app.listen(PORT, () => console.log(`дашборд + API на :${PORT} · /api → ${API_ORIGIN}`));
