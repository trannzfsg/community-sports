import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webAppDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(webAppDir, "..");
const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3001";

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)];
      }),
  );
}

const testEnv = readEnvFile(path.join(repoRoot, ".env.test.local"));

const organiserEmail = process.env.ORGANISER_TEST_EMAIL || testEnv.ORGANISER_TEST_EMAIL;
const organiserPassword = process.env.ORGANISER_TEST_PASSWORD || testEnv.ORGANISER_TEST_PASSWORD;
const playerEmail = process.env.MEMBER_BENEFITS_PLAYER_TEST_EMAIL
  || testEnv.MEMBER_BENEFITS_PLAYER_TEST_EMAIL
  || process.env.PLAYER_TEST_EMAIL
  || testEnv.PLAYER_TEST_EMAIL;
const playerPassword = process.env.MEMBER_BENEFITS_PLAYER_TEST_PASSWORD
  || testEnv.MEMBER_BENEFITS_PLAYER_TEST_PASSWORD
  || process.env.PLAYER_TEST_PASSWORD
  || testEnv.PLAYER_TEST_PASSWORD;
const playerName = process.env.MEMBER_BENEFITS_PLAYER_TEST_NAME
  || testEnv.MEMBER_BENEFITS_PLAYER_TEST_NAME
  || "Member Benefits Smoke Player";

if (!organiserEmail || !organiserPassword || !playerEmail || !playerPassword) {
  throw new Error("Missing organiser/player smoke credentials in .env.test.local or environment variables.");
}

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const seriesTitle = `Member Benefits Smoke ${stamp}`;
const seriesLocation = `Smoke Court ${stamp}`;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitForDashboard(page) {
  await page.waitForURL(/\/dashboard(?:\?|$)/, { timeout: 30_000 });
  await page.getByText(/^Dashboard$/).waitFor({ state: "visible", timeout: 30_000 });
}

async function waitForLoginForm(page) {
  await page.waitForURL((url) => {
    const pathname = new URL(url).pathname;
    return pathname === "/" || pathname === "/login";
  }, { timeout: 30_000 });
  await page.locator('input[type="email"]').waitFor({ state: "visible", timeout: 30_000 });
}

async function logout(page) {
  await page.goto(`${baseUrl}/logout`, { waitUntil: "load" });
  await waitForLoginForm(page);
}

async function attemptLogin(page, email, password) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "load" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  const dashboardPromise = waitForDashboard(page).then(() => "dashboard");
  const invalidPromise = page.getByText("Invalid email or password").waitFor({
    state: "visible",
    timeout: 15_000,
  }).then(() => "invalid");

  return Promise.race([dashboardPromise, invalidPromise]);
}

async function ensurePlayerAccount(page) {
  const loginResult = await attemptLogin(page, playerEmail, playerPassword);
  if (loginResult === "dashboard") {
    await logout(page);
    return "existing";
  }

  await page.goto(`${baseUrl}/login`, { waitUntil: "load" });
  await page.getByRole("button", { name: "Need an account? Register" }).click();
  await page.locator('input[placeholder="Your name"]').fill(playerName);
  await page.locator('input[type="email"]').fill(playerEmail);
  await page.locator('input[type="password"]').fill(playerPassword);
  await page.getByRole("button", { name: "Create account" }).click();
  await waitForDashboard(page);
  await logout(page);
  return "created";
}

async function login(page, email, password) {
  const result = await attemptLogin(page, email, password);
  if (result !== "dashboard") {
    throw new Error(`Unable to sign in as ${email}.`);
  }
}

async function waitForSeriesCard(page) {
  const heading = page.getByRole("heading", { name: seriesTitle });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await heading.count()) {
      return heading.first().locator("xpath=ancestor::article[1]");
    }
    await page.reload({ waitUntil: "load" });
  }
  throw new Error(`Timed out waiting for series "${seriesTitle}" to appear on the dashboard.`);
}

async function waitForOrganiserApprovalCard(page) {
  const matcher = new RegExp(escapeRegExp(organiserEmail), "i");
  const cards = page.locator('[data-testid^="player-organiser-approval-"]').filter({ hasText: matcher });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await cards.count()) {
      return cards.first();
    }
    await page.reload({ waitUntil: "load" });
  }
  throw new Error(`Could not find organiser approval card for ${organiserEmail}.`);
}

async function waitForOrganiserPendingApproval(page) {
  const matcher = new RegExp(escapeRegExp(playerEmail), "i");
  const cards = page.locator('[data-testid^="organiser-approval-request-"]').filter({ hasText: matcher });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await cards.count()) {
      return cards.first();
    }
    await page.reload({ waitUntil: "load" });
  }
  return null;
}

async function waitForPlayerMembershipCard(page, seriesCard) {
  const matcher = new RegExp(escapeRegExp(playerEmail), "i");
  const cards = seriesCard.locator('[data-testid^="series-membership-card-"]').filter({ hasText: matcher });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await cards.count()) {
      return cards.first();
    }
    await page.reload({ waitUntil: "load" });
  }
  throw new Error(`Timed out waiting for the player membership card for ${playerEmail}.`);
}

