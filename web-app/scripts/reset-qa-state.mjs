import {
  fetchUserContext,
  fetchUserProfile,
  loadFirebaseQaConfig,
  resetOnboardingVersions,
  setOrganiserApprovalStatus,
} from "./qa-state-utils.mjs";

const argv = process.argv.slice(2);

function hasFlag(flag) {
  return argv.includes(flag);
}

function getOption(flag, fallback) {
  const entry = argv.find((value) => value.startsWith(`${flag}=`));
  return entry ? entry.slice(flag.length + 1) : fallback;
}

async function main() {
  const config = loadFirebaseQaConfig({
    organiserEmail: getOption("--organiser-email"),
    organiserPassword: getOption("--organiser-password"),
    playerEmail: getOption("--player-email"),
    playerPassword: getOption("--player-password"),
  });

  const approvalStatus = getOption("--approval-status", "none");
  if (!["none", "pending", "approved", "rejected"].includes(approvalStatus)) {
    throw new Error(`Unsupported approval status: ${approvalStatus}`);
  }

  const resetAdminOnboarding = hasFlag("--reset-admin-onboarding");
  const resetOrganiserOnboarding = hasFlag("--reset-organiser-onboarding");
  const resetPlayerOnboarding = hasFlag("--reset-player-onboarding");
  const shouldTouchApproval = hasFlag("--reset-organiser-approval") || approvalStatus !== "none";

  const admin = await fetchUserContext(config, config.adminEmail, config.adminPassword, "Admin test email");
  const organiser = await fetchUserContext(config, config.organiserEmail, config.organiserPassword, "Organiser test email");
  const player = await fetchUserContext(config, config.playerEmail, config.playerPassword, "Player test email");

  const summary = {
    approvalStatus,
    resetAdminOnboarding,
    resetOrganiserOnboarding,
    resetPlayerOnboarding,
    organiserEmail: config.organiserEmail,
    playerEmail: config.playerEmail,
  };

  if (resetAdminOnboarding) {
    await resetOnboardingVersions(config, admin.idToken, admin.uid);
  }

  if (resetOrganiserOnboarding) {
    await resetOnboardingVersions(config, admin.idToken, organiser.uid);
  }

  if (resetPlayerOnboarding) {
    await resetOnboardingVersions(config, admin.idToken, player.uid);
  }

  if (shouldTouchApproval) {
    const organiserProfile = await fetchUserProfile(config, admin.idToken, organiser.uid);
    const playerProfile = await fetchUserProfile(config, admin.idToken, player.uid);

    await setOrganiserApprovalStatus(config, admin.idToken, {
      organiserUid: organiser.uid,
      organiserName: organiserProfile?.displayName || organiserProfile?.email || config.organiserEmail,
      playerUid: player.uid,
      playerName: playerProfile?.displayName || playerProfile?.email || config.playerEmail,
      playerEmail: playerProfile?.email || config.playerEmail,
      status: approvalStatus,
    });
  }

  console.log(JSON.stringify({ ok: true, summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
