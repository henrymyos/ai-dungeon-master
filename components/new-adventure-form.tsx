"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "@/components/icons";
import type { ClassKey } from "@/lib/db";

const CLASSES: ClassKey[] = [
  "Wanderer",
  "Fighter",
  "Rogue",
  "Mage",
  "Ranger",
];

const BLURBS: Record<ClassKey, string> = {
  Wanderer: "Neutral stats. Carries the bare minimum.",
  Fighter: "High HP and strength. Iron sword, leather armor.",
  Rogue: "Quick and clever. Daggers, lockpicks, smoke.",
  Mage: "Low HP, high wits. Staff and battered spellbook.",
  Ranger: "Outdoorsy. Longbow, arrows, trail rations.",
};

export type NewAdventurePayload = {
  characterName?: string;
  characterClass: ClassKey;
  scenario?: string;
  backstory?: string;
};

type Props = {
  onCreate: (payload: NewAdventurePayload) => Promise<void>;
  /** Render a stand-alone card instead of a modal (used by the landing page). */
  inline?: boolean;
  /** Modal-mode props */
  open?: boolean;
  onClose?: () => void;
  /** Override the submit button label and surrounding copy. */
  ctaLabel?: string;
  title?: string;
  subtitle?: string;
};

export function NewAdventureForm({
  onCreate,
  inline = false,
  open = false,
  onClose,
  ctaLabel = "Begin adventure",
  title = "Begin a new adventure",
  subtitle = "Pick your hero. Add a world if you want one — leave blank and the DM picks.",
}: Props) {
  const [name, setName] = useState("");
  const [cls, setCls] = useState<ClassKey>("Wanderer");
  const [scenario, setScenario] = useState("");
  const [backstory, setBackstory] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!inline && !open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !inline) onClose?.();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, inline, onClose]);

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onCreate({
        characterName: name.trim() || undefined,
        characterClass: cls,
        scenario: scenario.trim() || undefined,
        backstory: backstory.trim() || undefined,
      });
      // Reset on success.
      setName("");
      setScenario("");
      setBackstory("");
      setCls("Wanderer");
    } finally {
      setSubmitting(false);
    }
  }

  const body = (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-xs">
          <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] block mb-1.5">
            Character name (optional)
          </span>
          <input
            value={name}
            maxLength={40}
            placeholder="Wanderer"
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-zinc-900/60 border border-[var(--border)] rounded-md px-3 py-2 text-sm text-zinc-100
                       outline-none focus:border-[var(--accent)]/50"
          />
        </label>
        <div>
          <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] block mb-1.5">
            Class
          </span>
          <select
            value={cls}
            onChange={(e) => setCls(e.target.value as ClassKey)}
            className="w-full bg-zinc-900/60 border border-[var(--border)] rounded-md px-3 py-2 text-sm text-zinc-100
                       outline-none focus:border-[var(--accent)]/50"
          >
            {CLASSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11px] text-[var(--muted)] leading-snug">
            {BLURBS[cls]}
          </p>
        </div>
      </div>

      <label className="block text-xs">
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] flex items-center justify-between mb-1.5">
          <span>Starting scenario (optional)</span>
          <span className="text-[9px] normal-case font-normal italic">
            Leave blank for a foggy forest at dusk
          </span>
        </span>
        <textarea
          value={scenario}
          onChange={(e) => setScenario(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="You wake up in the burning hold of a slaver ship…"
          className="w-full resize-none bg-zinc-900/60 border border-[var(--border)] rounded-md px-3 py-2 text-sm text-zinc-100
                     outline-none focus:border-[var(--accent)]/50"
        />
      </label>

      <label className="block text-xs">
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] flex items-center justify-between mb-1.5">
          <span>Character backstory (optional)</span>
          <span className="text-[9px] normal-case font-normal italic">
            What the DM should know about you
          </span>
        </span>
        <textarea
          value={backstory}
          onChange={(e) => setBackstory(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="My family was killed by the Iron Magi when I was nine. I've been hunting them ever since."
          className="w-full resize-none bg-zinc-900/60 border border-[var(--border)] rounded-md px-3 py-2 text-sm text-zinc-100
                     outline-none focus:border-[var(--accent)]/50"
        />
      </label>
    </div>
  );

  const footer = (
    <div className="flex items-center justify-end gap-2">
      {!inline && (
        <button
          onClick={onClose}
          className="px-3.5 py-1.5 text-sm rounded-md border border-[var(--border)] text-zinc-200 hover:bg-[#1a1410]/60 transition-colors"
        >
          Cancel
        </button>
      )}
      <button
        disabled={submitting}
        onClick={submit}
        className="px-4 py-2 text-sm rounded-md font-medium bg-gradient-to-b from-[var(--accent)] to-amber-600 text-zinc-950
                   hover:brightness-110 shadow-[0_4px_18px_-6px_rgba(245,158,11,0.65)]
                   disabled:opacity-50 transition-all"
      >
        {submitting ? "Starting…" : ctaLabel}
      </button>
    </div>
  );

  if (inline) {
    return (
      <div className="w-full max-w-xl mx-auto rounded-2xl border border-[var(--border)] bg-[#100c08]/80 backdrop-blur-sm
                      shadow-[0_20px_60px_-10px_rgba(0,0,0,0.7)] overflow-hidden">
        <span className="pointer-events-none block h-px w-full bg-gradient-to-r from-transparent via-[var(--accent)]/60 to-transparent" />
        <div className="px-6 py-5 border-b border-[var(--border)]">
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="mt-1 text-xs text-[var(--muted)] leading-relaxed">
            {subtitle}
          </p>
        </div>
        <div className="px-6 py-5">{body}</div>
        <div className="px-6 py-4 border-t border-[var(--border)] bg-[#1a1410]/40">
          {footer}
        </div>
      </div>
    );
  }

  if (!open || !mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="relative w-[min(560px,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto
                   rounded-2xl border border-[var(--border)] bg-[#100c08]/95
                   shadow-[0_20px_60px_-10px_rgba(0,0,0,0.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)]/60 to-transparent" />
        <header className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">{subtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--muted)] hover:text-zinc-100"
            aria-label="Close"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </header>
        <div className="px-5 py-4">{body}</div>
        <div className="px-5 py-3 border-t border-[var(--border)] bg-[#1a1410]/40">
          {footer}
        </div>
      </div>
    </div>,
    document.body,
  );
}
