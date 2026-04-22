export type AlertTone = "success" | "warning" | "error" | "neutral";

export const SUCCESS_ALERT_CLASS_NAME =
  "rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800";

export const WARNING_ALERT_CLASS_NAME =
  "rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900";

export const ERROR_ALERT_CLASS_NAME =
  "rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700";

export const NEUTRAL_ALERT_CLASS_NAME =
  "rounded-2xl border border-zinc-200 bg-zinc-100 px-4 py-3 text-sm text-zinc-700";

export function getAlertClassName(tone: AlertTone) {
  switch (tone) {
    case "success":
      return SUCCESS_ALERT_CLASS_NAME;
    case "warning":
      return WARNING_ALERT_CLASS_NAME;
    case "error":
      return ERROR_ALERT_CLASS_NAME;
    default:
      return NEUTRAL_ALERT_CLASS_NAME;
  }
}
