// Агент 4 — СРОКОВЕ. Следи крайните срокове на RELEVANT/DRAFTED поръчки и праща
// дневно резюме по email през ОТДЕЛЕН Resend акаунт за Infinita (не се смесва със Skyrent).
// SuperHosting SMTP не работи от облака (Railway IP блокиран) → Resend праща отвсякъде.
// Без RESEND_API_KEY — само връща предстоящите.
import { Resend } from "resend";
import { db } from "../database/db.js";

export function upcomingDeadlines({ withinDays = 7 } = {}) {
  const now = Date.now();
  const horizon = now + withinDays * 86400000;
  return db.data.tenders
    .filter((t) => ["RELEVANT", "DRAFTED"].includes(t.status) && t.deadline)
    // Форматът е "2026-09-23+03:00" (дата + tz, без час) — Date.parse го чупи.
    // Взимаме само датата (първите 10 знака) и я броим до края на деня (BG време).
    .map((t) => {
      const datePart = (t.deadline || "").split(";")[0].trim().slice(0, 10);
      return { ...t, deadlineTs: Date.parse(`${datePart}T23:59:59+03:00`) };
    })
    .filter((t) => !Number.isNaN(t.deadlineTs) && t.deadlineTs >= now && t.deadlineTs <= horizon)
    .sort((a, b) => a.deadlineTs - b.deadlineTs);
}

function buildEmailHtml(due, withinDays) {
  const rows = due
    .map((t) => {
      const days = Math.ceil((t.deadlineTs - Date.now()) / 86400000);
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee"><b>${(t.deadline || "").split(";")[0].slice(0, 10)}</b> (след ${days} дни)</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${t.buyer || ""}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${t.score ?? ""} ${t.status === "DRAFTED" ? "📝" : ""}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee"><a href="${t.pdfBg || "#"}">PDF</a></td>
      </tr>`;
    })
    .join("");
  return `<div style="font-family:sans-serif">
    <h2>Обществени поръчки — предстоящи срокове</h2>
    <p>${due.length} релевантни поръчки със срок до ${withinDays} дни:</p>
    <table style="border-collapse:collapse;width:100%">
      <tr style="text-align:left;background:#f5f5f5"><th style="padding:6px 10px">Срок</th><th style="padding:6px 10px">Възложител</th><th style="padding:6px 10px">Score</th><th style="padding:6px 10px">Досие</th></tr>
      ${rows}
    </table>
    <p style="color:#888;font-size:12px">Генерирано от infinita-tenders. Подаването в ЦАИС ЕОП изисква КЕП.</p>
  </div>`;
}

function emailConfigured() {
  return process.env.RESEND_API_KEY && process.env.ALERT_EMAIL;
}

export async function runDeadlines({ withinDays = Number(process.env.ALERT_WITHIN_DAYS || 14) } = {}) {
  const due = upcomingDeadlines({ withinDays });
  console.log(`[deadlines] ${due.length} поръчки със срок до ${withinDays} дни`);
  if (!due.length) return { due: 0, items: [], email: { sent: false, reason: "няма срокове в прозореца" } };

  let email = { sent: false };
  if (emailConfigured()) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const from = process.env.ALERT_FROM || "Infinita Търгове <onboarding@resend.dev>";
      const r = await resend.emails.send({
        from,
        to: process.env.ALERT_EMAIL,
        subject: `🔔 ${due.length} обществени поръчки със срок до ${withinDays} дни`,
        html: buildEmailHtml(due, withinDays),
      });
      if (r.error) throw new Error(r.error.message || JSON.stringify(r.error));
      email = { sent: true, to: process.env.ALERT_EMAIL, id: r.data?.id };
      console.log(`[deadlines] email изпратен до ${process.env.ALERT_EMAIL} (id ${r.data?.id})`);
    } catch (err) {
      email = { sent: false, error: err.message };
      console.log(`[deadlines] Resend грешка: ${err.message}`);
    }
  } else {
    email = { sent: false, reason: "RESEND_API_KEY/ALERT_EMAIL не са зададени" };
    console.log("[deadlines] (RESEND_API_KEY/ALERT_EMAIL не са зададени — пропускам email)");
  }
  return { due: due.length, items: due, email };
}
