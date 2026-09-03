// Агент 4 — СРОКОВЕ. Следи крайните срокове на RELEVANT/DRAFTED поръчки и праща
// дневно резюме по email през СОБСТВЕНИЯ SMTP на Infinita (SuperHosting) — без Resend,
// за да не се смесва с други проекти. Без SMTP env — само връща предстоящите.
import nodemailer from "nodemailer";
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

// SMTP транспорт (SuperHosting). Подателят ТРЯБВА да е SMTP_USER, иначе SPF пада.
function smtpConfigured() {
  return process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.ALERT_EMAIL;
}

function makeTransport() {
  const port = Number(process.env.SMTP_PORT || 465);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: String(process.env.SMTP_SECURE ?? (port === 465)) === "true" || port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

export async function runDeadlines({ withinDays = Number(process.env.ALERT_WITHIN_DAYS || 14) } = {}) {
  const due = upcomingDeadlines({ withinDays });
  console.log(`[deadlines] ${due.length} поръчки със срок до ${withinDays} дни`);
  if (!due.length) return { due: 0, items: [] };

  if (smtpConfigured()) {
    try {
      const from = process.env.ALERT_FROM || `Infinita Търгове <${process.env.SMTP_USER}>`;
      await makeTransport().sendMail({
        from,
        to: process.env.ALERT_EMAIL,
        subject: `🔔 ${due.length} обществени поръчки със срок до ${withinDays} дни`,
        html: buildEmailHtml(due),
      });
      console.log(`[deadlines] email изпратен до ${process.env.ALERT_EMAIL} (от ${process.env.SMTP_USER})`);
    } catch (err) {
      console.log(`[deadlines] SMTP грешка: ${err.message}`);
    }
  } else {
    console.log("[deadlines] (SMTP_* / ALERT_EMAIL не са зададени — пропускам email)");
  }
  return { due: due.length, items: due };
}
