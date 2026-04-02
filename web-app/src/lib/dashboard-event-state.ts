import type { AppRole } from "@/lib/roles";

type Input = {
  role?: AppRole;
  playerIsGoing: boolean;
  playerIsWaiting: boolean;
  playerCanJoin: boolean;
  eventIsFull: boolean;
  waitingListIsFull: boolean;
};

export function getDashboardEventPresentation(input: Input) {
  if (input.role === "player") {
    if (input.playerIsGoing) {
      return {
        className: "ring-emerald-300 bg-emerald-50",
        stateText: "going",
      };
    }

    if (input.playerIsWaiting) {
      return {
        className: "ring-yellow-300 bg-yellow-50",
        stateText: "waiting list",
      };
    }

    if (input.playerCanJoin) {
      return {
        className: "ring-blue-300 bg-blue-50",
        stateText: "available",
      };
    }

    if (input.waitingListIsFull) {
      return {
        className: "ring-red-300 bg-red-50",
        stateText: "not available",
      };
    }

    return {
      className: "ring-zinc-300 bg-zinc-100",
      stateText: "not available",
    };
  }

  if (input.waitingListIsFull) {
    return {
      className: "ring-red-300 bg-red-50",
      stateText: "waiting list full",
    };
  }

  if (input.eventIsFull) {
    return {
      className: "ring-amber-300 bg-amber-50",
      stateText: "full",
    };
  }

  return {
    className: "ring-emerald-300 bg-emerald-50",
    stateText: "open",
  };
}
