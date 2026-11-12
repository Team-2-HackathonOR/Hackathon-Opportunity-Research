let accountMode = "login";
let accountSession = null;
let accountBusy = false;
const accountElement = (id) => document.getElementById(id);

function accountModeSelect(mode) {
  accountMode = mode;
  const registering = mode === "register";
  accountElement("account-login-tab").setAttribute("aria-pressed", String(!registering));
  accountElement("account-register-tab").setAttribute("aria-pressed", String(registering));
  accountElement("account-confirm-label").hidden = !registering;
  accountElement("account-confirm").required = registering;
  accountElement("account-confirm").value = "";
  accountElement("account-password").value = "";
  accountElement("account-password").minLength = registering ? 8 : 1;
  accountElement("account-password").autocomplete = registering ? "new-password" : "current-password";
  accountElement("account-password-hint").hidden = !registering;
  accountElement("account-submit").textContent = registering ? "Create account" : "Sign in";
  accountElement("account-feedback").textContent = "";
}

function accountShowApplication() {
  accountElement("account-entrance").hidden = true;
  accountElement("application-shell").hidden = false;
  accountElement("account-menu").textContent = accountSession
    ? `${accountSession.user.email} - Sign out` : "Sign in / Create account";
  accountElement("account-form").reset();
  window.scrollTo(0, 0);
}

async function accountRequest(route, { method = "POST", body } = {}) {
  const response = await fetch(`/api/auth/${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(accountSession ? { Authorization: `Bearer ${accountSession.token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let payload;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    throw new Error(`The authentication service returned an invalid response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const fieldErrors = payload?.details?.fieldErrors;
    const detail = fieldErrors && Object.values(fieldErrors).flat().join(" ");
    throw new Error(detail || payload?.error || `Authentication failed (HTTP ${response.status}).`);
  }
  return payload;
}

function accountSetBusy(busy) {
  accountBusy = busy;
  accountElement("account-form").querySelectorAll("input,button").forEach((control) => {
    control.disabled = busy;
  });
  for (const id of ["account-login-tab", "account-register-tab", "account-guest", "account-menu"]) {
    accountElement(id).disabled = busy;
  }
}

accountElement("account-login-tab").addEventListener("click", () => accountModeSelect("login"));
accountElement("account-register-tab").addEventListener("click", () => accountModeSelect("register"));
accountElement("account-guest").addEventListener("click", accountShowApplication);
accountElement("account-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (accountBusy) return;
  const password = accountElement("account-password").value;
  if (accountMode === "register" && password !== accountElement("account-confirm").value) {
    accountElement("account-feedback").textContent = "Passwords do not match.";
    return;
  }
  accountSetBusy(true);
  accountElement("account-feedback").textContent = accountMode === "register" ? "Creating your account..." : "Signing in...";
  try {
    const session = await accountRequest(accountMode, {
      body: { email: accountElement("account-email").value.trim(), password },
    });
    if (!session || typeof session.token !== "string" || !session.token ||
        typeof session.user?.email !== "string" || !["viewer", "researcher", "admin"].includes(session.user.role)) {
      throw new Error("The authentication service returned an invalid session.");
    }
    accountSession = session;
    accountShowApplication();
  } catch (error) {
    console.error("HackScout account access failed:", error.message);
    accountElement("account-feedback").textContent = error.message;
  } finally {
    accountElement("account-password").value = "";
    accountElement("account-confirm").value = "";
    accountSetBusy(false);
  }
});
accountElement("account-menu").addEventListener("click", async () => {
  if (accountBusy) return;
  accountElement("account-feedback").textContent = "";
  if (accountSession) {
    accountSetBusy(true);
    try {
      await accountRequest("logout", { body: {} });
    } catch (error) {
      console.error("HackScout session revocation failed:", error.message);
      accountElement("account-feedback").textContent = `Signed out locally. ${error.message}`;
    } finally {
      accountSession = null;
      accountSetBusy(false);
    }
  }
  accountElement("application-shell").hidden = true;
  accountElement("account-entrance").hidden = false;
  accountElement("account-form").reset();
  accountElement("account-email").focus();
  window.scrollTo(0, 0);
});
