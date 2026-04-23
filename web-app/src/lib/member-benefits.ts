import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";

type DataPartition = "test" | "live";

export type OrganiserBenefitProgram = {
  id: string;
  organiserId: string;
  minGamesRequired: number;
  benefitInstructionText: string;
  dataPartition: DataPartition;
};

export type SeriesMembershipStatus =
  | "pending"
  | "active"
  | "paused"
  | "cancelled"
  | "rejected";

export type SeriesMembership = {
  id: string;
  seriesId: string;
  organiserId: string;
  playerId: string;
  playerName: string;
  playerEmail: string;
  status: SeriesMembershipStatus;
  startDate?: string | null;
  endDate?: string | null;
  autoPaidUntilDate?: string | null;
  approvedAtDate?: string | null;
  skipNextEvent: boolean;
  skipCount: number;
  skipDates: string[];
  recentTenWeekSkipCount?: number;
  lastAutoRegisteredEventId?: string | null;
  dataPartition: DataPartition;
  createdAt?: unknown;
  updatedAt?: unknown;
};

type PlannedRegistrationInput = {
  userId: string;
  playerName: string;
  playerEmail: string;
  source: "series-membership" | "roster-copy";
  seriesMembershipId?: string | null;
  playerPaid?: boolean;
  organiserPaid?: boolean;
};

export type PlannedRegistration = PlannedRegistrationInput & {
  status: "registered" | "waiting";
};

export function buildSeriesMembershipId(seriesId: string, playerId: string) {
  return `${seriesId}__${playerId}`;
}

export function buildOrganiserBenefitProgramId(organiserId: string) {
  return organiserId;
}

export function normalizeSkipDates(skipDates: string[], maxEntries = 104) {
  return Array.from(new Set(
    skipDates
      .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
      .sort((a, b) => a.localeCompare(b)),
  )).slice(-maxEntries);
}

export function normalizeDateOnly(value?: string | null) {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function resolveSeriesMembershipStartDate(input: {
  approvalDate: string;
  membershipStartDate?: string | null;
  seriesDefaultStartDate?: string | null;
}) {
  return normalizeDateOnly(input.membershipStartDate)
    ?? normalizeDateOnly(input.seriesDefaultStartDate)
    ?? input.approvalDate;
}

export function isSeriesMembershipActiveForEvent(input: {
  status: SeriesMembershipStatus | string;
  eventDate: string;
  startDate?: string | null;
  endDate?: string | null;
}) {
  if (input.status !== "active") {
    return false;
  }

  const startDate = normalizeDateOnly(input.startDate);
  const endDate = normalizeDateOnly(input.endDate);

  if (startDate && input.eventDate < startDate) {
    return false;
  }

  if (endDate && input.eventDate > endDate) {
    return false;
  }

  return true;
}

export function shouldAutoMarkMembershipRegistrationPaid(input: {
  eventDate: string;
  autoPaidUntilDate?: string | null;
}) {
  const autoPaidUntilDate = normalizeDateOnly(input.autoPaidUntilDate);
  return !!autoPaidUntilDate && input.eventDate <= autoPaidUntilDate;
}

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

export function getRecentSkipCount(
  skipDates: string[],
  referenceDate: string,
  weekWindow = 10,
) {
  const reference = parseDateOnly(referenceDate);
  const threshold = new Date(reference);
  threshold.setUTCDate(threshold.getUTCDate() - (weekWindow * 7));

  return normalizeSkipDates(skipDates).filter((dateText) => {
    const skipDate = parseDateOnly(dateText);
    return skipDate >= threshold && skipDate <= reference;
  }).length;
}

export function getOrganiserBenefitStatus(input: {
  confirmedGames: number;
  minGamesRequired: number;
}) {
  const remainingGames = Math.max(0, input.minGamesRequired - input.confirmedGames);
  const qualified = input.confirmedGames >= input.minGamesRequired;

  return {
    qualified,
    remainingGames,
  };
}

export function planEventRegistrations(input: {
  eventDate: string;
  capacity: number;
  waitingListCapacity?: number;
  activeMemberships: Array<{
    id: string;
    playerId: string;
    playerName: string;
    playerEmail: string;
    status: SeriesMembershipStatus;
    startDate?: string | null;
    endDate?: string | null;
    autoPaidUntilDate?: string | null;
    skipNextEvent?: boolean;
    joinedOrder?: number;
  }>;
  previousRegistrations: Array<{
    userId: string;
    playerName: string;
    playerEmail: string;
    createdOrder?: number;
  }>;
}) {
  const planned: PlannedRegistration[] = [];
  const skippedMembershipIds: string[] = [];
  const reservedMembershipPlayerIds = new Set<string>();

  const orderedMemberships = [...input.activeMemberships].sort((a, b) => {
    const aOrder = a.joinedOrder ?? 0;
    const bOrder = b.joinedOrder ?? 0;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.playerName.localeCompare(b.playerName);
  });

  const pushPlannedRegistration = (entry: PlannedRegistrationInput) => {
    const bookedCount = planned.filter((item) => item.status === "registered").length;
    const waitingCount = planned.filter((item) => item.status === "waiting").length;
    const waitingListCapacity = Math.max(0, input.waitingListCapacity || 0);
    const nextStatus: "registered" | "waiting" | null = bookedCount < input.capacity
      ? "registered"
      : waitingCount < waitingListCapacity
        ? "waiting"
        : null;

    if (!nextStatus) {
      return;
    }

    planned.push({
      ...entry,
      playerPaid: entry.playerPaid ?? false,
      organiserPaid: entry.organiserPaid ?? false,
      status: nextStatus,
    });
  };

  orderedMemberships.forEach((membership) => {
    if (membership.skipNextEvent) {
      reservedMembershipPlayerIds.add(membership.playerId);
      skippedMembershipIds.push(membership.id);
      return;
    }

    if (!isSeriesMembershipActiveForEvent({
      status: membership.status,
      eventDate: input.eventDate,
      startDate: membership.startDate,
      endDate: membership.endDate,
    })) {
      return;
    }

    reservedMembershipPlayerIds.add(membership.playerId);
    const shouldAutoPay = shouldAutoMarkMembershipRegistrationPaid({
      eventDate: input.eventDate,
      autoPaidUntilDate: membership.autoPaidUntilDate,
    });

    pushPlannedRegistration({
      userId: membership.playerId,
      playerName: membership.playerName,
      playerEmail: membership.playerEmail,
      source: "series-membership",
      seriesMembershipId: membership.id,
      playerPaid: shouldAutoPay,
      organiserPaid: shouldAutoPay,
    });
  });

  const orderedPreviousRegistrations = [...input.previousRegistrations].sort((a, b) => {
    const aOrder = a.createdOrder ?? 0;
    const bOrder = b.createdOrder ?? 0;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.playerName.localeCompare(b.playerName);
  });

  orderedPreviousRegistrations.forEach((registration) => {
    if (reservedMembershipPlayerIds.has(registration.userId)) {
      return;
    }

    if (planned.some((item) => item.userId === registration.userId)) {
      return;
    }

    pushPlannedRegistration({
      userId: registration.userId,
      playerName: registration.playerName,
      playerEmail: registration.playerEmail,
      source: "roster-copy",
      seriesMembershipId: null,
    });
  });

  return {
    plannedRegistrations: planned,
    skippedMembershipIds,
  };
}

export async function getOrganiserBenefitProgram(
  db: Firestore,
  organiserId: string,
) {
  const snapshot = await getDoc(
    doc(db, "organiserBenefitPrograms", buildOrganiserBenefitProgramId(organiserId)),
  );
  if (!snapshot.exists()) return null;

  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<OrganiserBenefitProgram, "id">),
  };
}

