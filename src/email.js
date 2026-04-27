import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import {
  ADMIN_EMAIL,
  EMAIL_ERROR_LOG_PATH,
  SENDMAIL_PATH,
  SMTP_FROM,
  SMTP_HOST,
  SMTP_PASS,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER
} from "./config.js";
import { formatMoscowDateTime, getBookingStatusLabel, getCategoryLabel } from "./utils.js";

function appendEmailErrorLog(message) {
  fs.mkdirSync(path.dirname(EMAIL_ERROR_LOG_PATH), { recursive: true });
  fs.appendFileSync(EMAIL_ERROR_LOG_PATH, `${new Date().toISOString()} ${message}\n`, "utf8");
}

function createTransport() {
  if (SMTP_HOST) {
    return nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
    });
  }

  if (SENDMAIL_PATH) {
    return nodemailer.createTransport({
      sendmail: true,
      newline: "unix",
      path: SENDMAIL_PATH
    });
  }

  return null;
}

function composeBookingBody({ booking, psychologist, slot }) {
  return [
    "Новая заявка на консультацию",
    "",
    `Дата и время слота: ${formatMoscowDateTime(slot.starts_at)}`,
    `Психолог: ${psychologist.name}`,
    `Возрастная категория: ${getCategoryLabel(booking.age_category)}`,
    `Имя родителя: ${booking.parent_name}`,
    `Email: ${booking.parent_email}`,
    `Телефон: ${booking.parent_phone}`,
    `Telegram: ${booking.parent_telegram}`,
    `Имя ребенка: ${booking.child_name}`,
    `Возраст ребенка: ${booking.child_age}`,
    `Страна: ${booking.country}`,
    `Краткий запрос: ${booking.request_text}`,
    `Предпочтительный способ связи: ${booking.preferred_contact_method}`,
    `Статус заявки: ${getBookingStatusLabel(booking.status)}`
  ].join("\n");
}

export async function sendBookingNotifications(context) {
  const body = composeBookingBody(context);
  const subject = `Новая запись: ${context.psychologist.name} / ${formatMoscowDateTime(context.slot.starts_at)}`;
  const transport = createTransport();

  try {
    if (!transport) {
      throw new Error("Email transport is not configured. Set SMTP_* or SENDMAIL_PATH.");
    }

    await transport.sendMail({
      from: SMTP_FROM || ADMIN_EMAIL,
      to: ADMIN_EMAIL,
      subject,
      text: body
    });

    await transport.sendMail({
      from: SMTP_FROM || ADMIN_EMAIL,
      to: context.psychologist.email,
      subject,
      text: body
    });

    return { ok: true };
  } catch (error) {
    appendEmailErrorLog(`booking=${context.booking.id} ${error.message}`);
    return {
      ok: false,
      error: error.message
    };
  }
}
