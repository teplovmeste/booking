import test from "node:test";
import assert from "node:assert/strict";
import { createRepository } from "../src/db.js";
import { createBookingModule } from "../src/module.js";

function createFixedNow() {
  return new Date("2026-04-21T09:00:00.000Z");
}

async function createTestModule(overrides = {}) {
  const repository =
    overrides.repository ||
    (await createRepository({
      driver: "sqlite",
      sqlitePath: ":memory:",
      seedDemoData: true,
      nowProvider: createFixedNow
    }));

  const sentNotifications = [];
  const moduleApi = createBookingModule({
    repository,
    nowProvider: createFixedNow,
    sendBookingNotifications: overrides.sendBookingNotifications
      || (async (context) => {
        sentNotifications.push(context);
        return { ok: true };
      })
  });

  return {
    repository,
    moduleApi,
    sentNotifications
  };
}

async function getFirstAvailableSlotForCategory(repository, ageCategory) {
  const availability = await repository.getPublicAvailableSlotsByCategory(ageCategory);
  return availability[0];
}

function validBookingPayload(slotId, ageCategory) {
  return {
    slot_id: slotId,
    age_category: ageCategory,
    parent_name: "Ирина",
    parent_email: "parent@example.com",
    parent_phone: "+79990000000",
    parent_telegram: "@irinaparent",
    child_name: "Миша",
    child_age: "8 лет",
    country: "Россия",
    request_text: "Нужна консультация по адаптации в школе.",
    preferred_contact_method: "telegram"
  };
}

test("admin can create slot", async () => {
  const { moduleApi } = await createTestModule();
  const meta = await moduleApi.getAdminMeta();
  const psychologist = meta.psychologists[0];
  const slot = await moduleApi.createSlot({
    psychologist_id: psychologist.id,
    starts_at_local: "2026-04-30T16:00"
  });

  assert.equal(slot.psychologist_id, psychologist.id);
  assert.equal(slot.status, "available");
});

test("admin can create psychologist", async () => {
  const { moduleApi } = await createTestModule();
  const created = await moduleApi.createPsychologist({
    name: "Новый психолог",
    email: "new-psych@example.com",
    age_categories: ["preschool", "teens"],
    is_active: "true"
  });

  assert.equal(created.name, "Новый психолог");
  assert.equal(created.email, "new-psych@example.com");
  assert.equal(created.age_category, "preschool");
  assert.deepEqual(created.age_categories, ["preschool", "teens"]);
  assert.equal(created.is_active, true);
});

test("admin can update psychologist", async () => {
  const { moduleApi } = await createTestModule();
  const meta = await moduleApi.getAdminMeta();
  const psychologist = meta.psychologists[0];

  const updated = await moduleApi.updatePsychologist(psychologist.id, {
    name: "Анна Обновленная",
    email: "anna-updated@example.com",
    age_categories: ["primary_school", "teens"],
    is_active: "false"
  });

  assert.equal(updated.name, "Анна Обновленная");
  assert.equal(updated.email, "anna-updated@example.com");
  assert.equal(updated.age_category, "primary_school");
  assert.deepEqual(updated.age_categories, ["primary_school", "teens"]);
  assert.equal(updated.is_active, false);
});

test("public availability shows only matching psychologists and only available slots", async () => {
  const { repository, moduleApi } = await createTestModule();
  const preschool = await moduleApi.listPublicAvailability("preschool");

  assert.ok(preschool.psychologists.every((item) => item.age_categories.includes("preschool")));
  assert.ok(preschool.psychologists.some((item) => item.slots.length > 0));

  const slotId = (await getFirstAvailableSlotForCategory(repository, "preschool")).id;
  await moduleApi.createBooking(validBookingPayload(slotId, "preschool"));
  const refreshed = await moduleApi.listPublicAvailability("preschool");
  const flattenedSlotIds = refreshed.psychologists.flatMap((item) => item.slots.map((slot) => slot.id));

  assert.ok(!flattenedSlotIds.includes(Number(slotId)));
});

