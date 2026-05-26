"use client";

import { useState } from "react";
import type { DmCampaign } from "@/lib/db";
import { CloseIcon, TrashIcon } from "@/components/icons";
import { ConfirmDialog } from "@/components/confirm-dialog";

type Props = {
  campaigns: DmCampaign[];
  activeId: string | null;
  loading: boolean;
  creating: boolean;
  open: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
};

export function Sidebar({
  campaigns,
  activeId,
  loading,
  creating,
  open,
  onSelect,
  onNew,
  onDelete,
  onClose,
}: Props) {
  const [pendingDelete, setPendingDelete] = useState<DmCampaign | null>(null);

  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    await onDelete(id);
  }

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/55 backdrop-blur-sm z-30 md:hidden transition-opacity ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />
      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 w-72 shrink-0 border-r border-[var(--border)]
                    bg-[#100c08]/95 md:bg-[#100c08]/60 backdrop-blur-sm flex flex-col
                    transition-transform duration-200 ease-out
                    ${open ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      >
        <div className="px-5 py-5 border-b border-[var(--border)] bg-gradient-to-b from-[var(--accent)]/[0.08] to-transparent flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="relative inline-flex items-center justify-center w-7 h-7 rounded-lg
                           bg-[var(--accent)]/15 border border-[var(--accent)]/30
                           shadow-[0_0_18px_rgba(245,158,11,0.4)] text-[var(--accent)] text-sm"
              >
                ✦
              </span>
              <h1 className="text-base font-semibold tracking-tight">
                AI Dungeon Master
              </h1>
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Text adventures with Claude.
            </p>
          </div>
          <button
            onClick={onClose}
            className="md:hidden text-[var(--muted)] hover:text-zinc-100 -mt-1"
            aria-label="Close sidebar"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="px-3 py-3 border-b border-[var(--border)]">
          <button
            disabled={creating}
            onClick={onNew}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md
                       bg-gradient-to-b from-[var(--accent)] to-amber-600 text-zinc-950
                       hover:brightness-110 shadow-[0_4px_18px_-6px_rgba(245,158,11,0.65)]
                       disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {creating ? "Starting…" : "New adventure"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          <div className="px-3 mt-1 mb-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
            Adventures
          </div>
          {loading && campaigns.length === 0 ? (
            <SkeletonRows />
          ) : campaigns.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[var(--muted)]">
              No adventures yet. Start one above.
            </p>
          ) : (
            campaigns.map((c) => (
              <CampaignItem
                key={c.id}
                campaign={c}
                active={activeId === c.id}
                onClick={() => onSelect(c.id)}
                onDelete={() => setPendingDelete(c)}
              />
            ))
          )}
        </div>

        <div className="px-5 py-3 text-[11px] text-[var(--muted)] border-t border-[var(--border)]">
          Phase 2 · persistent campaigns
        </div>

        <ConfirmDialog
          open={pendingDelete !== null}
          title="Abandon this adventure?"
          description={
            pendingDelete
              ? `"${pendingDelete.title}" and all of its narration will be permanently lost. This can't be undone.`
              : ""
          }
          confirmLabel="Abandon"
          cancelLabel="Cancel"
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      </aside>
    </>
  );
}

function CampaignItem({
  campaign,
  active,
  onClick,
  onDelete,
}: {
  campaign: DmCampaign;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  const updated = new Date(campaign.updated_at);
  const ago = formatRelative(updated);
  return (
    <div
      className={`group relative flex items-center gap-2 rounded-md px-3 py-2 cursor-pointer transition-colors
                  ${
                    active
                      ? "bg-[var(--accent)]/12 ring-1 ring-inset ring-[var(--accent)]/30"
                      : "hover:bg-[#1a1410]/80"
                  }`}
      onClick={onClick}
    >
      {active && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-[var(--accent)]" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{campaign.title}</p>
        <p className="text-[11px] text-[var(--muted)] truncate">{ago}</p>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="opacity-0 group-hover:opacity-100 text-[var(--muted)] hover:text-red-400 transition-opacity flex items-center justify-center w-8 h-8"
        aria-label="Abandon adventure"
      >
        <TrashIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-1 px-1 py-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-2 px-2 py-2 rounded-md animate-pulse"
        >
          <div className="min-w-0 flex-1">
            <div className="h-3 bg-[#2a1f15]/80 rounded w-3/4" />
            <div className="mt-1.5 h-2 bg-[#2a1f15]/60 rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}
