// Агент 1 — ОТКРИВАЧ. Тегли поръчки от TED по ДВЕ независими мрежи — CPV кодове и
// ключови думи в текста — дедуплицира и записва в db.
// Защо две: по нашите CPV кода се хващат 70 от 164 реални ехограф-обявления (43%),
// защото възложителите кодират с общия 33100000 вместо със специфичния код. Текстовата
// мрежа вижда поръчката независимо как е кодирана. Виж config/keywords.js.
import { CPV_CODES } from "../config/cpv.js";
import { activeKeywords, TERM_GROUP } from "../config/keywords.js";
import { fetchTedAll } from "../sources/ted.js";
import { upsertTenders, logRun } from "../database/db.js";

export async function runDiscovery() {
  const keywords = activeKeywords();
  const opts = {
    sinceDays: Number(process.env.DISCOVERY_LOOKBACK_DAYS || 30),
    noticeType: process.env.DISCOVERY_NOTICE_TYPE || "cn-standard",
  };

  console.log(
    `[discovery] TED: ${CPV_CODES.length} CPV кода + ${keywords.length} ключови думи, ${opts.sinceDays} дни назад...`,
  );
  const { notices, stats, byNet } = await fetchTedAll({ cpvCodes: CPV_CODES, keywords, ...opts });
  const { added, total } = await upsertTenders(notices);

  // Колко е добавила текстовата мрежа над CPV мрежата — това е числото, което показва
  // дали думите си вършат работата.
  const onlyKeyword = notices.filter((n) => n.foundBy.every((f) => f.startsWith("дума")));
  await logRun({ type: "discovery", found: notices.length, added, total, stats, opts, byNet, onlyKeyword: onlyKeyword.length });

  console.log(`[discovery] открити ${notices.length} уникални | ${added} нови | ${total} общо в базата`);
  console.log(`  по CPV: ${byNet.cpv} | по думи: ${byNet.keyword} | САМО по дума (CPV мрежата би ги изпуснала): ${onlyKeyword.length}`);

  const errors = stats.filter((s) => s.error);
  const empty = stats.filter((s) => !s.error && s.total === 0 && s.kind === "keyword");
  for (const s of stats.filter((x) => x.kind === "cpv")) {
    if (s.error) console.log(`  CPV ${s.key}: ГРЕШКА ${s.error}`);
    else console.log(`  CPV ${s.key}: ${s.returned}/${s.total}`);
  }
  const hits = stats.filter((s) => s.kind === "keyword" && !s.error && s.total > 0);
  if (hits.length) {
    console.log("  думи с попадения:");
    for (const s of hits.sort((a, b) => b.total - a.total)) {
      console.log(`    „${s.key}“ (${TERM_GROUP[s.key] || "?"}): ${s.returned}/${s.total}`);
    }
  }
  if (empty.length) console.log(`  думи без попадения този период: ${empty.map((s) => s.key).join(", ")}`);
  if (errors.length) console.log(`  ГРЕШКИ по ${errors.length} заявки: ${errors.map((s) => s.key).join(", ")}`);

  if (onlyKeyword.length) {
    console.log("  примери, видими САМО по текста:");
    for (const n of onlyKeyword.slice(0, 10)) {
      console.log(`    ${n.id} | ${n.foundBy.join(", ")} | CPV в обявлението: ${n.cpvCodes || "—"} | ${(n.title || "").slice(0, 60)}`);
    }
  }

  return { found: notices.length, added, total, byNet, onlyKeyword: onlyKeyword.length };
}