export async function saveOrganiserBenefitProgram(
  db: Firestore,
  input: Omit<OrganiserBenefitProgram, "id">,
) {
  const id = buildOrganiserBenefitProgramId(input.organiserId);
  await setDoc(doc(db, "organiserBenefitPrograms", id), {
    ...input,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return id;
}

export async function getSeriesMembershipsForPlayer(
  db: Firestore,
  playerId: string,
  dataPartition: DataPartition,
) {
  const snapshot = await getDocs(
    query(
      collection(db, "seriesMemberships"),
      where("playerId", "==", playerId),
      where("dataPartition", "==", dataPartition),
    ),
  );

  return snapshot.docs.map((membershipDoc) => {
    const membership = {
      id: membershipDoc.id,
      ...(membershipDoc.data() as Omit<SeriesMembership, "id">),
    };
    return {
      ...membership,
      recentTenWeekSkipCount: getRecentSkipCount(
        membership.skipDates || [],
        new Date().toISOString().slice(0, 10),
      ),
    };
  });
}

export async function getSeriesMembershipsForSeries(
  db: Firestore,
  seriesId: string,
  organiserId: string,
  dataPartition: DataPartition,
) {
  const snapshot = await getDocs(
    query(
      collection(db, "seriesMemberships"),
      where("seriesId", "==", seriesId),
      where("organiserId", "==", organiserId),
      where("dataPartition", "==", dataPartition),
    ),
  );

  return snapshot.docs.map((membershipDoc) => {
    const membership = {
      id: membershipDoc.id,
      ...(membershipDoc.data() as Omit<SeriesMembership, "id">),
    };
    return {
      ...membership,
      recentTenWeekSkipCount: getRecentSkipCount(
        membership.skipDates || [],
        new Date().toISOString().slice(0, 10),
      ),
    };
  });
}

export async function updateSeriesMembershipSettings(
  db: Firestore,
  membershipId: string,
  input: {
    startDate?: string | null;
    endDate?: string | null;
    autoPaidUntilDate?: string | null;
    approvedAtDate?: string | null;
  },
) {
  const updates: Record<string, string | null | unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (Object.prototype.hasOwnProperty.call(input, "startDate")) {
    updates.startDate = normalizeDateOnly(input.startDate) ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(input, "endDate")) {
    updates.endDate = normalizeDateOnly(input.endDate) ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(input, "autoPaidUntilDate")) {
    updates.autoPaidUntilDate = normalizeDateOnly(input.autoPaidUntilDate) ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(input, "approvedAtDate")) {
    updates.approvedAtDate = normalizeDateOnly(input.approvedAtDate) ?? null;
  }

  await updateDoc(doc(db, "seriesMemberships", membershipId), updates);
}

export async function updateSeriesMembershipStatus(
  db: Firestore,
  membershipId: string,
  status: SeriesMembershipStatus,
) {
  await updateDoc(doc(db, "seriesMemberships", membershipId), {
    status,
    updatedAt: serverTimestamp(),
  });
}

export async function updateSeriesMembershipSkipNextEvent(
  db: Firestore,
  membershipId: string,
  skipNextEvent: boolean,
) {
  await updateDoc(doc(db, "seriesMemberships", membershipId), {
    skipNextEvent,
    updatedAt: serverTimestamp(),
  });
}
