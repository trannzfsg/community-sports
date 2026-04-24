import { chromium } from "playwright";
import {
  fetchUserContext,
  fetchUserProfile,
  loadFirebaseQaConfig,
  resetOnboardingVersions,
  setOrganiserApprovalStatus,
} from "./qa-state-utils.mjs";

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3001";
const config = loadFirebaseQaConfig();
const adminEmail = config.adminEmail;
const adminPassword = config.adminPassword;
const organiserEmail = config.organiserEmail;
const organiserPassword = config.organiserPassword;
const playerEmail = process.env.RECENT_FEATURES_PLAYER_EMAIL || config.playerEmail;
const playerPassword = process.env.RECENT_FEATURES_PLAYER_PASSWORD || config.playerPassword;
const playerName = process.env.RECENT_FEATURES_PLAYER_NAME || "Primary Player";

const stamp = Date.now();
const seriesTitle = `QA Recent Features ${stamp}`;
const initialSeriesLocation = `QA Court Alpha ${stamp}`;
const overrideLocation = `QA Event Override ${stamp}`;
const updatedSeriesLocation = `QA Court Beta ${stamp}`;

const initialSeriesValues = {
  startAt: "19:00",
  endAt: "21:00",
  price: "15",
  capacity: "4",
  waiting: "1",
  cancellationHours: "72",
};

const overrideValues = {
  startAt: "18:30",
  endAt: "20:30",
  price: "18",
  capacity: "6",
  waiting: "2",
};

