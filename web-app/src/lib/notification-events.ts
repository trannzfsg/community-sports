export type NotificationDeliveryStatus =
  | "pending"
  | "sent"
  | "partial_failure"
  | "failed"
  | "skipped";

export type NotificationEvent = {
  id: string;
  title: string;
  body: string;
  status: NotificationDeliveryStatus;
  sourceCollection: string | null;
  sourceId: string | null;
  createdAt: Date | null;
  readAt: Date | null;
};

type DateLike = Date | { toDate: () => Date } | string | number | null | undefined;

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function readDate(value: DateLike) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "object" && "toDate" in value) {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readStatus(value: unknown): NotificationDeliveryStatus {
  if (
    value === "sent" ||
    value === "partial_failure" ||
    value === "failed" ||
    value === "skipped"
  ) {
    return value;
  }

  return "pending";
}

export function normalizeNotificationEvent(
  id: string,
  data: Record<string, unknown>,
): NotificationEvent {
  return {
    id,
    title: readString(data.title, "Notification") || "Notification",
    body: readString(data.body),
    status: readStatus(data.status),
    sourceCollection: readString(data.sourceCollection) || null,
    sourceId: readString(data.sourceId) || null,
    createdAt: readDate(data.createdAt as DateLike),
    readAt: readDate(data.readAt as DateLike),
  };
}

export function sortNotificationEvents(
  events: NotificationEvent[],
): NotificationEvent[] {
  return [...events].sort((left, right) => {
    const leftTime = left.createdAt?.getTime() ?? 0;
    const rightTime = right.createdAt?.getTime() ?? 0;
    return rightTime - leftTime;
  });
}

export function countUnreadNotifications(events: NotificationEvent[]) {
  return events.filter((event) => !event.readAt).length;
}

export function formatNotificationTime(date: Date | null) {
  if (!date) {
    return "";
  }

  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
