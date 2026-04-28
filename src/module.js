import { AGE_CATEGORIES, APP_TIMEZONE, BOOKING_STATUSES, BOOKING_SUCCESS_MESSAGE, SLOT_STATUSES } from "./config.js";
import {
  AppError,
  assertValidBookingStatus,
  cleanString,
  computeEndsAtIso,
  formatMoscowDateForInput,
  formatMoscowDateTime,
  getBookingStatusLabel,
  getCategoryLabel,
  isPublicBookingClosed,
  moscowInputToUtcIso,
  normalizeOptionalDate,
  nowIso,
  validateBookingPayload
} from "./utils.js";

function serializePsychologist(row) {
  return {
    id: Number(row.id),
    name: row.name,
    age_category: row.age_category,
    age_category_label: getCategoryLabel(row.age_category),
    email: row.email,
    is_active: Boolean(row.is_active)
  };
}

function serializeSlot(row) {
  return {
    id: Number(row.id),
    psychologist_id: Number(row.psychologist_id),
    psychologist_name: row.psychologist_name,
    starts_at: toIso(row.starts_at),
    ends_at: toIso(row.ends_at),
    starts_at_label: formatMoscowDateTime(toIso(row.starts_at)),
    starts_at_input: formatMoscowDateForInput(toIso(row.starts_at)),
    timezone: row.timezone,
    status: row.status,
    booking_id: row.booking_id === null || row.booking_id === undefined ? null : Number(row.booking_id),
    age_category: row.age_category,
    age_category_label: getCategoryLabel(row.age_category)
  };
}

function serializeBooking(row) {
  const slotStartsAt = row.slot_starts_at ? toIso(row.slot_starts_at) : null;

  return {
    id: Number(row.id),
    slot_id: Number(row.slot_id),
    psychologist_id: Number(row.psychologist_id),
    psychologist_name: row.psychologist_name,
    age_category: row.age_category,
    age_category_label: getCategoryLabel(row.age_category),
    parent_name: row.parent_name,
    parent_email: row.parent_email,
    parent_phone: row.parent_phone,
    parent_telegram: row.parent_telegram,
    child_name: row.child_name,
    child_age: Number(row.child_age),
    country: row.country,
    request_text: row.request_text,
    preferred_contact_method: row.preferred_contact_method,
    status: row.status,
    status_label: getBookingStatusLabel(row.status),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    slot_starts_at: slotStartsAt,
    slot_starts_at_label: slotStartsAt ? formatMoscowDateTime(slotStartsAt) : "Слот не назначен"
  };
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function validatePsychologistPayload(payload, { requireAllFields = true } = {}) {
  const errors = {};
  const name = cleanString(payload.name);
  const email = cleanString(payload.email);
  const ageCategory = cleanString(payload.age_category);
  const isActiveValue = payload.is_active;

  if (requireAllFields || "name" in payload) {
    if (!name) {
      errors.name = "Укажите имя психолога.";
    }
  }

  if (requireAllFields || "email" in payload) {
    if (!email) {
      errors.email = "Укажите email психолога.";
    }
  }

  if ((requireAllFields || "age_category" in payload) && !AGE_CATEGORIES.some((item) => item.value === ageCategory)) {
    errors.age_category = "Выберите корректную возрастную категорию.";
  }

  if ((requireAllFields || "is_active" in payload)
    && !["true", "false", true, false, 1, 0, "1", "0"].includes(isActiveValue)) {
    errors.is_active = "Укажите корректный статус активности.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: {
      name,
      email,
      age_category: ageCategory,
      is_active: isActiveValue === true || isActiveValue === "true" || isActiveValue === 1 || isActiveValue === "1"
    }
  };
}

