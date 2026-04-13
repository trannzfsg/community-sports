export type OrganiserVisiblePlayerSplitCandidate = {
  isEditablePrivatePlayer: boolean;
  hasRegisteredForOrganiser: boolean;
};

export function splitOrganiserVisiblePlayers<T extends OrganiserVisiblePlayerSplitCandidate>(items: T[]) {
  return {
    privatePlayers: items.filter((player) => player.isEditablePrivatePlayer),
    registeredPlayers: items.filter((player) => player.hasRegisteredForOrganiser && !player.isEditablePrivatePlayer),
  };
}
