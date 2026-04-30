"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import AppShell from "@/components/app-shell";
import { auth, db } from "@/lib/firebase";
import { resolveDataPartition, type DataPartition } from "@/lib/data-partition";
import type { AppRole } from "@/lib/roles";
import {
  attachFeedbackVotes,
  createFeedback,
  getFeedback,
  getFeedbackSectionDate,
  getFeedbackVotes,
  setFeedbackVote,
  sortFeedbackSection,
  updateFeedbackStatus,
  type FeedbackSectionSort,
  type FeedbackStatus,
  type FeedbackVoteValue,
  type FeedbackWithVotes,
} from "@/lib/feedback";

type UserProfile = {
  displayName?: string;
  email?: string;
  role: AppRole;
  dataPartition?: DataPartition;
};

const SECTION_LABELS: Record<FeedbackStatus, string> = {
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
};

const SECTION_DATE_LABELS: Record<FeedbackStatus, string> = {
  active: "Created",
  completed: "Completed",
  cancelled: "Cancelled",
};

function formatDate(value: ReturnType<typeof getFeedbackSectionDate>) {
  if (!value) return "Not dated";
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(value.toDate());
}

export default function FeedbackPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedbackItems, setFeedbackItems] = useState<FeedbackWithVotes[]>([]);
  const [feedbackBody, setFeedbackBody] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [sorts, setSorts] = useState<Record<FeedbackStatus, FeedbackSectionSort>>({
    active: "date",
    completed: "date",
    cancelled: "date",
  });

  async function loadFeedback(currentUser: User, currentProfile: UserProfile) {
    const dataPartition = currentProfile.dataPartition || "live";
    const [items, votes] = await Promise.all([
      getFeedback(db, dataPartition),
      getFeedbackVotes(db, dataPartition),
    ]);
    setFeedbackItems(attachFeedbackVotes(items, votes, currentUser.uid));
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      try {
        setError("");
        if (!currentUser) {
          router.push("/login");
          return;
        }

        const profileSnapshot = await getDoc(doc(db, "users", currentUser.uid));
        const profileData = profileSnapshot.data() as UserProfile | undefined;
        if (!profileData) {
          router.push("/dashboard");
          return;
        }

        const nextProfile = {
          ...profileData,
          dataPartition: resolveDataPartition(profileData.email || currentUser.email || "", profileData.dataPartition || "live"),
        };
        setUser(currentUser);
        setProfile(nextProfile);
        await loadFeedback(currentUser, nextProfile);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load feedback.");
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [router]);

  const sections = useMemo(() => {
    return (["active", "completed", "cancelled"] as FeedbackStatus[]).map((status) => ({
      status,
      items: sortFeedbackSection(
        feedbackItems.filter((item) => item.status === status),
        sorts[status],
      ),
    }));
  }, [feedbackItems, sorts]);

  async function handleCreateFeedback() {
    if (!user || !profile || !feedbackBody.trim()) return;
    setBusyKey("create-feedback");
    setError("");
    try {
      await createFeedback(db, {
        body: feedbackBody,
        authorId: user.uid,
        authorName: profile.displayName || user.email || "User",
        authorEmail: profile.email || user.email || "",
        authorRole: profile.role,
        dataPartition: profile.dataPartition || "live",
      });
      setFeedbackBody("");
      await loadFeedback(user, profile);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to add feedback.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleVote(feedbackId: string, value: FeedbackVoteValue) {
    if (!user || !profile) return;
    setBusyKey(`vote-${feedbackId}-${value}`);
    setError("");
    try {
      await setFeedbackVote(db, {
        feedbackId,
        userId: user.uid,
        value,
        dataPartition: profile.dataPartition || "live",
      });
      await loadFeedback(user, profile);
    } catch (voteError) {
      setError(voteError instanceof Error ? voteError.message : "Failed to save vote.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleStatus(feedbackId: string, status: Exclude<FeedbackStatus, "active">) {
    if (!user || !profile || profile.role !== "admin") return;
    setBusyKey(`${status}-${feedbackId}`);
    setError("");
    try {
      await updateFeedbackStatus(db, feedbackId, status);
      await loadFeedback(user, profile);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Failed to update feedback.");
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
        <div className="mx-auto max-w-4xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          Loading feedback...
        </div>
      </main>
    );
  }

  return (
    <AppShell role={profile?.role ?? "player"} contentClassName="max-w-5xl">
      <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200" data-testid="feedback-page">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Feedback</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Site feedback</h1>
        <div className="mt-5 space-y-3">
          <textarea
            value={feedbackBody}
            onChange={(event) => setFeedbackBody(event.target.value)}
            placeholder="Share feedback about the site."
            rows={4}
            className="min-h-28 w-full rounded-2xl border border-zinc-300 px-4 py-3 outline-none transition placeholder:text-zinc-400 focus:border-zinc-500"
          />
          <button
            type="button"
            onClick={() => void handleCreateFeedback()}
            disabled={!feedbackBody.trim() || busyKey === "create-feedback"}
            className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busyKey === "create-feedback" ? "Adding..." : "Add feedback"}
          </button>
        </div>
        {error ? (
          <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
      </div>

      {sections.map(({ status, items }) => (
        <section key={status} className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200" data-testid={`feedback-section-${status}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">{SECTION_LABELS[status]}</h2>
              <p className="mt-1 text-sm text-zinc-600">{items.length} item{items.length === 1 ? "" : "s"}</p>
            </div>
            <label className="text-sm text-zinc-600">
              <span className="mr-2 font-medium text-zinc-700">Order by</span>
              <select
                value={sorts[status]}
                onChange={(event) => setSorts((current) => ({
                  ...current,
                  [status]: event.target.value as FeedbackSectionSort,
                }))}
                className="rounded-full border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500"
              >
                <option value="date">{SECTION_DATE_LABELS[status]} date</option>
                <option value="upvotes">Upvotes</option>
                <option value="downvotes">Downvotes</option>
                <option value="netVotes">Net votes</option>
                <option value="author">Author</option>
              </select>
            </label>
          </div>

          <div className="mt-5 space-y-3">
            {items.length ? items.map((item) => (
              <article key={item.id} className="rounded-2xl border border-zinc-200 p-4" data-testid={`feedback-item-${item.id}`}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-800">{item.body}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-500">
                      <span>{item.authorName}</span>
                      <span>{item.authorRole}</span>
                      <span>{SECTION_DATE_LABELS[status]}: {formatDate(getFeedbackSectionDate(item))}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleVote(item.id, 1)}
                      disabled={busyKey === `vote-${item.id}-1`}
                      className={`rounded-full border px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${
                        item.currentUserVote === 1
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-zinc-300 text-zinc-700 hover:bg-zinc-100"
                      }`}
                    >
                      Upvote {item.upvotes}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleVote(item.id, -1)}
                      disabled={busyKey === `vote-${item.id}--1`}
                      className={`rounded-full border px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${
                        item.currentUserVote === -1
                          ? "border-red-300 bg-red-50 text-red-700"
                          : "border-zinc-300 text-zinc-700 hover:bg-zinc-100"
                      }`}
                    >
                      Downvote {item.downvotes}
                    </button>
                    {profile?.role === "admin" && status === "active" ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleStatus(item.id, "completed")}
                          disabled={busyKey === `completed-${item.id}`}
                          className="rounded-full border border-emerald-300 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Complete
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleStatus(item.id, "cancelled")}
                          disabled={busyKey === `cancelled-${item.id}`}
                          className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Cancel
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </article>
            )) : (
              <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-500">
                No {SECTION_LABELS[status].toLowerCase()} feedback yet.
              </div>
            )}
          </div>
        </section>
      ))}
    </AppShell>
  );
}
