import type { AppRole } from "@/lib/roles";
import type { RegistrationItem } from "@/lib/session-series";

export function canManageSessions(role?: AppRole | null) {
  return role === "admin" || role === "organiser";
}

export function canAccessAdminArea(role?: AppRole | null) {
  return role === "admin";
}

export function canEditSeries(
  role: AppRole | null | undefined,
  currentUserId: string,
  organiserId: string,
) {
  if (role === "admin") return true;
  if (role === "organiser" && currentUserId === organiserId) return true;
  return false;
}

export function getPlayerEventState(input: {
  currentRegistration?: RegistrationItem;
  canAddMore: boolean;
}) {
  const isGoing = input.currentRegistration?.status === "registered";
  const isWaiting = input.currentRegistration?.status === "waiting";

  if (isGoing) return "going";
  if (isWaiting) return "waiting list";
  if (input.canAddMore) return "available";
  return "not available";
}

export function getManagerEventState(input: {
  eventIsFull: boolean;
  waitingListIsFull: boolean;
}) {
  if (input.waitingListIsFull) return "waiting list full";
  if (input.eventIsFull) return "full";
  return "open";
}

export function getPlayerRegisterButtonLabel(input: {
  eventIsFull: boolean;
}) {
  return input.eventIsFull ? "Join waiting list" : "Register";
}
