// Агент 2 — КЛАСИФИКАТОР. За всяка NEW поръчка: чете описанието (от TED) и мачва срещу
// реалния каталог на Infinita (data/catalog.json) с Claude → score 0-100 + RELEVANT/SKIP.
import Anthropic from "@anthropic-ai/sdk";
import { db } from "../database/db.js";
import { categorySummary, relevantSlice } from "../sources/catalog.js";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";
const THRESHOLD = Number(process.env.CLASSIFY_THRESHOLD || 50);

// Построява prompt-а за една поръчка. Изнесено, за да може dry-run без API ключ.
export function buildPrompt(tender) {
  const cats = categorySummary()
    .filter((c) => c.count >= 3)
    .map((c) => `- ${c.name} (${c.count})`)
    .join("\n");
  const slice = relevantSlice(tender.cpv);
  const sliceTxt = slice.length
    ? slice
        .map((c) => `### ${c.name} (${c.count})\n${(c.samples || []).join("; ")}`)
        .join("\n")
    : "(няма пряко съвпадение по CPV ключови думи — прецени по описанието)";

  const tenderTxt = [
    `Заглавие: ${tender.title}`,
    `Възложител: ${tender.buyer}`,
    `CPV: ${tender.cpvCodes || tender.cpv}`,
    `Стойност: ${tender.estimatedValue || "—"} ${tender.currency || ""}`,
    `Срок: ${tender.deadline || "—"}`,
    `Описание: ${tender.description || "(няма в TED — виж PDF: " + (tender.pdfBg || "—") + ")"}`,
  ].join("\n");

  const system =
    "Ти си експерт по обществени поръчки за медицинско оборудване в Infinita OOD. " +
    "Оцени дали Infinita може да участва, въз основа на каталога ѝ. Бъди консервативен — " +
    "висок score само ако имаме реално подходящ продукт. Върни САМО валиден JSON: " +
    '{"score":0-100,"matched_category":string|null,"matched_products":string[],"gaps":string[],"verdict":string}';

  const user =
    `КАТАЛОГ НА INFINITA (категории с брой продукти):\n${cats}\n\n` +
    `ФОКУС ПО CPV НА ТАЗИ ПОРЪЧКА:\n${sliceTxt}\n\n` +
    `ПОРЪЧКА:\n${tenderTxt}`;

  return { system, user };
}

async function scoreTender(client, tender) {
  const { system, user } = buildPrompt(tender);
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: user }],
  });
  const text = msg.content.find((c) => c.type === "text")?.text || "{}";
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return { score: 0, verdict: "не успях да парсна отговора", raw: text };
  }
}

export async function runClassifier({ limit = 50 } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("[classifier] липсва ANTHROPIC_API_KEY — пропускам (виж dry-run: npm run classify:dry)");
    return { classified: 0 };
  }
  const client = new Anthropic();
  const pending = db.data.tenders.filter((t) => t.status === "NEW").slice(0, limit);
  console.log(`[classifier] оценявам ${pending.length} нови поръчки...`);

  let classified = 0;
  for (const t of pending) {
    const match = await scoreTender(client, t);
    t.score = match.score;
    t.match = match;
    t.status = match.score >= THRESHOLD ? "RELEVANT" : "SKIP";
    classified++;
    console.log(`  ${t.id} → ${t.score} (${t.status}) — ${(t.title || "").slice(0, 55)}`);
  }
  await db.write();
  return { classified };
}
