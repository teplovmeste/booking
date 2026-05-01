import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import {
  ADMIN_EMAIL,
  CLIENT_BOOKING_EMAIL_BODY_WITHOUT_SLOT,
  CLIENT_BOOKING_EMAIL_BODY_WITH_SLOT,
  CLIENT_BOOKING_EMAIL_SUBJECT,
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

function normalizeTemplateText(value) {
  return String(value || "").replaceAll("\\n", "\n");
}

function formatSlotWithTimeZone(isoString, timeZone) {
  if (!isoString) {
    return "Слот не выбран";
  }

  if (!timeZone) {
    return `${formatMoscowDateTime(isoString)} (Europe/Moscow)`;
  }

  try {
    const formatted = new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(isoString));

    return `${formatted} (${timeZone})`;
  } catch {
    return `${formatMoscowDateTime(isoString)} (Europe/Moscow)`;
  }
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
    `Дата и время слота: ${slot?.starts_at ? `${formatMoscowDateTime(slot.starts_at)} (Europe/Moscow)` : "Слот не выбран"}`,
    `Психолог: ${psychologist?.name || "Психолог не выбран"}`,
    `Возрастная категория: ${getCategoryLabel(booking.age_category)}`,
    `Имя родителя: ${booking.parent_name}`,
    `Email: ${booking.parent_email}`,
    `Телефон: ${booking.parent_phone}`,
    `Telegram: ${booking.parent_telegram}`,
    `Имя ребенка: ${booking.child_name}`,
    `Возраст ребенка: ${booking.child_age}`,
    `Страна: ${booking.country}`,
    `Удобное время для консультации: ${booking.preferred_time || "Не указано"}`,
    `Краткий запрос: ${booking.request_text}`,
    `Предпочтительный способ связи: ${getContactMethodLabel(booking.preferred_contact_method)}`,
    `Статус заявки: ${getBookingStatusLabel(booking.status)}`
  ].join("\n");
}

function renderTemplate(template, values) {
  return normalizeTemplateText(template).replaceAll(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key) => {
    return values[key] ?? match;
  });
}

function buildClientTemplateValues({ booking, psychologist, slot }) {
  return {
    parent_name: booking.parent_name,
    parent_email: booking.parent_email,
    child_name: booking.child_name,
    child_age: booking.child_age,
    country: booking.country,
    request_text: booking.request_text,
    age_category: getCategoryLabel(booking.age_category),
    psychologist_name: psychologist?.name || "Подберем подходящего специалиста",
    preferred_contact_method: getContactMethodLabel(booking.preferred_contact_method),
    preferred_time: booking.preferred_time || "Не указано",
    slot_time: slot?.starts_at
      ? formatSlotWithTimeZone(slot.starts_at, booking.client_timezone)
      : "Слот не выбран",
    client_timezone: booking.client_timezone || "Europe/Moscow"
  };
}

function composeClientBookingBody(context) {
  const template = context.slot?.starts_at
    ? CLIENT_BOOKING_EMAIL_BODY_WITH_SLOT
    : CLIENT_BOOKING_EMAIL_BODY_WITHOUT_SLOT;

  return renderTemplate(template, buildClientTemplateValues(context));
}

export async function sendBookingNotifications(context) {
  const bookingWithMeta = {
    ...context.booking,
    client_timezone: context.clientTimeZone || null
  };
  const body = composeBookingBody(context);
  const subject = context.slot?.starts_at
    ? `Новая запись: ${context.psychologist?.name || "Без психолога"} / ${formatMoscowDateTime(context.slot.starts_at)}`
    : `Новая заявка без слота: ${getCategoryLabel(context.booking.age_category)}`;
  const clientSubject = renderTemplate(CLIENT_BOOKING_EMAIL_SUBJECT, buildClientTemplateValues({
    ...context,
    booking: bookingWithMeta
  }));
  const clientBody = composeClientBookingBody({
    ...context,
    booking: bookingWithMeta
  });

  try {
    await sendEmail({
      to: ADMIN_EMAIL,
      subject,
      text: body
    });

    if (context.psychologist?.email) {
      await sendEmail({
        to: context.psychologist.email,
        subject,
        text: body
      });
    }

    await sendEmail({
      to: context.booking.parent_email,
      subject: clientSubject,
      text: clientBody
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
