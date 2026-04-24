"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppRole } from "@/lib/roles";

type AppShellProps = {
  role: AppRole;
  children: ReactNode;
  contentClassName?: string;
};

type NavigationItem = {
  href: string;
  label: string;
  shortLabel: string;
  matchPrefixes?: string[];
};

const DESKTOP_NAV_STATE_KEY = "community-sports.desktop-nav-collapsed";

function toTestIdSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function getNavigationItems(role: AppRole): NavigationItem[] {
  if (role === "admin") {
    return [
      { href: "/dashboard", label: "Dashboard", shortLabel: "Da", matchPrefixes: ["/dashboard", "/sessions/view"] },
      { href: "/admin/organisers", label: "Organisers", shortLabel: "Or" },
      { href: "/admin/players", label: "Players", shortLabel: "Pl" },
      { href: "/profile", label: "Profile", shortLabel: "Pr" },
    ];
  }

  if (role === "organiser") {
    return [
      { href: "/dashboard", label: "Dashboard", shortLabel: "Da", matchPrefixes: ["/dashboard", "/sessions/view"] },
      { href: "/organiser/approvals", label: "Approvals", shortLabel: "Ap" },
      { href: "/organiser/players", label: "Players", shortLabel: "Pl" },
      { href: "/onboarding", label: "Onboarding", shortLabel: "On" },
      { href: "/profile", label: "Profile", shortLabel: "Pr" },
    ];
  }

  return [
    { href: "/dashboard", label: "Dashboard", shortLabel: "Da", matchPrefixes: ["/dashboard", "/sessions/view"] },
    { href: "/onboarding", label: "Onboarding", shortLabel: "On" },
    { href: "/profile", label: "Profile", shortLabel: "Pr" },
  ];
}

function getRoleLabel(role: AppRole) {
  if (role === "admin") return "Admin";
  if (role === "organiser") return "Organiser";
  return "Player";
}

