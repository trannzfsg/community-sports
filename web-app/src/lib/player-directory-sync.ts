import { canActAsPlayer, type AppRole } from "./roles.ts";

export function shouldSyncSelfRegisteredPlayerDirectoryEntry(role: AppRole) {
  return canActAsPlayer(role);
}
