import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import {
  ADMIN_EMAIL,
  EMAIL_ERROR_LOG_PATH,
  RESEND_API_KEY,
  RESEND_FROM,
  SENDMAIL_PATH,
  SMTP_FROM,
  SMTP_HOST,
  SMTP_PASS,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER
} from "./config.js";
import { formatMoscowDateTime, getBookingStatusLabel, getCategoryLabel, getContactMethodLabel } from "./utils.js";

function appendEmailErrorLog(message) {
  fs.mkdirSync(path.dirname(EMAIL_ERROR_LOG_PATH), { recursive: true });
  fs.appendFileSync(EMAIL_ERROR_LOG_PATH, `${new Date().toISOString()} ${message}\n`, "utf8");
}

function createResendClient() {
  return RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
}

function createSmtpTransport() {
  if (!SMTP_HOST) {
    return null;
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
  });
}

function createSendmailTransport() {
  if (!SENDMAIL_PATH) {
    return null;
  }

  return nodemailer.createTransport({
    sendmail: true,
    newline: "unix",
    path: SENDMAIL_PATH
  });
}

function getSenderAddress() {
  return RESEND_FROM || SMTP_FROM || ADMIN_EMAIL;
}

async function sendViaResend({ to, subject, text }) {
  const resend = createResendClient();
  if (!resend) {
    return false;
  }

  const { error } = await resend.emails.send({
    from: getSenderAddress(),
    to: Array.isArray(to) ? to : [to],
    subject,
    text
  });

  if (error) {
    throw new Error(`Resend: ${error.message}`);
  }

  return true;
}

async function sendViaNodemailer(transport, { to, subject, text }) {
  if (!transport) {
    return false;
  }

  await transport.sendMail({
    from: getSenderAddress(),
    to,
    subject,
    text
  });

  return true;
}

async function sendEmail(payload) {
  if (await sendViaResend(payload)) {
    return "resend";
  }

  const smtpTransport = createSmtpTransport();
  if (await sendViaNodemailer(smtpTransport, payload)) {
    return "smtp";
  }

  const sendmailTransport = createSendmailTransport();
  if (await sendViaNodemailer(sendmailTransport, payload)) {
    return "sendmail";
  }

  throw new Error("Email transport is not configured. Set RESEND_* or SMTP_* or SENDMAIL_PATH.");
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
    `Предпочтительный способ связи: ${getContactMethodLabel(booking.preferred_contact_method)}`,
    `Статус заявки: ${getBookingStatusLabel(booking.status)}`
  ].join("\n");
}

export async function sendBookingNotifications(context) {
  const body = composeBookingBody(context);
  const subject = `Новая запись: ${context.psychologist.name} / ${formatMoscowDateTime(context.slot.starts_at)}`;

  try {
    await sendEmail({
      to: ADMIN_EMAIL,
      subject,
      text: body
    });

    await sendEmail({
      to: context.psychologist.email,
      subject,
      text: body
    });

    return { ok: true };
  } catch (error) {
    appendEmailErrorLog(`booking=${context.booking.id} ${error.message}`);
    console.error(`Email delivery failed for booking ${context.booking.id}: ${error.message}`);
    return {
      ok: false,
      error: error.message
    };
  }
}
