const state = {
  meta: null,
  bookingsFilters: {},
  slotsFilters: {},
  currentSlots: [],
  psychologists: [],
  recentCreatedSlotId: null
};

const elements = {
  psychologistForm: document.getElementById("psychologist-form"),
  psychologistFormFeedback: document.getElementById("psychologist-form-feedback"),
  psychologistsList: document.getElementById("psychologists-list"),
  slotForm: document.getElementById("slot-form"),
  slotFormFeedback: document.getElementById("slot-form-feedback"),
  bookingFilters: document.getElementById("booking-filters"),
  slotFilters: document.getElementById("slot-filters"),
  bookingsFeedback: document.getElementById("bookings-feedback"),
  slotsFeedback: document.getElementById("slots-feedback"),
  bookingsList: document.getElementById("bookings-list"),
  slotsList: document.getElementById("slots-list"),
  slotsSection: document.getElementById("slots-section")
};

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) => {
  const value = String(index).padStart(2, "0");
  return { value, label: value };
});

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });
  const payload = await response.json();

  if (response.status === 401) {
    const loginPath = window.location.pathname.replace(/\/admin\/?$/, "/admin/login");
    window.location.href = loginPath;
    throw { message: "Сессия администратора истекла." };
  }

  if (!response.ok) {
    throw payload.error || { message: "Не удалось выполнить запрос." };
  }

  return payload.data;
}

function showFeedback(target, message, kind = "error") {
  target.className = `feedback ${kind}`;
  target.textContent = message;
  target.classList.remove("hidden");
}

function clearFeedback(target) {
  target.textContent = "";
  target.className = "feedback hidden";
}

function scrollToElement(element) {
  if (!element) return;

  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  window.requestAnimationFrame(() => {
    element.scrollIntoView({ behavior, block: "start" });
  });
}

function fillSelect(select, options, includeEmptyLabel) {
  select.innerHTML = [
    includeEmptyLabel ? `<option value="">${includeEmptyLabel}</option>` : "",
    ...options.map((item) => `<option value="${item.value}">${item.label}</option>`)
  ].join("");
}

function buildSlotStartsAtLocal(form) {
  const date = form.elements.starts_at_date.value;
  const hour = form.elements.starts_at_hour.value;
  const minute = form.elements.starts_at_minute.value;

  if (!date || hour === "" || minute === "") {
    return "";
  }

  return `${date}T${hour}:${minute}`;
}

function buildQuery(params) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      searchParams.set(key, value);
    }
  });
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

function buildPsychologistOptions() {
  return state.psychologists.map((item) => ({
    value: String(item.id),
    label: `${item.name} — ${item.age_categories_label}`
  }));
}

function getPsychologistStatusPillClass(isActive) {
  return isActive ? "status-pill status-pill--success" : "status-pill";
}

function getBookingStatusPillClass(status) {
  const statusClassMap = {
    new: "status-pill status-pill--info",
    awaiting_payment: "status-pill status-pill--success-strong",
    confirmed: "status-pill status-pill--success-soft",
    cancelled: "status-pill status-pill--danger",
    completed: "status-pill status-pill--violet"
  };

  return statusClassMap[status] || "status-pill";
}

function renderCategoryCheckboxes(selectedValues = [], namespace = "psychologist") {
  const selected = new Set(selectedValues);

  return state.meta.categories
    .map(
      (category, index) => `
        <label class="checkbox-pill" for="${namespace}-category-${index}">
          <input
            id="${namespace}-category-${index}"
            name="age_categories"
            type="checkbox"
            value="${category.value}"
            ${selected.has(category.value) ? "checked" : ""}
          />
          <span>${category.label}</span>
        </label>
      `
    )
    .join("");
}

function refreshPsychologistSelects() {
  const psychologists = buildPsychologistOptions();
  elements.psychologistForm.querySelector("[data-psychologist-categories]").innerHTML = renderCategoryCheckboxes(
    [],
    "create"
  );
  fillSelect(elements.slotForm.elements.psychologist_id, psychologists);
  fillSelect(elements.slotForm.elements.starts_at_hour, HOUR_OPTIONS);
  elements.slotForm.elements.starts_at_minute.value = "00";
  fillSelect(elements.bookingFilters.elements.psychologist_id, psychologists, "Все психологи");
  fillSelect(elements.slotFilters.elements.psychologist_id, psychologists, "Все психологи");
  fillSelect(elements.bookingFilters.elements.status, state.meta.booking_statuses, "Все статусы");
  fillSelect(elements.slotFilters.elements.status, state.meta.slot_statuses, "Все статусы");
}

