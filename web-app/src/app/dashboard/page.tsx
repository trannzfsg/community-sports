"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import AppShell from "@/components/app-shell";
import SearchablePlayerSelect from "@/components/searchable-player-select";
import EventRegistrationRow from "@/components/event-registration-row";
import { auth, db } from "@/lib/firebase";
import { getDataPartitionForEmail, resolveDataPartition, shouldBypassEmailVerification, type DataPartition } from "@/lib/data-partition";
import { deletePaymentRecord, syncPaymentRecordForRegistration } from "@/lib/payments";
import { getManagedUserByEmail } from "@/lib/managed-users";
import {
  ensureSelfRegisteredPlayers,
  getVisiblePlayersForOrganiser,
  type PlayerDirectoryEntry,
} from "@/lib/players";
import { filterPlayersSelectableByOrganiserApproval } from "@/lib/player-selection";
import {
  getOrganiserApprovalRequests,
  getPlayerOrganiserApprovals,
  requestOrganiserApproval,
  type OrganiserApprovalRecord,
} from "@/lib/organiser-approvals";
import { needsOnboarding, type OnboardingVersionState } from "@/lib/onboarding";
import { getUsersByRole } from "@/lib/users";
import type { AppRole } from "@/lib/roles";
import { getEffectiveNextGameOn } from "@/lib/session-options";
import { getDashboardEventPresentation } from "@/lib/dashboard-event-state";
import {
  buildRegistrationId,
  createSessionEventForSeries,
  getCancellationPolicyLabel,
  formatWaitingListCapacity,
  getWaitingListCapacityInputValue,
  getOrganiserCancellationPolicyWarning,
  getPlayerCancellationPolicyMessage,
  getRegistrationCapacityState,
  isCancellationPolicyActive,
  normalizeWaitingListCapacity,
  rebalanceEventRegistrations,
  updateSessionEventOverrides,
  type RegistrationItem,
  type SessionEvent,
  type SessionEventOverridesInput,
  type SessionSeries,
} from "@/lib/session-series";

type UserProfile = {
  displayName?: string;
  email?: string;
  role: AppRole;
  dataPartition?: DataPartition;
  onboardingSeenVersions?: OnboardingVersionState | null;
};

type OrganiserOption = {
  id: string;
  displayName: string;
  email: string;
};

type EventEditDraft = {
  location: string;
  startAt: string;
  endAt: string;
  defaultPriceCasual: string;
  capacity: string;
  waitingListCapacity: string;
};

function requiresVerifiedEmail(user: User) {
  return user.providerData.some((provider) => provider.providerId === "password")
    && !shouldBypassEmailVerification(user.email || "");
}

function sortRegistrations(
  registrations: RegistrationItem[],
  currentUserId?: string,
) {
  const copy = [...registrations];
  copy.sort((a, b) => {
    const aIsMember = a.source === "series-membership" ? 0 : 1;
    const bIsMember = b.source === "series-membership" ? 0 : 1;
    if (aIsMember !== bIsMember) {
      return aIsMember - bIsMember;
    }

    const aIsSelf = currentUserId && a.userId === currentUserId ? 1 : 0;
    const bIsSelf = currentUserId && b.userId === currentUserId ? 1 : 0;
    if (aIsSelf !== bIsSelf) {
      return bIsSelf - aIsSelf;
    }

    const aCreated = a.createdAt instanceof Timestamp ? a.createdAt.toMillis() : 0;
    const bCreated = b.createdAt instanceof Timestamp ? b.createdAt.toMillis() : 0;
    return aCreated - bCreated;
  });
  return copy;
}

