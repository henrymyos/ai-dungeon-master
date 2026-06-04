"use client";

import { useCallback, useEffect, useState } from "react";
import { DmChat } from "@/components/dm-chat";
import { Sidebar } from "@/components/sidebar";
import { ToastProvider, useToast } from "@/components/toast";
import type { DmCampaign, DmCharacter, DmWorld } from "@/lib/db";
import type { ToolEvent } from "@/lib/tools";
import { sfx } from "@/lib/sfx";
import {
  NewAdventureForm,
  type NewAdventurePayload,
} from "@/components/new-adventure-form";

type UsageSummary = {
  turns: number;
  tokens: {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
  };
  estimatedCostUsd: number;
};

function PageInner() {
  const [campaigns, setCampaigns] = useState<DmCampaign[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [character, setCharacter] = useState<DmCharacter | null>(null);
  const [world, setWorld] = useState<DmWorld | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const toast = useToast();

  const refresh = useCallback(async () => {
    const res = await fetch("/api/campaigns", { cache: "no-store" });
    if (!res.ok) return;
    const { campaigns } = (await res.json()) as { campaigns: DmCampaign[] };
    setCampaigns(campaigns);
    return campaigns;
  }, []);

  const fetchCharacter = useCallback(async (campaignId: string) => {
    const res = await fetch(`/api/campaigns/${campaignId}/character`, {
      cache: "no-store",
    });
    if (!res.ok) {
      setCharacter(null);
      return;
    }
    const { character } = (await res.json()) as { character: DmCharacter };
    setCharacter(character);
  }, []);

  const fetchWorld = useCallback(async (campaignId: string) => {
    const res = await fetch(`/api/campaigns/${campaignId}/world`, {
      cache: "no-store",
    });
    if (!res.ok) {
      setWorld(null);
      return;
    }
    const { world } = (await res.json()) as { world: DmWorld };
    setWorld(world);
  }, []);

  const refreshUsage = useCallback(async () => {
    const res = await fetch("/api/usage", { cache: "no-store" });
    if (!res.ok) return;
    setUsage((await res.json()) as UsageSummary);
  }, []);

  useEffect(() => {
    (async () => {
      const list = await refresh();
      if (list && list.length > 0) setActiveId(list[0].id);
      await refreshUsage();
      setLoading(false);
    })();
  }, [refresh, refreshUsage]);

  useEffect(() => {
    if (activeId) {
      fetchCharacter(activeId);
      fetchWorld(activeId);
    } else {
      setCharacter(null);
      setWorld(null);
    }
  }, [activeId, fetchCharacter, fetchWorld]);

  // Portrait generation runs in the background after campaign creation
  // and after gear changes. Poll the character endpoint until a portrait
  // shows up (or we give up after ~45s).
  useEffect(() => {
    if (!activeId || !character || character.portrait_url) return;
    let cancelled = false;
    let attempts = 0;
    const id = setInterval(() => {
      if (cancelled || attempts >= 15) {
        clearInterval(id);
        return;
      }
      attempts += 1;
      fetchCharacter(activeId);
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeId, character, fetchCharacter]);

  async function newCampaign(payload?: NewAdventurePayload) {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't start a new adventure.");
      }
      const { campaign } = (await res.json()) as { campaign: DmCampaign };
      setCampaigns((c) => [campaign, ...c]);
      setActiveId(campaign.id);
      setSidebarOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start.");
    } finally {
      setCreating(false);
    }
  }

  async function deleteCampaign(id: string) {
    const previous = campaigns;
    setCampaigns((c) => c.filter((x) => x.id !== id));
    if (activeId === id) {
      const next = previous.find((x) => x.id !== id);
      setActiveId(next?.id ?? null);
    }
    const res = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't abandon adventure.");
      setCampaigns(previous);
    }
  }

  function onToolEvent(evt: ToolEvent) {
    // Procedural SFX layer — each tool event maps to a one-shot synth pop.
    if (evt.kind === "roll_dice") sfx.play("dice");
    else if (evt.kind === "update_hp")
      sfx.play(evt.delta < 0 ? "hit" : "heal");
    else if (evt.kind === "add_item") sfx.play("pickup");
    else if (evt.kind === "remove_item") sfx.play("drop");
    else if (evt.kind === "damage_enemy") sfx.play("hit");
    else if (evt.kind === "start_encounter") sfx.play("combat_start");
    else if (evt.kind === "defeat_enemy") sfx.play("enemy_down");
    else if (evt.kind === "record_quest" && evt.isNew) sfx.play("quest");
    else if (evt.kind === "advance_arc") sfx.play("level_change");

    setCharacter((prev) => {
      if (!prev) return prev;
      if (evt.kind === "update_hp")
        return { ...prev, hp: evt.hp, max_hp: evt.max_hp };
      if (evt.kind === "add_item") {
        const inv = [...prev.inventory];
        const idx = inv.findIndex(
          (i) => i.item.toLowerCase() === evt.item.toLowerCase(),
        );
        if (idx >= 0)
          inv[idx] = { ...inv[idx], quantity: inv[idx].quantity + evt.quantity };
        else inv.push({ item: evt.item, quantity: evt.quantity });
        return { ...prev, inventory: inv };
      }
      if (evt.kind === "remove_item") {
        const inv = prev.inventory
          .map((i) =>
            i.item.toLowerCase() === evt.item.toLowerCase()
              ? { ...i, quantity: i.quantity - evt.quantity }
              : i,
          )
          .filter((i) => i.quantity > 0);
        return { ...prev, inventory: inv };
      }
      return prev;
    });

    // World tools optimistically mutate the cached world state so the
    // sidebar updates the moment the SSE event arrives.
    if (
      evt.kind === "advance_time" ||
      evt.kind === "record_npc" ||
      evt.kind === "record_location" ||
      evt.kind === "record_lore" ||
      evt.kind === "record_quest" ||
      evt.kind === "update_quest_status" ||
      evt.kind === "advance_arc"
    ) {
      setWorld((prev) => {
        if (!prev) return prev;
        if (evt.kind === "advance_time")
          return {
            ...prev,
            time_minutes: evt.time_minutes,
            day_count: evt.day_count,
            weather: evt.weather,
          };
        if (evt.kind === "record_npc") {
          const idx = prev.npcs.findIndex(
            (n) => n.name.toLowerCase() === evt.name.toLowerCase(),
          );
          const next = [...prev.npcs];
          const now = new Date().toISOString();
          if (idx >= 0) {
            next[idx] = {
              ...next[idx],
              description: evt.description,
              attitude: evt.attitude,
              relationship: evt.relationship,
              last_seen_at: now,
            };
          } else {
            next.unshift({
              id: `tmp-${Date.now()}`,
              campaign_id: prev.npcs[0]?.campaign_id ?? "",
              name: evt.name,
              description: evt.description,
              attitude: evt.attitude,
              relationship: evt.relationship,
              notes: null,
              first_seen_at: now,
              last_seen_at: now,
            });
          }
          return { ...prev, npcs: next };
        }
        if (evt.kind === "record_location") {
          const idx = prev.locations.findIndex(
            (l) => l.name.toLowerCase() === evt.name.toLowerCase(),
          );
          const next = [...prev.locations];
          const now = new Date().toISOString();
          if (idx >= 0) {
            next[idx] = {
              ...next[idx],
              description: evt.description,
              last_visited_at: now,
            };
          } else {
            next.unshift({
              id: `tmp-${Date.now()}`,
              campaign_id: prev.locations[0]?.campaign_id ?? "",
              name: evt.name,
              description: evt.description,
              notes: null,
              first_visited_at: now,
              last_visited_at: now,
            });
          }
          return { ...prev, locations: next };
        }
        if (evt.kind === "record_lore") {
          const now = new Date().toISOString();
          return {
            ...prev,
            lore: [
              {
                id: -Date.now(),
                campaign_id: prev.lore[0]?.campaign_id ?? "",
                fact: evt.fact,
                created_at: now,
              },
              ...prev.lore,
            ],
          };
        }
        if (evt.kind === "record_quest") {
          const now = new Date().toISOString();
          const existing = prev.quests.findIndex(
            (q) => q.name.toLowerCase() === evt.name.toLowerCase(),
          );
          const next = [...prev.quests];
          if (existing >= 0) {
            next[existing] = {
              ...next[existing],
              description: evt.description,
              updated_at: now,
            };
          } else {
            next.unshift({
              id: `tmp-${Date.now()}`,
              campaign_id: prev.quests[0]?.campaign_id ?? "",
              name: evt.name,
              description: evt.description,
              status: "active",
              notes: null,
              created_at: now,
              updated_at: now,
            });
          }
          return { ...prev, quests: next };
        }
        if (evt.kind === "update_quest_status") {
          const next = prev.quests.map((q) =>
            q.name.toLowerCase() === evt.name.toLowerCase()
              ? { ...q, status: evt.status, updated_at: new Date().toISOString() }
              : q,
          );
          return { ...prev, quests: next };
        }
        if (evt.kind === "advance_arc") {
          return { ...prev, current_beat: evt.new_beat };
        }
        return prev;
      });
    }
  }

  const active = campaigns.find((c) => c.id === activeId) ?? null;

  // First-time visitor: full-screen landing. Once they have any campaign,
  // we drop back into the normal sidebar + chat layout.
  if (!loading && campaigns.length === 0) {
    return <LandingPage onCreate={newCampaign} creating={creating} />;
  }

  return (
    <div className="h-dvh flex">
      <Sidebar
        campaigns={campaigns}
        activeId={activeId}
        loading={loading}
        creating={creating}
        open={sidebarOpen}
        character={character}
        world={world}
        usage={usage}
        onSelect={(id) => {
          setActiveId(id);
          setSidebarOpen(false);
        }}
        onNew={newCampaign}
        onDelete={deleteCampaign}
        onClose={() => setSidebarOpen(false)}
        onCharacterUpdate={(next) => setCharacter(next)}
      />
      <DmChat
        campaignId={activeId}
        campaignTitle={active?.title ?? "AI Dungeon Master"}
        shareToken={active?.share_token ?? null}
        world={world}
        onOpenSidebar={() => setSidebarOpen(true)}
        onCampaignChanged={refresh}
        onToolEvent={onToolEvent}
        onStreamEnd={async () => {
          if (activeId) {
            await Promise.all([
              fetchCharacter(activeId),
              fetchWorld(activeId),
            ]);
          }
          await refreshUsage();
        }}
        onShareTokenChanged={refresh}
        onForked={async (newId) => {
          await refresh();
          setActiveId(newId);
          setSidebarOpen(false);
        }}
      />
    </div>
  );
}

