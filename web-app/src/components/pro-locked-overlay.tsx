import Link from "next/link";
import type { PremiumFeatureKey } from "@/lib/subscription";

const FEATURE_LABELS: Record<PremiumFeatureKey, string> = {
  inAppPayments: "In-app payments",
  accounting: "Accounting",
  pushNotifications: "Mobile push notifications",
};

type ProLockedOverlayProps = {
  feature: PremiumFeatureKey;
  compact?: boolean;
};

export default function ProLockedOverlay({ feature, compact = false }: ProLockedOverlayProps) {
  return (
    <div className={`rounded-2xl border border-amber-200 bg-amber-50 ${compact ? "p-4" : "p-6"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-800">
            Pro
          </div>
          <h2 className={`${compact ? "mt-2 text-base" : "mt-3 text-xl"} font-semibold text-zinc-950`}>
            {FEATURE_LABELS[feature]}
          </h2>
          <p className="mt-1 text-sm text-amber-900">
            Upgrade to Pro to unlock this organiser feature.
          </p>
        </div>
        <Link
          href="/organiser/subscription"
          className="inline-flex items-center justify-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          View Pro
        </Link>
      </div>
    </div>
  );
}