function withDerivedEventCounts(
  event: SessionEvent,
  registrations: RegistrationItem[],
): SessionEvent {
  const bookedCount = registrations.filter((registration) => registration.status !== "waiting").length;
  const waitingCount = registrations.filter((registration) => registration.status === "waiting").length;

  return {
    ...event,
    bookedCount,
    waitingCount,
  };
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [seriesList, setSeriesList] = useState<SessionSeries[]>([]);
  const [eventsBySeries, setEventsBySeries] = useState<Record<string, SessionEvent[]>>({});
  const [registrationsByEvent, setRegistrationsByEvent] = useState<Record<string, RegistrationItem[]>>({});
  const [playerDirectory, setPlayerDirectory] = useState<PlayerDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [paymentReferenceInputs, setPaymentReferenceInputs] = useState<Record<string, string>>({});
  const [editingReferenceId, setEditingReferenceId] = useState<string | null>(null);
  const [playerOrganiserApprovals, setPlayerOrganiserApprovals] = useState<OrganiserApprovalRecord[]>([]);
  const [availableOrganisers, setAvailableOrganisers] = useState<OrganiserOption[]>([]);
  const [organiserApprovalRequests, setOrganiserApprovalRequests] = useState<OrganiserApprovalRecord[]>([]);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventEditDrafts, setEventEditDrafts] = useState<Record<string, EventEditDraft>>({});
  const [openActionsSeriesId, setOpenActionsSeriesId] = useState<string | null>(null);

  function splitIntoChunks<T>(items: T[], size: number) {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      try {
        setLoadError("");
        if (!currentUser) {
          router.push("/");
          return;
        }

        console.log("[dashboard] auth user", { uid: currentUser.uid, email: currentUser.email });
        setUser(currentUser);

        const userRef = doc(db, "users", currentUser.uid);
        const profileSnapshot = await getDoc(userRef);
        console.log("[dashboard] profile doc exists:", profileSnapshot.exists(), "role:", profileSnapshot.data()?.role);

        if (requiresVerifiedEmail(currentUser) && !currentUser.emailVerified && !profileSnapshot.exists()) {
          await signOut(auth);
          router.push("/login");
          return;
        }

        let profileData: UserProfile;
        if (!profileSnapshot.exists()) {
          const email = currentUser.email || "";
          // users/{uid} doesn't exist - look up the pending user doc to get the correct role
          // rather than defaulting to "player". This covers organisers on first login.
          const managedUser = email ? await getManagedUserByEmail(db, email) : null;
          const displayName = (managedUser?.displayName || currentUser.displayName || currentUser.email || "Player").trim();
          const role: AppRole = managedUser?.role || "player";
          const status = managedUser?.status || "active";
          console.warn("[dashboard] No users/{uid} doc found - creating from pending user doc or default.", { email, resolvedRole: role });

          await setDoc(userRef, {
            displayName,
            email,
            role,
            status,
            dataPartition: getDataPartitionForEmail(email),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }, { merge: true });

          profileData = { displayName, email, role, dataPartition: getDataPartitionForEmail(email) };
        } else {
          profileData = profileSnapshot.data() as UserProfile;
        }

        const dataPartition = resolveDataPartition(profileData.email || currentUser.email || "", profileData.dataPartition || "live");
        profileData = {
          ...profileData,
          dataPartition,
        };

        console.log("[dashboard] loaded profile", { role: profileData.role });
        setProfile(profileData);

        if (needsOnboarding({
          role: profileData.role,
          seenVersions: profileData.onboardingSeenVersions,
        })) {
          router.push("/onboarding?returnTo=/dashboard");
          return;
        }

        let seriesItems: SessionSeries[] = [];
        let approvedOrganiserIds = new Set<string>();

        if (profileData.role === "organiser") {
          const seriesSnapshots = await getDocs(
            query(
              collection(db, "sessions"),
              where("organiserId", "==", currentUser.uid),
              where("dataPartition", "==", dataPartition),
            ),
          );
          seriesItems = seriesSnapshots.docs.map((sessionDoc) => ({
            id: sessionDoc.id,
            ...(sessionDoc.data() as Omit<SessionSeries, "id">),
          })).sort((a, b) => a.dayOfWeek.localeCompare(b.dayOfWeek));
        } else if (profileData.role === "player") {
          const [approvals, organisers] = await Promise.all([
            getPlayerOrganiserApprovals(db, currentUser.uid, dataPartition),
            getUsersByRole(db, "organiser", dataPartition),
          ]);
          setPlayerOrganiserApprovals(approvals.sort((a, b) => a.organiserName.localeCompare(b.organiserName)));
          setAvailableOrganisers(organisers.map((organiser) => ({
            id: organiser.id,
            displayName: organiser.displayName || organiser.email || "Organiser",
            email: organiser.email || "",
          })).sort((a, b) => a.displayName.localeCompare(b.displayName)));

          approvedOrganiserIds = new Set(
            approvals
              .filter((approval) => approval.status === "approved")
              .map((approval) => approval.organiserId),
          );

          if (approvedOrganiserIds.size) {
            const organiserIdChunks = splitIntoChunks(Array.from(approvedOrganiserIds), 10);
            const snapshotChunks = await Promise.all(
              organiserIdChunks.map((chunk) => getDocs(
                query(
                  collection(db, "sessions"),
                  where("organiserId", "in", chunk),
                  where("dataPartition", "==", dataPartition),
                ),
              )),
            );
            seriesItems = snapshotChunks
              .flatMap((snapshot) => snapshot.docs)
              .map((sessionDoc) => ({
                id: sessionDoc.id,
                ...(sessionDoc.data() as Omit<SessionSeries, "id">),
              }))
              .sort((a, b) => a.dayOfWeek.localeCompare(b.dayOfWeek));
          }
        } else {
          const seriesSnapshots = await getDocs(
            query(collection(db, "sessions"), where("dataPartition", "==", dataPartition)),
          );
          seriesItems = seriesSnapshots.docs.map((sessionDoc) => ({
            id: sessionDoc.id,
            ...(sessionDoc.data() as Omit<SessionSeries, "id">),
          })).sort((a, b) => a.dayOfWeek.localeCompare(b.dayOfWeek));
        }

        const eventMap: Record<string, SessionEvent[]> = {};
        const registrationMap: Record<string, RegistrationItem[]> = {};

        await Promise.all(
          seriesItems.map(async (series) => {
            const eventSnapshot = await getDocs(
              query(
                collection(db, "sessionEvents"),
                where("sessionSeriesId", "==", series.id),
                where("organiserId", "==", series.organiserId),
                where("dataPartition", "==", dataPartition),
              ),
            );
            const rawEventItems = eventSnapshot.docs
              .map((eventDoc) => ({
                id: eventDoc.id,
                ...(eventDoc.data() as Omit<SessionEvent, "id">),
              }))
              .sort((a, b) => a.eventDate.localeCompare(b.eventDate));

            await Promise.all(
              rawEventItems.map(async (event) => {
                const registrationSnapshot = await getDocs(
                  query(
                    collection(db, "registrations"),
                    where("sessionEventId", "==", event.id),
                    where("dataPartition", "==", dataPartition),
                  ),
                );
                registrationMap[event.id] = sortRegistrations(
                  registrationSnapshot.docs.map((registrationDoc) => ({
                    id: registrationDoc.id,
                    ...(registrationDoc.data() as Omit<RegistrationItem, "id">),
                  })),
                  currentUser.uid,
                );
              }),
            );

            eventMap[series.id] = rawEventItems.map((event) => withDerivedEventCounts(event, registrationMap[event.id] ?? []));
          }),
        );

        if (profileData.role === "admin") {
          await ensureSelfRegisteredPlayers(db, dataPartition);
        }

        if (profileData.role === "admin" || profileData.role === "organiser") {
          const organiserIds = profileData.role === "organiser"
            ? [currentUser.uid]
            : Array.from(new Set(seriesItems.map((series) => series.organiserId)));

          const visiblePlayers = new Map<string, PlayerDirectoryEntry>();
          for (const organiserId of organiserIds) {
              const entries = await getVisiblePlayersForOrganiser(db, organiserId, dataPartition);
            for (const entry of entries) {
              visiblePlayers.set(entry.id, entry);
            }
          }
          setPlayerDirectory(Array.from(visiblePlayers.values()).sort((a, b) => {
            const nameCompare = a.displayName.localeCompare(b.displayName);
            if (nameCompare !== 0) return nameCompare;
            return a.email.localeCompare(b.email);
          }));

          if (profileData.role === "organiser") {
            const approvals = await getOrganiserApprovalRequests(db, currentUser.uid, dataPartition);
            setOrganiserApprovalRequests(
              approvals.sort((a, b) => a.playerName.localeCompare(b.playerName)),
            );
          } else {
            setOrganiserApprovalRequests([]);
          }
        } else {
          setPlayerDirectory([]);
          setOrganiserApprovalRequests([]);
        }

        if (profileData.role !== "player") {
          setPlayerOrganiserApprovals([]);
          setAvailableOrganisers([]);
        }

        setSeriesList(seriesItems);
        setEventsBySeries(eventMap);
        setRegistrationsByEvent(registrationMap);
      } catch (error) {
        console.error("[dashboard] Load failed:", error);
        setLoadError(error instanceof Error ? error.message : "Unknown dashboard error");
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [router]);

  const canManageSessions = useMemo(() => {
    return profile?.role === "admin" || profile?.role === "organiser";
  }, [profile?.role]);

  const approvedOrganiserIdsForPlayer = useMemo(() => {
    return new Set(
      playerOrganiserApprovals
        .filter((approval) => approval.status === "approved")
        .map((approval) => approval.organiserId),
    );
  }, [playerOrganiserApprovals]);

  const approvedPlayerIdsForOrganiser = useMemo(() => {
    return new Set(
      organiserApprovalRequests
        .filter((approval) => approval.status === "approved")
        .map((approval) => approval.playerId),
    );
  }, [organiserApprovalRequests]);

  async function refreshSeriesData(seriesId: string, organiserId: string) {
    const eventSnapshots = await getDocs(
      query(
        collection(db, "sessionEvents"),
        where("sessionSeriesId", "==", seriesId),
        where("organiserId", "==", organiserId),
        where("dataPartition", "==", profile?.dataPartition || "live"),
      ),
    );

    const rawEventItems = eventSnapshots.docs
      .map((eventDoc) => ({
        id: eventDoc.id,
        ...(eventDoc.data() as Omit<SessionEvent, "id">),
      }))
      .sort((a, b) => a.eventDate.localeCompare(b.eventDate));

    const registrationMap: Record<string, RegistrationItem[]> = {};
    await Promise.all(
      rawEventItems.map(async (event) => {
        const registrationsSnapshot = await getDocs(
          query(
            collection(db, "registrations"),
            where("sessionEventId", "==", event.id),
            where("dataPartition", "==", profile?.dataPartition || "live"),
          ),
        );
        registrationMap[event.id] = sortRegistrations(
          registrationsSnapshot.docs.map((registrationDoc) => ({
            id: registrationDoc.id,
            ...(registrationDoc.data() as Omit<RegistrationItem, "id">),
          })),
          user?.uid,
        );
      }),
    );

    const eventItems = rawEventItems.map((event) => withDerivedEventCounts(event, registrationMap[event.id] ?? []));

    setEventsBySeries((current) => ({ ...current, [seriesId]: eventItems }));
    setRegistrationsByEvent((current) => ({ ...current, ...registrationMap }));
  }

  async function handleCreateNextEvent(series: SessionSeries) {
    setBusyKey(series.id);
    try {
      const createdEvent = await createSessionEventForSeries(db, series);
      await updateDoc(doc(db, "sessions", series.id), {
        nextGameOn: createdEvent.eventDate,
      });
      setSeriesList((current) =>
        current.map((item) => (
          item.id === series.id
            ? { ...item, nextGameOn: createdEvent.eventDate }
            : item
        )),
      );
      await refreshSeriesData(series.id, series.organiserId);
    } catch (error) {
      console.error("[dashboard] create next event failed", error);
      setLoadError(error instanceof Error ? error.message : "Failed to create the next event.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSetEventStatus(series: SessionSeries, eventItem: SessionEvent, status: "completed" | "cancelled") {
    setBusyKey(eventItem.id);
    try {
      await updateDoc(doc(db, "sessionEvents", eventItem.id), { status });
      await refreshSeriesData(series.id, series.organiserId);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDeleteSeries(series: SessionSeries) {
    const message = `WARNING: Inactivating this series will hide it from normal use and preserve its history, events, registrations, and payment records. Continue?`;
    if (!confirm(message)) {
      return;
    }

    setBusyKey(series.id);
    try {
      await updateDoc(doc(db, "sessions", series.id), {
        status: "inactive",
      });
      setSeriesList((current) =>
        current.map((item) => (item.id === series.id ? { ...item, status: "inactive" } : item)),
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRegister(series: SessionSeries, eventItem: SessionEvent) {
    if (!user) return;
    setBusyKey(eventItem.id);

    try {
      const registrationId = buildRegistrationId(eventItem.id, user.uid);
      if (!approvedOrganiserIdsForPlayer.has(series.organiserId)) {
        return;
      }

      const capacityState = getRegistrationCapacityState({
        capacity: eventItem.capacity,
        waitingListCapacity: eventItem.waitingListCapacity ?? series.waitingListCapacity,
        bookedCount: eventItem.bookedCount,
        waitingCount: eventItem.waitingCount,
      });

      if (!capacityState.canAddMore || !capacityState.nextRegistrationStatus) {
        return;
      }

      const registration: RegistrationItem = {
        id: registrationId,
        sessionEventId: eventItem.id,
        sessionSeriesId: series.id,
        userId: user.uid,
        playerName: profile?.displayName || user.email || "Player",
        playerEmail: user.email || "",
        dataPartition: getDataPartitionForEmail(user.email || ""),
        playerPaid: false,
        organiserPaid: false,
        status: capacityState.nextRegistrationStatus,
        source: "self",
        seriesMembershipId: null,
      };

      try {
        await setDoc(doc(db, "registrations", registrationId), {
          ...registration,
          createdAt: serverTimestamp(),
        });
      } catch (error) {
        const firebaseError = error as { code?: string; message?: string };
        console.error("[handleRegister] failed writing registration", {
          registrationId,
          code: firebaseError?.code,
          message: firebaseError?.message,
        });
        throw error;
      }

      try {
        await syncPaymentRecordForRegistration(db, series, eventItem, registration);
      } catch (error) {
        const firebaseError = error as { code?: string; message?: string };
        console.error("[handleRegister] failed syncing payment", {
          registrationId,
          code: firebaseError?.code,
          message: firebaseError?.message,
        });
        throw error;
      }
      if (canManageSessions) {
        await rebalanceEventRegistrations(db, eventItem.id, eventItem.capacity, profile?.dataPartition);
        await updateDoc(doc(db, "sessions", series.id), {
          nextGameOn: getEffectiveNextGameOn(series.dayOfWeek, series.startAt, series.nextGameOn),
        });
      }
      await refreshSeriesData(series.id, series.organiserId);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRemoveRegistration(
    registration: RegistrationItem,
    series: SessionSeries,
    eventItem: SessionEvent,
  ) {
    const cancellationPolicyActive = isCancellationPolicyActive({
      eventDate: eventItem.eventDate,
      startAt: eventItem.startAt,
      cancellationPolicyHours: series.cancellationPolicyHours,
    });

    if (!canManageSessions && registration.userId === user?.uid && cancellationPolicyActive) {
      alert(getPlayerCancellationPolicyMessage(series.cancellationPolicyHours));
      return;
    }

    if (canManageSessions && cancellationPolicyActive) {
      const confirmed = confirm(
        getOrganiserCancellationPolicyWarning(
          registration.playerName,
          series.cancellationPolicyHours,
        ),
      );
      if (!confirmed) {
        return;
      }
    }

    setBusyKey(registration.id);
    try {
      await deletePaymentRecord(db, registration.id);
      await deleteDoc(doc(db, "registrations", registration.id));
      if (canManageSessions) {
        await rebalanceEventRegistrations(db, eventItem.id, eventItem.capacity, profile?.dataPartition);
      }
      await refreshSeriesData(series.id, series.organiserId);
    } finally {
      setBusyKey(null);
    }
  }

  async function handlePaymentReferenceSubmit(
    registration: RegistrationItem,
    reference: string,
    series: SessionSeries,
    eventItem: SessionEvent,
  ) {
    setBusyKey(registration.sessionEventId);
    try {
      const trimmedRef = reference.trim();
      const updatedRegistration = {
        ...registration,
        paymentReference: trimmedRef || null,
        playerPaid: !!trimmedRef,
      };
      await updateDoc(doc(db, "registrations", registration.id), {
        paymentReference: trimmedRef || null,
        playerPaid: !!trimmedRef,
      });
      await syncPaymentRecordForRegistration(db, series, eventItem, updatedRegistration);
      setEditingReferenceId(null);
      setPaymentReferenceInputs((current) => {
        const next = { ...current };
        delete next[registration.id];
        return next;
      });
      await refreshSeriesData(series.id, series.organiserId);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleOrganiserPaidToggle(
    registration: RegistrationItem,
    nextValue: boolean,
    series: SessionSeries,
    eventItem: SessionEvent,
  ) {
    setBusyKey(registration.sessionEventId);
    try {
      const updatedRegistration = {
        ...registration,
        organiserPaid: nextValue,
      };
      await updateDoc(doc(db, "registrations", registration.id), {
        organiserPaid: nextValue,
      });
      await syncPaymentRecordForRegistration(db, series, eventItem, updatedRegistration);
      await refreshSeriesData(series.id, series.organiserId);
    } finally {
      setBusyKey(null);
    }
  }

  async function addPlayerToEvent(series: SessionSeries, eventItem: SessionEvent, player: PlayerDirectoryEntry) {
    const playerKey = player.userId || player.id;
    const existing = (registrationsByEvent[eventItem.id] ?? []).find(
      (registration) => registration.userId === playerKey,
    );
    if (existing) return;

    if (
      profile?.role === "organiser"
      && player.userId
      && !approvedPlayerIdsForOrganiser.has(player.userId)
    ) {
      throw new Error("Player must be approved before being added to events.");
    }

    const capacityState = getRegistrationCapacityState({
      capacity: eventItem.capacity,
      waitingListCapacity: eventItem.waitingListCapacity ?? series.waitingListCapacity,
      bookedCount: eventItem.bookedCount,
      waitingCount: eventItem.waitingCount,
    });

    if (!capacityState.canAddMore || !capacityState.nextRegistrationStatus) {
      return;
    }

    const registration: RegistrationItem = {
      id: buildRegistrationId(eventItem.id, playerKey),
      sessionEventId: eventItem.id,
      sessionSeriesId: series.id,
      userId: playerKey,
      playerName: player.displayName,
      playerEmail: player.email,
      dataPartition: player.dataPartition || getDataPartitionForEmail(player.email),
      playerPaid: false,
      organiserPaid: false,
      status: capacityState.nextRegistrationStatus,
      source: "organiser",
      seriesMembershipId: null,
    };

    console.log("[addPlayerToEvent] writing registration", {
      registrationId: registration.id,
      eventId: eventItem.id,
      currentUid: auth.currentUser?.uid,
      eventOrganiserId: eventItem.organiserId,
      playerKey,
      eventLocked: eventItem.locked,
    });
    try {
      await setDoc(doc(db, "registrations", registration.id), {
        ...registration,
        createdAt: serverTimestamp(),
      });
    } catch (err: unknown) {
      const firebaseErr = err as { message?: string; code?: string };
      console.error("[addPlayerToEvent] FAILED writing registrations/" + registration.id, "code:", firebaseErr?.code, "message:", firebaseErr?.message);
      throw err;
    }

    console.log("[addPlayerToEvent] syncing payment for registration", registration.id);
    try {
      await syncPaymentRecordForRegistration(db, series, eventItem, registration);
    } catch (err: unknown) {
      const firebaseErr = err as { message?: string; code?: string };
      console.error("[addPlayerToEvent] FAILED syncing payment", "code:", firebaseErr?.code, "message:", firebaseErr?.message);
      throw err;
    }

    console.log("[addPlayerToEvent] rebalancing event", eventItem.id);
    try {
      await rebalanceEventRegistrations(db, eventItem.id, eventItem.capacity, profile?.dataPartition);
    } catch (err: unknown) {
      const firebaseErr = err as { message?: string; code?: string };
      console.error("[addPlayerToEvent] FAILED rebalancing sessionEvents/" + eventItem.id, "code:", firebaseErr?.code, "message:", firebaseErr?.message);
      throw err;
    }
  }

  async function handleSelectOrCreatePlayer(
    series: SessionSeries,
    eventItem: SessionEvent,
    selection: { type: "existing"; player: PlayerDirectoryEntry },
  ) {
    setBusyKey(eventItem.id);
    try {
      await addPlayerToEvent(series, eventItem, selection.player);
      await refreshSeriesData(series.id, series.organiserId);
    } catch (err: unknown) {
      const firebaseErr = err as { message?: string; code?: string };
      console.error("[handleSelectOrCreatePlayer] failed:", "code:", firebaseErr?.code, "message:", firebaseErr?.message, "eventId:", eventItem.id, "playerId:", selection.player.id);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRequestOrganiserApproval(organiser: OrganiserOption) {
    if (!user || !profile) return;
    setBusyKey(`request-approval-${organiser.id}`);
    try {
      await requestOrganiserApproval(db, {
        organiserId: organiser.id,
        organiserName: organiser.displayName,
        playerId: user.uid,
        playerName: profile.displayName || user.email || "Player",
        playerEmail: user.email || "",
        dataPartition: profile.dataPartition || "live",
      });

      const approvals = await getPlayerOrganiserApprovals(
        db,
        user.uid,
        profile.dataPartition || "live",
      );
      setPlayerOrganiserApprovals(approvals.sort((a, b) => a.organiserName.localeCompare(b.organiserName)));
    } finally {
      setBusyKey(null);
    }
  }

  const approvedApprovalsForPlayer = playerOrganiserApprovals
    .filter((approval) => approval.status === "approved");

  function buildEventEditDraft(eventItem: SessionEvent): EventEditDraft {
    return {
      location: eventItem.location,
      startAt: eventItem.startAt,
      endAt: eventItem.endAt,
      defaultPriceCasual: String(eventItem.defaultPriceCasual),
      capacity: String(eventItem.capacity),
      waitingListCapacity: getWaitingListCapacityInputValue(eventItem.waitingListCapacity),
    };
  }

  function handleEventEditStart(eventItem: SessionEvent) {
    setEventEditDrafts((current) => ({
      ...current,
      [eventItem.id]: current[eventItem.id] || buildEventEditDraft(eventItem),
    }));
    setOpenActionsSeriesId(null);
    setEditingEventId(eventItem.id);
  }

  function handleEventEditDraftChange(
    eventId: string,
    field: keyof EventEditDraft,
    value: string,
  ) {
    setEventEditDrafts((current) => ({
      ...current,
      [eventId]: {
        ...(current[eventId] || {
          location: "",
          startAt: "",
          endAt: "",
          defaultPriceCasual: "",
          capacity: "",
          waitingListCapacity: "",
        }),
        [field]: value,
      },
    }));
  }

  async function handleEventEditSave(series: SessionSeries, eventItem: SessionEvent) {
    const draft = eventEditDrafts[eventItem.id] || buildEventEditDraft(eventItem);
    const values: SessionEventOverridesInput = {
      location: draft.location,
      startAt: draft.startAt,
      endAt: draft.endAt,
      defaultPriceCasual: Number(draft.defaultPriceCasual),
      capacity: Number(draft.capacity),
      waitingListCapacity: normalizeWaitingListCapacity(draft.waitingListCapacity),
    };

    setBusyKey(`edit-event-${eventItem.id}`);
    setLoadError("");
    try {
      await updateSessionEventOverrides(db, {
        series,
        event: eventItem,
        registrations: registrationsByEvent[eventItem.id] ?? [],
        values,
      });
      setEditingEventId(null);
      await refreshSeriesData(series.id, series.organiserId);
    } catch (error) {
      console.error("[dashboard] event edit failed", error);
      setLoadError(error instanceof Error ? error.message : "Failed to update event details.");
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
        <div className="mx-auto max-w-5xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          Loading dashboard...
        </div>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
        <div className="mx-auto max-w-3xl rounded-3xl border border-red-200 bg-red-50 p-8 shadow-sm">
          <div className="text-sm font-semibold uppercase tracking-[0.15em] text-red-600">Dashboard error</div>
          <div className="mt-3 text-lg font-medium text-red-800">{loadError}</div>
          <div className="mt-4 text-sm text-red-700">Open the browser console for the exact failing call if needed.</div>
        </div>
      </main>
    );
  }

  return (
    <AppShell role={profile?.role ?? "player"} contentClassName="max-w-6xl">
      <div className="flex w-full flex-col gap-6">
        <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Dashboard</p>
          <h1 className="text-3xl font-semibold tracking-tight">Welcome {profile?.displayName || user?.email}</h1>
          <p className="mt-3 text-zinc-600">Role: <strong>{profile?.role ?? "player"}</strong></p>
        </div>

        {profile?.role === "player" ? (
          <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200" data-testid="player-organiser-approvals">
            <h2 className="text-xl font-semibold">Organiser approvals</h2>
            <p className="mt-2 text-sm text-zinc-600">Request organiser approval before you can view or register for their events.</p>
            <div className="mt-4 space-y-3">
              {availableOrganisers.length ? availableOrganisers.map((organiser) => {
                const approval = playerOrganiserApprovals.find((item) => item.organiserId === organiser.id);
                const status = approval?.status || "none";
                const isPending = status === "pending";
                const isApproved = status === "approved";
                const isRejected = status === "rejected";
                const isRequesting = busyKey === `request-approval-${organiser.id}`;

                return (
                  <div key={organiser.id} className="rounded-2xl border border-zinc-200 p-4" data-testid={`player-organiser-approval-${organiser.id}`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-medium text-zinc-900">{organiser.displayName}</div>
                        <div className="text-sm text-zinc-500">{organiser.email}</div>
                        <div className="mt-1 text-xs text-zinc-500">
                          Status: {isApproved ? "approved" : isPending ? "pending" : isRejected ? "rejected" : "not requested"}
                        </div>
                      </div>
                      {isApproved ? (
                        <span className="rounded-full bg-emerald-100 px-4 py-2 text-xs font-medium text-emerald-700">Approved</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleRequestOrganiserApproval(organiser)}
                          disabled={isPending || isRequesting}
                          data-testid={`request-organiser-approval-${organiser.id}`}
                          className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isPending ? "Requested" : isRequesting ? "Requesting..." : "Request approval"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              }) : <div className="text-sm text-zinc-500">No organisers available in your partition yet.</div>}
            </div>
          </div>
        ) : null}

        <section className="grid gap-4">
          {profile?.role === "player" && !approvedApprovalsForPlayer.length ? (
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">
              No events yet. Request organiser approval above to view and join events.
            </div>
          ) : seriesList.filter((series) => series.status !== "inactive").length ? (
            seriesList.filter((series) => series.status !== "inactive").map((series) => {
              const events = eventsBySeries[series.id] ?? [];
              const dashboardEvents = events.filter((event) => (event.status || "active") === "active");
              const nextEvent = dashboardEvents.find((event) => event.eventDate === series.nextGameOn) ?? dashboardEvents.at(-1);
              const registrations = nextEvent ? registrationsByEvent[nextEvent.id] ?? [] : [];
              const currentRegistration = nextEvent ? registrations.find((registration) => registration.userId === user?.uid) : undefined;
              const selfRemovalBlocked = !!nextEvent
                && !!currentRegistration
                && !canManageSessions
                && isCancellationPolicyActive({
                  eventDate: nextEvent.eventDate,
                  startAt: nextEvent.startAt,
                  cancellationPolicyHours: series.cancellationPolicyHours,
                });
              const playersForSeriesOwner = playerDirectory.filter((player) => {
                if (player.ownerOrganiserId && player.ownerOrganiserId !== series.organiserId) {
                  return false;
                }

                return true;
              });
              const visiblePlayersForSeries = profile?.role === "organiser"
                ? filterPlayersSelectableByOrganiserApproval(playersForSeriesOwner, approvedPlayerIdsForOrganiser)
                : playersForSeriesOwner;
              const capacityState = getRegistrationCapacityState({
                capacity: nextEvent?.capacity || series.capacity,
                waitingListCapacity: nextEvent?.waitingListCapacity ?? series.waitingListCapacity,
                bookedCount: nextEvent?.bookedCount || 0,
                waitingCount: nextEvent?.waitingCount || 0,
              });
              const waitingListCapacity = capacityState.waitingListCapacity;
              const waitingListCapacityLabel = formatWaitingListCapacity(waitingListCapacity);
              const bookedCount = capacityState.bookedCount;
              const waitingCount = capacityState.waitingCount;
              const eventIsFull = !!nextEvent && capacityState.eventIsFull;
              const waitingListIsFull = !!nextEvent && capacityState.waitingListIsFull;
              const playerIsGoing = currentRegistration?.status === "registered";
              const playerIsWaiting = currentRegistration?.status === "waiting";
              const playerCanJoin = !!nextEvent && capacityState.canAddMore;
              const eventEditDraft = nextEvent
                ? eventEditDrafts[nextEvent.id] || buildEventEditDraft(nextEvent)
                : null;

              const eventPresentation = getDashboardEventPresentation({
                role: profile?.role,
                playerIsGoing,
                playerIsWaiting,
                playerCanJoin,
                eventIsFull,
                waitingListIsFull,
              });

              const eventCardClass = eventPresentation.className;
              const eventStateText = eventPresentation.stateText;

              return (
                <article key={series.id} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200" data-testid={`series-card-${series.id}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700">{series.typeOfSport}</span>
                        {nextEvent ? <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700">{eventStateText}</span> : null}
                        {nextEvent?.locked ? <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700">locked</span> : null}
                      </div>
                      <h2 className="text-xl font-semibold">{series.title}</h2>
                      <p className="mt-2 text-sm text-zinc-600">
                        {nextEvent ? `${nextEvent.eventDate} · ${bookedCount}/${nextEvent.capacity} registered · ${waitingCount}/${waitingListCapacityLabel} waiting` : "No event created yet"}
                      </p>
                      <p className="mt-1 text-sm text-zinc-500">Organiser: {series.organiserName || "Organiser"}</p>
                    </div>
                    <div className="relative shrink-0" data-testid="series-actions-menu">
                      <button
                        type="button"
                        aria-expanded={openActionsSeriesId === series.id}
                        onClick={() => setOpenActionsSeriesId((current) => (current === series.id ? null : series.id))}
                        className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium hover:bg-zinc-100"
                      >
                        Actions
                      </button>
                      {openActionsSeriesId === series.id ? (
                        <div className="absolute right-0 z-10 mt-2 grid w-48 gap-1 rounded-2xl border border-zinc-200 bg-white p-2 text-sm shadow-lg">
                          {canManageSessions ? <button type="button" data-testid="series-create-next-event-button" onClick={() => { setOpenActionsSeriesId(null); void handleCreateNextEvent(series); }} disabled={busyKey === series.id} className="rounded-xl px-3 py-2 text-left hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60">Create next event</button> : null}
                          {canManageSessions && nextEvent ? (
                            <button type="button" data-testid="series-edit-event-button" onClick={() => handleEventEditStart(nextEvent)} className="rounded-xl px-3 py-2 text-left hover:bg-zinc-100">
                              Edit event
                            </button>
                          ) : null}
                          {canManageSessions && nextEvent && nextEvent.status !== "completed" && nextEvent.status !== "cancelled" ? (
                            <>
                              <button type="button" data-testid="series-mark-completed-button" onClick={() => { setOpenActionsSeriesId(null); void handleSetEventStatus(series, nextEvent, "completed"); }} disabled={busyKey === nextEvent.id} className="rounded-xl px-3 py-2 text-left hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60">Mark completed</button>
                              <button type="button" onClick={() => { setOpenActionsSeriesId(null); void handleSetEventStatus(series, nextEvent, "cancelled"); }} disabled={busyKey === nextEvent.id} className="rounded-xl px-3 py-2 text-left hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60">Mark cancelled</button>
                            </>
                          ) : null}
                          <Link href={`/sessions/view?id=${series.id}`} data-testid="series-view-events-link" onClick={() => setOpenActionsSeriesId(null)} className="rounded-xl px-3 py-2 hover:bg-zinc-100">View all events</Link>
                          {canManageSessions ? (
                            <Link href={`/sessions/edit?id=${series.id}`} data-testid="series-edit-link" onClick={() => setOpenActionsSeriesId(null)} className="rounded-xl px-3 py-2 hover:bg-zinc-100">Edit event series</Link>
                          ) : null}
                          {canManageSessions ? (
                            <button type="button" onClick={() => { setOpenActionsSeriesId(null); void handleDeleteSeries(series); }} disabled={busyKey === series.id} className="rounded-xl px-3 py-2 text-left font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60">Delete event series</button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <dl className="mt-4 grid gap-3 text-sm text-zinc-700 sm:grid-cols-2 xl:grid-cols-4">
                    <div><dt className="text-zinc-500">Day</dt><dd>{series.dayOfWeek}</dd></div>
                    <div><dt className="text-zinc-500">Date</dt><dd>{nextEvent?.eventDate || getEffectiveNextGameOn(series.dayOfWeek, series.startAt, series.nextGameOn)}</dd></div>
                    <div><dt className="text-zinc-500">Time</dt><dd>{nextEvent ? `${nextEvent.startAt} - ${nextEvent.endAt}` : `${series.startAt} - ${series.endAt}`}</dd></div>
                    <div><dt className="text-zinc-500">Location</dt><dd>{nextEvent?.location || series.location}</dd></div>
                    <div><dt className="text-zinc-500">Casual price</dt><dd>${nextEvent?.defaultPriceCasual ?? series.defaultPriceCasual}</dd></div>
                    <div><dt className="text-zinc-500">Capacity</dt><dd>{nextEvent?.capacity ?? series.capacity}</dd></div>
                    <div><dt className="text-zinc-500">Waiting list</dt><dd>{formatWaitingListCapacity(nextEvent?.waitingListCapacity ?? series.waitingListCapacity)}</dd></div>
                    <div><dt className="text-zinc-500">Cancellation policy</dt><dd>{getCancellationPolicyLabel(series.cancellationPolicyHours)}</dd></div>
                  </dl>

                  {/*
                  {showSeriesMembershipPanel ? (
                    <div className="mt-4 rounded-2xl border border-zinc-200 p-4" data-testid={`series-membership-panel-${series.id}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-zinc-500">Series membership</h3>
                          <p className="mt-1 text-sm text-zinc-600">
                            {series.seriesMembershipEnabled
                              ? "Recurring members are added first when the next event is created."
                              : "Membership is currently disabled for this series."}
                          </p>
                          {series.seriesMembershipEnabled ? (
                            <p className="mt-2 text-xs text-zinc-500">
                              Defaults: start {formatDateOnly(series.seriesMembershipDefaultStartDate || null) === "None" ? "uses approval date" : formatDateOnly(series.seriesMembershipDefaultStartDate || null)}
                              {" · "}end {formatDateOnly(series.seriesMembershipDefaultEndDate || null)}
                              {" · "}auto paid {formatDateOnly(series.seriesMembershipAutoPaidUntilDate || null)}
                            </p>
                          ) : null}
                        </div>
                        {profile?.role === "player" && currentSeriesMembership ? (
                          <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700" data-testid={`series-membership-status-${series.id}`}>
                            {currentSeriesMembership.status}
                          </span>
                        ) : null}
                      </div>

                      {profile?.role === "player" ? (
                        currentSeriesMembership ? (
                          <div className="mt-3 space-y-3">
                            <div className="text-sm text-zinc-700">
                              Total skips: {currentSeriesMembership.skipCount} · Recent 10 weeks: {currentSeriesMembership.recentTenWeekSkipCount || 0}
                            </div>
                            <div className="text-sm text-zinc-700">
                              Start: {currentMembershipStartDate ? formatDateOnly(currentMembershipStartDate) : "Pending approval"}
                              {" · "}End: {formatDateOnly(currentMembershipEndDate)}
                              {" · "}Auto paid: {formatDateOnly(currentMembershipAutoPaidUntilDate)}
                            </div>
                            {currentSeriesMembership.status === "pending" ? (
                              <div className="text-sm text-zinc-500">Your request is waiting for organiser approval.</div>
                            ) : null}
                            <div className="flex flex-wrap gap-2">
                              {currentSeriesMembership.status === "active" || currentSeriesMembership.status === "paused" ? (
                                <button
                                  type="button"
                                  onClick={() => void handleSeriesMembershipSkipToggle(currentSeriesMembership, !currentSeriesMembership.skipNextEvent)}
                                  disabled={busyKey === `skip-membership-${currentSeriesMembership.id}`}
                                  data-testid={`toggle-series-membership-skip-${currentSeriesMembership.id}`}
                                  className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {currentSeriesMembership.skipNextEvent ? "Undo next-event skip" : "Skip next event"}
                                </button>
                              ) : null}
                              {currentSeriesMembership.status === "active" ? (
                                <button
                                  type="button"
                                  onClick={() => void handleSeriesMembershipStatusChange(currentSeriesMembership, "paused")}
                                  disabled={busyKey === `paused-membership-${currentSeriesMembership.id}`}
                                  data-testid={`pause-series-membership-${currentSeriesMembership.id}`}
                                  className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Pause membership
                                </button>
                              ) : null}
                              {currentSeriesMembership.status === "paused" ? (
                                <button
                                  type="button"
                                  onClick={() => void handleSeriesMembershipStatusChange(currentSeriesMembership, "active")}
                                  disabled={busyKey === `active-membership-${currentSeriesMembership.id}`}
                                  data-testid={`resume-series-membership-${currentSeriesMembership.id}`}
                                  className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Resume membership
                                </button>
                              ) : null}
                              {currentSeriesMembership.status !== "cancelled" ? (
                                <button
                                  type="button"
                                  onClick={() => void handleSeriesMembershipStatusChange(currentSeriesMembership, "cancelled")}
                                  disabled={busyKey === `cancelled-membership-${currentSeriesMembership.id}`}
                                  data-testid={`cancel-series-membership-${currentSeriesMembership.id}`}
                                  className="rounded-full border border-red-300 px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Cancel membership
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <div className="mt-3 text-sm text-zinc-500">
                            {series.seriesMembershipEnabled
                              ? "Contact the organiser if you want to be added as a recurring member for future events in this series."
                              : "Recurring membership is currently disabled for this series."}
                          </div>
                        )
                      ) : null}

                      {(profile?.role === "organiser" || profile?.role === "admin") ? (
                        <div className="mt-4 space-y-3">
                          {seriesMemberships.length ? seriesMemberships.map((membership) => {
                            const membershipDraft = membershipDraftsById[membership.id] || buildMembershipDraft(membership);
                            const effectiveStartDate = getEffectiveMembershipStartDate(membership, series);
                            const effectiveEndDate = getEffectiveMembershipEndDate(membership, series);
                            const effectiveAutoPaidUntilDate = getEffectiveMembershipAutoPaidUntilDate(membership, series);

                            return (
                              <div key={membership.id} className="rounded-2xl border border-zinc-200 p-4" data-testid={`series-membership-card-${membership.id}`}>
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                  <div className="font-medium text-zinc-900">{membership.playerName}</div>
                                  <div className="text-sm text-zinc-500">{membership.playerEmail}</div>
                                  <div className="mt-1 text-xs text-zinc-500">
                                    Status: {membership.status} · Total skips: {membership.skipCount} · Recent 10 weeks: {membership.recentTenWeekSkipCount || 0}
                                  </div>
                                  <div className="mt-1 text-xs text-zinc-500">
                                    Start: {formatDateOnly(effectiveStartDate)}
                                    {" · "}End: {formatDateOnly(effectiveEndDate)}
                                    {" · "}Auto paid: {formatDateOnly(effectiveAutoPaidUntilDate)}
                                  </div>
                                  {membership.skipNextEvent ? (
                                    <div className="mt-1 text-xs font-medium text-amber-700">Will skip the next auto-registration.</div>
                                  ) : null}
                                </div>
                                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                                    <label className="block text-xs text-zinc-600">
                                      <span className="mb-1 block font-medium text-zinc-700">Member start override</span>
                                      <input
                                        type="date"
                                        value={membershipDraft.startDate}
                                        onChange={(event) => handleMembershipDraftChange(membership.id, "startDate", event.target.value)}
                                        className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                                      />
                                      <span className="mt-1 block text-[11px] text-zinc-500">Blank uses the series default start date, then approval date.</span>
                                    </label>
                                    <label className="block text-xs text-zinc-600">
                                      <span className="mb-1 block font-medium text-zinc-700">Member end override</span>
                                      <input
                                        type="date"
                                        value={membershipDraft.endDate}
                                        min={membershipDraft.startDate || undefined}
                                        onChange={(event) => handleMembershipDraftChange(membership.id, "endDate", event.target.value)}
                                        className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                                      />
                                      <span className="mt-1 block text-[11px] text-zinc-500">Blank means the membership stays active until cancelled.</span>
                                    </label>
                                    <label className="block text-xs text-zinc-600">
                                      <span className="mb-1 block font-medium text-zinc-700">Auto paid override</span>
                                      <input
                                        type="date"
                                        value={membershipDraft.autoPaidUntilDate}
                                        onChange={(event) => handleMembershipDraftChange(membership.id, "autoPaidUntilDate", event.target.value)}
                                        className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-zinc-500"
                                      />
                                      <span className="mt-1 block text-[11px] text-zinc-500">Blank uses the series default auto-paid date.</span>
                                    </label>
                                  </div>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void handleSeriesMembershipDetailsSave(membership)}
                                    disabled={busyKey === `save-membership-${membership.id}`}
                                    className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {busyKey === `save-membership-${membership.id}` ? "Saving..." : "Save details"}
                                  </button>
                                  {membership.status === "pending" ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => void handleSeriesMembershipStatusChange(membership, "active")}
                                        disabled={busyKey === `active-membership-${membership.id}`}
                                        data-testid={`approve-series-membership-${membership.id}`}
                                        className="rounded-full border border-emerald-300 px-4 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        Approve
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void handleSeriesMembershipStatusChange(membership, "rejected")}
                                        disabled={busyKey === `rejected-membership-${membership.id}`}
                                        data-testid={`reject-series-membership-${membership.id}`}
                                        className="rounded-full border border-red-300 px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        Reject
                                      </button>
                                    </>
                                  ) : null}
                                  {membership.status === "active" ? (
                                    <button
                                      type="button"
                                      onClick={() => void handleSeriesMembershipStatusChange(membership, "paused")}
                                      disabled={busyKey === `paused-membership-${membership.id}`}
                                      data-testid={`pause-series-membership-${membership.id}`}
                                      className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      Pause
                                    </button>
                                  ) : null}
                                  {membership.status === "paused" ? (
                                    <button
                                      type="button"
                                      onClick={() => void handleSeriesMembershipStatusChange(membership, "active")}
                                      disabled={busyKey === `active-membership-${membership.id}`}
                                      data-testid={`resume-series-membership-${membership.id}`}
                                      className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      Resume
                                    </button>
                                  ) : null}
                                  {membership.status !== "cancelled" ? (
                                    <button
                                      type="button"
                                      onClick={() => void handleSeriesMembershipStatusChange(membership, "cancelled")}
                                      disabled={busyKey === `cancelled-membership-${membership.id}`}
                                      data-testid={`cancel-series-membership-${membership.id}`}
                                      className="rounded-full border border-red-300 px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      Cancel
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          )}) : (
                            <div className="text-sm text-zinc-500">No members for this series yet.</div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  */}

                  {nextEvent && editingEventId === nextEvent.id && eventEditDraft ? (
                    <form
                      className="mt-4 rounded-2xl border border-zinc-200 p-4"
                      data-testid="dashboard-event-edit-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void handleEventEditSave(series, nextEvent);
                      }}
                    >
                      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-zinc-500">Edit event</h3>
                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        <label className="block text-sm text-zinc-700 md:col-span-3">
                          <span className="mb-1 block font-medium">Location</span>
                          <input value={eventEditDraft.location} onChange={(event) => handleEventEditDraftChange(nextEvent.id, "location", event.target.value)} className="w-full rounded-xl border border-zinc-300 px-3 py-2 outline-none transition focus:border-zinc-500" required />
                        </label>
                        <label className="block text-sm text-zinc-700">
                          <span className="mb-1 block font-medium">Start time</span>
                          <input type="time" value={eventEditDraft.startAt} onChange={(event) => handleEventEditDraftChange(nextEvent.id, "startAt", event.target.value)} className="w-full rounded-xl border border-zinc-300 px-3 py-2 outline-none transition focus:border-zinc-500" required />
                        </label>
                        <label className="block text-sm text-zinc-700">
                          <span className="mb-1 block font-medium">End time</span>
                          <input type="time" value={eventEditDraft.endAt} onChange={(event) => handleEventEditDraftChange(nextEvent.id, "endAt", event.target.value)} className="w-full rounded-xl border border-zinc-300 px-3 py-2 outline-none transition focus:border-zinc-500" required />
                        </label>
                        <label className="block text-sm text-zinc-700">
                          <span className="mb-1 block font-medium">Casual price</span>
                          <input type="number" min="0" step="0.01" value={eventEditDraft.defaultPriceCasual} onChange={(event) => handleEventEditDraftChange(nextEvent.id, "defaultPriceCasual", event.target.value)} className="w-full rounded-xl border border-zinc-300 px-3 py-2 outline-none transition focus:border-zinc-500" required />
                        </label>
                        <label className="block text-sm text-zinc-700">
                          <span className="mb-1 block font-medium">Capacity</span>
                          <input type="number" min="1" step="1" value={eventEditDraft.capacity} onChange={(event) => handleEventEditDraftChange(nextEvent.id, "capacity", event.target.value)} className="w-full rounded-xl border border-zinc-300 px-3 py-2 outline-none transition focus:border-zinc-500" required />
                        </label>
                        <label className="block text-sm text-zinc-700">
                          <span className="mb-1 block font-medium">Waiting list</span>
                          <input type="number" min="0" step="1" value={eventEditDraft.waitingListCapacity} onChange={(event) => handleEventEditDraftChange(nextEvent.id, "waitingListCapacity", event.target.value)} placeholder="Unlimited" className="w-full rounded-xl border border-zinc-300 px-3 py-2 outline-none transition focus:border-zinc-500" />
                          <span className="mt-1 block text-xs text-zinc-500">Blank or 0 means unlimited.</span>
                        </label>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button type="submit" disabled={busyKey === `edit-event-${nextEvent.id}`} className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60">
                          {busyKey === `edit-event-${nextEvent.id}` ? "Saving..." : "Save event"}
                        </button>
                        <button type="button" onClick={() => setEditingEventId(null)} className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium hover:bg-zinc-100">Cancel</button>
                      </div>
                    </form>
                  ) : null}

                  <div className={`mt-4 rounded-2xl p-4 ring-1 ${eventCardClass}`} data-testid="series-next-event-panel">
                    {/*
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-zinc-500">Next event</h3>
                        <p className="mt-1 text-sm text-zinc-700">{nextEvent ? `${nextEvent.eventDate} • ${bookedCount}/${nextEvent.capacity} registered • ${waitingCount}/${waitingListCapacity} waiting` : "No event created yet"}</p>
                        {nextEvent ? <p className="mt-1 text-xs text-zinc-500">Status: {nextEvent.status || "active"}{nextEvent.locked ? " • locked" : ""}</p> : null}
                        {nextEvent ? <p className="mt-1 text-sm text-zinc-500">Organiser: {nextEvent.organiserName || series.organiserName || "Organiser"}</p> : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-zinc-700">{eventStateText}</span>
                        {canManageSessions && nextEvent && nextEvent.status !== "completed" && nextEvent.status !== "cancelled" ? (
                          <>
                            <button type="button" data-testid="series-mark-completed-button" onClick={() => handleSetEventStatus(series, nextEvent, "completed")} disabled={busyKey === nextEvent.id} className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-medium hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60">Mark completed</button>
                            <button type="button" onClick={() => handleSetEventStatus(series, nextEvent, "cancelled")} disabled={busyKey === nextEvent.id} className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-medium hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60">Mark cancelled</button>
                          </>
                        ) : null}
                        {canManageSessions && !nextEventIsOpen ? <button type="button" data-testid="series-create-next-event-button" onClick={() => handleCreateNextEvent(series)} disabled={busyKey === series.id} className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-medium hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60">Create next event</button> : null}
                      </div>
                    </div>

                    {nextEvent ? (
                      <>
                        <dl className="mt-4 grid gap-3 text-sm text-zinc-700 sm:grid-cols-2 xl:grid-cols-4">
                          <div><dt className="text-zinc-500">Event location</dt><dd>{nextEvent.location}</dd></div>
                          <div><dt className="text-zinc-500">Event time</dt><dd>{nextEvent.startAt} - {nextEvent.endAt}</dd></div>
                          <div><dt className="text-zinc-500">Event casual price</dt><dd>${nextEvent.defaultPriceCasual}</dd></div>
                          <div><dt className="text-zinc-500">Event waiting list</dt><dd>{nextEvent.waitingListCapacity ?? 0}</dd></div>
                        </dl>
                        */}
                    {nextEvent ? (
                      <>
                        <div className="flex items-center justify-between gap-3">
                          <h4 className="text-sm font-semibold uppercase tracking-[0.15em] text-zinc-500">Registrations for {nextEvent.eventDate}</h4>
                          {!canManageSessions ? (
                            currentRegistration ? (
                              <div className="flex flex-col items-start gap-2">
                                <button type="button" data-testid="series-self-remove-button" onClick={() => handleRemoveRegistration(currentRegistration, series, nextEvent)} disabled={busyKey === currentRegistration.id} className="rounded-full border border-red-300 bg-white px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60">{selfRemovalBlocked ? "Contact organiser to cancel" : "Leave event"}</button>
                                {selfRemovalBlocked ? <div className="text-xs text-amber-700">{getPlayerCancellationPolicyMessage(series.cancellationPolicyHours)}</div> : null}
                              </div>
                            ) : (
                              <button type="button" data-testid="series-register-button" onClick={() => handleRegister(series, nextEvent)} disabled={busyKey === nextEvent.id || !playerCanJoin} className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60">{eventIsFull ? "Join waiting list" : "Register"}</button>
                            )
                          ) : null}
                        </div>

                        {canManageSessions ? (
                          <div className="mt-2 space-y-1">
                            <SearchablePlayerSelect
                              players={visiblePlayersForSeries}
                              allowCreate={false}
                              noOptionsText="No players available. Use Manage players to add players first."
                              disabled={busyKey === nextEvent.id || !playerCanJoin || !!nextEvent.locked}
                              onSelectOrCreate={async (selection) => {
                                if (selection.type === "create") return;
                                await handleSelectOrCreatePlayer(series, nextEvent, selection);
                              }}
                            />
                          </div>
                        ) : null}

                        <div className="mt-2 space-y-1">
                            {registrations.length ? (
                              registrations.map((registration) => {
                                const isOwnRegistration = registration.userId === user?.uid;
                                const playerRecord = visiblePlayersForSeries.find((player) => (player.userId || player.id) === registration.userId);
                                const isWaiting = registration.status === "waiting";
                                return (
                                  <EventRegistrationRow
                                    key={registration.id}
                                    registration={registration}
                                    isOwnRegistration={isOwnRegistration}
                                    skillLevel={canManageSessions ? playerRecord?.skillLevel || "Not set" : null}
                                  >
                                    {isOwnRegistration && !isWaiting && !canManageSessions ? (
                                      registration.paymentReference && editingReferenceId !== registration.id ? (
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span>Ref: <span className="font-medium text-zinc-700">{registration.paymentReference}</span></span>
                                          <button type="button" onClick={() => { setEditingReferenceId(registration.id); setPaymentReferenceInputs((c) => ({ ...c, [registration.id]: registration.paymentReference || "" })); }} className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100">Edit ref</button>
                                          <button type="button" onClick={() => handlePaymentReferenceSubmit(registration, "", series, nextEvent)} disabled={busyKey === nextEvent.id} className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60">Clear ref</button>
                                        </div>
                                      ) : (
                                        <div className="flex flex-wrap items-center gap-2">
                                          <input
                                            type="text"
                                            value={paymentReferenceInputs[registration.id] ?? ""}
                                            onChange={(e) => setPaymentReferenceInputs((c) => ({ ...c, [registration.id]: e.target.value }))}
                                            placeholder="Payment ref"
                                            className="rounded-full border border-zinc-300 px-3 py-1 text-xs outline-none focus:border-zinc-500"
                                          />
                                          <button type="button" onClick={() => handlePaymentReferenceSubmit(registration, paymentReferenceInputs[registration.id] ?? "", series, nextEvent)} disabled={busyKey === nextEvent.id || !(paymentReferenceInputs[registration.id] ?? "").trim()} className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60">Submit ref</button>
                                          {editingReferenceId === registration.id ? <button type="button" onClick={() => setEditingReferenceId(null)} className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100">Cancel</button> : null}
                                        </div>
                                      )
                                    ) : null}
                                    {canManageSessions || isOwnRegistration ? (
                                      <div className="flex flex-wrap items-center gap-2">
                                        {canManageSessions && !isWaiting ? <button type="button" onClick={() => handleOrganiserPaidToggle(registration, !registration.organiserPaid, series, nextEvent)} disabled={busyKey === nextEvent.id} className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60">{registration.organiserPaid ? "Undo confirm" : "Confirm"}</button> : null}
                                        <button type="button" onClick={() => handleRemoveRegistration(registration, series, nextEvent)} disabled={busyKey === registration.id} className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60">{isOwnRegistration && !canManageSessions && selfRemovalBlocked ? "Contact organiser" : isOwnRegistration && !canManageSessions ? "Leave event" : "Remove"}</button>
                                      </div>
                                    ) : null}
                                  </EventRegistrationRow>
                                );
                              })
                          ) : <div className="text-sm text-zinc-500">No players registered yet.</div>}
                        </div>
                      </>
                    ) : null}
                  </div>
                </article>
              );
            })
          ) : (
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">No event series yet. Use <strong>New event series</strong> to add the first one.</div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
