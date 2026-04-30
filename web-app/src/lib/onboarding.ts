import type { AppRole } from "./roles";

export type OnboardingRole = "player" | "organiser";

type OnboardingSection = {
  title: string;
  points: string[];
};

type OnboardingContent = {
  version: string;
  badge: string;
  title: string;
  intro: string;
  sections: OnboardingSection[];
};

export type OnboardingVersionState = Partial<Record<OnboardingRole, string>>;

// When onboarding copy changes in a way that returning users should see again,
// bump the matching role version here so the app reshow logic can pick it up.
export const ONBOARDING_CONTENT: Record<OnboardingRole, OnboardingContent> = {
  player: {
    version: "2026-04-23-player-v1",
    badge: "Player onboarding",
    title: "How player access and registrations work",
    intro: "This walkthrough covers the approval, registration, payment, waitlist, and cancellation rules you will use most often as a player.",
    sections: [
      {
        title: "Getting access",
        points: [
          "Request approval from at least one organiser before you can view or join that organiser's events.",
          "Once an organiser approves you, their active events appear on your dashboard.",
          "Organisers control when registration is available, so an event may still be unavailable until they open or create it.",
        ],
      },
      {
        title: "Joining and paying",
        points: [
          "Use Register to join an available event, or join the waiting list when the event is full and the waiting list still has space.",
          "Enter your payment reference after you register so the organiser can match the transfer.",
          "A payment reference does not complete payment by itself. The organiser still confirms that the payment was received.",
        ],
      },
      {
        title: "Waitlists and cancellations",
        points: [
          "When a registered player leaves, the first waiting-list player moves up automatically.",
          "Waiting-list players cannot complete payment steps until they become registered.",
          "Cancellation rules depend on the organiser's event-series policy. Inside the cutoff window, contact the organiser instead of removing yourself.",
        ],
      },
      {
        title: "Memberships",
        points: [
          "Recurring memberships are organiser-managed. Players no longer request them directly in the app.",
          "If you want recurring membership benefits, contact the organiser and ask them to add you to that series.",
          "When you already have a recurring membership, the dashboard shows its current status and skip controls.",
        ],
      },
    ],
  },
  organiser: {
    version: "2026-04-23-organiser-v1",
    badge: "Organiser onboarding",
    title: "How organiser workflows fit together",
    intro: "This walkthrough focuses on the day-to-day organiser flow: bringing players in, running event series, handling event overrides, and managing payments and memberships.",
    sections: [
      {
        title: "Bringing players in",
        points: [
          "You can share the self-registration flow with players, or create organiser-managed private players yourself.",
          "If a private player later self-registers with the same email address, the app keeps them as the same person and preserves their history.",
          "Player approvals are handled on the dedicated approvals page before registered players can access your events.",
        ],
      },
      {
        title: "Series and events",
        points: [
          "Create an event series first, then create each dated event from that series.",
          "Event series defaults set the starting values for new events. Existing events keep their own copied values for audit history.",
          "Use event history to override an individual event's location, time, price, capacity, or waitlist without changing older events.",
        ],
      },
      {
        title: "Registrations and payments",
        points: [
          "You can add approved players directly to an event, and players can also self-register when registration is open.",
          "Players submit payment references, then you confirm whether payment was actually received.",
          "Online payments are optional. Set up Stripe Connect from Payments only when you want players to pay through the app.",
          "Stripe setup does not block organiser onboarding, player approvals, event creation, or manual payment tracking.",
          "Use the event lifecycle controls to complete or cancel an event, then create the next one when you are ready.",
        ],
      },
      {
        title: "Stripe Connect setup",
        points: [
          "Open Payments, then choose Set up Stripe Connect to continue on Stripe's secure onboarding page.",
          "Stripe asks for payout and identity details directly, then returns you to Community Sports.",
          "When the Payments page shows Ready for online payments, online checkout can be enabled for paid series in future payment workflows.",
        ],
      },
      {
        title: "Memberships and communication",
        points: [
          "Only organisers add or manage recurring memberships now. Members are auto-registered first when a new event is created.",
          "Membership settings let you control start dates, end dates, skips, and auto-paid periods.",
          "Event registration opening still needs to be announced outside the app.",
          "Telegram notifications are available from your profile. Begin setup there, then contact tranzha83@gmail.com to finish configuration.",
        ],
      },
    ],
  },
};

export function getOnboardingContent(role: AppRole) {
  if (role === "player" || role === "organiser") {
    return ONBOARDING_CONTENT[role];
  }

  return null;
}

export function getCurrentOnboardingVersion(role: AppRole) {
  return getOnboardingContent(role)?.version || null;
}

export function needsOnboarding(input: {
  role: AppRole;
  seenVersions?: OnboardingVersionState | null;
}) {
  const currentVersion = getCurrentOnboardingVersion(input.role);
  if (!currentVersion) {
    return false;
  }

  return input.seenVersions?.[input.role as OnboardingRole] !== currentVersion;
}
