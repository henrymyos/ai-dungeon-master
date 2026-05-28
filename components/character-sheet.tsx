"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useEffect } from "react";
import type { DmCharacter, DmStatus, StatusKind } from "@/lib/db";
import { CloseIcon } from "@/components/icons";

const CLASSES = ["Wanderer", "Fighter", "Rogue", "Mage", "Ranger"] as const;
const BLURBS: Record<(typeof CLASSES)[number], string> = {
  Wanderer: "Neutral stats. Carries the bare minimum.",
  Fighter: "High HP and strength. Iron sword, leather armor.",
  Rogue: "Quick and clever. Daggers, lockpicks, smoke.",
  Mage: "Low HP, high wits. Staff and battered spellbook.",
  Ranger: "Outdoorsy. Longbow, arrows, trail rations.",
};

type Props = {
  character: DmCharacter | null;
  statuses: DmStatus[];
  onUpdate: (next: DmCharacter) => void;
  campaignId: string;
};

const STATUS_TONE: Record<StatusKind, string> = {
  buff: "border-emerald-400/40 bg-emerald-400/[0.08] text-emerald-200",
  debuff: "border-amber-400/40 bg-amber-400/[0.08] text-amber-200",
  condition: "border-zinc-500/40 bg-zinc-500/[0.06] text-zinc-200",
  injury: "border-red-400/40 bg-red-400/[0.08] text-red-200",
};

