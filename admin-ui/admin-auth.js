function setLoginStep(step) {
  loginStep = step;
  const setup = step === "setup";
  $("#email").readOnly = step !== "email";
  $("#password-field").hidden = step === "email";
  $("#password").disabled = step === "email";
  $("#password").value = "";
  $("#password").minLength = setup ? 8 : 1;
  $("#password").autocomplete = setup ? "new-password" : "current-password";
  $("#confirm-password-field").hidden = !setup;
  $("#confirm-password").disabled = !setup;
  $("#confirm-password").value = "";
  $("#change-email").hidden = step === "email";
  $("#login-submit").textContent = setup ? "Create password" : step === "password" ? "Sign in" : "Continue";
  $("#login-description").textContent = setup
    ? "Your administrator account is approved. Create your first password."
    : step === "password" ? "Sign in with your administrator password."
      : "Enter your approved administrator email to continue.";
}

async function openDashboard(session) {
  if (session.user?.role !== "admin") throw new Error("An administrator account is required.");
  authenticated = true;
  $("#password").value = "";
  $("#confirm-password").value = "";
  $("#account-email").textContent = session.user.email;
  $("#login-panel").hidden = true;
  $("#dashboard").hidden = false;
  $("#logout").hidden = false;
  page = 1;
  notify("Signed in. Select a submission to review.");
  await loadPipeline();
  await loadQueue();
}

$("#change-email").addEventListener("click", () => {
  setLoginStep("email");
  notify("");
  $("#email").focus();
});
$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#login-submit").disabled = true;
  $("#change-email").disabled = true;
  notify(loginStep === "email" ? "Checking account..." : loginStep === "setup" ? "Creating password..." : "Signing in...");
  try {
    if (loginStep === "email") {
      const access = await api("auth/access", { method: "POST", body: { email: $("#email").value.trim() } });
      if (typeof access.email !== "string" || typeof access.passwordSetupRequired !== "boolean") {
        throw new Error("The administrator access response is invalid.");
      }
      $("#email").value = access.email;
      setLoginStep(access.passwordSetupRequired ? "setup" : "password");
      $("#password").focus();
      notify("");
      return;
    }
    if (loginStep === "setup" && $("#password").value !== $("#confirm-password").value) {
      throw new Error("Passwords do not match.");
    }
    const session = await api(loginStep === "setup" ? "auth/create-password" : "auth/login", {
      method: "POST", body: { email: $("#email").value.trim(), password: $("#password").value },
    });
    await openDashboard(session);
  } catch (error) {
    console.error("Admin sign-in failed:", error);
    notify(error.message, true);
  } finally {
    $("#login-submit").disabled = false;
    $("#change-email").disabled = false;
  }
});
$("#logout").addEventListener("click", async () => {
  $("#logout").disabled = true;
  try {
    await api("auth/logout", { method: "POST", body: {} });
    notify("Signed out.");
  } catch (error) {
    console.error("Could not revoke admin session:", error);
    notify(`Signed out locally, but session revocation failed: ${error.message}`, true);
  } finally {
    signOut();
    $("#logout").disabled = false;
  }
});
