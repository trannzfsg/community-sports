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
  skipNextEvent: boolean;
  skipCount: number;
  skipDates: string[];
  recentTenWeekSkipCount?: number;
  lastAutoRegisteredEventId?: string | null;
  dataPartition: DataPartition;
  createdAt?: unknown;
};

type PlannedRegistrationInput = {
  userId: string;
  playerName: string;
  playerEmail: string;
  source: "series-membership" | "roster-copy";
  seriesMembershipId?: string | null;
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
  capacity: number;
  waitingListCapacity?: number;
  activeMemberships: Array<{
    id: string;
    playerId: string;
    playerName: string;
    playerEmail: string;
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
  const reservedMembershipPlayerIds = new Set(
    input.activeMemberships.map((membership) => membership.playerId),
  );

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
      status: nextStatus,
    });
  };

  orderedMemberships.forEach((membership) => {
    if (membership.skipNextEvent) {
      skippedMembershipIds.push(membership.id);
      return;
    }

    pushPlannedRegistration({
      userId: membership.playerId,
      playerName: membership.playerName,
      playerEmail: membership.playerEmail,
      source: "series-membership",
      seriesMembershipId: membership.id,
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

export async function requestSeriesMembership(
  db: Firestore,
  input: {
    seriesId: string;
    organiserId: string;
    playerId: string;
    playerName: string;
    playerEmail: string;
    dataPartition: DataPartition;
  },
) {
  const membershipId = buildSeriesMembershipId(input.seriesId, input.playerId);
  const membershipRef = doc(db, "seriesMemberships", membershipId);
  let existingData: Partial<SeriesMembership> | null = null;
  let existingCreatedAt: unknown;

  try {
    const existingSnapshot = await getDoc(membershipRef);
    if (existingSnapshot.exists()) {
      existingData = existingSnapshot.data() as Partial<SeriesMembership>;
      existingCreatedAt = existingData.createdAt;
    }
  } catch (error) {
    const permissionDenied = typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: string }).code === "permission-denied";
    if (!permissionDenied) {
      throw error;
    }
  }

  await setDoc(membershipRef, {
    seriesId: input.seriesId,
    organiserId: input.organiserId,
    playerId: input.playerId,
    playerName: input.playerName,
    playerEmail: input.playerEmail,
    status: "pending",
    skipNextEvent: false,
    skipCount: existingData?.skipCount ?? 0,
    skipDates: existingData?.skipDates ?? [],
    lastAutoRegisteredEventId: existingData?.lastAutoRegisteredEventId ?? null,
    dataPartition: input.dataPartition,
    createdAt: existingCreatedAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return membershipId;
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
