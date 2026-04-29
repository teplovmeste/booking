const state = {
  meta: null,
  bookingsFilters: {},
  slotsFilters: {},
  currentSlots: [],
  psychologists: []
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
  slotsList: document.getElementById("slots-list")
};

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

function fillSelect(select, options, includeEmptyLabel) {
  select.innerHTML = [
    includeEmptyLabel ? `<option value="">${includeEmptyLabel}</option>` : "",
    ...options.map((item) => `<option value="${item.value}">${item.label}</option>`)
  ].join("");
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
            <span class="status-pill" data-status-pill>${psychologist.is_active ? "Активен" : "Выключен"}</span>
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
            <span class="status-pill">${booking.status_label}</span>
          </div>
          <div class="admin-card__grid">
            <p><strong>Категория:</strong> ${booking.age_category_label}</p>
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
            <button class="button-secondary" type="button" data-action="cancel" data-booking-id="${booking.id}">
              Отменить
            </button>
            <button class="button-secondary" type="button" data-action="cancel-release" data-booking-id="${booking.id}">
              Отменить и освободить слот
            </button>
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

  elements.slotsList.innerHTML = items
    .map(
      (slot) => `
        <article class="admin-card">
          <div class="admin-card__head">
            <div>
              <h3>${slot.psychologist_name}</h3>
              <p>${slot.starts_at_label}</p>
            </div>
            <span class="status-pill">${slot.status}</span>
          </div>
          <div class="admin-card__grid">
            <p><strong>Категории:</strong> ${slot.psychologist_age_categories_label}</p>
            <p><strong>Часовой пояс:</strong> ${slot.timezone}</p>
            <p><strong>ID слота:</strong> ${slot.id}</p>
          </div>
          <div class="admin-actions">
            <button
              class="button-secondary"
              type="button"
              data-action="delete-slot"
              data-slot-id="${slot.id}"
              ${slot.status === "booked" ? "disabled" : ""}
            >
              Удалить слот
            </button>
          </div>
        </article>
      `
    )
    .join("");
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
  const payload = Object.fromEntries(new FormData(elements.slotForm).entries());

  try {
    await api("./api/admin/slots", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    elements.slotForm.reset();
    showFeedback(elements.slotFormFeedback, "Слот создан.", "success");
    await refreshLists();
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
    if (button.dataset.action === "cancel") {
      await api(`./api/admin/bookings/${bookingId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ release_slot: false })
      });
      showFeedback(elements.bookingsFeedback, "Заявка отменена.", "success");
    }

    if (button.dataset.action === "cancel-release") {
      await api(`./api/admin/bookings/${bookingId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ release_slot: true })
      });
      showFeedback(elements.bookingsFeedback, "Заявка отменена, слот освобожден.", "success");
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
