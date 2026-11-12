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

function showAccountData() {
  accountElement("account-data-feedback").textContent = "";
  accountElement("clear-browser-confirm").checked = false;
  accountElement("delete-account-form").reset();
  accountElement("delete-account-form").hidden = !accountSession;
  accountElement("delete-account-description").textContent = accountSession
    ? `Delete ${accountSession.user.email}, all sign-in sessions and invitations to or from this account. Linked team-member records, contributions and verifications are removed; moderator identity and notes are anonymized. Public listings and anonymous submissions stay. This cannot be undone. Directory accounts, if any, are not deleted from the external directory.`
    : "Sign in to delete your account and its linked server-side data.";
  accountElement("account-data-dialog").showModal();
}
accountElement("account-data-entry").addEventListener("click", showAccountData);
accountElement("account-data-open").addEventListener("click", showAccountData);
accountElement("account-data-close").addEventListener("click", () => accountElement("account-data-dialog").close());
accountElement("account-data-dialog").addEventListener("close", () => {
  accountElement("delete-account-form").reset();
});
accountElement("account-data-dialog").addEventListener("cancel", (event) => {
  if (accountBusy) event.preventDefault();
});
accountElement("clear-browser-data").addEventListener("click", () => {
  if (!accountElement("clear-browser-confirm").checked) {
    accountElement("account-data-feedback").textContent = "Confirm that you want to clear browser data.";
    return;
  }
  try {
    clearHackScoutBrowserData();
    accountElement("clear-browser-confirm").checked = false;
    accountElement("account-data-feedback").textContent = "Saved hackathons and filters cleared in this browser. Your account is unchanged.";
  } catch (error) {
    console.error("Could not clear HackScout browser data:", error);
    accountElement("account-data-feedback").textContent = `Could not finish clearing browser data: ${error.message}`;
  }
});
accountElement("delete-account-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (accountBusy || !accountSession) return;
  if (accountElement("delete-account-confirmation").value !== "DELETE") {
    accountElement("account-data-feedback").textContent = "Type DELETE to confirm permanent account deletion.";
    return;
  }
  accountSetBusy(true);
  for (const id of ["delete-account-submit", "clear-browser-data", "account-data-close"]) accountElement(id).disabled = true;
  accountElement("account-data-feedback").textContent = "Deleting your account and linked data...";
  try {
    const result = await accountRequest("account", {
      method: "DELETE", body: { password: accountElement("delete-account-password").value, confirmation: "DELETE" },
    });
    if (result.deleted !== true) throw new Error("The service did not confirm account deletion.");
    accountSession = null;
    accountShowApplication();
    accountElement("delete-account-form").hidden = true;
    accountElement("delete-account-description").textContent = "Your account has been deleted and all its sessions are invalid. Saved browser data is separate; use Clear browser data to remove it.";
    accountElement("account-data-feedback").textContent = "Your account and linked server-side data have been deleted.";
  } catch (error) {
    console.error("HackScout account deletion failed:", error.message);
    accountElement("account-data-feedback").textContent = error.message;
  } finally {
    accountElement("delete-account-password").value = "";
    accountElement("delete-account-confirmation").value = "";
    accountSetBusy(false);
    for (const id of ["delete-account-submit", "clear-browser-data", "account-data-close"]) accountElement(id).disabled = false;
  }
});
