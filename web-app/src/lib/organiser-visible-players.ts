export type OrganiserVisiblePlayerSplitCandidate = {
  isOwnedPrivatePlayer: boolean;
  hasRegisteredForOrganiser: boolean;
};

export function splitOrganiserVisiblePlayers<T extends OrganiserVisiblePlayerSplitCandidate>(items: T[]) {
  return {
    privatePlayers: items.filter((player) => player.isOwnedPrivatePlayer),
    registeredPlayers: items.filter((player) => player.hasRegisteredForOrganiser && !player.isOwnedPrivatePlayer),
  };
}