function renderPsychologists(items) {
  if (!items.length) {
    elements.psychologistsList.innerHTML = '<p class="empty-state">Психологов пока нет.</p>';
    return;
  }

  elements.psychologistsList.innerHTML = items
    .map(
      (psychologist) => `
        <article class="admin-card">
          <div class="admin-card__head">
            <div>
              <h3>${psychologist.name}</h3>
              <p>${psychologist.age_categories_label}</p>
            </div>
            <span class="${getPsychologistStatusPillClass(psychologist.is_active)}" data-status-pill>${psychologist.is_active ? "Активен" : "Выключен"}</span>
          </div>
          <form class="admin-form compact-form" data-psychologist-form data-psychologist-id="${psychologist.id}">
            <div class="admin-card__grid">
              <label>
                <span>Имя</span>
                <input name="name" type="text" value="${escapeHtml(psychologist.name)}" required />
              </label>
              <label>
                <span>Email</span>
                <input name="email" type="email" value="${escapeHtml(psychologist.email)}" required />
              </label>
              <label>
                <span>Возрастные категории</span>
                <div class="checkbox-group">
                  ${renderCategoryCheckboxes(psychologist.age_categories, `edit-${psychologist.id}`)}
                </div>
              </label>
              <label>
                <span>Статус</span>
                <select name="is_active">
                  <option value="true"${psychologist.is_active ? " selected" : ""}>Активен</option>
                  <option value="false"${psychologist.is_active ? "" : " selected"}>Выключен</option>
                </select>
              </label>
            </div>
            <div class="admin-actions">
              <button class="button-secondary" type="submit">Сохранить</button>
            </div>
          </form>
        </article>
      `
    )
    .join("");
}

function syncPsychologistStatusPreview(form) {
  const statusPill = form.closest(".admin-card")?.querySelector("[data-status-pill]");
  const selectedValue = form.elements.is_active?.value;

  if (!statusPill || !selectedValue) {
    return;
  }

  statusPill.className = getPsychologistStatusPillClass(selectedValue === "true");
  statusPill.textContent = selectedValue === "true" ? "Активен" : "Выключен";
}