test("one psychologist can appear in multiple age categories", async () => {
  const { moduleApi } = await createTestModule();

  const primarySchool = await moduleApi.listPublicAvailability("primary_school");
  const teens = await moduleApi.listPublicAvailability("teens");

  const sharedName = "Дарья Соболева";
  assert.ok(primarySchool.psychologists.some((item) => item.name === sharedName));
  assert.ok(teens.psychologists.some((item) => item.name === sharedName));
});

test("not important category shows all active psychologists with available slots", async () => {
  const { moduleApi } = await createTestModule();
  const availability = await moduleApi.listPublicAvailability("not_important");

  assert.ok(availability.psychologists.length >= 4);
  assert.ok(availability.psychologists.some((item) => item.slots.length > 0));
});

test("slots within 24 hours are hidden from public booking", async () => {
  const { repository, moduleApi } = await createTestModule();
  const psychologist = (await moduleApi.getAdminMeta()).psychologists.find((item) => item.age_categories.includes("teens"));

  await moduleApi.createSlot({
    psychologist_id: psychologist.id,
    starts_at_local: "2026-04-22T10:00"
  });

  const teens = await moduleApi.listPublicAvailability("teens");
  assert.ok(
    teens.psychologists.every((item) => item.slots.every((slot) => !slot.starts_at_label.includes("22 апреля 2026 г.")))
  );

  const directSlot = (await repository.listAdminSlots({ psychologist_id: psychologist.id }))[0];

  await assert.rejects(() => moduleApi.createBooking(validBookingPayload(directSlot.id, "teens")), {
    code: "SLOT_BOOKING_CLOSED"
  });
});

test("successful booking locks slot and sends notifications", async () => {
  const { repository, moduleApi, sentNotifications } = await createTestModule();
  const slotId = (await getFirstAvailableSlotForCategory(repository, "primary_school")).id;

  const result = await moduleApi.createBooking(validBookingPayload(slotId, "primary_school"));
  const slot = await repository.getSlotWithPsychologist(slotId);

  assert.equal(result.booking.status, "new");
  assert.equal(slot.status, "booked");
  assert.equal(Number(slot.booking_id), result.booking.id);
  assert.equal(sentNotifications.length, 1);
});

test("booking can be created when parent selected not important", async () => {
  const { repository, moduleApi } = await createTestModule();
  const slotId = (await getFirstAvailableSlotForCategory(repository, "teens")).id;

  const result = await moduleApi.createBooking(validBookingPayload(slotId, "not_important"));
  const slot = await repository.getSlotWithPsychologist(slotId);

  assert.equal(result.booking.age_category, "not_important");
  assert.equal(slot.status, "booked");
});

test("repeat booking for same slot is impossible", async () => {
  const { repository, moduleApi } = await createTestModule();
  const slotId = (await getFirstAvailableSlotForCategory(repository, "teens")).id;

  await moduleApi.createBooking(validBookingPayload(slotId, "teens"));

  await assert.rejects(() => moduleApi.createBooking(validBookingPayload(slotId, "teens")), (error) => {
    assert.equal(error.code, "SLOT_ALREADY_BOOKED");
    return true;
  });
});

test("booking status can be changed in admin", async () => {
  const { repository, moduleApi } = await createTestModule();
  const slotId = (await getFirstAvailableSlotForCategory(repository, "preschool")).id;
  const created = await moduleApi.createBooking(validBookingPayload(slotId, "preschool"));

  const updated = await moduleApi.updateBookingStatus(created.booking.id, "confirmed");

  assert.equal(updated.status, "confirmed");
});

