"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import AppShell from "@/components/app-shell";
import { auth, db } from "@/lib/firebase";
import {
  getOrganiserApprovalRequests,
  updateOrganiserApprovalStatus,
  type OrganiserApprovalRecord,
} from "@/lib/organiser-approvals";
import { resolveDataPartition, type DataPartition } from "@/lib/data-partition";

type UserProfile = {
  displayName?: string;
  email?: string;
  role: "player" | "organiser" | "admin";
  dataPartition?: DataPartition;
};

export default function OrganiserApprovalsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [organiserName, setOrganiserName] = useState("");
  const [organiserId, setOrganiserId] = useState("");
  const [dataPartition, setDataPartition] = useState<DataPartition>("live");
  const [approvalRequests, setApprovalRequests] = useState<OrganiserApprovalRecord[]>([]);

  async function loadApprovalRequests(nextOrganiserId: string, nextPartition: DataPartition) {
    const approvals = await getOrganiserApprovalRequests(db, nextOrganiserId, nextPartition);
    setApprovalRequests(
      approvals.sort((a, b) => {
        if (a.status === "pending" && b.status !== "pending") return -1;
        if (a.status !== "pending" && b.status === "pending") return 1;
        return a.playerName.localeCompare(b.playerName);
      }),
    );
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        if (!user) {
          router.push("/login");
          return;
        }

        const snapshot = await getDoc(doc(db, "users", user.uid));
        const profile = snapshot.data() as UserProfile | undefined;
        if (!profile || profile.role !== "organiser") {
          router.push("/dashboard");
          return;
        }

        const nextPartition = resolveDataPartition(profile.email || user.email || "", profile.dataPartition || "live");
        setOrganiserName(profile.displayName || user.email || "Organiser");
        setOrganiserId(user.uid);
        setDataPartition(nextPartition);
        await loadApprovalRequests(user.uid, nextPartition);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load approval requests.");
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [router]);

  async function handleApprovalDecision(
    approval: OrganiserApprovalRecord,
    status: "approved" | "rejected",
  ) {
    setBusyKey(`${status}-approval-${approval.id}`);
    setError("");

    try {
      await updateOrganiserApprovalStatus(db, approval.id, status);
      await loadApprovalRequests(organiserId, dataPartition);
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "Failed to update approval.");
    } finally {
      setBusyKey(null);
    }
  }

  const pendingRequests = useMemo(
    () => approvalRequests.filter((approval) => approval.status === "pending"),
    [approvalRequests],
  );
  const decidedRequests = useMemo(
    () => approvalRequests.filter((approval) => approval.status !== "pending"),
    [approvalRequests],
  );

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-900">
        <div className="mx-auto max-w-4xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200">
          Loading approval requests...
        </div>
      </main>
    );
  }

  return (
    <AppShell role="organiser" contentClassName="max-w-5xl">
      <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200" data-testid="organiser-approvals-page">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Organiser approvals</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Player approval requests</h1>
        <p className="mt-3 text-zinc-600">
          Review player access separately from the dashboard so your event operations stay focused.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm text-zinc-600">
          <span className="rounded-full bg-zinc-100 px-4 py-2 font-medium text-zinc-700">
            Organiser: {organiserName}
          </span>
          <span className="rounded-full bg-amber-100 px-4 py-2 font-medium text-amber-800">
            Pending: {pendingRequests.length}
          </span>
          <span className="rounded-full bg-zinc-100 px-4 py-2 font-medium text-zinc-700">
            Reviewed: {decidedRequests.length}
          </span>
        </div>
        {error ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
      </div>

      <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200" data-testid="organiser-approval-requests">
        <h2 className="text-xl font-semibold">Pending requests</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Approve players before they can view or register for your events.
        </p>
        <div className="mt-4 space-y-3">
          {pendingRequests.length ? pendingRequests.map((approval) => (
            <div key={approval.id} className="rounded-2xl border border-zinc-200 p-4" data-testid={`organiser-approval-request-${approval.id}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium text-zinc-900">{approval.playerName}</div>
                  <div className="text-sm text-zinc-500">{approval.playerEmail}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleApprovalDecision(approval, "approved")}
                    disabled={busyKey === `approved-approval-${approval.id}`}
                    data-testid={`approve-organiser-approval-${approval.id}`}
                    className="rounded-full border border-emerald-300 px-4 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busyKey === `approved-approval-${approval.id}` ? "Approving..." : "Approve"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleApprovalDecision(approval, "rejected")}
                    disabled={busyKey === `rejected-approval-${approval.id}`}
                    data-testid={`reject-organiser-approval-${approval.id}`}
                    className="rounded-full border border-red-300 px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busyKey === `rejected-approval-${approval.id}` ? "Rejecting..." : "Reject"}
                  </button>
                </div>
              </div>
            </div>
          )) : (
            <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-500">
              No pending approval requests right now.
            </div>
          )}
        </div>
      </div>

      <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-zinc-200" data-testid="organiser-reviewed-approvals">
        <h2 className="text-xl font-semibold">Recently reviewed</h2>
        <p className="mt-2 text-sm text-zinc-600">
          This is a quick history of the decisions you have already made.
        </p>
        <div className="mt-4 space-y-3">
          {decidedRequests.length ? decidedRequests.map((approval) => (
            <div key={approval.id} className="rounded-2xl border border-zinc-200 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium text-zinc-900">{approval.playerName}</div>
                  <div className="text-sm text-zinc-500">{approval.playerEmail}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-4 py-2 text-xs font-medium ${
                      approval.status === "approved"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {approval.status === "approved" ? "Approved" : "Rejected"}
                  </span>
                  {approval.status === "approved" ? (
                    <button
                      type="button"
                      onClick={() => void handleApprovalDecision(approval, "rejected")}
                      disabled={busyKey === `rejected-approval-${approval.id}`}
                      data-testid={`remove-organiser-approval-${approval.id}`}
                      className="rounded-full border border-red-300 px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busyKey === `rejected-approval-${approval.id}` ? "Removing..." : "Remove"}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          )) : (
            <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-500">
              No reviewed approvals yet.
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