export function CharacterSheet({
  character,
  statuses,
  onUpdate,
  campaignId,
}: Props) {
  const [open, setOpen] = useState(false);

  if (!character) return null;

  const hpPct =
    character.max_hp > 0
      ? Math.round((character.hp / character.max_hp) * 100)
      : 0;
  const lowHp = hpPct <= 30;
  // Smooth hue ramp: red (0°) at 0% → amber (~45°) at 50% → green (130°) at 100%.
  const hue = Math.max(0, Math.min(130, (hpPct / 100) * 130));
  const barStyle = {
    width: `${hpPct}%`,
    background: `linear-gradient(to right, hsl(${hue} 70% 42%), hsl(${hue} 78% 56%))`,
    boxShadow: lowHp ? `0 0 12px hsl(${hue} 80% 50% / 0.55)` : "none",
  };

  return (
    <div className="border-t border-[var(--border)] px-4 py-3 space-y-2.5 text-xs">
      <div className="flex items-start gap-3">
        <Portrait url={character.portrait_url} name={character.name} />
        <div className="min-w-0 flex-1 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
              {character.class}
            </p>
            <p className="text-sm font-semibold text-zinc-100 truncate">
              {character.name}
            </p>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="text-[10px] uppercase tracking-wider text-[var(--muted)] hover:text-[var(--accent)] transition-colors shrink-0"
          >
            Customize
          </button>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between text-[10px] text-[var(--muted)] mb-1">
          <span>Health</span>
          <span
            className={lowHp ? "animate-pulse" : ""}
            style={{ color: `hsl(${hue} 70% 65%)` }}
          >
            {character.hp} / {character.max_hp}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-zinc-900/60 overflow-hidden">
          <div className="h-full transition-all duration-500" style={barStyle} />
        </div>
      </div>

      {statuses.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {statuses.map((s) => (
            <li
              key={s.id}
              title={s.description}
              className={`text-[10px] uppercase tracking-wider rounded border px-1.5 py-0.5 ${STATUS_TONE[s.kind]}`}
            >
              {s.name}
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-3 gap-1.5 text-center">
        <Stat label="STR" value={character.attributes.strength} />
        <Stat label="DEX" value={character.attributes.dexterity} />
        <Stat label="WIT" value={character.attributes.wits} />
      </div>

      {character.skills && character.skills.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--muted)] mb-1">
            Skills
          </p>
          <ul className="flex flex-wrap gap-1">
            {character.skills.map((s) => (
              <li
                key={s.name}
                className="rounded-md bg-zinc-900/60 border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-zinc-200"
              >
                {s.name}
                <span className="text-[var(--accent)] ml-1">+{s.level}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-[10px] uppercase tracking-wider text-[var(--muted)] mb-1">
          Inventory
        </p>
        {character.inventory.length === 0 ? (
          <p className="text-zinc-500 italic">Empty pockets.</p>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {character.inventory.map((i) => (
              <li
                key={i.item}
                className="rounded-md bg-zinc-900/60 border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-zinc-200"
              >
                {i.item}
                {i.quantity > 1 && (
                  <span className="text-[var(--accent)] ml-1">
                    ×{i.quantity}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ClassPickerModal
        open={open}
        current={character}
        campaignId={campaignId}
        onClose={() => setOpen(false)}
        onUpdate={onUpdate}
      />
    </div>
  );
}

function Portrait({ url, name }: { url: string | null; name: string }) {
  return (
    <div
      className="relative w-14 h-16 shrink-0 rounded-md overflow-hidden border border-[var(--border)]
                 bg-gradient-to-br from-[#1a1410] to-[#0c0907]"
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`Portrait of ${name}`}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-[#2a1f15] via-[#1a1410] to-[#0c0907]" />
      )}
      <span className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-[var(--accent)]/15" />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-zinc-900/40 border border-[var(--border)] py-1">
      <p className="text-[9px] uppercase tracking-wider text-[var(--muted)]">
        {label}
      </p>
      <p className="text-sm font-mono text-zinc-100 leading-none mt-0.5">
        {value}
      </p>
    </div>
  );
}

function ClassPickerModal({
  open,
  current,
  campaignId,
  onClose,
  onUpdate,
}: {
  open: boolean;
  current: DmCharacter;
  campaignId: string;
  onClose: () => void;
  onUpdate: (next: DmCharacter) => void;
}) {
  const [name, setName] = useState(current.name);
  const [cls, setCls] = useState(current.class);
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (open) {
      setName(current.name);
      setCls(current.class);
    }
  }, [open, current]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/character`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, class: cls }),
      });
      if (!res.ok) throw new Error("Update failed");
      const { character } = (await res.json()) as { character: DmCharacter };
      onUpdate(character);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="relative w-[min(440px,calc(100vw-2rem))] rounded-2xl border border-[var(--border)]
                   bg-[#100c08]/95 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.7)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)]/60 to-transparent" />
        <header className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold">Customize character</h2>
          <button
            onClick={onClose}
            className="text-[var(--muted)] hover:text-zinc-100"
            aria-label="Close"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </header>
        <div className="px-5 py-4 space-y-4">
          <label className="block text-xs">
            <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] block mb-1.5">
              Name
            </span>
            <input
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-zinc-900/60 border border-[var(--border)] rounded-md px-3 py-2 text-sm text-zinc-100
                         outline-none focus:border-[var(--accent)]/50"
            />
          </label>
          <fieldset>
            <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] block mb-2">
              Class
            </span>
            <div className="grid grid-cols-1 gap-1.5">
              {CLASSES.map((c) => (
                <label
                  key={c}
                  className={`flex items-start gap-3 rounded-md border px-3 py-2 cursor-pointer transition-colors text-xs ${
                    cls === c
                      ? "border-[var(--accent)]/50 bg-[var(--accent)]/[0.08]"
                      : "border-[var(--border)] hover:bg-zinc-900/60"
                  }`}
                >
                  <input
                    type="radio"
                    name="class"
                    value={c}
                    checked={cls === c}
                    onChange={() => setCls(c)}
                    className="mt-0.5 accent-[var(--accent)]"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-100">{c}</p>
                    <p className="text-[11px] text-[var(--muted)]">
                      {BLURBS[c]}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-[11px] text-[var(--muted)] leading-relaxed">
            Changing your class resets your HP and inventory to that class&apos;s
            starting kit — your story so far is preserved.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)] bg-[#1a1410]/40">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 text-sm rounded-md border border-[var(--border)] text-zinc-200 hover:bg-[#1a1410]/60 transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={saving || !name.trim()}
            onClick={save}
            className="px-3.5 py-1.5 text-sm rounded-md font-medium bg-[var(--accent)] text-zinc-950 hover:brightness-110 disabled:opacity-50 transition-all"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
  return createPortal(modal, document.body);
}