function LandingPage({
  onCreate,
  creating,
}: {
  onCreate: (payload?: NewAdventurePayload) => Promise<void>;
  creating: boolean;
}) {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-4 py-10 sm:py-16 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[var(--accent)]/[0.06] to-transparent" />
      <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[520px] h-[520px] bg-[var(--accent)]/[0.08] rounded-full blur-3xl" />
      <div className="relative z-10 text-center mb-8 sm:mb-10 max-w-2xl">
        <div
          className="mx-auto relative w-14 h-14 rounded-2xl bg-[var(--accent)]/15 border border-[var(--accent)]/30
                     flex items-center justify-center mb-5
                     shadow-[0_0_45px_-5px_rgba(245,158,11,0.6)] text-[var(--accent)] text-2xl"
        >
          ✦
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
          AI Dungeon Master
        </h1>
        <p className="mt-3 text-sm sm:text-base text-[var(--muted)] leading-relaxed">
          A text adventure where Claude is the dungeon master. Describe what you
          do; the world streams back vivid second-person prose, illustrated
          scenes, and a living world that remembers your choices.
        </p>
      </div>
      <div className="relative z-10 w-full">
        <NewAdventureForm
          inline
          onCreate={onCreate}
          ctaLabel={creating ? "Starting…" : "Begin adventure"}
          title="Begin your first adventure"
          subtitle="Pick your hero. Add a world and a backstory if you want — leave them blank and the DM picks."
        />
      </div>
      <p className="relative z-10 mt-6 text-[11px] text-[var(--muted)]">
        No login. Your progress is tied to this browser.
      </p>
    </main>
  );
}

export default function Home() {
  return (
    <ToastProvider>
      <PageInner />
    </ToastProvider>
  );
}
