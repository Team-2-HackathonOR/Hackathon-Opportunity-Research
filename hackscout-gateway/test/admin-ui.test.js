const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createPage } = require("./admin-ui-helpers");

test("admin email-first setup confirms password, signs in, restores session and signs out", async () => {
  const session = { signedIn: false };
  const page = createPage(session, true);
  await page.ready();
  page.element("#email").value = "fixture@example.test";
  await page.submit();
  assert.equal(page.element("#confirm-password-field").hidden, false);
  assert.equal(page.element("#login-submit").textContent, "Create password");
  page.element("#password").value = "correct-password";
  page.element("#confirm-password").value = "different-password";
  await page.submit();
  assert.equal(page.element("#notification").textContent, "Passwords do not match.");
  assert.equal(page.calls.some(({ action }) => action === "auth/create-password"), false);
  page.element("#confirm-password").value = "correct-password";
  await page.submit();
  assert.equal(page.element("#dashboard").hidden, false);
  assert.equal(page.element("#password").value, "");
  const reload = createPage(session, true);
  await reload.ready();
  assert.equal(reload.element("#dashboard").hidden, false);
  await reload.element("#logout").listeners.click();
  assert.equal(session.signedIn, false);
  assert.equal(reload.element("#password-field").hidden, true);
  assert.equal(reload.element("#login-submit").textContent, "Continue");
  for (const { options } of page.calls) {
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.headers?.Authorization, undefined);
  }
});

test("existing admins sign in with a password and can change email", async () => {
  const page = createPage({ signedIn: false }, false);
  await page.ready();
  page.element("#email").value = "fixture@example.test";
  await page.submit();
  assert.equal(page.element("#confirm-password-field").hidden, true);
  assert.equal(page.element("#login-submit").textContent, "Sign in");
  page.element("#change-email").listeners.click();
  assert.equal(page.element("#email").readOnly, false);
  await page.submit();
  page.element("#password").value = "correct-password";
  await page.submit();
  assert.equal(page.calls.some(({ action }) => action === "auth/login"), true);
  assert.equal(page.element("#dashboard").hidden, false);
});

test("pipeline authentication errors do not log out a valid administrator session", async () => {
  for (const status of [401, 403]) {
    const page = createPage({ signedIn: true }, false, {
      pipeline: () => Response.json({ error: "Pipeline gateway authorization failed." }, { status }),
    });
    await page.ready();
    assert.equal(page.element("#dashboard").hidden, false);
    assert.equal(page.element("#login-panel").hidden, true);
    assert.match(page.element("#scraper-result").textContent, /Pipeline gateway authorization failed/);
    assert.equal(page.calls.filter(({ action }) => action === "auth/session").length, 2);
  }
});

test("expired administrator sessions still sign out when protected requests fail", async () => {
  const session = { signedIn: true };
  const responses = {};
  const page = createPage(session, false, responses);
  await page.ready();
  session.signedIn = false;
  responses.pipeline = () => Response.json({ error: "Authentication required." }, { status: 401 });
  await assert.rejects(page.request("pipeline"), /Authentication required/);
  assert.equal(page.element("#dashboard").hidden, true);
  assert.equal(page.element("#login-panel").hidden, false);
  assert.match(page.element("#notification").textContent, /session has expired/);
});

test("a session verification outage reports the error without logging the administrator out", async () => {
  const responses = {};
  const page = createPage({ signedIn: true }, false, responses);
  await page.ready();
  responses.pipeline = () => Response.json({ error: "Forbidden" }, { status: 403 });
  responses["auth/session"] = () => Response.json({ error: "Unavailable" }, { status: 502 });
  await assert.rejects(page.request("pipeline"), /Could not verify administrator session \(HTTP 502\)/);
  assert.equal(page.element("#dashboard").hidden, false);
  assert.equal(page.element("#login-panel").hidden, true);
});

