"use client";

import { useCallback, useEffect, useState } from "react";
import { DmChat } from "@/components/dm-chat";
import { Sidebar } from "@/components/sidebar";
import { ToastProvider, useToast } from "@/components/toast";
import type { DmCampaign, DmCharacter, DmWorld } from "@/lib/db";
import type { ToolEvent } from "@/lib/tools";

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

  async function newCampaign() {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/campaigns", { method: "POST" });
      if (!res.ok) throw new Error("Couldn't start a new adventure.");
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
      evt.kind === "record_lore"
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
        return prev;
      });
    }
  }

  const active = campaigns.find((c) => c.id === activeId) ?? null;

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
      />
    </div>
  );
}

export default function Home() {
  return (
    <ToastProvider>
      <PageInner />
    </ToastProvider>
  );
}
