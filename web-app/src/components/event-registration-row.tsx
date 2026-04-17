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
  return registration.organiserPaid ? "OK" : "Check";
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
      className={`rounded-xl bg-white p-3 ring-1 ${isOwnRegistration ? "bg-blue-50/30 ring-blue-300" : "ring-zinc-200"}`}
    >
      <summary className="list-none cursor-pointer [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
            {registration.playerName}
            {isOwnRegistration ? " (you)" : ""}
          </div>
          <div className="flex shrink-0 items-center gap-1 text-[11px]">
            {isWaiting ? (
              <span className="rounded-full bg-amber-100 px-2 py-1 font-medium text-amber-700">Wait</span>
            ) : null}
            <span className={`rounded-full px-2 py-1 font-medium ${registration.playerPaid ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>
              {getPaymentSummaryLabel(registration)}
            </span>
            <span className={`rounded-full px-2 py-1 font-medium ${registration.organiserPaid ? "bg-blue-100 text-blue-700" : "bg-zinc-100 text-zinc-600"}`}>
              {getConfirmationSummaryLabel(registration)}
            </span>
            <span className="text-sm text-zinc-400" aria-hidden="true">▾</span>
          </div>
        </div>
      </summary>

      <div className="mt-3 space-y-2 border-t border-zinc-200 pt-3 text-xs text-zinc-500">
        <div>Email: {registration.playerEmail || "Manually added player"}</div>
        <div>Status: {isWaiting ? "Waiting list" : "Registered"}</div>
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
