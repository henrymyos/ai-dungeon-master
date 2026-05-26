"use client";

import { useCallback, useEffect, useState } from "react";
import { DmChat } from "@/components/dm-chat";
import { Sidebar } from "@/components/sidebar";
import { ToastProvider, useToast } from "@/components/toast";
import type { DmCampaign, DmCharacter } from "@/lib/db";
import type { ToolEvent } from "@/lib/tools";

function PageInner() {
  const [campaigns, setCampaigns] = useState<DmCampaign[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [character, setCharacter] = useState<DmCharacter | null>(null);
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

  useEffect(() => {
    (async () => {
      const list = await refresh();
      if (list && list.length > 0) setActiveId(list[0].id);
      setLoading(false);
    })();
  }, [refresh]);

  useEffect(() => {
    if (activeId) fetchCharacter(activeId);
    else setCharacter(null);
  }, [activeId, fetchCharacter]);

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
    // Apply mutations to local character state so the sidebar feels live
    // instead of waiting on the post-stream refetch.
    setCharacter((prev) => {
      if (!prev) return prev;
      if (evt.kind === "update_hp")
        return { ...prev, hp: evt.hp, max_hp: evt.max_hp };
      if (evt.kind === "add_item") {
        const inv = [...prev.inventory];
        const idx = inv.findIndex(
          (i) => i.item.toLowerCase() === evt.item.toLowerCase(),
        );
        if (idx >= 0) inv[idx] = { ...inv[idx], quantity: inv[idx].quantity + evt.quantity };
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
        onOpenSidebar={() => setSidebarOpen(true)}
        onCampaignChanged={refresh}
        onToolEvent={onToolEvent}
        onStreamEnd={() => activeId && fetchCharacter(activeId)}
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
