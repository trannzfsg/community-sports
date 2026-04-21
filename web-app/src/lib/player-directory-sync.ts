export function shouldSyncSelfRegisteredPlayerDirectoryEntry(role: "player" | "organiser" | "admin") {
  return role === "player";
}
