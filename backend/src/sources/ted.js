// TED (Tenders Electronic Daily) адаптер — основен източник на поръчки.
// POST {TED_API_BASE}/notices/search — официален, БЕЗ API ключ.
// Валидирано на 2026-06-29: полета и query синтаксис работят за buyer-country=BGR.
// Допълнено на 2026-10-28: търсене по ТЕКСТ (FT ~) освен по CPV, защото CPV мрежата
// изпуска над половината поръчки. Виж config/keywords.js за измерената семантика.

const BASE = process.env.TED_API_BASE || "https://api.ted.europa.eu/v3";

// TED реже с HTTP 429 при няколко заявки в секунда, а една обиколка по ключови думи
// прави ~90 заявки. Паузата и повторенията не са излишни — без тях половината думи
// се връщат като грешка и поръчките по тях изглеждат като несъществуващи.
const THROTTLE_MS = Number(process.env.TED_THROTTLE_MS || 900);
const MAX_RETRIES = Number(process.env.TED_MAX_RETRIES || 5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Полета, потвърдени като валидни в TED Search API v1/v3.
// (Внимание: суфиксите са задължителни — "deadline-receipt-tender" без "-date-lot" се отхвърля.)
const FIELDS = [
  "publication-number",
  "notice-title",
  "buyer-name",
  "notice-type",
  "classification-cpv",
  "estimated-value-glo",
  "estimated-value-cur-glo",
  "deadline-receipt-tender-date-lot",
  "publication-date",
  "place-of-performance-post-code-part",
  "description-lot",
  "description-proc",
  "links",
];

// TED връща многоезични полета като { bul: "...", eng: "..." }, понякога вложени в масиви.
// Вади BG, после EN, после каквото има — и винаги връща плосък string.
function pickLang(v) {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(pickLang).filter(Boolean).join("; ") || null;
  if (typeof v === "object") return pickLang(v.bul ?? v.eng ?? Object.values(v)[0]);
  return String(v);
}

// Маха повтарящите се стойности (TED дава една и съща дата за всяка обособена позиция).
function dedupeJoin(s) {
  if (!s) return s;
  return [...new Set(s.split("; ").map((x) => x.trim()))].join("; ");
}

function ymd(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

// Нормализира едно TED обявление към вътрешния ни модел.
// `foundBy` казва КОЯ мрежа го е уловила — показва се в имейла, за да се вижда
// дали дадена ключова дума върши работа или само генерира шум.
function normalize(n, foundBy) {
  const links = n.links || {};
  const pub = n["publication-number"];
  return {
    id: pub, // напр. "3275-2026" — уникален в TED
    source: "ted",
    cpv: foundBy.kind === "cpv" ? foundBy.value : "",
    foundBy: [foundBy.kind === "cpv" ? `CPV ${foundBy.value}` : `дума „${foundBy.value}“`],
    publicationNumber: pub,
    title: pickLang(n["notice-title"]),
    buyer: pickLang(n["buyer-name"]),
    noticeType: n["notice-type"] || null,
    cpvCodes: n["classification-cpv"] || null,
    estimatedValue: pickLang(n["estimated-value-glo"]),
    currency: pickLang(n["estimated-value-cur-glo"]),
    deadline: dedupeJoin(pickLang(n["deadline-receipt-tender-date-lot"])),
    publicationDate: pickLang(n["publication-date"]),
    postCode: pickLang(n["place-of-performance-post-code-part"]),
    description: pickLang(n["description-lot"]) || pickLang(n["description-proc"]),
    // Готови линкове за класификатора/документиста:
    pdfBg: links?.pdf?.BUL || null,
    xml: links?.xml?.MUL || null,
    detailBg: links?.html?.BUL || null,
    status: "NEW",
    fetchedAt: new Date().toISOString(),
  };
}

// Една заявка към TED, с повторения при 429 и нарастващо изчакване.
async function tedSearch(query, limit = 100) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`${BASE}/notices/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, fields: FIELDS, limit, page: 1 }),
    });
    if (res.status === 429) {
      if (attempt === MAX_RETRIES) throw new Error("TED 429 след всички повторения");
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`TED ${res.status}: ${text.slice(0, 300)}`);
    }
    return await res.json();
  }
}

// Общите ограничители (държава, период, тип обявление) — еднакви за двете мрежи.
function baseFilters({ sinceDays = 30, noticeType = "cn-standard" } = {}) {
  const parts = [
    "buyer-country=BGR",
    `publication-date>=${ymd(new Date(Date.now() - sinceDays * 86400000))}`,
  ];
  if (noticeType) parts.push(`notice-type=${noticeType}`);
  return parts;
}

// Едно търсене за конкретен CPV код.
async function searchByCpv(cpv, opts = {}) {
  const query = [...baseFilters(opts), `classification-cpv=${cpv}`].join(" AND ");
  const data = await tedSearch(query, opts.limit || 100);
  const notices = (data.notices || []).map((n) => normalize(n, { kind: "cpv", value: cpv }));
  return { total: data.totalNoticeCount ?? notices.length, notices };
}

// Едно търсене по ключова дума в пълния текст на обявлението.
// FT ~ ("дума") е точен съседен израз при няколко думи и се нормализира по число при
// една — затова кавичките вътре в скобите са задължителни.
async function searchByKeyword(term, opts = {}) {
  const query = [...baseFilters(opts), `FT ~ ("${term}")`].join(" AND ");
  const data = await tedSearch(query, opts.limit || 100);
  const notices = (data.notices || []).map((n) => normalize(n, { kind: "keyword", value: term }));
  return { total: data.totalNoticeCount ?? notices.length, notices };
}

// Слива ново обявление в картата, като пази всички мрежи, които са го уловили.
function merge(byId, notices) {
  for (const n of notices) {
    const cur = byId.get(n.id);
    if (!cur) { byId.set(n.id, n); continue; }
    for (const f of n.foundBy) if (!cur.foundBy.includes(f)) cur.foundBy.push(f);
    if (n.cpv && !String(cur.cpv).split(",").includes(n.cpv)) {
      cur.cpv = cur.cpv ? `${cur.cpv},${n.cpv}` : n.cpv;
    }
  }
}

// Търси по списък CPV кодове и връща дедуплициран масив (по publication-number).
export async function fetchTedNotices(cpvCodes, opts = {}) {
  const byId = new Map();
  const stats = [];
  for (const cpv of cpvCodes) {
    try {
      const { total, notices } = await searchByCpv(cpv, opts);
      stats.push({ kind: "cpv", key: cpv, total, returned: notices.length });
      merge(byId, notices);
    } catch (err) {
      stats.push({ kind: "cpv", key: cpv, error: err.message });
    }
    await sleep(THROTTLE_MS);
  }
  return { notices: [...byId.values()], stats };
}

// Търси по списък ключови думи. Връща и статистика по дума, за да се вижда кои думи
// работят — думата с 0 попадения месец след месец е или сгрешена, или излишна.
export async function fetchTedByKeywords(terms, opts = {}) {
  const byId = new Map();
  const stats = [];
  for (const term of terms) {
    try {
      const { total, notices } = await searchByKeyword(term, opts);
      stats.push({ kind: "keyword", key: term, total, returned: notices.length });
      merge(byId, notices);
    } catch (err) {
      stats.push({ kind: "keyword", key: term, error: err.message });
    }
    await sleep(THROTTLE_MS);
  }
  return { notices: [...byId.values()], stats };
}

// Обединява двете мрежи в един дедуплициран резултат.
export async function fetchTedAll({ cpvCodes = [], keywords = [], ...opts } = {}) {
  const byId = new Map();
  const cpvRes = await fetchTedNotices(cpvCodes, opts);
  merge(byId, cpvRes.notices);
  const kwRes = await fetchTedByKeywords(keywords, opts);
  merge(byId, kwRes.notices);
  return {
    notices: [...byId.values()],
    stats: [...cpvRes.stats, ...kwRes.stats],
    byNet: { cpv: cpvRes.notices.length, keyword: kwRes.notices.length },
  };
}