function renderBookings(items) {
  if (!items.length) {
    elements.bookingsList.innerHTML = '<p class="empty-state">Заявок по текущему фильтру нет.</p>';
    return;
  }

  elements.bookingsList.innerHTML = items
    .map((booking) => {
      const statusOptions = state.meta.booking_statuses
        .map(
          (status) => `
            <option value="${status.value}"${status.value === booking.status ? " selected" : ""}>
              ${status.label}
            </option>
          `
        )
        .join("");

      const transferOptions = [
        '<option value="">Перенести на слот</option>',
        ...state.currentSlots
          .filter((slot) => slot.status === "available")
          .map(
            (slot) =>
              `<option value="${slot.id}">${slot.psychologist_name} — ${slot.starts_at_label}</option>`
          )
      ].join("");

      return `
        <article class="admin-card">
          <div class="admin-card__head">
            <div>
              <h3>${booking.parent_name} → ${booking.psychologist_name}</h3>
              <p>${booking.slot_starts_at_label}</p>
            </div>
            <span class="${getBookingStatusPillClass(booking.status)}">${booking.status_label}</span>
          </div>
          <div class="admin-card__grid">
            <p><strong>Категория:</strong> ${booking.age_category_label}</p>
            <p><strong>Удобное время:</strong> ${booking.preferred_time || "Не указано"}</p>
            <p><strong>Ребенок:</strong> ${booking.child_name}, ${booking.child_age}</p>
            <p><strong>Email:</strong> ${booking.parent_email}</p>
            <p><strong>Телефон:</strong> ${booking.parent_phone}</p>
            <p><strong>Telegram:</strong> ${booking.parent_telegram}</p>
            <p><strong>Страна:</strong> ${booking.country}</p>
            <p><strong>Способ связи:</strong> ${booking.preferred_contact_method_label}</p>
            <p><strong>Запрос:</strong> ${booking.request_text}</p>
          </div>
          <div class="admin-actions">
            <label class="inline-field">
              <span>Статус</span>
              <select data-action="status" data-booking-id="${booking.id}">
                ${statusOptions}
              </select>
            </label>
            <button class="button-secondary" type="button" data-action="cancel-release" data-booking-id="${booking.id}">
              Отменить и освободить слот
            </button>
            ${booking.status === "cancelled" ? `
              <button class="button-secondary" type="button" data-action="delete-booking" data-booking-id="${booking.id}">
                Удалить заявку
              </button>
            ` : ""}
            <label class="inline-field">
              <span>Перенос</span>
              <select data-action="transfer" data-booking-id="${booking.id}">
                ${transferOptions}
              </select>
            </label>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderSlots(items) {
  state.currentSlots = items;

  if (!items.length) {
    elements.slotsList.innerHTML = '<p class="empty-state">Слотов по текущему фильтру нет.</p>';
    return;
  }

  const grouped = new Map();

  for (const slot of items) {
    const psychologistId = String(slot.psychologist_id);
    if (!grouped.has(psychologistId)) {
      grouped.set(psychologistId, {
        psychologist_id: slot.psychologist_id,
        psychologist_name: slot.psychologist_name,
        psychologist_age_categories_label: slot.psychologist_age_categories_label,
        slots: []
      });
    }

    grouped.get(psychologistId).slots.push(slot);
  }

  elements.slotsList.innerHTML = [...grouped.values()]
    .map((group) => `
      <article class="psychologist-card">
        <div class="psychologist-card__head">
          <h3>${escapeHtml(group.psychologist_name)}</h3>
          <p>Работает с: ${escapeHtml(group.psychologist_age_categories_label)}</p>
        </div>
        <div class="slot-list">
          ${group.slots.map((slot) => renderAdminSlotTile(slot)).join("")}
        </div>
      </article>
    `)
    .join("");
}

function renderAdminSlotTile(slot) {
  const statusLabelMap = {
    available: "Доступен",
    booked: "Занят",
    deleted: "Удален"
  };
  const statusLabel = statusLabelMap[slot.status] || slot.status;

  return `
    <div class="admin-slot-tile${state.recentCreatedSlotId === slot.id ? " admin-slot-tile--highlight" : ""}" data-slot-card-id="${slot.id}">
      <div class="admin-slot-tile__meta">
        <span class="admin-slot-tile__time">${escapeHtml(slot.starts_at_label)}</span>
        <span class="admin-slot-tile__timezone">(${escapeHtml(slot.timezone)})</span>
      </div>
      <div class="admin-slot-tile__footer">
        <span class="admin-slot-tile__status admin-slot-tile__status--${slot.status}">${statusLabel}</span>
        <button
          class="slot-trash-button"
          type="button"
          data-action="delete-slot"
          data-slot-id="${slot.id}"
          aria-label="Удалить слот ${escapeHtml(slot.starts_at_label)}"
          title="Удалить слот"
          ${slot.status !== "available" ? "disabled" : ""}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v8h-2V9zm4 0h2v8h-2V9zM7 9h2v8H7V9zm1 12a2 2 0 0 1-2-2V8h12v11a2 2 0 0 1-2 2H8z"></path>
          </svg>
        </button>
      </div>
    </div>
  `;
}

async function loadMeta() {
  const meta = await api("./api/admin/meta");
  state.meta = meta;
  state.psychologists = meta.psychologists;
  refreshPsychologistSelects();
}

async function loadPsychologists() {
  state.psychologists = await api("./api/admin/psychologists");
  refreshPsychologistSelects();
  renderPsychologists(state.psychologists);
}

async function loadBookings() {
  const items = await api(`./api/admin/bookings${buildQuery(state.bookingsFilters)}`);
  renderBookings(items);
}

async function loadSlots() {
  const items = await api(`./api/admin/slots${buildQuery(state.slotsFilters)}`);
  renderSlots(items);
}

async function refreshLists() {
  await loadPsychologists();
  await loadSlots();
  await loadBookings();
}

function formToPayload(form) {
  const formData = new FormData(form);
  const payload = Object.fromEntries(
    [...formData.entries()].filter(([key]) => key !== "age_categories")
  );
  payload.age_categories = formData.getAll("age_categories");
  return payload;
}

elements.psychologistForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFeedback(elements.psychologistFormFeedback);
  const payload = formToPayload(elements.psychologistForm);

  try {
    await api("./api/admin/psychologists", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    elements.psychologistForm.reset();
    elements.psychologistForm.elements.is_active.value = "true";
    showFeedback(elements.psychologistFormFeedback, "Психолог добавлен.", "success");
    await refreshLists();
  } catch (error) {
    showFeedback(elements.psychologistFormFeedback, buildErrorMessage(error) || "Не удалось добавить психолога.");
  }
});

elements.psychologistsList.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-psychologist-form]");
  if (!form) {
    return;
  }

  event.preventDefault();
  clearFeedback(elements.psychologistFormFeedback);
  const payload = formToPayload(form);

  try {
    await api(`./api/admin/psychologists/${form.dataset.psychologistId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    showFeedback(elements.psychologistFormFeedback, "Психолог обновлен.", "success");
    await refreshLists();
  } catch (error) {
    showFeedback(elements.psychologistFormFeedback, buildErrorMessage(error) || "Не удалось обновить психолога.");
  }
});

elements.psychologistsList.addEventListener("change", (event) => {
  const form = event.target.closest("[data-psychologist-form]");
  if (!form || event.target.name !== "is_active") {
    return;
  }

  syncPsychologistStatusPreview(form);
});

elements.slotForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFeedback(elements.slotFormFeedback);
  const payload = {
    psychologist_id: elements.slotForm.elements.psychologist_id.value,
    starts_at_local: buildSlotStartsAtLocal(elements.slotForm)
  };

  try {
    const createdSlot = await api("./api/admin/slots", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.recentCreatedSlotId = createdSlot.id;
    elements.slotForm.reset();
    fillSelect(elements.slotForm.elements.starts_at_hour, HOUR_OPTIONS);
    elements.slotForm.elements.starts_at_minute.value = "00";
    state.slotsFilters = {};
    elements.slotFilters.reset();
    showFeedback(elements.slotFormFeedback, `Слот создан: ${createdSlot.psychologist_name}, ${createdSlot.starts_at_label}.`, "success");
    await refreshLists();
    scrollToElement(elements.slotsSection);
    const createdCard = elements.slotsList.querySelector(`[data-slot-card-id="${createdSlot.id}"]`);
    scrollToElement(createdCard);
  } catch (error) {
    showFeedback(elements.slotFormFeedback, buildErrorMessage(error) || "Не удалось создать слот.");
  }
});

