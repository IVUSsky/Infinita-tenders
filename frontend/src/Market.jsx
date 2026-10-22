import { useEffect, useState } from "react";

const BLUE = "rgb(27,117,188)";
const API = import.meta.env.VITE_API_URL || "";

const eur = (n) => (n == null ? "—" : Math.round(n).toLocaleString("bg-BG") + " €");
const pct = (x) => (x == null ? "—" : (x * 100).toFixed(x < 0.1 ? 2 : 0).replace(".", ",") + "%");
const short = (s, n) => (!s ? "" : s.length > n ? s.slice(0, n - 1) + "…" : s);

function Tile({ label, value, note, alarm }) {
  return (
    <div className="bg-white rounded-lg p-3 shadow-sm">
      <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold leading-tight">{label}</div>
      <div className={`text-xl font-bold mt-1 ${alarm ? "text-rose-600" : "text-slate-800"}`}>{value}</div>
      {note && <div className="text-[11px] text-slate-400 mt-0.5 leading-tight">{note}</div>}
    </div>
  );
}

function Bars({ title, rows, max, labelKey = "key", valueKey = "eur", fmt = eur, note }) {
  const mx = max ?? Math.max(...rows.map((r) => r[valueKey]), 1);
  return (
    <section className="bg-white rounded-lg p-4 shadow-sm">
      <h3 className="font-semibold text-sm mb-3">{title}</h3>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r[labelKey]} className="flex items-center gap-3 text-xs">
            <div className="w-56 shrink-0 text-slate-600 truncate" title={r[labelKey]}>{r[labelKey]}</div>
            <div className="flex-1 h-3 bg-slate-100 rounded-sm overflow-hidden">
              <div
                className="h-full rounded-sm"
                style={{ width: `${Math.max(1, (r[valueKey] / mx) * 100)}%`, background: /ИНФИНИТА/i.test(r[labelKey]) ? "#e11d48" : BLUE }}
              />
            </div>
            <div className="w-28 text-right font-mono tabular-nums text-slate-700">{fmt(r[valueKey])}</div>
            <div className="w-10 text-right text-slate-400">{r.n}</div>
          </div>
        ))}
      </div>
      {note && <p className="text-[11px] text-slate-400 mt-3">{note}</p>}
    </section>
  );
}

