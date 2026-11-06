const accountLink = document.querySelector("#account-link");
const accountLogout = document.querySelector("#account-logout");
const authCheck = document.querySelector("#auth-check");
const app = document.querySelector("#app");
const accountToken = sessionStorage.getItem("hackscout.jwt");

function goToLogin() {
  sessionStorage.removeItem("hackscout.jwt");
  window.location.replace("/login/");
}

async function startApp() {
  if (!accountToken) {
    goToLogin();
    return;
  }
  try {
    const response = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${accountToken}` } });
    if (response.status === 401 || response.status === 403) {
      goToLogin();
      return;
    }
    const user = await response.json();
    if (!response.ok) throw new Error(user.error || `Session verification failed (HTTP ${response.status}).`);
    if (typeof user.email !== "string" || !["admin", "researcher", "viewer"].includes(user.role)) {
      throw new Error("The authentication service returned an invalid session.");
    }
    accountLink.textContent = `${user.email} (${user.role})`;
    accountLink.href = user.role === "admin" ? "/admin/" : "/login/";
    accountLogout.hidden = false;
    const script = document.createElement("script");
    script.src = "/app.js";
    script.onload = () => {
      authCheck.hidden = true;
      app.hidden = false;
    };
    script.onerror = () => {
      console.error("Could not load HackScout application.");
      authCheck.textContent = "Could not load HackScout. Please refresh the page.";
    };
    document.body.appendChild(script);
  } catch (error) {
    console.error("Could not verify session:", error);
    authCheck.textContent = "Could not verify your session. Check the authentication service and refresh the page.";
  }
}

accountLogout.addEventListener("click", async () => {
  accountLogout.disabled = true;
  try {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accountToken}` },
      body: "{}",
    });
    if (response.status === 401 || response.status === 403) {
      goToLogin();
      return;
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Sign-out failed (HTTP ${response.status}).`);
    goToLogin();
  } catch (error) {
    console.error("Sign-out failed:", error);
    accountLink.textContent = "Sign-out failed";
    accountLink.title = error.message;
  } finally {
    accountLogout.disabled = false;
  }
});

startApp();
