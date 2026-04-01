export type AppRole = "player" | "organiser" | "admin";

export function getRoleForEmail(): AppRole {
  return "player";
}