const updatedSeriesValues = {
  startAt: "20:00",
  endAt: "22:00",
  price: "21",
  capacity: "8",
  waiting: "3",
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function signInWithPassword(email, password) {
  return fetchUserContext(config, email, password, `${email} regression account`);
}

async function ensureSignedOut(page) {
  await page.goto(`${baseUrl}/logout`, { waitUntil: "load" }).catch(() => {});
  await page.goto(`${baseUrl}/login`, { waitUntil: "load" });
}

async function attemptLogin(page, email, password) {
  await ensureSignedOut(page);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function expectPath(page, matcher, timeout = 30_000) {
  await page.waitForURL(matcher, { timeout });
}

async function waitForTestIdState(page, testId, expectedState, timeout = 15_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    const currentState = await page.getByTestId(testId).getAttribute("data-state");
    if (currentState === expectedState) {
      return;
    }
    await page.waitForTimeout(150);
  }

  throw new Error(`Timed out waiting for ${testId} to reach state "${expectedState}".`);
}

async function finishOnboardingIfShown(page) {
  if (!/\/onboarding(?:\?|$)/.test(page.url())) {
    return false;
  }

  await page.locator("h1").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.getByRole("button", { name: /Finish onboarding|Back to dashboard/i }).click();
  await expectPath(page, /\/dashboard(?:\?|$)/);
  await page.getByRole("heading", { name: /^Welcome / }).waitFor({ state: "visible", timeout: 30_000 });
  return true;
}

async function loginExpectingDashboardOrOnboarding(page, email, password) {
  await attemptLogin(page, email, password);

  await page.waitForURL(/\/(dashboard|onboarding)(?:\?|$)/, { timeout: 30_000 });

  const outcome = await Promise.race([
    page.waitForURL(/\/onboarding(?:\?|$)/, { timeout: 30_000 }).then(() => "onboarding"),
    page.getByRole("heading", { name: /^Welcome / }).waitFor({ state: "visible", timeout: 30_000 }).then(() => "dashboard"),
  ]);

  if (outcome === "onboarding" || /\/onboarding(?:\?|$)/.test(page.url())) {
    await finishOnboardingIfShown(page);
    return;
  }
}

async function openOnboardingFromMenu(page, isMobile = false) {
  if (isMobile) {
    await page.getByTestId("app-shell-mobile-toggle").click();
    await page.getByTestId("app-shell-nav-mobile-onboarding").click();
  } else {
    await page.getByTestId("app-shell-nav-desktop-onboarding").click();
  }
  await expectPath(page, /\/onboarding(?:\?|$)/);
}

async function assertNoOnboardingLink(page) {
  await page.getByRole("heading", { name: /^Welcome / }).waitFor({ state: "visible", timeout: 30_000 });
  assert(await page.getByTestId(/app-shell-nav-(desktop|mobile)-onboarding/).count() === 0, "Admin menu should not show onboarding.");
}

async function collapseDesktopMenuAndVerifyPersistence(page) {
  const toggleButton = page.getByTestId("app-shell-desktop-toggle");
  await toggleButton.click();
  await waitForTestIdState(page, "app-shell-desktop-sidebar", "collapsed");
  await page.reload({ waitUntil: "load" });
  await waitForTestIdState(page, "app-shell-desktop-sidebar", "collapsed");
  await toggleButton.click();
  await waitForTestIdState(page, "app-shell-desktop-sidebar", "expanded");
}

async function assertNoRosterCopyControls(page) {
  assert((await page.getByText(/copy roster/i).count()) === 0, "Roster-copy controls should be removed.");
}

async function pickTodayForField(page, labelText) {
  const label = page.locator("label").filter({ hasText: labelText }).first();
  await label.getByRole("button").first().click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
}

async function createSeries(page) {
  await page.getByTestId("app-shell-create-series-desktop").click();
  await expectPath(page, /\/sessions\/new(?:\?|$)/);
  await page.getByRole("heading", { name: "Create a session series" }).waitFor({ state: "visible", timeout: 30_000 });
  await assertNoRosterCopyControls(page);
  await page.locator('input[placeholder="Monday Social Badminton"]').fill(seriesTitle);
  await page.locator('input[placeholder="Community Hall Court 1"]').fill(initialSeriesLocation);
  await pickTodayForField(page, "Next game on");
  await pickTodayForField(page, "First session on");
  await page.locator('input[type="time"]').nth(0).fill(initialSeriesValues.startAt);
  await page.locator('input[type="time"]').nth(1).fill(initialSeriesValues.endAt);
  await page.locator('input[type="number"]').nth(0).fill(initialSeriesValues.price);
  await page.locator('input[type="number"]').nth(1).fill(initialSeriesValues.capacity);
  await page.locator('input[type="number"]').nth(2).fill(initialSeriesValues.waiting);
  await page.locator('input[type="number"]').nth(3).fill(initialSeriesValues.cancellationHours);
  const membershipToggle = page.getByLabel("Enable organiser-managed recurring membership for automatic registration into future events.");
  await membershipToggle.check();
  await page.getByRole("button", { name: "Create session series" }).click();
  await expectPath(page, /\/dashboard(?:\?|$)/);
  await page.getByRole("heading", { name: seriesTitle }).waitFor({ state: "visible", timeout: 30_000 });
}

async function getSeriesCard(page, title) {
  const card = page.locator("article").filter({
    has: page.getByRole("heading", { name: title }),
  }).first();

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await card.count()) {
      await card.waitFor({ state: "visible", timeout: 30_000 });
      return card;
    }
    await page.reload({ waitUntil: "load" });
    await page.getByRole("heading", { name: /^Welcome / }).waitFor({ state: "visible", timeout: 30_000 });
  }

  throw new Error(`Timed out waiting for the series card for "${title}".`);
}

async function openEventHistory(page) {
  const seriesCard = await getSeriesCard(page, seriesTitle);
  await seriesCard.getByTestId("series-view-events-link").click();
  await expectPath(page, /\/sessions\/view\?id=/);
  await page.getByRole("heading", { name: seriesTitle }).waitFor({ state: "visible", timeout: 30_000 });
}

