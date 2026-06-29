import { useEffect, useState } from "react";

const BLUE = "rgb(27,117,188)"; // фирменото синьо на Infinita
// В dev: празно → Vite proxy-то праща /api към :4010. В прод: VITE_API_URL = URL на backend-а.
const API = import.meta.env.VITE_API_URL || "";

const STATUS = {
  NEW: { label: "Нови", color: "bg-slate-200 text-slate-700" },
  RELEVANT: { label: "Релевантни", color: "bg-amber-100 text-amber-800" },
  DRAFTED: { label: "С чернова", color: "bg-emerald-100 text-emerald-800" },
  SKIP: { label: "Пропуснати", color: "bg-slate-100 text-slate-400" },
};

function scoreBadge(s) {
  if (s == null) return "bg-slate-100 text-slate-400";
  if (s >= 70) return "bg-emerald-100 text-emerald-700";
  if (s >= 50) return "bg-amber-100 text-amber-700";
  return "bg-rose-50 text-rose-500";
}

export default function App() {
  const [tab, setTab] = useState("RELEVANT");
  const [items, setItems] = useState([]);
  const [deadlines, setDeadlines] = useState([]);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(null);

  async function load() {
    const [t, d] = await Promise.all([
      fetch(`${API}/api/tenders?status=${tab}`).then((r) => r.json()),
      fetch(`${API}/api/deadlines?days=14`).then((r) => r.json()),
    ]);
    setItems(t.items || []);
    setDeadlines(d.items || []);
  }
  useEffect(() => {
    load();
  }, [tab]);

  async function trigger(action) {
    setBusy(action);
    await fetch(`${API}/api/${action}`, { method: "POST" });
    setBusy(null);
    load();
  }

  async function openDraft(id) {
    const md = await fetch(`${API}/api/tenders/${id}/draft`).then((r) => r.text());
    setDraft({ id, md });
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold" style={{ color: BLUE }}>
          Infinita · Обществени поръчки
        </h1>
        <div className="flex gap-2">
          {["discover", "classify", "document"].map((a) => (
            <button
              key={a}
              onClick={() => trigger(a)}
              disabled={busy}
              className="px-3 py-1.5 text-sm rounded text-white disabled:opacity-50"
              style={{ background: BLUE }}
            >
              {busy === a ? "…" : { discover: "Открий", classify: "Класифицирай", document: "Чернови" }[a]}
            </button>
          ))}
        </div>
      </header>

      {deadlines.length > 0 && (
        <div className="mb-5 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm">
          🔔 <b>{deadlines.length}</b> релевантни поръчки със срок до 14 дни:{" "}
          {deadlines.slice(0, 3).map((d) => (
            <span key={d.id} className="mr-2">
              {d.buyer?.slice(0, 28)} ({d.deadline?.split(";")[0]})
            </span>
          ))}
        </div>
      )}

      <nav className="flex gap-2 mb-4">
        {Object.entries(STATUS).map(([k, v]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-1.5 text-sm rounded-full ${tab === k ? "ring-2 ring-offset-1" : ""} ${v.color}`}
          >
            {v.label}
          </button>
        ))}
      </nav>

      <div className="space-y-3">
        {items.length === 0 && <p className="text-slate-400 text-sm">Няма поръчки в тази категория.</p>}
        {items.map((t) => (
          <div key={t.id} className="bg-white rounded-lg p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded font-mono ${scoreBadge(t.score)}`}>
                    {t.score ?? "—"}
                  </span>
                  <span className="text-xs text-slate-400">{t.publicationNumber}</span>
                </div>
                <p className="font-medium text-sm leading-snug">{t.title}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {t.buyer} · срок <b>{t.deadline?.split(";")[0] || "—"}</b>
                </p>
                {t.match?.verdict && (
                  <p className="text-xs text-slate-600 mt-2 bg-slate-50 rounded p-2">{t.match.verdict}</p>
                )}
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                <a
                  href={t.pdfBg}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs px-2 py-1 rounded bg-slate-100 text-center hover:bg-slate-200"
                >
                  📄 Досие
                </a>
                {t.status === "DRAFTED" && (
                  <button
                    onClick={() => openDraft(t.id)}
                    className="text-xs px-2 py-1 rounded text-white"
                    style={{ background: BLUE }}
                  >
                    📝 Чернова
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {draft && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6"
          onClick={() => setDraft(null)}
        >
          <div
            className="bg-white rounded-lg max-w-3xl w-full max-h-[85vh] overflow-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold">Чернова · {draft.id}</h3>
              <button onClick={() => setDraft(null)} className="text-slate-400 hover:text-slate-700">
                ✕
              </button>
            </div>
            <pre className="whitespace-pre-wrap text-xs font-mono leading-relaxed">{draft.md}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
