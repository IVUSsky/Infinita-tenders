// Агент 3 — ДОКУМЕНТАЛИСТ. За RELEVANT поръчки генерира ЧЕРНОВА на техническо предложение
// + таблица за съответствие (изискване → продукт на Infinita → да/частично/не).
// Claude връща структуриран JSON → рендираме .md файл в data/drafts/<id>.md.
// ВАЖНО: това е чернова за вътрешен преглед. Финалното подаване в ЦАИС ЕОП е ръчно (КЕП).
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { db } from "../database/db.js";
import { relevantSlice } from "../sources/catalog.js";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";
const DRAFTS_DIR = process.env.DRAFTS_DIR || "./data/drafts";

export function buildDocPrompt(tender) {
  const slice = relevantSlice(tender.cpv)
    .map((c) => `### ${c.name} (${c.count})\n${(c.samples || []).join("; ")}`)
    .join("\n");
  const match = tender.match || {};

  const tenderTxt = [
    `Заглавие: ${tender.title}`,
    `Възложител: ${tender.buyer}`,
    `CPV: ${tender.cpvCodes || tender.cpv}`,
    `Срок за подаване: ${tender.deadline || "—"}`,
    `Описание/обособени позиции:\n${tender.description || "(виж PDF: " + (tender.pdfBg || "—") + ")"}`,
  ].join("\n");

  const system =
    "Ти си специалист по подготовка на оферти за обществени поръчки за медицинско оборудване " +
    "в Infinita OOD. Изготви ЧЕРНОВА на техническо предложение и таблица за съответствие по " +
    "обособени позиции. Бъди честен за пропуските — ако нямаме продукт, отбележи 'не'. " +
    "Това е чернова за вътрешен преглед, не финален документ. Върни САМО валиден JSON: " +
    '{"summary":string,' +
    '"lots":[{"position":string,"requirement":string,"offered_product":string|null,"compliant":"да"|"частично"|"не","note":string}],' +
    '"cover_letter":string,"open_questions":string[],"recommendation":string}';

  const user =
    `ПОРЪЧКА:\n${tenderTxt}\n\n` +
    `ОЦЕНКА ОТ КЛАСИФИКАТОРА:\nscore=${tender.score}; продукти=${(match.matched_products || []).join(", ")}; ` +
    `пропуски=${(match.gaps || []).join("; ")}\n\n` +
    `РЕЛЕВАНТНИ ПРОДУКТИ ОТ КАТАЛОГА:\n${slice || "(няма пряко съвпадение — ползвай описанието)"}`;

  return { system, user };
}

function renderMarkdown(tender, doc) {
  const rows = (doc.lots || [])
    .map((l) => {
      const mark = l.compliant === "да" ? "✅" : l.compliant === "частично" ? "⚠️" : "❌";
      return `| ${l.position || ""} | ${l.requirement || ""} | ${l.offered_product || "—"} | ${mark} ${l.compliant} | ${l.note || ""} |`;
    })
    .join("\n");

  return `# Чернова на техническо предложение

> ⚠️ **ЧЕРНОВА за вътрешен преглед.** Не е финален документ. Подаването в ЦАИС ЕОП изисква КЕП и ръчна проверка.

**Поръчка:** ${tender.title}
**Възложител:** ${tender.buyer}
**Публикация №:** ${tender.publicationNumber} · **Срок:** ${tender.deadline || "—"}
**Пълно досие (BG PDF):** ${tender.pdfBg || "—"}

## Резюме
${doc.summary || ""}

## Таблица за съответствие
| Обособена позиция | Изискване | Предлаган продукт | Съответствие | Бележка |
|---|---|---|---|---|
${rows}

## Придружително писмо (чернова)
${doc.cover_letter || ""}

## Отворени въпроси / за уточняване
${(doc.open_questions || []).map((q) => `- ${q}`).join("\n") || "—"}

## Препоръка
${doc.recommendation || ""}

---
*Генерирано автоматично от infinita-tenders на ${new Date().toISOString().slice(0, 10)}. Изисква преглед от човек.*
`;
}

async function draftTender(client, tender) {
  const { system, user } = buildDocPrompt(tender);
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content: user }],
  });
  const text = msg.content.find((c) => c.type === "text")?.text || "{}";
  if (msg.stop_reason === "max_tokens") {
    throw new Error("отговорът е орязан (max_tokens) — увеличи лимита");
  }
  const doc = JSON.parse(text.replace(/```json|```/g, "").trim());
  return doc;
}

export async function runDocumenter({ limit = 10 } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("[documenter] липсва ANTHROPIC_API_KEY — пропускам (виж: npm run document:dry)");
    return { drafts: 0 };
  }
  mkdirSync(DRAFTS_DIR, { recursive: true });
  const client = new Anthropic();
  const targets = db.data.tenders.filter((t) => t.status === "RELEVANT").slice(0, limit);
  console.log(`[documenter] изготвям чернови за ${targets.length} релевантни поръчки...`);

  let drafts = 0;
  for (const t of targets) {
    try {
      const doc = await draftTender(client, t);
      const md = renderMarkdown(t, doc);
      const path = `${DRAFTS_DIR}/${t.id}.md`;
      writeFileSync(path, md, "utf8");
      t.draft = { generatedAt: new Date().toISOString(), path, lots: doc.lots?.length || 0 };
      t.status = "DRAFTED";
      drafts++;
      console.log(`  ✓ ${t.id} → ${path} (${doc.lots?.length || 0} позиции)`);
    } catch (err) {
      console.log(`  ✗ ${t.id}: ${err.message}`);
    }
  }
  await db.write();
  return { drafts };
}
