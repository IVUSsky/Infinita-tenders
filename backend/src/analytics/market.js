// Пазарен анализ на ехографи: от TED обявленията до обобщена картина на пазара.
//
// Защо е отделно от discovery: discovery гледа НАПРЕД (какво да офертираме утре),
// този модул гледа НАЗАД (кой спечели, на каква цена, срещу колко оферти).
// Един ред тук = една ОБОСОБЕНА ПОЗИЦИЯ, не цяла поръчка — иначе обемът се надува,
// защото ехографът често е една позиция в поръчка за 26 различни апарата.

import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseNotice } from "./notice-xml.js";

const BASE = process.env.TED_API_BASE || "https://api.ted.europa.eu/v3";
const HERE = dirname(fileURLToPath(import.meta.url));
const MARKET_PATH = process.env.MARKET_PATH || join(process.env.DATA_DIR || "./data", "market.json");
const XML_CACHE = process.env.XML_CACHE_DIR || join(process.env.DATA_DIR || "./data", "notice-xml");

// Фиксираният курс. До 31.12.2025 обявленията са в лева, от 01.01.2026 — в евро.
// ВАЖНО: конверсията се прави по валутата на ВСЯКО ПОЛЕ, не по датата на обявлението —
// в обявления от 2026 г. прогнозата може да е в лева, а офертата в евро.
const BGN_PER_EUR = 1.95583;

// Тесните кодове хващат само половината от случаите: около 48% от позициите за ехограф
// се кодират с общия 33100000 / 33000000. Затова търсим и широко, а решението дали
// позицията е ехограф се взима на ниво ОБОСОБЕНА ПОЗИЦИЯ от XML-а, не по CPV.
const CPVS = ["33112000", "33112100", "33112200", "33112300", "33112310", "33112320", "33112330", "33112340"];
const CPVS_WIDE = ["33000000", "33100000", "33110000", "33115000"];
const KEYWORDS = ["ехограф", "ехографск", "ултразвук", "ехокардиограф", "доплер", "ultrasound"];

const FIELDS = [
  "publication-number", "publication-date", "notice-type", "buyer-name", "notice-title",
  "title-lot", "classification-cpv", "description-lot", "description-proc", "estimated-value-glo",
];

// Думи, по които отсяваме широкия улов, преди да сваляме XML-и.
const ULTRA_TEXT = /ехограф|ехокардиограф|сонограф|ултразвуков|ултразвукова|ултразвуково|ехо-?доплер|доплеров|трансдюсер|ultrasound|echograph|doppler/i;

const overrides = JSON.parse(readFileSync(join(HERE, "overrides.json"), "utf8"));

/* ---------------------------------------------------------------- помощни */

const pick = (v) => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.flat(4).filter((x) => typeof x === "string").join(" ~ ");
  if (typeof v === "object") return pick(v.bul ?? v.eng ?? Object.values(v)[0]);
  return String(v);
};

const toEur = (value, currency) => {
  const n = Number(value);
  if (!value || !isFinite(n)) return null;
  if (currency === "BGN") return Math.round((n / BGN_PER_EUR) * 100) / 100;
  if (!currency || currency === "EUR") return Math.round(n * 100) / 100;
  return null; // чужда валута — не гадаем
};

const norm = (s) => (s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 80);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------- 1. търсене в TED */

async function search(query, label, maxPages = 80) {
  const out = [];
  let retriedEmpty = false;
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(`${BASE}/notices/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, fields: FIELDS, limit: 100, page, scope: "ALL" }),
    });
    if (res.status === 429) { await sleep(4000); page--; continue; }
    if (!res.ok) {
      console.error(`[market] ${label}: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
      break;
    }
    const json = await res.json();
    const batch = json.notices || [];
    // TED понякога връща 200 с празен списък при натоварване — повтаряме веднъж,
    // вместо да решим, че такива обявления няма.
    if (!batch.length && page === 1 && !retriedEmpty) { retriedEmpty = true; await sleep(3000); page--; continue; }
    out.push(...batch);
    if (batch.length < 100) break;
    await sleep(400);
  }
  console.log(`[market] ${label}: ${out.length} обявления`);
  return out;
}