async function editCurrentEventOverrides(page) {
  await openEventHistory(page);
  const eventCard = page.locator("article").first();
  await eventCard.getByRole("button", { name: "Edit event details" }).click();
  await eventCard.getByLabel("Event location").fill(overrideLocation);
  await eventCard.getByLabel("Casual price").fill(overrideValues.price);
  await eventCard.getByLabel("Start time").fill(overrideValues.startAt);
  await eventCard.getByLabel("End time").fill(overrideValues.endAt);
  await eventCard.getByLabel("Player capacity").fill(overrideValues.capacity);
  await eventCard.getByLabel("Waiting list spots").fill(overrideValues.waiting);
  await eventCard.getByRole("button", { name: "Save event details" }).click();
  await eventCard.getByText(overrideLocation).waitFor({ state: "visible", timeout: 30_000 });
  await eventCard.getByText("Kept for history and audit").waitFor({ state: "visible", timeout: 30_000 });
  await page.getByRole("link", { name: "Back" }).click();
  await expectPath(page, /\/dashboard(?:\?|$)/);
}

async function editSeriesDefaults(page) {
  const seriesCard = await getSeriesCard(page, seriesTitle);
  await seriesCard.getByTestId("series-edit-link").click();
  await expectPath(page, /\/sessions\/edit\?id=/);
  await page.getByRole("heading", { name: /Edit session series/i }).waitFor({ state: "visible", timeout: 30_000 });
  await assertNoRosterCopyControls(page);
  await page.getByLabel("Series title").fill(seriesTitle);
  await page.getByLabel("Location").fill(updatedSeriesLocation);
  await page.locator('input[type="time"]').nth(0).fill(updatedSeriesValues.startAt);
  await page.locator('input[type="time"]').nth(1).fill(updatedSeriesValues.endAt);
  await page.locator('input[type="number"]').nth(0).fill(updatedSeriesValues.price);
  await page.locator('input[type="number"]').nth(1).fill(updatedSeriesValues.capacity);
  await page.locator('input[type="number"]').nth(2).fill(updatedSeriesValues.waiting);
  await page.getByRole("button", { name: /Save changes|Saving/i }).click();
  await expectPath(page, /\/dashboard(?:\?|$)/);
  const updatedCard = await getSeriesCard(page, seriesTitle);
  await updatedCard.getByText(`Series default location: ${updatedSeriesLocation}`).waitFor({ state: "visible", timeout: 30_000 });
}

async function requestOrganiserApproval(page) {
  const approvalsCard = page.getByTestId("player-organiser-approvals");
  await approvalsCard.waitFor({ state: "visible", timeout: 30_000 });
  const organiserCard = approvalsCard.locator('[data-testid^="player-organiser-approval-"]').filter({
    hasText: new RegExp(escapeRegExp(organiserEmail), "i"),
  }).first();
  await organiserCard.waitFor({ state: "visible", timeout: 30_000 });
  await organiserCard.getByRole("button", { name: /Request approval|Requested/i }).click();
  await organiserCard.getByText(/Status:\s+pending/i).waitFor({ state: "visible", timeout: 20_000 });
}

async function approveOrganiserRequest(page) {
  await page.getByTestId("app-shell-nav-desktop-approvals").click();
  await expectPath(page, /\/organiser\/approvals(?:\?|$)/);
  await page.getByTestId("organiser-approvals-page").waitFor({ state: "visible", timeout: 30_000 });
  const pendingCard = page.locator('[data-testid^="organiser-approval-request-"]').filter({
    hasText: new RegExp(escapeRegExp(playerEmail), "i"),
  }).first();
  await pendingCard.waitFor({ state: "visible", timeout: 30_000 });
  await pendingCard.getByRole("button", { name: "Approve" }).click();
  await pendingCard.waitFor({ state: "detached", timeout: 30_000 });
}

async function verifyPlayerPostApprovalState(page) {
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: "load" });
  await page.getByRole("heading", { name: /^Welcome / }).waitFor({ state: "visible", timeout: 30_000 });
  const seriesCard = await getSeriesCard(page, seriesTitle);
  await seriesCard.getByText("Contact the organiser if you want to be added as a recurring member for future events in this series.").waitFor({
    state: "visible",
    timeout: 30_000,
  });
  assert((await seriesCard.locator('[data-testid^="request-series-membership-"]').count()) === 0, "Player membership request button should be removed.");
}

