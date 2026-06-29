// Агент 1 — ОТКРИВАЧ. Тегли поръчки от TED по нашите CPV кодове, дедуплицира, записва в db.
import { CPV_CODES } from "../config/cpv.js";
import { fetchTedNotices } from "../sources/ted.js";
import { upsertTenders, logRun } from "../database/db.js";

export async function runDiscovery() {
  const opts = {
    sinceDays: Number(process.env.DISCOVERY_LOOKBACK_DAYS || 30),
    noticeType: process.env.DISCOVERY_NOTICE_TYPE || "cn-standard",
  };

  console.log(`[discovery] TED търсене за ${CPV_CODES.length} CPV кода, ${opts.sinceDays} дни назад...`);
  const { notices, stats } = await fetchTedNotices(CPV_CODES, opts);
  const { added, total } = await upsertTenders(notices);

  await logRun({ type: "discovery", found: notices.length, added, total, stats, opts });

  console.log(`[discovery] открити ${notices.length} уникални | ${added} нови | ${total} общо в базата`);
  for (const s of stats) {
    if (s.error) console.log(`  CPV ${s.cpv}: ГРЕШКА ${s.error}`);
    else console.log(`  CPV ${s.cpv}: ${s.returned}/${s.total}`);
  }
  return { found: notices.length, added, total };
}
