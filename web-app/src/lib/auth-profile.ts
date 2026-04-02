import type { AppRole } from "@/lib/roles";
import type { ManagedUserRecord } from "@/lib/managed-users";

type ExistingProfile = {
  displayName?: string;
  email?: string;
  role?: AppRole;
};

export function resolveAuthProfile(input: {
  fallbackDisplayName?: string;
  authDisplayName?: string | null;
  authEmail?: string | null;
  existing?: ExistingProfile;
  managedUser?: ManagedUserRecord | null;
}) {
  const email = input.authEmail || input.existing?.email || "";
  const displayName = (
    input.fallbackDisplayName
    || input.authDisplayName
    || input.existing?.displayName
    || input.managedUser?.displayName
    || input.authEmail
    || "Player"
  ).trim();

  const role: AppRole = input.managedUser?.role || input.existing?.role || "player";
  const status = input.managedUser?.status || "active";

  return { email, displayName, role, status };
}
