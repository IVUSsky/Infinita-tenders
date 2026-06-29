// TED (Tenders Electronic Daily) адаптер — основен източник на поръчки.
// POST {TED_API_BASE}/notices/search — официален, БЕЗ API ключ.
// Валидирано на 2026-06-29: полета и query синтаксис работят за buyer-country=BGR.

const BASE = process.env.TED_API_BASE || "https://api.ted.europa.eu/v3";

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
function normalize(n, cpv) {
  const links = n.links || {};
  const pub = n["publication-number"];
  return {
    id: pub, // напр. "3275-2026" — уникален в TED
    source: "ted",
    cpv,
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

// Едно търсене за конкретен CPV код.
async function searchByCpv(cpv, { sinceDays = 30, noticeType = "cn-standard", limit = 100 } = {}) {
  const since = new Date(Date.now() - sinceDays * 86400000);
  const parts = [
    "buyer-country=BGR",
    `classification-cpv=${cpv}`,
    `publication-date>=${ymd(since)}`,
  ];
  if (noticeType) parts.push(`notice-type=${noticeType}`);
  const query = parts.join(" AND ");

  const res = await fetch(`${BASE}/notices/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, fields: FIELDS, limit, page: 1 }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TED ${res.status} за CPV ${cpv}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const notices = (data.notices || []).map((n) => normalize(n, cpv));
  return { total: data.totalNoticeCount ?? notices.length, notices };
}

// Търси по списък CPV кодове и връща дедуплициран масив (по publication-number).
export async function fetchTedNotices(cpvCodes, opts = {}) {
  const byId = new Map();
  const stats = [];
  for (const cpv of cpvCodes) {
    try {
      const { total, notices } = await searchByCpv(cpv, opts);
      stats.push({ cpv, total, returned: notices.length });
      for (const n of notices) {
        if (!byId.has(n.id)) byId.set(n.id, n);
        else byId.get(n.id).cpv += `,${cpv}`; // поръчка, която мачва няколко наши кода
      }
    } catch (err) {
      stats.push({ cpv, error: err.message });
    }
  }
  return { notices: [...byId.values()], stats };
}
