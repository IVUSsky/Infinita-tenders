// Агент 4 — СРОКОВЕ. Следи крайните срокове на RELEVANT/DRAFTED поръчки и праща
// дневно резюме по email (Resend, както в Skyrent). Без ключ — само връща предстоящите.
import { Resend } from "resend";
import { db } from "../database/db.js";

export function upcomingDeadlines({ withinDays = 7 } = {}) {
  const now = Date.now();
  const horizon = now + withinDays * 86400000;
  return db.data.tenders
    .filter((t) => ["RELEVANT", "DRAFTED"].includes(t.status) && t.deadline)
    .map((t) => ({ ...t, deadlineTs: Date.parse((t.deadline || "").split(";")[0]) }))
    .filter((t) => !Number.isNaN(t.deadlineTs) && t.deadlineTs >= now && t.deadlineTs <= horizon)
    .sort((a, b) => a.deadlineTs - b.deadlineTs);
}

function buildEmailHtml(due) {
  const rows = due
    .map((t) => {
      const days = Math.ceil((t.deadlineTs - Date.now()) / 86400000);
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee"><b>${t.deadline?.split(";")[0] || ""}</b> (след ${days} дни)</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${t.buyer || ""}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${t.score ?? ""} ${t.status === "DRAFTED" ? "📝" : ""}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee"><a href="${t.pdfBg || "#"}">PDF</a></td>
      </tr>`;
    })
    .join("");
  return `<div style="font-family:sans-serif">
    <h2>Обществени поръчки — предстоящи срокове</h2>
    <p>${due.length} релевантни поръчки със срок до 7 дни:</p>
    <table style="border-collapse:collapse;width:100%">
      <tr style="text-align:left;background:#f5f5f5"><th style="padding:6px 10px">Срок</th><th style="padding:6px 10px">Възложител</th><th style="padding:6px 10px">Score</th><th style="padding:6px 10px">Досие</th></tr>
      ${rows}
    </table>
    <p style="color:#888;font-size:12px">Генерирано от infinita-tenders. Подаването в ЦАИС ЕОП изисква КЕП.</p>
  </div>`;
}

export async function runDeadlines({ withinDays = 7 } = {}) {
  const due = upcomingDeadlines({ withinDays });
  console.log(`[deadlines] ${due.length} поръчки със срок до ${withinDays} дни`);

  if (due.length && process.env.RESEND_API_KEY && process.env.ALERT_EMAIL) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: process.env.ALERT_FROM || "Infinita Tenders <onboarding@resend.dev>",
        to: process.env.ALERT_EMAIL,
        subject: `🔔 ${due.length} обществени поръчки със срок до ${withinDays} дни`,
        html: buildEmailHtml(due),
      });
      console.log(`[deadlines] email изпратен до ${process.env.ALERT_EMAIL}`);
    } catch (err) {
      console.log(`[deadlines] email грешка: ${err.message}`);
    }
  } else if (due.length) {
    console.log("[deadlines] (RESEND_API_KEY/ALERT_EMAIL не са зададени — пропускам email)");
  }
  return { due: due.length, items: due };
}
