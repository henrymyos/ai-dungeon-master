"use client";

import { useState } from "react";
import type { DmWorld, NpcAttitude } from "@/lib/db";

const ATTITUDE_COLOR: Record<NpcAttitude, string> = {
  friendly: "text-emerald-400",
  hostile: "text-red-400",
  neutral: "text-zinc-300",
  suspicious: "text-amber-300",
  allied: "text-sky-300",
  fearful: "text-violet-300",
};

export function WorldPanel({ world }: { world: DmWorld | null }) {
  if (!world) return null;
  const hasAny =
    world.npcs.length > 0 ||
    world.locations.length > 0 ||
    world.lore.length > 0;
  if (!hasAny) return null;
  return (
    <div className="border-t border-[var(--border)] px-4 py-3 space-y-2 text-xs">
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
        World
      </p>
      {world.npcs.length > 0 && (
        <Section title={`NPCs · ${world.npcs.length}`}>
          <ul className="space-y-1.5">
            {world.npcs.slice(0, 12).map((n) => (
              <li
                key={n.id}
                className="leading-snug border-l-2 border-[var(--border)] pl-2"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-zinc-100 font-medium truncate">
                    {n.name}
                  </span>
                  <span
                    className={`text-[10px] uppercase tracking-wider shrink-0 ${ATTITUDE_COLOR[n.attitude]}`}
                  >
                    {n.attitude}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--muted)] line-clamp-2">
                  {n.description}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {world.locations.length > 0 && (
        <Section title={`Locations · ${world.locations.length}`}>
          <ul className="space-y-1.5">
            {world.locations.slice(0, 12).map((l) => (
              <li
                key={l.id}
                className="leading-snug border-l-2 border-[var(--border)] pl-2"
              >
                <p className="text-zinc-100 font-medium truncate">{l.name}</p>
                <p className="text-[11px] text-[var(--muted)] line-clamp-2">
                  {l.description}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {world.lore.length > 0 && (
        <Section title={`Lore · ${world.lore.length}`}>
          <ul className="space-y-1.5">
            {world.lore.slice(0, 10).map((f) => (
              <li
                key={f.id}
                className="leading-snug border-l-2 border-[var(--border)] pl-2 text-[11px] text-zinc-300"
              >
                {f.fact}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--muted)] hover:text-zinc-100 transition-colors py-0.5"
      >
        <span>{title}</span>
        <span className={`transition-transform ${open ? "rotate-90" : ""}`}>
          ›
        </span>
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}
