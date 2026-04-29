import type { PlayerDirectoryEntry } from "./players";

export function filterPlayersSelectableByOrganiserApproval(
  players: PlayerDirectoryEntry[],
  approvedPlayerIds: Set<string>,
) {
  return players.filter((player) => !player.userId || approvedPlayerIds.has(player.userId));
}

export function filterActiveSelectablePlayers(players: PlayerDirectoryEntry[]) {
  return players.filter((player) => player.status !== "inactive");
}