function isItemActive(pathname: string, item: NavigationItem) {
  const prefixes = item.matchPrefixes ?? [item.href];
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function getItemClassName(active: boolean) {
  return active
    ? "border-zinc-900 bg-zinc-900 text-white shadow-sm"
    : "border-transparent text-zinc-600 hover:border-zinc-200 hover:bg-zinc-100 hover:text-zinc-900";
}

export default function AppShell({
  role,
  children,
  contentClassName = "max-w-6xl",
}: AppShellProps) {
  const pathname = usePathname();
  const [desktopCollapsed, setDesktopCollapsed] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    try {
      return window.localStorage.getItem(DESKTOP_NAV_STATE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigationItems = getNavigationItems(role);
  const roleLabel = getRoleLabel(role);
  const canCreateSeries = role === "admin" || role === "organiser";

  useEffect(() => {
    try {
      window.localStorage.setItem(DESKTOP_NAV_STATE_KEY, String(desktopCollapsed));
    } catch {
      // Ignore localStorage failures and keep the menu usable.
    }
  }, [desktopCollapsed]);

  function renderNavigation(compact: boolean, area: "desktop" | "mobile") {
    return (
      <nav className="space-y-2" data-testid={`app-shell-nav-${area}`}>
        {navigationItems.map((item) => {
          const active = isItemActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileMenuOpen(false)}
              data-testid={`app-shell-nav-${area}-${toTestIdSegment(item.label)}`}
              className={`flex items-center gap-3 rounded-2xl border px-3 py-3 text-sm font-medium transition ${getItemClassName(active)}`}
              aria-current={active ? "page" : undefined}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-semibold ${
                  active ? "bg-white/20 text-white" : "bg-zinc-200 text-zinc-700"
                }`}
              >
                {item.shortLabel}
              </span>
              {!compact ? <span>{item.label}</span> : null}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900" data-testid="app-shell">
      <div className="flex min-h-screen">
        <aside
          data-testid="app-shell-desktop-sidebar"
          data-state={desktopCollapsed ? "collapsed" : "expanded"}
          className={`sticky top-0 hidden h-screen shrink-0 border-r border-zinc-200 bg-white md:flex md:flex-col ${
            desktopCollapsed ? "w-24" : "w-80"
          }`}
        >
          <div className="border-b border-zinc-200 px-4 py-5">
            <div className="flex items-start justify-between gap-3">
              <div className={desktopCollapsed ? "w-full" : ""}>
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-900 text-sm font-semibold text-white">
                    CS
                  </span>
                  {!desktopCollapsed ? (
                    <div>
                      <div className="text-sm font-semibold text-zinc-900">Community Sports</div>
                      <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">{roleLabel}</div>
                    </div>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDesktopCollapsed((current) => !current)}
                data-testid="app-shell-desktop-toggle"
                className="rounded-xl border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100"
                aria-label={desktopCollapsed ? "Expand menu" : "Collapse menu"}
              >
                {desktopCollapsed ? ">" : "<"}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-5">
            {renderNavigation(desktopCollapsed, "desktop")}
          </div>

          <div className="border-t border-zinc-200 px-4 py-5">
            {canCreateSeries ? (
              <Link
                href="/sessions/new"
                data-testid="app-shell-create-series-desktop"
                className={`mb-3 flex items-center justify-center rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-zinc-700 ${
                  desktopCollapsed ? "px-0" : ""
                }`}
              >
                {desktopCollapsed ? "New" : "Create session series"}
              </Link>
            ) : null}
            <Link
              href="/logout"
              data-testid="app-shell-sign-out-desktop"
              className={`flex items-center justify-center rounded-2xl border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 ${
                desktopCollapsed ? "px-0" : ""
              }`}
            >
              {desktopCollapsed ? "Out" : "Sign out"}
            </Link>
          </div>
        </aside>

        {mobileMenuOpen ? (
          <div className="fixed inset-0 z-40 md:hidden" data-testid="app-shell-mobile-overlay">
            <button
              type="button"
              data-testid="app-shell-mobile-overlay-close"
              className="absolute inset-0 bg-zinc-950/35"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close menu"
            />
            <div className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col border-r border-zinc-200 bg-white shadow-xl" data-testid="app-shell-mobile-panel">
              <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-900 text-sm font-semibold text-white">
                    CS
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-zinc-900">Community Sports</div>
                    <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">{roleLabel}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  data-testid="app-shell-mobile-close"
                  className="rounded-xl border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100"
                >
                  Close
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-5">
                {renderNavigation(false, "mobile")}
              </div>

              <div className="border-t border-zinc-200 px-4 py-5">
                {canCreateSeries ? (
                  <Link
                    href="/sessions/new"
                    data-testid="app-shell-create-series-mobile"
                    className="mb-3 flex items-center justify-center rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-zinc-700"
                  >
                    Create session series
                  </Link>
                ) : null}
                <Link
                  href="/logout"
                  data-testid="app-shell-sign-out-mobile"
                  className="flex items-center justify-center rounded-2xl border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
                >
                  Sign out
                </Link>
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="sticky top-0 z-30 border-b border-zinc-200 bg-white/90 px-4 py-4 backdrop-blur md:hidden">
            <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(true)}
                  data-testid="app-shell-mobile-toggle"
                  className="rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
                >
                  Menu
                </button>
                <div>
                  <div className="text-sm font-semibold text-zinc-900">Community Sports</div>
                  <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">{roleLabel}</div>
                </div>
              </div>
              {canCreateSeries ? (
                <Link
                  href="/sessions/new"
                  data-testid="app-shell-create-series-mobile-quick"
                  className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
                >
                  New series
                </Link>
              ) : null}
            </div>
          </div>

          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
            <div className={`mx-auto flex w-full min-w-0 flex-col gap-6 ${contentClassName}`}>
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
