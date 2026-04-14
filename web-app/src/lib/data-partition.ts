export type DataPartition = "test" | "live";

export function normalizePartitionEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isExampleEmail(email: string) {
  return normalizePartitionEmail(email).endsWith("@example.com");
}

export function getDataPartitionForEmail(email: string): DataPartition {
  return isExampleEmail(email) ? "test" : "live";
}

export function shouldBypassEmailVerification(email: string) {
  return isExampleEmail(email);
}

export function resolveDataPartition(email?: string | null, fallback: DataPartition = "live"): DataPartition {
  const normalized = normalizePartitionEmail(email || "");
  return normalized ? getDataPartitionForEmail(normalized) : fallback;
}