async function registerForEvent(page) {
  const seriesCard = await getSeriesCard(page, seriesTitle);
  await seriesCard.getByTestId("series-register-button").click();
  await seriesCard.getByTestId("series-self-remove-button").waitFor({ state: "visible", timeout: 30_000 });
  await seriesCard.getByText(/Please contact the organiser if you still need to cancel\./i).waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

async function verifyPlayerCancellationBlocked(page) {
  const seriesCard = await getSeriesCard(page, seriesTitle);
  let dialogMessage = "";
  page.once("dialog", async (dialog) => {
    dialogMessage = dialog.message();
    await dialog.accept();
  });
  await seriesCard.getByTestId("series-self-remove-button").click();
  await page.waitForTimeout(500);
  assert(
    /inside the 72-hour cancellation window/i.test(dialogMessage),
    `Expected player cancellation warning dialog, received: ${dialogMessage || "<none>"}`,
  );
}

async function organiserRemovesPlayer(page, playerUid) {
  const seriesCard = await getSeriesCard(page, seriesTitle);
  const playerRow = seriesCard.getByTestId(`event-registration-row-${playerUid}`);
  await playerRow.waitFor({ state: "visible", timeout: 30_000 });
  await playerRow.getByTestId("event-registration-row-summary").click();
  await playerRow.getByText(new RegExp(`Email:\\s*${escapeRegExp(playerEmail)}`, "i")).waitFor({ state: "visible", timeout: 15_000 });
  let dialogMessage = "";
  page.once("dialog", async (dialog) => {
    dialogMessage = dialog.message();
    await dialog.accept();
  });
  await playerRow.getByRole("button", { name: /^Remove$/ }).click();
  await page.waitForTimeout(500);
  assert(
    /inside the 72-hour cancellation window\. Remove/i.test(dialogMessage),
    `Expected organiser cancellation warning dialog, received: ${dialogMessage || "<none>"}`,
  );
  await playerRow.waitFor({ state: "detached", timeout: 30_000 });
}

async function completeCurrentEventAndCreateNext(page) {
  const seriesCard = await getSeriesCard(page, seriesTitle);
  const nextEventPanel = seriesCard.getByTestId("series-next-event-panel");
  await nextEventPanel.getByTestId("series-mark-completed-button").click();
  await nextEventPanel.getByTestId("series-create-next-event-button").waitFor({ state: "visible", timeout: 30_000 });
  await nextEventPanel.getByTestId("series-create-next-event-button").click();
  await seriesCard.getByText(`Event location${updatedSeriesLocation}`).waitFor({ state: "visible", timeout: 30_000 }).catch(async () => {
    await seriesCard.getByText(updatedSeriesLocation).waitFor({ state: "visible", timeout: 30_000 });
  });
  await seriesCard.getByText(`${updatedSeriesValues.startAt} - ${updatedSeriesValues.endAt}`).first().waitFor({ state: "visible", timeout: 30_000 });
  await seriesCard.getByText(`$${updatedSeriesValues.price}`).first().waitFor({ state: "visible", timeout: 30_000 });
}

async function verifyEventHistoryAudit(page) {
  await openEventHistory(page);
  const newEventCard = page.locator("article").nth(0);
  const oldEventCard = page.locator("article").nth(1);
  await newEventCard.getByText(updatedSeriesLocation).waitFor({ state: "visible", timeout: 30_000 });
  await newEventCard.getByText(`${updatedSeriesValues.startAt} - ${updatedSeriesValues.endAt}`).waitFor({ state: "visible", timeout: 30_000 });
  await newEventCard.getByText(`$${updatedSeriesValues.price}`).waitFor({ state: "visible", timeout: 30_000 });
  await oldEventCard.getByText(overrideLocation).waitFor({ state: "visible", timeout: 30_000 });
  await oldEventCard.getByText(`${overrideValues.startAt} - ${overrideValues.endAt}`).waitFor({ state: "visible", timeout: 30_000 });
  await oldEventCard.getByText(`$${overrideValues.price}`).waitFor({ state: "visible", timeout: 30_000 });
  await oldEventCard.getByText("Kept for history and audit").waitFor({ state: "visible", timeout: 30_000 });
}

async function withContext(browser, options, task) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  try {
    return await task(page);
  } finally {
    await context.close();
  }
}

