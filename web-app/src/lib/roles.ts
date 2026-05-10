export type AppRole = "player" | "organiser" | "admin";

export function getRoleForEmail(): AppRole {
  return "player";
}

export function canActAsPlayer(role?: AppRole | null) {
  return role === "player" || role === "organiser";
}

export function canActAsOrganiser(role?: AppRole | null) {
  return role === "organiser" || role === "admin";
}

export function canManageOwnedSeries(
  role: AppRole | null | undefined,
  currentUserId: string | null | undefined,
  organiserId: string,
) {
  if (role === "admin") return true;
  return role === "organiser" && !!currentUserId && currentUserId === organiserId;
}
