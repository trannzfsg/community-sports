import type { DataPartition } from "./data-partition";

export type TelegramChatType = "private" | "group" | "channel";

export type OrganiserNotificationPreferences = {
  approvalRequested: boolean;
  playerRegistered: boolean;
  playerRemoved: boolean;
  paymentReferenceUpdated: boolean;
};

export type PlayerNotificationPreferences = {
  approvalApproved: boolean;
  paymentDueSoon: boolean;
  movedFromWaitlist: boolean;
  paymentConfirmed: boolean;
  newEventOpened: boolean;
};

export type NotificationPreferences = {
  userId: string;
  dataPartition: DataPartition;
  email: {
    enabled: boolean;
  };
  telegram: {
    enabled: boolean;
    chatId: string;
    chatType: TelegramChatType;
  };
  organiser: OrganiserNotificationPreferences;
  player: PlayerNotificationPreferences;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const DEFAULT_ORGANISER_NOTIFICATION_PREFERENCES:
  OrganiserNotificationPreferences = {
    approvalRequested: false,
    playerRegistered: false,
    playerRemoved: false,
    paymentReferenceUpdated: false,
  };

const DEFAULT_PLAYER_NOTIFICATION_PREFERENCES:
  PlayerNotificationPreferences = {
    approvalApproved: false,
    paymentDueSoon: false,
    movedFromWaitlist: false,
    paymentConfirmed: false,
    newEventOpened: false,
  };

export function buildDefaultNotificationPreferences(
  userId = "",
  dataPartition: DataPartition = "live",
): NotificationPreferences {
  return {
    userId,
    dataPartition,
    email: {
      enabled: false,
    },
    telegram: {
      enabled: false,
      chatId: "",
      chatType: "private",
    },
    organiser: {...DEFAULT_ORGANISER_NOTIFICATION_PREFERENCES},
    player: {...DEFAULT_PLAYER_NOTIFICATION_PREFERENCES},
  };
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function readString(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function readTelegramChatType(value: unknown): TelegramChatType {
  return value === "group" || value === "channel" ? value : "private";
}

export function normalizeNotificationPreferences(
  value: unknown,
  input: {
    userId: string;
    dataPartition: DataPartition;
  },
): NotificationPreferences {
  const defaults = buildDefaultNotificationPreferences(
    input.userId,
    input.dataPartition,
  );

  if (typeof value !== "object" || value === null) {
    return defaults;
  }

  const source = value as Partial<NotificationPreferences>;
  const email = source.email;
  const telegram = source.telegram;
  const organiser = source.organiser;
  const player = source.player;

  return {
    userId: readString(source.userId, input.userId),
    dataPartition:
      source.dataPartition === "test" || source.dataPartition === "live" ?
        source.dataPartition :
        input.dataPartition,
    email: {
      enabled: readBoolean(email?.enabled, defaults.email.enabled),
    },
    telegram: {
      enabled: readBoolean(telegram?.enabled, defaults.telegram.enabled),
      chatId: readString(telegram?.chatId, defaults.telegram.chatId).trim(),
      chatType: readTelegramChatType(telegram?.chatType),
    },
    organiser: {
      approvalRequested: readBoolean(
        organiser?.approvalRequested,
        defaults.organiser.approvalRequested,
      ),
      playerRegistered: readBoolean(
        organiser?.playerRegistered,
        defaults.organiser.playerRegistered,
      ),
      playerRemoved: readBoolean(
        organiser?.playerRemoved,
        defaults.organiser.playerRemoved,
      ),
      paymentReferenceUpdated: readBoolean(
        organiser?.paymentReferenceUpdated,
        defaults.organiser.paymentReferenceUpdated,
      ),
    },
    player: {
      approvalApproved: readBoolean(
        player?.approvalApproved,
        defaults.player.approvalApproved,
      ),
      paymentDueSoon: readBoolean(
        player?.paymentDueSoon,
        defaults.player.paymentDueSoon,
      ),
      movedFromWaitlist: readBoolean(
        player?.movedFromWaitlist,
        defaults.player.movedFromWaitlist,
      ),
      paymentConfirmed: readBoolean(
        player?.paymentConfirmed,
        defaults.player.paymentConfirmed,
      ),
      newEventOpened: readBoolean(
        player?.newEventOpened,
        defaults.player.newEventOpened,
      ),
    },
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}
