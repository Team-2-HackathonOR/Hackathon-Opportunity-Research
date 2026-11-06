const form = document.querySelector("#login-form");
const notification = document.querySelector("#notification");
const submit = document.querySelector("#submit");
const password = document.querySelector("#password");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submit.disabled = true;
  notification.textContent = "";
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: document.querySelector("#email").value.trim(), password: password.value }),
    });
    const session = await response.json();
    if (!response.ok) throw new Error(session.error || `Sign-in failed (HTTP ${response.status}).`);
    if (typeof session.token !== "string" || !session.token ||
        !["admin", "researcher", "viewer"].includes(session.user?.role)) {
      throw new Error("The authentication service returned an invalid session.");
    }
    sessionStorage.setItem("hackscout.jwt", session.token);
    password.value = "";
    window.location.assign(session.user.role === "admin" ? "/admin/" : "/");
  } catch (error) {
    console.error("Sign-in failed:", error);
    notification.textContent = error.message || "Sign-in failed. Please try again.";
  } finally {
    submit.disabled = false;
  }
});
