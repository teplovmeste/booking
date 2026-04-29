const state = {
  categories: [],
  contactMethods: [],
  contactEmail: "",
  selectedCategory: null,
  selectedSlot: null,
  successMessage: ""
};

const elements = {
  categoryGrid: document.getElementById("category-grid"),
  categoryEmpty: document.getElementById("category-empty"),
  psychologistsList: document.getElementById("psychologists-list"),
  bookingForm: document.getElementById("booking-form"),
  formFeedback: document.getElementById("form-feedback"),
  selectedSlotSummary: document.getElementById("selected-slot-summary"),
  successCard: document.getElementById("success-card"),
  successMessage: document.getElementById("success-message"),
  successWarning: document.getElementById("success-warning")
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });

  const payload = await response.json();
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

function buildContactLink(subject, body) {
  const params = new URLSearchParams({ subject, body });
  return `mailto:${state.contactEmail}?${params.toString()}`;
}

function renderCategoryEmpty() {
  const categoryLabel = state.categories.find((item) => item.value === state.selectedCategory)?.label || "выбранной категории";

  elements.categoryEmpty.innerHTML = `
    <div class="contact-fallback">
      <p>Для категории <strong>${categoryLabel}</strong> сейчас нет доступных слотов.</p>
      <a
        class="button-secondary"
        href="${buildContactLink(
          `Нет слотов в категории ${categoryLabel}`,
          `Здравствуйте!\n\nСейчас в категории ${categoryLabel} нет свободных слотов. Помогите, пожалуйста, подобрать запись или предложить альтернативу.`
        )}"
      >
        Связаться с нами
      </a>
    </div>
  `;
}

function renderCategories() {
  elements.categoryGrid.innerHTML = state.categories
    .map(
      (category) => `
        <button class="category-card${state.selectedCategory === category.value ? " is-active" : ""}" type="button" data-category="${category.value}">
          <span>${category.label}</span>
        </button>
      `
    )
    .join("");
}

function renderContactMethods() {
  elements.bookingForm.elements.preferred_contact_method.innerHTML = [
    '<option value="">Выберите способ связи</option>',
    ...state.contactMethods.map(
      (item) => `<option value="${item.value}">${item.label}</option>`
    )
  ].join("");
}

function renderPsychologists(data) {
  const hasAnySlots = data.psychologists.some((item) => item.slots.length > 0);
  elements.categoryEmpty.classList.toggle("hidden", hasAnySlots);
  if (!hasAnySlots) {
    renderCategoryEmpty();
  }

  elements.psychologistsList.innerHTML = data.psychologists
    .map((psychologist) => {
      const slotsMarkup = psychologist.slots.length
        ? psychologist.slots
            .map(
              (slot) => `
                <button class="slot-button${state.selectedSlot?.id === slot.id ? " is-active" : ""}" type="button" data-slot-id="${slot.id}" data-slot-label="${slot.starts_at_label}" data-psychologist-name="${psychologist.name}">
                  ${slot.starts_at_label}
                </button>
              `
            )
            .join("")
        : `
          <div class="contact-fallback">
            <p class="muted-line">Сейчас свободных слотов нет.</p>
            <a
              class="button-secondary"
              href="${buildContactLink(
                `Нет слотов: ${psychologist.name}`,
                `Здравствуйте!\n\nСейчас у психолога ${psychologist.name} нет свободных слотов. Подскажите, пожалуйста, можно ли предложить альтернативу или лист ожидания?`
              )}"
            >
              Связаться с нами
            </a>
          </div>
        `;

      return `
        <article class="psychologist-card">
          <div class="psychologist-card__head">
            <h3>${psychologist.name}</h3>
            <p>Работает с: ${psychologist.age_categories_label}</p>
          </div>
          <div class="slot-list">
            ${slotsMarkup}
          </div>
        </article>
      `;
    })
    .join("");
}

function setSelectedSlot(slot) {
  state.selectedSlot = slot;
  elements.bookingForm.classList.remove("hidden");
  elements.bookingForm.elements.slot_id.value = String(slot.id);
  elements.bookingForm.elements.age_category.value = state.selectedCategory;
  elements.selectedSlotSummary.textContent = `Выбран слот: ${slot.label} — ${slot.psychologistName}.`;
  renderCategories();
  loadAvailability(state.selectedCategory);
}

async function loadAvailability(ageCategory) {
  clearFeedback(elements.formFeedback);
  const data = await api(`./api/public/availability?age_category=${encodeURIComponent(ageCategory)}`);
  renderPsychologists(data);

  elements.psychologistsList.querySelectorAll("[data-slot-id]").forEach((button) => {
    button.addEventListener("click", () => {
      setSelectedSlot({
        id: Number(button.dataset.slotId),
        label: button.dataset.slotLabel,
        psychologistName: button.dataset.psychologistName
      });
    });
  });
}

async function bootstrap() {
  const meta = await api("./api/public/meta");
  state.categories = meta.categories;
  state.contactMethods = meta.contact_methods || [];
  state.contactEmail = meta.contact_email || "support@teplovmeste.com";
  state.successMessage = meta.success_message;
  state.selectedCategory = meta.categories[0]?.value || null;

  renderCategories();
  renderContactMethods();
  elements.categoryGrid.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;

    state.selectedCategory = button.dataset.category;
    state.selectedSlot = null;
    elements.bookingForm.reset();
    elements.bookingForm.classList.add("hidden");
    elements.successCard.classList.add("hidden");
    elements.selectedSlotSummary.textContent = "Сначала выберите слот, после этого откроется форма заявки.";
    renderCategories();
    await loadAvailability(state.selectedCategory);
  });

  if (state.selectedCategory) {
    await loadAvailability(state.selectedCategory);
  }
}

elements.bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFeedback(elements.formFeedback);
  elements.successCard.classList.add("hidden");

  const payload = Object.fromEntries(new FormData(elements.bookingForm).entries());

  try {
    const result = await api("./api/public/bookings", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    elements.bookingForm.reset();
    elements.bookingForm.classList.add("hidden");
    state.selectedSlot = null;
    elements.successCard.classList.remove("hidden");
    elements.successMessage.textContent = state.successMessage;
    elements.successWarning.classList.add("hidden");

    if (!result.notification.ok) {
      elements.successWarning.textContent =
        "Заявка сохранена, но отправка email не удалась. Ошибка залогирована для ручной проверки администратором.";
      elements.successWarning.classList.remove("hidden");
    }

    await loadAvailability(state.selectedCategory);
    elements.selectedSlotSummary.textContent = "Выберите следующий слот, если нужно оформить еще одну запись.";
  } catch (error) {
    const details = error.details ? Object.values(error.details).join(" ") : "";
    showFeedback(elements.formFeedback, [error.message, details].filter(Boolean).join(" "));
  }
});

bootstrap().catch((error) => {
  showFeedback(elements.formFeedback, error.message || "Не удалось загрузить страницу записи.");
});