test("admin can transfer booking and old slot becomes available", async () => {
  const { repository, moduleApi } = await createTestModule();
  const oldSlotId = (await getFirstAvailableSlotForCategory(repository, "teens")).id;
  const booking = await moduleApi.createBooking(validBookingPayload(oldSlotId, "teens"));
  const targetSlotId = (await repository.listAdminSlots({ psychologist_id: 3 })).find(
    (slot) => Number(slot.id) !== Number(oldSlotId) && slot.status === "available"
  ).id;

  const moved = await moduleApi.transferBooking(booking.booking.id, targetSlotId);
  const oldSlot = await repository.getSlotWithPsychologist(oldSlotId);
  const newSlot = await repository.getSlotWithPsychologist(targetSlotId);

  assert.equal(moved.slot_id, Number(targetSlotId));
  assert.equal(oldSlot.status, "available");
  assert.equal(oldSlot.booking_id, null);
  assert.equal(newSlot.status, "booked");
  assert.equal(Number(newSlot.booking_id), booking.booking.id);
});

test("admin cannot transfer booking to already booked slot", async () => {
  const { repository, moduleApi } = await createTestModule();
  const teensSlots = await repository.getPublicAvailableSlotsByCategory("teens");
  const firstSlot = teensSlots[0].id;
  const secondSlot = teensSlots.find((slot) => Number(slot.id) !== Number(firstSlot)).id;

  const bookingOne = await moduleApi.createBooking(validBookingPayload(firstSlot, "teens"));
  await moduleApi.createBooking(validBookingPayload(secondSlot, "teens"));

  await assert.rejects(() => moduleApi.transferBooking(bookingOne.booking.id, secondSlot), {
    code: "TARGET_SLOT_UNAVAILABLE"
  });
});

test("booking survives email failure and returns explicit notification state", async () => {
  const { repository, moduleApi } = await createTestModule({
    sendBookingNotifications: async () => ({ ok: false, error: "smtp failed" })
  });

  const slotId = (await getFirstAvailableSlotForCategory(repository, "preschool")).id;
  const result = await moduleApi.createBooking(validBookingPayload(slotId, "preschool"));
  const slot = await repository.getSlotWithPsychologist(slotId);

  assert.equal(result.booking.status, "new");
  assert.equal(result.notification.ok, false);
  assert.equal(slot.status, "booked");
  assert.equal(Number(slot.booking_id), result.booking.id);
});

test("admin can cancel booking and release the slot", async () => {
  const { repository, moduleApi } = await createTestModule();
  const slotId = (await getFirstAvailableSlotForCategory(repository, "primary_school")).id;
  const created = await moduleApi.createBooking(validBookingPayload(slotId, "primary_school"));

  const cancelled = await moduleApi.cancelBooking(created.booking.id, { releaseSlot: true });
  const slot = await repository.getSlotWithPsychologist(slotId);

  assert.equal(cancelled.status, "cancelled");
  assert.equal(slot.status, "available");
  assert.equal(slot.booking_id, null);
});

test("admin cannot delete a booked slot", async () => {
  const { repository, moduleApi } = await createTestModule();
  const slotId = (await getFirstAvailableSlotForCategory(repository, "preschool")).id;
  await moduleApi.createBooking(validBookingPayload(slotId, "preschool"));

  await assert.rejects(() => moduleApi.deleteSlot(slotId), {
    code: "BOOKED_SLOT_DELETE_FORBIDDEN"
  });
});

test("invalid booking payload is rejected with field details", async () => {
  const { repository, moduleApi } = await createTestModule();
  const slotId = (await getFirstAvailableSlotForCategory(repository, "teens")).id;

  await assert.rejects(
    () =>
      moduleApi.createBooking({
      ...validBookingPayload(slotId, "teens"),
      parent_email: "broken-email",
      child_age: "",
      request_text: ""
    }),
    (error) => {
      assert.equal(error.code, "INVALID_BOOKING_FORM");
      assert.equal(error.details.parent_email, "Укажите корректный email.");
      assert.equal(error.details.child_age, "Укажите возраст ребенка или детей.");
      assert.equal(error.details.request_text, "Опишите краткий запрос.");
      return true;
    }
  );
});