export function createBookingModule({ repository, sendBookingNotifications, nowProvider = () => new Date() }) {
  async function getPublicMeta() {
    return {
      success_message: BOOKING_SUCCESS_MESSAGE,
      categories: AGE_CATEGORIES
    };
  }

  async function getAdminMeta() {
    return {
      categories: AGE_CATEGORIES,
      booking_statuses: BOOKING_STATUSES,
      slot_statuses: SLOT_STATUSES,
      psychologists: (await repository.listPsychologists()).map(serializePsychologist)
    };
  }

  async function listPsychologists() {
    return (await repository.listPsychologists()).map(serializePsychologist);
  }

  async function listPublicAvailability(ageCategory) {
    if (!AGE_CATEGORIES.some((item) => item.value === ageCategory)) {
      throw new AppError(400, "INVALID_AGE_CATEGORY", "Выбрана неизвестная возрастная категория.");
    }

    const psychologists = (await repository.getPsychologistsByCategory(ageCategory)).map((row) => ({
      ...serializePsychologist(row),
      slots: []
    }));

    const grouped = new Map(psychologists.map((item) => [item.id, item]));
    const slots = (await repository.getPublicAvailableSlotsByCategory(ageCategory)).filter(
      (row) => !isPublicBookingClosed(toIso(row.starts_at), nowProvider)
    );

    for (const slot of slots) {
      grouped.get(Number(slot.psychologist_id))?.slots.push(serializeSlot(slot));
    }

    return {
      age_category: ageCategory,
      age_category_label: getCategoryLabel(ageCategory),
      psychologists
    };
  }

  async function createBooking(payload) {
    const validation = validateBookingPayload(payload);
    if (!validation.valid) {
      throw new AppError(400, "INVALID_BOOKING_FORM", "Форма заполнена с ошибками.", validation.errors);
    }

    const value = validation.value;
    const timestamp = nowIso(nowProvider);

    const bookingId = await repository.transaction(async (tx) => {
      const slot = await tx.getSlotWithPsychologist(value.slot_id, { forUpdate: true });

      if (!slot || !slot.is_active) {
        throw new AppError(404, "SLOT_NOT_FOUND", "Выбранный слот не найден.");
      }

      if (slot.age_category !== value.age_category) {
        throw new AppError(400, "AGE_CATEGORY_MISMATCH", "Слот не соответствует выбранной возрастной категории.");
      }

      if (slot.status !== "available" || slot.booking_id !== null) {
        throw new AppError(409, "SLOT_ALREADY_BOOKED", "Этот слот уже занят.");
      }

      if (isPublicBookingClosed(toIso(slot.starts_at), nowProvider)) {
        throw new AppError(409, "SLOT_BOOKING_CLOSED", "Запись на этот слот уже закрыта: до начала осталось меньше 24 часов.");
      }

      const createdBookingId = await tx.insertBooking(
        {
          ...value,
          psychologist_id: Number(slot.psychologist_id)
        },
        timestamp
      );

      const slotUpdate = await tx.markSlotBooked(createdBookingId, timestamp, slot.id);
      if (slotUpdate !== 1) {
        throw new AppError(409, "SLOT_ALREADY_BOOKED", "Этот слот уже заняли, пока вы отправляли форму.");
      }

      return createdBookingId;
    });

    const booking = await repository.getBookingDetails(bookingId);
    const slot = await repository.getSlotWithPsychologist(value.slot_id);
    const notifications = await sendBookingNotifications({
      booking: serializeBooking(booking),
      psychologist: {
        id: Number(slot.psychologist_id),
        name: slot.psychologist_name,
        email: slot.psychologist_email
      },
      slot: serializeSlot(slot)
    });

    return {
      booking: serializeBooking(booking),
      notification: notifications
    };
  }

  async function listAdminBookings(filters = {}) {
    normalizeOptionalDate(filters.date);
    return (await repository.listAdminBookings(filters)).map(serializeBooking);
  }

  async function listAdminSlots(filters = {}) {
    normalizeOptionalDate(filters.date);
    return (await repository.listAdminSlots(filters)).map(serializeSlot);
  }

  async function createSlot(payload) {
    const psychologistId = Number(payload.psychologist_id);
    if (!Number.isInteger(psychologistId) || psychologistId <= 0) {
      throw new AppError(400, "INVALID_PSYCHOLOGIST", "Выберите психолога.");
    }

    const psychologist = await repository.getPsychologistById(psychologistId);
    if (!psychologist || !psychologist.is_active) {
      throw new AppError(404, "PSYCHOLOGIST_NOT_FOUND", "Психолог не найден или отключен.");
    }

    const startsAt = moscowInputToUtcIso(payload.starts_at_local);
    const timestamp = nowIso(nowProvider);
    const slotId = await repository.insertSlot(
      {
        psychologist_id: psychologistId,
        starts_at: startsAt,
        ends_at: computeEndsAtIso(startsAt),
        timezone: APP_TIMEZONE
      },
      timestamp
    );

    return serializeSlot(await repository.getSlotById(slotId));
  }

  async function createPsychologist(payload) {
    const validation = validatePsychologistPayload(payload);
    if (!validation.valid) {
      throw new AppError(400, "INVALID_PSYCHOLOGIST_FORM", "Форма психолога заполнена с ошибками.", validation.errors);
    }

    const psychologistId = await repository.insertPsychologist(validation.value, nowIso(nowProvider));
    return serializePsychologist(await repository.getPsychologistById(psychologistId));
  }

  async function updatePsychologist(psychologistId, payload) {
    const existing = await repository.getPsychologistById(Number(psychologistId));
    if (!existing) {
      throw new AppError(404, "PSYCHOLOGIST_NOT_FOUND", "Психолог не найден.");
    }

    const validation = validatePsychologistPayload(payload);
    if (!validation.valid) {
      throw new AppError(400, "INVALID_PSYCHOLOGIST_FORM", "Форма психолога заполнена с ошибками.", validation.errors);
    }

    await repository.updatePsychologist(Number(psychologistId), validation.value, nowIso(nowProvider));
    return serializePsychologist(await repository.getPsychologistById(Number(psychologistId)));
  }

  async function updateBookingStatus(bookingId, status) {
    assertValidBookingStatus(status);
    const booking = await repository.getBookingWithSlot(Number(bookingId));
    if (!booking) {
      throw new AppError(404, "BOOKING_NOT_FOUND", "Заявка не найдена.");
    }

    await repository.updateBookingStatus(Number(bookingId), status, nowIso(nowProvider));
    return serializeBooking(await repository.getBookingDetails(Number(bookingId)));
  }

  async function cancelBooking(bookingId, { releaseSlot = false } = {}) {
    const existing = await repository.getBookingWithSlot(Number(bookingId));
    if (!existing) {
      throw new AppError(404, "BOOKING_NOT_FOUND", "Заявка не найдена.");
    }

    await repository.transaction(async (tx) => {
      await tx.updateBookingStatus(Number(bookingId), "cancelled", nowIso(nowProvider));
      if (releaseSlot) {
        await tx.releaseSlotByBooking(Number(bookingId), nowIso(nowProvider));
      }
    });

    return serializeBooking(await repository.getBookingDetails(Number(bookingId)));
  }

  async function deleteSlot(slotId) {
    const slot = await repository.getSlotById(Number(slotId));
    if (!slot) {
      throw new AppError(404, "SLOT_NOT_FOUND", "Слот не найден.");
    }

    if (slot.status === "booked" || slot.booking_id !== null) {
      throw new AppError(409, "BOOKED_SLOT_DELETE_FORBIDDEN", "Нельзя удалить занятый слот. Сначала освободите его.");
    }

    const changes = await repository.softDeleteSlot(Number(slotId), nowIso(nowProvider));
    if (changes !== 1) {
      throw new AppError(409, "SLOT_DELETE_FAILED", "Не удалось удалить слот.");
    }

    return { id: Number(slotId) };
  }

  async function transferBooking(bookingId, targetSlotId) {
    const existing = await repository.getBookingWithSlot(Number(bookingId));
    if (!existing) {
      throw new AppError(404, "BOOKING_NOT_FOUND", "Заявка не найдена.");
    }

    await repository.transaction(async (tx) => {
      const booking = await tx.getBookingWithSlot(Number(bookingId), { forUpdate: true });
      const targetSlot = await tx.getSlotWithPsychologist(Number(targetSlotId), { forUpdate: true });

      if (!targetSlot || !targetSlot.is_active) {
        throw new AppError(404, "TARGET_SLOT_NOT_FOUND", "Целевой слот не найден.");
      }

      if (targetSlot.status !== "available" || targetSlot.booking_id !== null) {
        throw new AppError(409, "TARGET_SLOT_UNAVAILABLE", "Нельзя перенести заявку на занятый слот.");
      }

      const timestamp = nowIso(nowProvider);
      const targetMove = await tx.markTargetSlotBooked(Number(bookingId), timestamp, Number(targetSlotId));
      if (targetMove !== 1) {
        throw new AppError(409, "TARGET_SLOT_UNAVAILABLE", "Целевой слот уже заняли.");
      }

      await tx.freeOriginalSlot(timestamp, Number(booking.slot_id), Number(bookingId));
      await tx.reassignBooking({
        bookingId: Number(bookingId),
        slotId: Number(targetSlotId),
        psychologistId: Number(targetSlot.psychologist_id),
        ageCategory: targetSlot.age_category,
        timestamp
      });
    });

    return serializeBooking(await repository.getBookingDetails(Number(bookingId)));
  }

  return {
    getPublicMeta,
    getAdminMeta,
    listPsychologists,
    listPublicAvailability,
    createBooking,
    listAdminBookings,
    listAdminSlots,
    createPsychologist,
    updatePsychologist,
    createSlot,
    updateBookingStatus,
    cancelBooking,
    deleteSlot,
    transferBooking
  };
}
