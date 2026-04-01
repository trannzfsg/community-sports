export type AppRole = "player" | "organiser" | "admin";

export const ADMIN_EMAILS = ["tranzha83@gmail.com"] as const;
export const ORGANISER_EMAILS = [
  "tranzha83+badmintonmonday@gmail.com",
] as const;

export function getRoleForEmail(email?: string | null): AppRole {
  const normalized = (email ?? "").trim().toLowerCase();

  if (ADMIN_EMAILS.includes(normalized as (typeof ADMIN_EMAILS)[number])) {
    return "admin";
  }

  if (
    ORGANISER_EMAILS.includes(
      normalized as (typeof ORGANISER_EMAILS)[number],
    )
  ) {
    return "organiser";
  }

  return "player";
}
