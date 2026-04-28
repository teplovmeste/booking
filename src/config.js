import path from "node:path";

export const APP_PORT = Number(process.env.PORT || 3000);
export const BASE_PATH = normalizeBasePath(process.env.BASE_PATH || "");
export const APP_TIMEZONE = "Europe/Moscow";
export const SLOT_DURATION_MINUTES = 50;
export const SLOT_STEP_MINUTES = 60;
export const BOOKING_CUTOFF_HOURS = 24;
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@teplovmeste.com";
export const ADMIN_BASIC_AUTH_USER = process.env.ADMIN_BASIC_AUTH_USER || "";
export const ADMIN_BASIC_AUTH_PASS = process.env.ADMIN_BASIC_AUTH_PASS || "";
export const DATABASE_URL = process.env.DATABASE_URL || "";
export const DATABASE_SSL = process.env.DATABASE_SSL || "prefer";
export const DATABASE_SSL_REJECT_UNAUTHORIZED =
  process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true";
export const AUTO_SEED_DEMO_DATA = parseOptionalBoolean(process.env.AUTO_SEED_DEMO_DATA);
export const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
export const RESEND_FROM = process.env.RESEND_FROM || "";
export const SMTP_HOST = process.env.SMTP_HOST || "";
export const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
export const SMTP_SECURE = process.env.SMTP_SECURE === "true";
export const SMTP_USER = process.env.SMTP_USER || "";
export const SMTP_PASS = process.env.SMTP_PASS || "";
export const SMTP_FROM = process.env.SMTP_FROM || "";
export const SENDMAIL_PATH = process.env.SENDMAIL_PATH || "";
export const BOOKING_SUCCESS_MESSAGE =
  process.env.BOOKING_SUCCESS_MESSAGE ||
  "Спасибо! Ваша заявка принята. Мы свяжемся с вами для подтверждения записи и дальнейших шагов.";

export const AGE_CATEGORIES = [
  { value: "preschool", label: "0-8 лет" },
  { value: "primary_school", label: "9-13 лет" },
  { value: "teens", label: "14-18 лет" }
];

export const PUBLIC_AGE_CATEGORIES = [
  ...AGE_CATEGORIES,
  { value: "not_important", label: "Не важно" }
];

export const CONTACT_METHODS = [
  { value: "telegram", label: "Telegram" },
  { value: "email", label: "Email" }
];

export const BOOKING_STATUSES = [
  { value: "new", label: "Новая" },
  { value: "awaiting_payment", label: "Ожидает оплаты" },
  { value: "confirmed", label: "Подтверждена" },
  { value: "cancelled", label: "Отменена" },
  { value: "completed", label: "Завершена" }
];

export const SLOT_STATUSES = [
  { value: "available", label: "Доступен" },
  { value: "booked", label: "Занят" },
  { value: "deleted", label: "Удален" }
];

export const DATA_DIR = path.resolve(process.cwd(), "data");
export const DB_PATH = path.join(DATA_DIR, "teplovmeste.sqlite");
export const EMAIL_ERROR_LOG_PATH = path.join(DATA_DIR, "email-errors.log");

function normalizeBasePath(input) {
  const value = String(input || "").trim();

  if (!value || value === "/") {
    return "";
  }

  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
}

function parseOptionalBoolean(value) {
  if (value === undefined) {
    return null;
  }

  return value === "true";
}