export async function findNotices({ from, to }) {
  const period = `publication-date>=${from.replace(/-/g, "")} AND publication-date<=${to.replace(/-/g, "")}`;
  // Тесните заявки влизат както са. Широките се прецеждат по текст, за да не теглим 6000 XML-а.
  const narrow = [
    [`buyer-country=BGR AND (${CPVS.map((c) => `classification-cpv=${c}`).join(" OR ")}) AND ${period}`, "по CPV за ултразвук", false],
    // Групиран OR вътре в FT~ връща 0 — всяка дума си има отделна заявка.
    ...KEYWORDS.map((k) => [`buyer-country=BGR AND FT ~ ("${k}") AND ${period}`, `по дума „${k}“`, false]),
    ...CPVS_WIDE.map((c) => [`buyer-country=BGR AND classification-cpv=${c} AND ${period}`, `широко CPV ${c}`, true]),
  ];

  const map = new Map();
  for (const [q, label, filter] of narrow) {
    for (const n of await search(q, label)) {
      const id = n["publication-number"];
      if (map.has(id)) continue;
      if (filter) {
        const text = [n["notice-title"], n["title-lot"], n["description-lot"], n["description-proc"]].map(pick).join(" \n ");
        if (!ULTRA_TEXT.test(text)) continue;
      }
      map.set(id, n);
    }
    await sleep(900); // TED връща 429 при бърза серия
  }
  return [...map.values()];
}

/* --------------------------------------------------- 2. сваляне на XML-ите */

async function fetchXml(id, attempt = 0) {
  mkdirSync(XML_CACHE, { recursive: true });
  const path = join(XML_CACHE, `${id}.xml`);
  if (existsSync(path) && readFileSync(path, "utf8").length > 2000) return readFileSync(path, "utf8");
  const res = await fetch(`https://ted.europa.eu/en/notice/${id}/xml`);
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    await sleep(3000 * (attempt + 1));
    return fetchXml(id, attempt + 1);
  }
  if (!res.ok) return null;
  const text = await res.text();
  writeFileSync(path, text);
  return text;
}

/* ------------------------------------------------ 3. позиции за ултразвук */

const ULTRA = /ехограф|ехокардиограф|сонограф|ултразвуков[аио]?\s*(?:диагностич\w*\s*)?(?:апарат|систем|скенер|образн)|ултразвукова\s*диагност|ultrasound\s*(?:system|scanner|machine|unit|device|equipment)|ultrasonic\s*unit|ехоскоп|ехо-?доплер|трансдюсер|сонда за ехограф/i;
const ULTRA_WEAK = /ултразвук|доплер|ехо-?кардиограф|ultrasound|doppler/i;
const CPV_ULTRA = /^3311(20|21|22|23)/;
const CPV_SERVICE = /^50/;

const RULES = [
  // ред = [клас, тест]. Първото съвпадение печели.
  ["DRUG_APARAT", /скалпел|ултразвуков нож|ултразвукова вана|литотрип|инхалатор|небулизатор|физиотерап|ултразвуков аспиратор|дисектор|ултразвукова ножица|мамограф|ангиограф|остеоденситометр|остеоденситометър|електроенцефалограф|\bЕЕГ\b/i],
  ["KONSUMATIV", /термохартия|консуматив|реактив|биопсичн|нефростом|покрития за сонди|водач за .*трансдюсер/i],
  ["SERVIZ", /сервиз|извънгаранцион|абонамент|резервни части|профилакт|поддържане на медицинск/i],
];

function classifyLot({ notice, lotId, lotName, lotDesc, procTitle, cpvs }) {
  const manual = overrides[`${notice}|${lotId}`];
  if (manual) return { ...manual, source: "ръчна проверка" };

  const text = [lotName, lotDesc].join(" \n ");
  if (cpvs.some((c) => CPV_SERVICE.test(c))) return { class: "SERVIZ", source: "CPV 50xxxxxx" };
  for (const [cls, re] of RULES) if (re.test(text)) return { class: cls, source: "правило" };
  const hit = ULTRA.test(text) || cpvs.some((c) => CPV_ULTRA.test(c)) ||
    (ULTRA_WEAK.test(text) && ULTRA.test(procTitle || ""));
  return { class: hit ? "APARAT" : "NERELEVANT", source: "правило" };
}