test("queued jobs show waiting, block duplicate runs and report a missing cron worker", async () => {
  const page = createPage({ signedIn: true }, false, {
    pipeline: () => Response.json({ job: {
      id: "queued-id", status: "queued", stage: "reset", startedAt: new Date().toISOString(),
      steps: { reset: { status: "waiting" } },
    } }),
    "pipeline/schedule": () => Response.json({
      schedule: { frequency: "off", workerConfigured: false },
    }),
  });
  await page.ready();
  assert.equal(page.element("#scraper-run").disabled, true);
  assert.equal(page.element("#pipeline-stop").hidden, false);
  assert.match(page.element("#scraper-result").textContent, /Queued.*No worker is executing/);
  assert.equal(page.element("#pipeline-time-reset").textContent, "--:--");
  assert.match(page.element("#pipeline-schedule-status").textContent, /worker is not scheduled/);
});

test("stop control targets the displayed run and shows cancellation without claiming rollback", async () => {
  const job = {
    id: "displayed-job", status: "running", stage: "reset", startedAt: new Date().toISOString(),
    steps: { reset: { status: "running" } },
  };
  const page = createPage({ signedIn: true }, false, {
    "pipeline/cancel": () => Response.json({ job: {
      ...job, status: "failed", cancelled: true, steps: { reset: { status: "cancelled" } },
      error: "Stopped by administrator. Completed changes were not undone.",
    } }),
  });
  await page.ready();
  page.renderPipeline(job);
  await page.element("#pipeline-stop").listeners.click();
  const request = page.calls.find(({ action }) => action === "pipeline/cancel");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), { jobId: job.id });
  assert.equal(page.element("#pipeline-stop").hidden, false);
  assert.equal(page.element("#pipeline-stop").disabled, true);
  assert.equal(page.element("#scraper-run").disabled, false);
  assert.match(page.element("#scraper-result").textContent, /Completed changes were not undone.*Automatic runs are disabled/);
});

test("stop remains visible but disabled without an active run", async () => {
  const page = createPage({ signedIn: true }, false);
  await page.ready();
  for (const job of [null, { id: "finished-run", status: "failed", steps: {} }]) {
    page.renderPipeline(job);
    assert.equal(page.element("#pipeline-stop").hidden, false);
    assert.equal(page.element("#pipeline-stop").disabled, true);
    assert.match(page.element("#pipeline-stop").title, /No queued or running pipeline/);
    await page.element("#pipeline-stop").listeners.click();
  }
  assert.equal(page.calls.some(({ action }) => action === "pipeline/cancel"), false);
});

test("targeted pipeline failures remain readable in the admin UI", async () => {
  const page = createPage({ signedIn: true }, false);
  await page.ready();
  page.renderPipeline({
    id: "failed-run", status: "failed", stage: "reset",
    error: "[MONGODB_PERMISSION_DENIED] MongoDB denied this operation. Grant the database user read/write permissions.",
    steps: { reset: { status: "failed" } },
  });
  assert.match(page.element("#scraper-result").textContent, /MONGODB_PERMISSION_DENIED.*Grant the database user/);
  assert.equal(page.element("#pipeline-stop").hidden, false);
  assert.equal(page.element("#pipeline-stop").disabled, true);
});

test("intentionally stopped workers are neutral while active work and real schedule errors stay visible", async () => {
  let job = null;
  const schedule = { frequency: "off", workerConfigured: false };
  const page = createPage({ signedIn: true }, false, {
    pipeline: () => Response.json({ job }),
    "pipeline/schedule": () => Response.json({ schedule }),
  });
  await page.ready();
  const status = page.element("#pipeline-schedule-status");
  assert.match(status.textContent, /worker is stopped.*Automatic runs are disabled/);
  assert.equal(status.classList.contains("error"), false);
  job = { id: "queued-id", status: "queued", steps: {} };
  await page.runTimers();
  assert.equal(status.classList.contains("error"), true);
  assert.match(status.textContent, /worker is not scheduled/);
  job = null;
  await page.runTimers();
  assert.equal(status.classList.contains("error"), false);
  schedule.frequency = "weekly";
  await page.runTimers();
  assert.equal(status.classList.contains("error"), true);
  schedule.frequency = "off";
  schedule.lastError = "Gateway dispatch failed.";
  await page.runTimers();
  assert.equal(status.textContent, schedule.lastError);
  assert.equal(status.classList.contains("error"), true);
  assert.equal(page.calls.some(({ options }) => options.method === "POST"), false);
});
