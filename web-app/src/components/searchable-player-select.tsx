"use client";

import { useMemo, useState } from "react";
import type { PlayerDirectoryEntry } from "@/lib/players";

type Props = {
  players: PlayerDirectoryEntry[];
  value: string;
  onValueChange: (value: string) => void;
  onCreate: (name: string) => Promise<void> | void;
  disabled?: boolean;
};

export default function SearchablePlayerSelect({
  players,
  value,
  onValueChange,
  onCreate,
  disabled,
}: Props) {
  const [query, setQuery] = useState("");

  const filteredPlayers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return players;
    return players.filter((player) => {
      return (
        player.displayName.toLowerCase().includes(normalized) ||
        player.email.toLowerCase().includes(normalized)
      );
    });
  }, [players, query]);

  return (
    <div className="space-y-2">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search player by name or email"
        disabled={disabled}
        className="w-full rounded-xl border border-zinc-300 px-4 py-2 text-sm outline-none transition focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
      />

      <div className="max-h-56 overflow-auto rounded-xl border border-zinc-200 bg-white">
        {filteredPlayers.length ? (
          filteredPlayers.map((player) => {
            const selected = value === player.id;
            return (
              <button
                key={player.id}
                type="button"
                onClick={() => onValueChange(player.id)}
                disabled={disabled}
                className={`flex w-full flex-col items-start gap-1 border-b border-zinc-100 px-4 py-3 text-left text-sm last:border-b-0 hover:bg-zinc-50 ${selected ? "bg-zinc-100" : ""}`}
              >
                <span className="font-medium text-zinc-900">{player.displayName}</span>
                <span className="text-xs text-zinc-500">{player.email || "No email"}</span>
              </button>
            );
          })
        ) : (
          <div className="px-4 py-3 text-sm text-zinc-500">No matching players found.</div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={value.startsWith("create:") ? value.slice(7) : ""}
          onChange={(event) => onValueChange(`create:${event.target.value}`)}
          placeholder="Or create a new player by name"
          disabled={disabled}
          className="flex-1 rounded-xl border border-zinc-300 px-4 py-2 text-sm outline-none transition focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="button"
          onClick={async () => {
            const name = value.startsWith("create:") ? value.slice(7).trim() : "";
            if (!name) return;
            await onCreate(name);
          }}
          disabled={disabled || !value.startsWith("create:") || !value.slice(7).trim()}
          className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Create
        </button>
      </div>
    </div>
  );
}
