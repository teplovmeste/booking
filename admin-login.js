const feedback = document.getElementById("login-feedback");
const form = document.getElementById("admin-login-form");

const url = new URL(window.location.href);

if (url.searchParams.get("error") === "1") {
  feedback.textContent = "Неверный логин или пароль. Попробуйте еще раз.";
  feedback.className = "feedback";
  feedback.classList.remove("hidden");
}

if (url.searchParams.get("logged_out") === "1") {
  feedback.textContent = "Вы вышли из админки.";
  feedback.className = "feedback success";
  feedback.classList.remove("hidden");
}

form?.addEventListener("submit", () => {
  feedback.classList.add("hidden");
});