function extractRows(id, xml, meta) {
  const p = parseNotice(xml);
  // 29 = обявление за възлагане, 38 = изменение/приключване на договор.
  const noticeType = meta["notice-type"] ||
    (p.subtype === "29" ? "can-standard" : p.subtype === "38" ? "can-modif" : "cn-standard");
  const procText = [p.title, p.descProc].join(" \n ");
  const lots = p.lots.length ? p.lots : [{
    lotId: "LOT-0001", name: p.title, desc: p.descProc, cpv: p.cpvMain,
    cpvAdd: [], est: p.estTotal, estCur: p.estCur, deadline: "",
  }];
  const rows = [];

  for (const l of lots) {
    const cpvs = [l.cpv, ...(l.cpvAdd || [])].filter(Boolean);
    const text = [l.name, l.desc].join(" \n ");
    const relevant = ULTRA.test(text) || cpvs.some((c) => CPV_ULTRA.test(c)) ||
      (ULTRA_WEAK.test(text) && ULTRA.test(procText));
    if (!relevant) continue;

    const verdict = classifyLot({
      notice: id, lotId: l.lotId, lotName: l.name, lotDesc: l.desc, procTitle: p.title, cpvs,
    });

    const res = p.results.find((r) => r.lotId === l.lotId);
    let winners = [], awarded = null, awCur = "", nBids = "", status = "", conDate = "", consortium = "";
    if (res) {
      status = res.status;
      nBids = res.nTenders;
      awCur = res.cur;
      awarded = res.lower || res.higher || null;
      const tenders = p.tenders.filter((t) => res.tenders.includes(t.tenderId));
      // Стойността идва от офертата, не от обобщението по позицията:
      // обобщението понякога съдържа МЕСЕЧНА такса вместо обща стойност на договора.
      if (tenders.length && tenders[0].payable) { awarded = tenders[0].payable; awCur = tenders[0].cur || awCur; }
      const orgIds = [...new Set(tenders.flatMap((t) => p.parties[t.tpa] || []))];
      winners = [...new Set(orgIds.map((o) => (p.orgs[o] || {}).name).filter(Boolean))];
      const ref = tenders.map((t) => t.ref).filter(Boolean).join(" ");
      const dzzd = ref.match(/(ДЗЗД|ОБЕДИНЕНИЕ|Консорциум)[^"]*/i);
      if (dzzd) consortium = dzzd[0].replace(/[„“"]/g, "").trim();
      const con = p.contracts.find((c) => res.contracts.includes(c.conId));
      if (con) conDate = con.date;
    }

    rows.push({
      notice: id, folder: p.folder, noticeType, pubDate: pick(meta["publication-date"]).slice(0, 10) || p.pubDate,
      buyer: p.buyer, buyerEik: p.buyerId, city: (p.buyerCity || "").replace(/^гр\.?\s*/i, ""),
      procTitle: p.title, lotId: l.lotId, lotName: l.name, lotDesc: (l.desc || "").slice(0, 600),
      cpv: cpvs.join(","),
      class: verdict.class, classSource: verdict.source, vet: !!verdict.vet,
      klas: verdict.klas || "", broj: verdict.broj || null, note: verdict.note || "",
      est: toEur(l.est, l.estCur || p.estCur), awarded: toEur(awarded, awCur),
      winners: winners.join(" + "), consortium, nBids, status, conDate,
      deadline: l.deadline || "",
      url: `https://ted.europa.eu/bg/notice/-/detail/${id}`,
    });
  }
  return rows;
}

/* ------------------------- 4. консолидация: една процедура+позиция = 1 ред */

function consolidate(rows) {
  const groups = {};
  for (const r of rows) (groups[`${r.folder}||${norm(r.lotName)}`] ||= []).push(r);

  return Object.values(groups).map((g) => {
    const cns = g.filter((r) => r.noticeType.startsWith("cn"));
    const cans = g.filter((r) => r.noticeType === "can-standard" || r.noticeType === "can-social");
    const mods = g.filter((r) => r.noticeType === "can-modif");
    const base = cans[0] || cns[0] || g[0];
    const a = cans.find((r) => r.winners) || mods.find((r) => r.winners) || cans[0] || null;

    const est = g.map((r) => r.est).find((v) => typeof v === "number" && v > 0) ?? null;
    const awarded = a && typeof a.awarded === "number" ? a.awarded : null;
    const winners = a?.winners || "";
    const deadline = g.map((r) => r.deadline).filter(Boolean).sort().pop() || "";

    let status;
    if (winners) status = "Сключен договор";
    else if (a && /clos/.test(a.status || "")) status = "Прекратена";
    else if (cans.length || mods.length) status = "Решение без избор";
    else if (deadline && deadline < new Date().toISOString().slice(0, 10)) status = "Изтекъл срок, без решение";
    else status = "Отворена";

    return {
      folder: base.folder,
      noticesCn: cns.map((r) => r.notice).join(", "),
      noticeAward: a?.notice || "",
      srcType: !a ? "" : a.noticeType === "can-modif" ? "приключване/изменение" : "решение за избор",
      announced: cns[0]?.pubDate || base.pubDate,
      awardPub: a?.pubDate || "",
      contractDate: a?.conDate || "",
      deadline,
      buyer: base.buyer, buyerEik: base.buyerEik, city: base.city,
      procTitle: base.procTitle, lotId: base.lotId, lotName: base.lotName, lotDesc: base.lotDesc,
      cpv: base.cpv, class: base.class, classSource: base.classSource,
      vet: base.vet, klas: base.klas, broj: base.broj, note: base.note,
      est, awarded,
      saving: est && awarded ? Math.round((1 - awarded / est) * 1000) / 10 : null,
      unit: awarded && base.broj > 0 ? Math.round(awarded / base.broj) : null,
      nBids: a?.nBids || "", winners,
      consortium: a?.consortium || "",
      winnerLabel: a?.consortium ? `${a.consortium} (${winners})` : winners,
      status,
      url: base.url,
    };
  });
}

/* --------------------------------------------------------- 5. обобщения */

const med = (a) => {
  const b = [...a].sort((x, y) => x - y);
  if (!b.length) return 0;
  return b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2;
};
const total = (a) => Math.round(a.reduce((s, x) => s + x, 0));

export function aggregate(rows, { from, to }) {
  const apar = rows.filter((r) => r.class === "APARAT");
  const inWindow = (r) => r.awardPub >= from && r.awardPub <= to;
  const won = apar.filter((r) => r.winners && r.srcType === "решение за избор" && inWindow(r) && r.awarded);
  const service = rows.filter((r) => r.class === "SERVIZ");
  const open = apar.filter((r) => !r.winners && /Отворена|без решение/.test(r.status));
  const cancelled = apar.filter((r) => !r.winners && r.status === "Прекратена");

  const TOT = total(won.map((r) => r.awarded));
  const group = (list, keyFn) => {
    const m = {};
    for (const r of list) {
      const k = keyFn(r);
      (m[k] ||= { key: k, n: 0, eur: 0, single: 0, buyers: new Set() });
      m[k].n++; m[k].eur += r.awarded; m[k].buyers.add(r.buyer);
      if (String(r.nBids) === "1") m[k].single++;
    }
    return Object.values(m)
      .map((v) => ({ ...v, eur: Math.round(v.eur), buyers: v.buyers.size, share: TOT ? v.eur / TOT : 0 }))
      .sort((a, b) => b.eur - a.eur);
  };

  const BANDS = [["под 25 000 €", 0, 25000], ["25 000 – 100 000 €", 25000, 1e5],
    ["100 000 – 300 000 €", 1e5, 3e5], ["над 300 000 €", 3e5, Infinity]];
  const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
  const cycle = won.map((r) => days(r.announced, r.awardPub)).filter((d) => d > 0 && d < 400);
  const windowDl = won.map((r) => days(r.announced, r.deadline)).filter((d) => d > 0 && d < 200);
  const savings = won.filter((r) => r.est > 0).map((r) => 1 - r.awarded / r.est).filter((v) => v > -0.5 && v < 0.95);

  return {
    period: { from, to },
    generatedAt: new Date().toISOString(),
    kpi: {
      totalEur: TOT,
      lots: won.length,
      buyers: new Set(won.map((r) => r.buyer)).size,
      suppliers: new Set(won.map((r) => r.consortium || r.winners)).size,
      medianDeal: Math.round(med(won.map((r) => r.awarded))),
      singleBid: won.filter((r) => String(r.nBids) === "1").length,
      avgSaving: savings.length ? +(savings.reduce((a, b) => a + b, 0) / savings.length * 100).toFixed(1) : 0,
      serviceEur: total(service.filter((r) => r.awarded).map((r) => r.awarded)),
      serviceLots: service.length,
      openLots: open.length,
      openEur: total(open.filter((r) => r.est).map((r) => r.est)),
      cancelled: cancelled.length,
      medianCycleDays: Math.round(med(cycle)),
      medianTenderWindowDays: Math.round(med(windowDl)),
      infinitaEur: total(won.filter((r) => /ИНФИНИТА/i.test(r.winners)).map((r) => r.awarded)),
      infinitaLots: won.filter((r) => /ИНФИНИТА/i.test(r.winners)).length,
    },
    suppliers: group(won, (r) => r.consortium || r.winners),
    buyers: group(won, (r) => r.buyer),
    cities: group(won, (r) => r.city || "—"),
    quarters: group(won, (r) => `${r.awardPub.slice(0, 4)}-Q${Math.floor((+r.awardPub.slice(5, 7) - 1) / 3) + 1}`)
      .sort((a, b) => a.key.localeCompare(b.key)),
    bands: BANDS.map(([label, lo, hi]) => {
      const s = won.filter((r) => r.awarded >= lo && r.awarded < hi);
      return {
        key: label, n: s.length, eur: total(s.map((r) => r.awarded)),
        median: Math.round(med(s.map((r) => r.awarded))),
        single: s.filter((r) => String(r.nBids) === "1").length,
        share: TOT ? total(s.map((r) => r.awarded)) / TOT : 0,
      };
    }),
    bids: group(won, (r) => r.nBids || "няма данни").sort((a, b) => (+a.key || 9) - (+b.key || 9)),
    unitPrices: won.filter((r) => r.unit).map((r) => ({
      date: r.awardPub, buyer: r.buyer, lot: r.lotName, broj: r.broj,
      eur: r.awarded, unit: r.unit, winner: r.winnerLabel,
    })).sort((a, b) => b.unit - a.unit),
    counts: rows.reduce((m, r) => ({ ...m, [r.class]: (m[r.class] || 0) + 1 }), {}),
  };
}

/* ------------------------------------------------------------ 6. конвейер */

export async function buildMarket({ from = "2025-10-01", to = new Date().toISOString().slice(0, 10) } = {}) {
  const started = Date.now();
  const notices = await findNotices({ from, to });
  console.log(`[market] уникални обявления: ${notices.length}`);

  const raw = [];
  let failed = 0;
  for (const meta of notices) {
    const id = meta["publication-number"];
    const xml = await fetchXml(id);
    if (!xml) { failed++; continue; }
    try {
      raw.push(...extractRows(id, xml, meta));
    } catch (err) {
      failed++;
      console.error(`[market] ${id}: ${err.message}`);
    }
  }

  const rows = consolidate(raw).sort((a, b) =>
    (b.awardPub || b.announced).localeCompare(a.awardPub || a.announced));
  const agg = aggregate(rows, { from, to });
  const payload = {
    ...agg,
    stats: { notices: notices.length, lotRows: raw.length, rows: rows.length, failed, ms: Date.now() - started },
    rows,
  };

  mkdirSync(dirname(MARKET_PATH), { recursive: true });
  writeFileSync(MARKET_PATH, JSON.stringify(payload, null, 1));
  console.log(`[market] готово: ${rows.length} позиции, ${agg.kpi.lots} със сключен договор, ${agg.kpi.totalEur.toLocaleString("bg-BG")} € · ${Math.round(payload.stats.ms / 1000)} сек.`);
  return payload;
}

export function readMarket() {
  if (!existsSync(MARKET_PATH)) return null;
  try {
    return JSON.parse(readFileSync(MARKET_PATH, "utf8"));
  } catch {
    return null;
  }
}
