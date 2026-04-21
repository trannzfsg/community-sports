import type { ReactNode } from "react";
import type { RegistrationItem } from "@/lib/session-series";

type EventRegistrationRowProps = {
  registration: RegistrationItem;
  isOwnRegistration?: boolean;
  skillLevel?: string | null;
  children?: ReactNode;
};

function getPaymentSummaryLabel(registration: RegistrationItem) {
  return registration.playerPaid ? "Paid" : "Due";
}

function getConfirmationSummaryLabel(registration: RegistrationItem) {
  return registration.organiserPaid ? "Received" : "Check";
}

function getConfirmationStatusLabel(registration: RegistrationItem) {
  return registration.organiserPaid ? "Confirmed" : "Not confirmed";
}

function getRegistrationSourceLabel(registration: RegistrationItem) {
  if (registration.source === "series-membership") return "Series member";
  if (registration.source === "roster-copy") return "Roster copy";
  if (registration.source === "organiser") return "Organiser added";
  if (registration.source === "self") return "Self registered";
  return null;
}

export default function EventRegistrationRow({
  registration,
  isOwnRegistration = false,
  skillLevel,
  children,
}: EventRegistrationRowProps) {
  const isWaiting = registration.status === "waiting";

  return (
    <details
      className={`rounded-lg bg-white px-2 py-1.5 ring-1 ${isOwnRegistration ? "bg-blue-50/30 ring-blue-300" : "ring-zinc-200"}`}
    >
      <summary className="list-none cursor-pointer [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1 truncate text-[13px] font-medium leading-none text-zinc-900">
            {registration.playerName}
            {isOwnRegistration ? " (you)" : ""}
          </div>
          <div className="flex shrink-0 items-center gap-1 text-[10px] leading-none">
            {isWaiting ? (
              <span className="rounded-full bg-amber-100 px-1.5 py-1 font-medium text-amber-700">Wait</span>
            ) : null}
            <span className={`rounded-full px-1.5 py-1 font-medium ${registration.playerPaid ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>
              {getPaymentSummaryLabel(registration)}
            </span>
            <span className={`rounded-full px-1.5 py-1 font-medium ${registration.organiserPaid ? "bg-blue-100 text-blue-700" : "bg-zinc-100 text-zinc-600"}`}>
              {getConfirmationSummaryLabel(registration)}
            </span>
            <span className="text-[10px] text-zinc-400" aria-hidden="true">▾</span>
          </div>
        </div>
      </summary>

      <div className="mt-2 space-y-1 border-t border-zinc-200 pt-2 text-[11px] text-zinc-500">
        <div>Email: {registration.playerEmail || "Manually added player"}</div>
        <div>Status: {isWaiting ? "Waiting list" : "Registered"}</div>
        {!isWaiting ? <div>Confirmation: {getConfirmationStatusLabel(registration)}</div> : null}
        {getRegistrationSourceLabel(registration) ? (
          <div>Source: {getRegistrationSourceLabel(registration)}</div>
        ) : null}
        {skillLevel ? <div>Skill level: {skillLevel}</div> : null}
        {registration.paymentReference ? (
          <div>
            Payment ref: <span className="font-medium text-zinc-700">{registration.paymentReference}</span>
          </div>
        ) : null}
        {children}
      </div>
    </details>
  );
}