elements.bookingFilters.addEventListener("submit", async (event) => {
  event.preventDefault();
  state.bookingsFilters = Object.fromEntries(new FormData(elements.bookingFilters).entries());
  await loadBookings();
});

elements.slotFilters.addEventListener("submit", async (event) => {
  event.preventDefault();
  state.slotsFilters = Object.fromEntries(new FormData(elements.slotFilters).entries());
  await loadSlots();
});

elements.bookingsList.addEventListener("change", async (event) => {
  const select = event.target.closest("select");
  if (!select) return;

  const bookingId = select.dataset.bookingId;
  const action = select.dataset.action;

  clearFeedback(elements.bookingsFeedback);

  try {
    if (action === "status") {
      await api(`./api/admin/bookings/${bookingId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: select.value })
      });
      showFeedback(elements.bookingsFeedback, "Статус обновлен.", "success");
    }

    if (action === "transfer" && select.value) {
      await api(`./api/admin/bookings/${bookingId}/transfer`, {
        method: "POST",
        body: JSON.stringify({ target_slot_id: Number(select.value) })
      });
      showFeedback(elements.bookingsFeedback, "Заявка перенесена на новый слот.", "success");
      select.value = "";
    }

    await refreshLists();
  } catch (error) {
    showFeedback(elements.bookingsFeedback, buildErrorMessage(error) || "Не удалось обновить заявку.");
  }
});

elements.bookingsList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const bookingId = button.dataset.bookingId;
  clearFeedback(elements.bookingsFeedback);

  try {
    if (button.dataset.action === "cancel-release") {
      await api(`./api/admin/bookings/${bookingId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ release_slot: true })
      });
      showFeedback(elements.bookingsFeedback, "Заявка отменена, слот освобожден.", "success");
    }

    if (button.dataset.action === "delete-booking") {
      await api(`./api/admin/bookings/${bookingId}`, {
        method: "DELETE"
      });
      showFeedback(elements.bookingsFeedback, "Заявка удалена.", "success");
    }

    await refreshLists();
  } catch (error) {
    showFeedback(elements.bookingsFeedback, buildErrorMessage(error) || "Не удалось обновить заявку.");
  }
});

elements.slotsList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action='delete-slot']");
  if (!button) return;

  clearFeedback(elements.slotsFeedback);

  try {
    await api(`./api/admin/slots/${button.dataset.slotId}`, {
      method: "DELETE"
    });
    showFeedback(elements.slotsFeedback, "Слот удален.", "success");
    await refreshLists();
  } catch (error) {
    showFeedback(elements.slotsFeedback, buildErrorMessage(error) || "Не удалось удалить слот.");
  }
});

async function bootstrap() {
  await loadMeta();
  await refreshLists();
}

function buildErrorMessage(error) {
  const details = error.details ? Object.values(error.details).join(" ") : "";
  return [error.message, details].filter(Boolean).join(" ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

bootstrap().catch((error) => {
  showFeedback(elements.bookingsFeedback, error.message || "Не удалось загрузить админку.");
});