export default function Market() {
  const [m, setM] = useState(null);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch(`${API}/api/market`);
    if (!r.ok) { setErr((await r.json()).error || "няма данни"); return; }
    setErr(null);
    setM(await r.json());
    const rr = await fetch(`${API}/api/market/rows?class=APARAT`).then((x) => x.json());
    setRows(rr.rows || []);
  }
  useEffect(() => { load(); }, []);

  async function refresh() {
    setBusy(true);
    await fetch(`${API}/api/market/refresh`, { method: "POST" });
    // преизчисляването е бавно — питаме на всеки 15 сек. дали е готово
    const timer = setInterval(async () => {
      const s = await fetch(`${API}/api/market/status`).then((r) => r.json());
      if (!s.running) { clearInterval(timer); setBusy(false); load(); }
    }, 15000);
  }

  if (err) {
    return (
      <div className="bg-white rounded-lg p-6 shadow-sm text-sm">
        <p className="text-slate-500 mb-3">{err}</p>
        <button onClick={refresh} disabled={busy} className="px-3 py-1.5 rounded text-white text-sm disabled:opacity-50" style={{ background: BLUE }}>
          {busy ? "Изчислява се…" : "Изчисли пазарния анализ"}
        </button>
        <p className="text-xs text-slate-400 mt-2">Тегли обявленията от TED и ги обобщава. Отнема няколко минути.</p>
      </div>
    );
  }
  if (!m) return <p className="text-slate-400 text-sm">Зарежда…</p>;

  const k = m.kpi;
  const open = rows.filter((r) => !r.winners && /Отворена|без решение|Прекратена/.test(r.status));
  const won = rows.filter((r) => r.winners && r.srcType === "решение за избор" && r.awarded);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">
          Период {m.period.from} – {m.period.to} · изчислено {new Date(m.generatedAt).toLocaleString("bg-BG")}
          {m.stats && ` · ${m.stats.notices} обявления, ${m.stats.rows} позиции`}
        </p>
        <button onClick={refresh} disabled={busy} className="px-3 py-1 text-xs rounded border border-slate-300 text-slate-600 disabled:opacity-50">
          {busy ? "Преизчислява се…" : "Преизчисли"}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Общ пазар" value={eur(k.totalEur)} note={`${k.lots} позиции при ${k.buyers} възложителя`} />
        <Tile label="Медиана на сделката" value={eur(k.medianDeal)} note="половината сделки са под нея" />
        <Tile label="Позиции с една оферта" value={pct(k.singleBid / (k.lots || 1))} note={`${k.singleBid} от ${k.lots}`} alarm />
        <Tile label="Средна отстъпка" value={`${String(k.avgSaving).replace(".", ",")}%`} note="спрямо прогнозната стойност" alarm />
        <Tile label="Сервизен пазар" value={eur(k.serviceEur)} note={`${k.serviceLots} позиции за сервиз и части`} />
        <Tile label="Отворено и прекратено" value={eur(k.openEur)} note={`${k.openLots} без решение · ${k.cancelled} прекратени`} />
        <Tile label="Цикъл на поръчката" value={`${k.medianCycleDays} дни`} note={`срок за оферта ${k.medianTenderWindowDays} дни`} />
        <Tile label="Дял на Инфинита" value={pct(k.infinitaEur / (k.totalEur || 1))} note={`${k.infinitaLots} позиции · ${eur(k.infinitaEur)}`} />
      </div>

      <Bars title="Кой печели пазара" rows={m.suppliers} note="Обединенията се броят като един участник. Последната колона е брой позиции." />

      <div className="grid md:grid-cols-2 gap-4">
        <section className="bg-white rounded-lg p-4 shadow-sm">
          <h3 className="font-semibold text-sm mb-3">Ценови нива</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 text-[11px] uppercase">
                <th className="text-left font-semibold pb-1">Ниво</th>
                <th className="text-right font-semibold pb-1">Поз.</th>
                <th className="text-right font-semibold pb-1">Стойност</th>
                <th className="text-right font-semibold pb-1">Медиана</th>
                <th className="text-right font-semibold pb-1">1 оферта</th>
              </tr>
            </thead>
            <tbody>
              {m.bands.map((b) => (
                <tr key={b.key} className="border-t border-slate-100">
                  <td className="py-1">{b.key}</td>
                  <td className="text-right font-mono tabular-nums">{b.n}</td>
                  <td className="text-right font-mono tabular-nums">{eur(b.eur)}</td>
                  <td className="text-right font-mono tabular-nums">{eur(b.median)}</td>
                  <td className={`text-right font-mono tabular-nums ${b.single === b.n && b.n ? "text-rose-600 font-semibold" : ""}`}>
                    {b.single}/{b.n}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="bg-white rounded-lg p-4 shadow-sm">
          <h3 className="font-semibold text-sm mb-3">Колко оферти се подават</h3>
          <div className="space-y-1.5">
            {m.bids.map((b) => (
              <div key={b.key} className="flex items-center gap-3 text-xs">
                <div className="w-24 shrink-0 text-slate-600">{b.key === "няма данни" ? b.key : `${b.key} оферт${b.key === "1" ? "а" : "и"}`}</div>
                <div className="flex-1 h-3 bg-slate-100 rounded-sm overflow-hidden">
                  <div className="h-full bg-rose-500 rounded-sm" style={{ width: `${(b.n / (k.lots || 1)) * 100}%` }} />
                </div>
                <div className="w-10 text-right font-mono tabular-nums">{b.n}</div>
                <div className="w-24 text-right font-mono tabular-nums text-slate-500">{eur(b.eur)}</div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-3">
            Състезанието се печели на етап техническа спецификация, не на цена. Там, където има повече от една оферта, залогът е голям.
          </p>
        </section>
      </div>

      <Bars title="Кой купува" rows={m.buyers.slice(0, 12)} note="Възложители с повече от една позиция са повтарящи се купувачи." />

      {m.unitPrices?.length > 0 && (
        <section className="bg-white rounded-lg p-4 shadow-sm">
          <h3 className="font-semibold text-sm mb-3">Единични цени — къде се вижда класът на апарата</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[640px]">
              <thead>
                <tr className="text-slate-400 text-[11px] uppercase">
                  <th className="text-left font-semibold pb-1">Дата</th>
                  <th className="text-left font-semibold pb-1">Възложител</th>
                  <th className="text-left font-semibold pb-1">Позиция</th>
                  <th className="text-right font-semibold pb-1">Бр.</th>
                  <th className="text-right font-semibold pb-1">Цена за 1</th>
                  <th className="text-left font-semibold pb-1">Изпълнител</th>
                </tr>
              </thead>
              <tbody>
                {m.unitPrices.map((u, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-1 whitespace-nowrap">{u.date}</td>
                    <td>{short(u.buyer, 30)}</td>
                    <td>{short(u.lot, 46)}</td>
                    <td className="text-right font-mono tabular-nums">{u.broj}</td>
                    <td className="text-right font-mono tabular-nums font-semibold">{eur(u.unit)}</td>
                    <td>{short(u.winner, 24)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="bg-white rounded-lg p-4 shadow-sm">
        <h3 className="font-semibold text-sm mb-1">Какво предстои</h3>
        <p className="text-[11px] text-slate-400 mb-3">
          Прекратените процедури почти винаги се обявяват повторно — това е най-предвидимият поток от нови възможности.
        </p>
        <div className="space-y-1.5">
          {open.map((r, i) => (
            <div key={i} className="flex items-start gap-3 text-xs border-t border-slate-100 pt-1.5">
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 ${
                  r.status === "Отворена" ? "bg-emerald-100 text-emerald-700"
                    : r.status === "Прекратена" ? "bg-rose-50 text-rose-600"
                      : "bg-slate-100 text-slate-500"
                }`}
              >
                {r.status}
              </span>
              <span className="w-20 shrink-0 font-mono tabular-nums text-slate-400">{r.deadline || "—"}</span>
              <span className="flex-1 min-w-0">
                <span className="text-slate-600">{short(r.buyer, 34)}</span>
                <span className="text-slate-400"> · {short(r.lotName, 60)}</span>
              </span>
              <span className="w-24 text-right font-mono tabular-nums text-slate-600">{eur(r.est)}</span>
            </div>
          ))}
          {open.length === 0 && <p className="text-slate-400 text-xs">Няма отворени или прекратени позиции.</p>}
        </div>
      </section>

      <section className="bg-white rounded-lg p-4 shadow-sm">
        <h3 className="font-semibold text-sm mb-3">Всички позиции със сключен договор ({won.length})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[860px]">
            <thead>
              <tr className="text-slate-400 text-[11px] uppercase">
                <th className="text-left font-semibold pb-1">Дата</th>
                <th className="text-left font-semibold pb-1">Възложител</th>
                <th className="text-left font-semibold pb-1">Обособена позиция</th>
                <th className="text-right font-semibold pb-1">Прогноза</th>
                <th className="text-right font-semibold pb-1">Цена</th>
                <th className="text-right font-semibold pb-1">Отстъпка</th>
                <th className="text-right font-semibold pb-1">Оферти</th>
                <th className="text-left font-semibold pb-1">Изпълнител</th>
                <th className="pb-1"></th>
              </tr>
            </thead>
            <tbody>
              {won.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1 whitespace-nowrap">{r.awardPub}</td>
                  <td>{short(r.buyer, 28)}</td>
                  <td>{short(r.lotName, 48)}</td>
                  <td className="text-right font-mono tabular-nums text-slate-500">{eur(r.est)}</td>
                  <td className="text-right font-mono tabular-nums font-semibold">{eur(r.awarded)}</td>
                  <td className="text-right font-mono tabular-nums">{r.saving == null ? "—" : String(r.saving).replace(".", ",") + "%"}</td>
                  <td className={`text-right font-mono tabular-nums ${String(r.nBids) === "1" ? "text-rose-600 font-semibold" : ""}`}>{r.nBids || "—"}</td>
                  <td className={/ИНФИНИТА/i.test(r.winners) ? "font-semibold text-rose-600" : ""}>{short(r.winnerLabel || r.winners, 26)}</td>
                  <td className="text-right">
                    <a href={r.url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-slate-700">↗</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-[11px] text-slate-400 leading-relaxed">
        Източник: TED (ted.europa.eu), официалните обявления. Стойности без ДДС, в евро; обявленията до 31.12.2025 са конвертирани
        по 1,95583 лв./€, по валутата на всяко поле поотделно. Един ред = една обособена позиция, не цяла поръчка. Поръчките под
        праговете за публикуване в TED (чл. 20, ал. 3 ЗОП) не се виждат тук — по оценка около една четвърт от позициите и около
        една шеста от стойността. Покупките на частни лечебни заведения не са публични и не са включени.
      </p>
    </div>
  );
}
