"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import AppShell from "@/components/app-shell";
import { auth, db } from "@/lib/firebase";
import {
  countUnreadNotifications,
  formatNotificationTime,
  normalizeNotificationEvent,
  sortNotificationEvents,
  type NotificationEvent,
} from "@/lib/notification-events";
import type { AppRole } from "@/lib/roles";

type ProfileData = {
  role?: AppRole;
};

export default function NotificationsPage() {
  const router = useRouter();
  const [profileRole, setProfileRole] = useState<AppRole>("player");
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let unsubscribeEvents: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      unsubscribeEvents?.();
      unsubscribeEvents = null;
      setEvents([]);
      setError("");

      if (!currentUser) {
        router.push("/login");
        return;
      }

      try {
        const profileSnapshot = await getDoc(doc(db, "users", currentUser.uid));
        const profile = profileSnapshot.exists()
          ? profileSnapshot.data() as ProfileData
          : null;
        setProfileRole(profile?.role ?? "player");

        const eventsQuery = query(
          collection(db, "notificationEvents"),
          where("recipientUserId", "==", currentUser.uid),
        );
        unsubscribeEvents = onSnapshot(
          eventsQuery,
          (snapshot) => {
            setEvents(sortNotificationEvents(snapshot.docs.map((eventDoc) =>
              normalizeNotificationEvent(eventDoc.id, eventDoc.data()),
            )));
            setLoading(false);
          },
          (snapshotError) => {
            console.error("[notifications] listen failed:", snapshotError);
            setError("Unable to load notifications.");
            setLoading(false);
          },
        );
      } catch (loadError) {
        console.error("[notifications] profile load failed:", loadError);
        setError("Unable to load notifications.");
        setLoading(false);
      }
    });

    return () => {
      unsubscribeEvents?.();
      unsubscribeAuth();
    };
  }, [router]);

  const unreadCount = useMemo(() => countUnreadNotifications(events), [events]);

  async function markEventRead(event: NotificationEvent) {
    if (event.readAt || busy) {
      return;
    }

    setBusy(true);
    setError("");
    try {
      await updateDoc(doc(db, "notificationEvents", event.id), {
        readAt: serverTimestamp(),
      });
    } catch (markError) {
      console.error("[notifications] mark read failed:", markError);
      setError("Unable to mark notification as read.");
    } finally {
      setBusy(false);
    }
  }

  async function markAllRead() {
    const unreadEvents = events.filter((event) => !event.readAt);
    if (unreadEvents.length === 0 || busy) {
      return;
    }

    setBusy(true);
    setError("");
    try {
      const batch = writeBatch(db);
      unreadEvents.forEach((event) => {
        batch.update(doc(db, "notificationEvents", event.id), {
          readAt: serverTimestamp(),
        });
      });
      await batch.commit();
    } catch (markError) {
      console.error("[notifications] mark all read failed:", markError);
      setError("Unable to mark notifications as read.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell role={profileRole} contentClassName="max-w-4xl">
      <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Notifications</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">Notification inbox</h1>
            <p className="mt-2 text-sm text-zinc-600">
              {unreadCount > 0
                ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
                : "Everything here has been read."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void markAllRead()}
            disabled={busy || unreadCount === 0}
            className="rounded-2xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Mark all read
          </button>
        </div>

        {error ? (
          <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <div className="mt-6 divide-y divide-zinc-200" data-testid="notifications-list">
          {loading ? (
            <div className="py-10 text-sm text-zinc-600">Loading notifications...</div>
          ) : events.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-600">
              No notifications yet.
            </div>
          ) : (
            events.map((event) => {
              const unread = !event.readAt;
              return (
                <article
                  key={event.id}
                  className={`flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between ${
                    unread ? "bg-amber-50/60 px-3" : ""
                  }`}
                  data-testid="notification-row"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-zinc-950">{event.title}</h2>
                      {unread ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                          Unread
                        </span>
                      ) : null}
                    </div>
                    {event.body ? (
                      <p className="mt-1 text-sm leading-6 text-zinc-700">{event.body}</p>
                    ) : null}
                    <p className="mt-2 text-xs text-zinc-500">
                      {formatNotificationTime(event.createdAt) || "Time unavailable"}
                    </p>
                  </div>
                  {unread ? (
                    <button
                      type="button"
                      onClick={() => void markEventRead(event)}
                      disabled={busy}
                      className="rounded-2xl border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Mark read
                    </button>
                  ) : null}
                </article>
              );
            })
          )}
        </div>
      </section>
    </AppShell>
  );
}
