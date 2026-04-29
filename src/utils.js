import {
  BOOKING_CUTOFF_HOURS,
  SLOT_DURATION_MINUTES,
  APP_TIMEZONE,
  AGE_CATEGORIES,
  BOOKING_STATUSES,
  CONTACT_METHODS,
  PUBLIC_AGE_CATEGORIES
} from "./config.js";

const categoryMap = new Map(PUBLIC_AGE_CATEGORIES.map((item) => [item.value, item.label]));
const bookingStatusMap = new Map(BOOKING_STATUSES.map((item) => [item.value, item.label]));
const contactMethodMap = new Map(CONTACT_METHODS.map((item) => [item.value, item.label]));

export class AppError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function nowIso(nowProvider = () => new Date()) {
  return nowProvider().toISOString();
}

export function formatMoscowDateTime(isoString) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: APP_TIMEZONE,
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(isoString));
}

export function formatMoscowDateForInput(isoString) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(isoString));

  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function moscowInputToUtcIso(inputValue) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(inputValue || ""))) {
    throw new AppError(400, "INVALID_SLOT_DATETIME", "Неверный формат даты слота.");
  }

  return new Date(`${inputValue}:00+03:00`).toISOString();
}

export function computeEndsAtIso(startsAtIso) {
  return new Date(Date.parse(startsAtIso) + SLOT_DURATION_MINUTES * 60 * 1000).toISOString();
}

export function isPublicBookingClosed(startsAtIso, nowProvider = () => new Date()) {
  return Date.parse(startsAtIso) - nowProvider().getTime() < BOOKING_CUTOFF_HOURS * 60 * 60 * 1000;
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

export function cleanString(value) {
  return String(value || "").trim();
}

export function normalizeOptionalDate(value) {
  const normalized = cleanString(value);
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new AppError(400, "INVALID_FILTER_DATE", "Фильтр по дате должен быть в формате YYYY-MM-DD.");
  }

  return normalized;
}

export function validateBookingPayload(payload) {
  const errors = {};
  const requiredStringFields = [
    ["parent_name", "Укажите имя родителя."],
    ["parent_email", "Укажите email."],
    ["parent_phone", "Укажите телефон."],
    ["parent_telegram", "Укажите Telegram."],
    ["child_name", "Укажите имя ребенка."],
    ["country", "Укажите страну."],
    ["request_text", "Опишите краткий запрос."],
    ["preferred_contact_method", "Выберите предпочтительный способ связи."],
    ["age_category", "Выберите возрастную категорию."]
  ];

  for (const [field, message] of requiredStringFields) {
    if (!cleanString(payload[field])) {
      errors[field] = message;
    }
  }

  if (!Number.isInteger(Number(payload.slot_id)) || Number(payload.slot_id) <= 0) {
    errors.slot_id = "Выберите слот.";
  }

  if (!isValidEmail(payload.parent_email)) {
    errors.parent_email = "Укажите корректный email.";
  }

  const childAge = cleanString(payload.child_age);
  if (!childAge) {
    errors.child_age = "Укажите возраст ребенка или детей.";
  } else if (childAge.length > 120) {
    errors.child_age = "Поле возраста слишком длинное.";
  }

  if (!categoryMap.has(cleanString(payload.age_category))) {
    errors.age_category = "Выбрана неизвестная возрастная категория.";
  }

  if (!contactMethodMap.has(cleanString(payload.preferred_contact_method))) {
    errors.preferred_contact_method = "Выберите способ связи: Telegram или Email.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: {
      slot_id: Number(payload.slot_id),
      parent_name: cleanString(payload.parent_name),
      parent_email: cleanString(payload.parent_email),
      parent_phone: cleanString(payload.parent_phone),
      parent_telegram: cleanString(payload.parent_telegram),
      child_name: cleanString(payload.child_name),
      child_age: childAge,
      country: cleanString(payload.country),
      request_text: cleanString(payload.request_text),
      preferred_contact_method: cleanString(payload.preferred_contact_method),
      age_category: cleanString(payload.age_category)
    }
  };
}

export function assertValidBookingStatus(status) {
  if (!bookingStatusMap.has(status)) {
    throw new AppError(400, "INVALID_BOOKING_STATUS", "Недопустимый статус заявки.");
  }
}

export function getCategoryLabel(value) {
  return categoryMap.get(value) || value;
}

export function getBookingStatusLabel(value) {
  return bookingStatusMap.get(value) || value;
}

export function getContactMethodLabel(value) {
  return contactMethodMap.get(value) || value;
}

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new AppError(413, "PAYLOAD_TOO_LARGE", "Слишком большой запрос."));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new AppError(400, "INVALID_JSON", "Некорректный JSON в теле запроса."));
      }
    });

    req.on("error", (error) => reject(error));
  });
}

export function readFormBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new AppError(413, "PAYLOAD_TOO_LARGE", "Слишком большой запрос."));
        req.destroy();
      }
    });

    req.on("end", () => {
      const params = new URLSearchParams(body);
      resolve(Object.fromEntries(params.entries()));
    });

    req.on("error", (error) => reject(error));
  });
}

export function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

export function notFound(res) {
  sendJson(res, 404, {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: "Ресурс не найден."
    }
  });
}

export function handleRouteError(res, error) {
  if (error instanceof AppError) {
    sendJson(res, error.status, {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      }
    });
    return;
  }

  console.error(error);
  sendJson(res, 500, {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Внутренняя ошибка сервера."
    }
  });
}