async function createMembershipEnabledSeries(page) {
  await page.goto(`${baseUrl}/sessions/new`, { waitUntil: "load" });
  await page.getByLabel("Series title").fill(seriesTitle);
  await page.getByLabel("Location").fill(seriesLocation);
  await page.locator('label:has-text("First session on") button').click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  const membershipCheckbox = page.getByLabel("Allow players to request recurring series membership for automatic registration into future events.");
  if (!(await membershipCheckbox.isChecked())) {
    await membershipCheckbox.check();
  }
  await page.getByRole("button", { name: "Create session series" }).click();
  await waitForDashboard(page);
  await waitForSeriesCard(page);
}

async function ensureOrganiserApproval(page) {
  const approvalCard = await waitForOrganiserApprovalCard(page);
  if (await approvalCard.getByText("Approved").count()) {
    return "already-approved";
  }
  const requestButton = approvalCard.locator('[data-testid^="request-organiser-approval-"]');
  if (await requestButton.count()) {
    const buttonText = (await requestButton.first().textContent() || "").trim();
    if (!buttonText.includes("Requested")) {
      await requestButton.first().click();
    }
  }
  await approvalCard.getByText(/Status:\s+pending/i).waitFor({ state: "visible", timeout: 15_000 });
  return "requested";
}

async function approveOrganiserRequest(page) {
  const pendingCard = await waitForOrganiserPendingApproval(page);
  if (!pendingCard) {
    return "already-approved";
  }
  await pendingCard.locator('[data-testid^="approve-organiser-approval-"]').first().click();
  await pendingCard.waitFor({ state: "detached", timeout: 20_000 });
  return "approved-now";
}

async function requestSeriesMembership(page) {
  const seriesCard = await waitForSeriesCard(page);
  const requestButton = seriesCard.locator('[data-testid^="request-series-membership-"]');
  if (!await requestButton.count()) {
    const statusPill = seriesCard.locator('[data-testid^="series-membership-status-"]');
    if (await statusPill.count()) {
      return "already-requested";
    }
    throw new Error("Series membership request controls were not available for the player.");
  }
  await requestButton.first().click();
  await seriesCard.getByText("Your request is waiting for organiser approval.").waitFor({
    state: "visible",
    timeout: 20_000,
  });
  const statusPill = seriesCard.locator('[data-testid^="series-membership-status-"]').first();
  await statusPill.getByText("pending").waitFor({ state: "visible", timeout: 20_000 });
  return "requested";
}

async function approveSeriesMembership(page) {
  const seriesCard = await waitForSeriesCard(page);
  const membershipCard = await waitForPlayerMembershipCard(page, seriesCard);
  const approveButton = membershipCard.locator('[data-testid^="approve-series-membership-"]');
  if (await approveButton.count()) {
    await approveButton.first().click();
  }
  await membershipCard.getByText(/Status:\s+active/i).waitFor({ state: "visible", timeout: 20_000 });
}

async function verifyPlayerMembershipActive(page) {
  const seriesCard = await waitForSeriesCard(page);
  const statusPill = seriesCard.locator('[data-testid^="series-membership-status-"]').first();
  await statusPill.getByText("active").waitFor({ state: "visible", timeout: 20_000 });
  await seriesCard.getByRole("button", { name: "Skip next event" }).waitFor({ state: "visible", timeout: 20_000 });
  await seriesCard.getByRole("button", { name: "Pause membership" }).waitFor({ state: "visible", timeout: 20_000 });
}

async function withPage(browser, task) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
  });
  const page = await context.newPage();
  try {
    return await task(page);
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
  });

  const summary = {
    playerAccount: "unknown",
    organiserApproval: "unknown",
  };

  try {
    summary.playerAccount = await withPage(browser, ensurePlayerAccount);

    await withPage(browser, async (page) => {
      await login(page, organiserEmail, organiserPassword);
      await createMembershipEnabledSeries(page);
      await logout(page);
    });

    summary.organiserApproval = await withPage(browser, async (page) => {
      await login(page, playerEmail, playerPassword);
      const result = await ensureOrganiserApproval(page);
      await logout(page);
      return result;
    });

    await withPage(browser, async (page) => {
      await login(page, organiserEmail, organiserPassword);
      await approveOrganiserRequest(page);
      await logout(page);
    });

    await withPage(browser, async (page) => {
      await login(page, playerEmail, playerPassword);
      await requestSeriesMembership(page);
      await logout(page);
    });

    await withPage(browser, async (page) => {
      await login(page, organiserEmail, organiserPassword);
      await approveSeriesMembership(page);
      await logout(page);
    });

    await withPage(browser, async (page) => {
      await login(page, playerEmail, playerPassword);
      await verifyPlayerMembershipActive(page);
      await logout(page);
    });

    console.log(JSON.stringify({
      ok: true,
      baseUrl,
      seriesTitle,
      organiserEmail,
      playerEmail,
      summary,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