async function main() {
  const adminContext = await fetchUserContext(config, adminEmail, adminPassword, "Admin QA account");
  const organiserContext = await signInWithPassword(organiserEmail, organiserPassword);
  const playerContext = await signInWithPassword(playerEmail, playerPassword);
  const organiserProfile = await fetchUserProfile(config, adminContext.idToken, organiserContext.uid);
  const playerProfile = await fetchUserProfile(config, adminContext.idToken, playerContext.uid);

  await resetOnboardingVersions(config, adminContext.idToken, organiserContext.uid);
  await resetOnboardingVersions(config, adminContext.idToken, playerContext.uid);
  await setOrganiserApprovalStatus(config, adminContext.idToken, {
    organiserUid: organiserContext.uid,
    organiserName: organiserProfile?.displayName || organiserProfile?.email || organiserEmail,
    playerUid: playerContext.uid,
    playerName: playerProfile?.displayName || playerProfile?.email || playerName,
    playerEmail: playerProfile?.email || playerEmail,
    status: "none",
  });

  const browser = await chromium.launch({ headless: true });
  const summary = {
    baseUrl,
    organiserEmail,
    playerEmail,
    seriesTitle,
  };

  try {
    await withContext(browser, { viewport: { width: 1440, height: 1200 } }, async (page) => {
      await loginExpectingDashboardOrOnboarding(page, organiserEmail, organiserPassword);
      await collapseDesktopMenuAndVerifyPersistence(page);
      await openOnboardingFromMenu(page, false);
      await page.getByRole("button", { name: /Finish onboarding|Back to dashboard/i }).click();
      await expectPath(page, /\/dashboard(?:\?|$)/);
      await page.getByText("Approvals moved out of the dashboard").waitFor({ state: "visible", timeout: 30_000 });
      await createSeries(page);
      await editCurrentEventOverrides(page);
      await editSeriesDefaults(page);
    });

    await withContext(browser, { viewport: { width: 390, height: 844 } }, async (page) => {
      await loginExpectingDashboardOrOnboarding(page, playerEmail, playerPassword);
      await page.getByTestId("app-shell-mobile-toggle").click();
      await page.getByTestId("app-shell-nav-mobile-onboarding").waitFor({ state: "visible", timeout: 15_000 });
      await page.getByTestId("app-shell-mobile-close").click();
      await requestOrganiserApproval(page);
    });

    await withContext(browser, { viewport: { width: 1440, height: 1200 } }, async (page) => {
      await loginExpectingDashboardOrOnboarding(page, organiserEmail, organiserPassword);
      await approveOrganiserRequest(page);
      await page.getByTestId("app-shell-nav-desktop-dashboard").click();
      await expectPath(page, /\/dashboard(?:\?|$)/);
      await page.getByRole("heading", { name: /^Welcome / }).waitFor({ state: "visible", timeout: 30_000 });
    });

    await withContext(browser, { viewport: { width: 390, height: 844 } }, async (page) => {
      await loginExpectingDashboardOrOnboarding(page, playerEmail, playerPassword);
      await verifyPlayerPostApprovalState(page);
      await openOnboardingFromMenu(page, true);
      await page.getByRole("button", { name: /Finish onboarding|Back to dashboard/i }).click();
      await expectPath(page, /\/dashboard(?:\?|$)/);
      await registerForEvent(page);
      await verifyPlayerCancellationBlocked(page);
    });

    await withContext(browser, { viewport: { width: 1440, height: 1200 } }, async (page) => {
      await loginExpectingDashboardOrOnboarding(page, organiserEmail, organiserPassword);
      await organiserRemovesPlayer(page, playerContext.uid);
      await completeCurrentEventAndCreateNext(page);
      await verifyEventHistoryAudit(page);
    });

    await withContext(browser, { viewport: { width: 1440, height: 1200 } }, async (page) => {
      await loginExpectingDashboardOrOnboarding(page, adminEmail, adminPassword);
      await assertNoOnboardingLink(page);
    });

    console.log(JSON.stringify({ ok: true, summary }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
