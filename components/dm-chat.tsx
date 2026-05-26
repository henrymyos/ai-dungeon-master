"use client";

import { useEffect, useRef, useState } from "react";
import { MarkdownAnswer } from "@/components/markdown-answer";
import { MenuIcon, SendIcon } from "@/components/icons";
import { useToast } from "@/components/toast";
import type { DmMessageRow } from "@/lib/db";

type Props = {
  campaignId: string | null;
  campaignTitle: string;
  onOpenSidebar: () => void;
  onCampaignChanged?: () => void;
};

type Message = { id: string; role: "user" | "assistant"; content: string };

export function DmChat({
  campaignId,
  campaignTitle,
  onOpenSidebar,
  onCampaignChanged,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  // Load this campaign's history whenever the active id changes.
  useEffect(() => {
    let cancelled = false;
    if (!campaignId) {
      setMessages([]);
      return;
    }
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/messages`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Couldn't load this adventure.");
        const { messages: rows } = (await res.json()) as {
          messages: DmMessageRow[];
        };
        if (cancelled) return;
        setMessages(
          rows.map((r) => ({
            id: String(r.id),
            role: r.role,
            content: r.content,
          })),
        );
      } catch (e) {
        if (!cancelled)
          toast.error(e instanceof Error ? e.message : "Load failed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId, toast]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy, loading]);

  async function send() {
    const action = input.trim();
    if (!action || busy || !campaignId) return;

    const userId = `u-${Date.now()}`;
    const dmId = `a-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: userId, role: "user", content: action },
      { id: dmId, role: "assistant", content: "" },
    ]);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/dm/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, action }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `DM call failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamErr: string | null = null;
      let titleChanged = false;

      let pending = "";
      let scheduled = false;
      const flush = () => {
        if (!pending) {
          scheduled = false;
          return;
        }
        const t = pending;
        pending = "";
        scheduled = false;
        setMessages((m) =>
          m.map((msg) =>
            msg.id === dmId ? { ...msg, content: msg.content + t } : msg,
          ),
        );
      };
      const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(flush);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const evt of events) {
          const line = evt.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let parsed: { type: string; text?: string; message?: string };
          try {
            parsed = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (parsed.type === "token" && parsed.text) {
            pending += parsed.text;
            schedule();
          } else if (parsed.type === "title") {
            titleChanged = true;
          } else if (parsed.type === "error") {
            streamErr = parsed.message ?? "DM call failed.";
          }
        }
      }
      if (pending) flush();
      if (streamErr) throw new Error(streamErr);

      // Title or updated_at likely changed; let the sidebar refresh.
      if (titleChanged) onCampaignChanged?.();
      else onCampaignChanged?.();
    } catch (e) {
      setMessages((m) => m.filter((msg) => msg.id !== dmId));
      toast.error(e instanceof Error ? e.message : "DM call failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex-1 flex flex-col min-w-0">
      <header className="px-4 md:px-6 py-4 border-b border-[var(--border)] flex items-center gap-3">
        <button
          onClick={onOpenSidebar}
          className="md:hidden -ml-1 p-1.5 text-[var(--muted)] hover:text-zinc-100 rounded-md"
          aria-label="Open sidebar"
        >
          <MenuIcon className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium truncate">
            {campaignId ? campaignTitle : "AI Dungeon Master"}
          </h2>
          <p className="text-[11px] text-[var(--muted)]">
            {campaignId
              ? "A foggy forest at dusk · Phase 2"
              : "Pick an adventure on the left, or start a new one"}
          </p>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-6 py-6">
        {!campaignId ? (
          <EmptyState />
        ) : loading ? (
          <SkeletonChat />
        ) : (
          <ul className="max-w-3xl mx-auto space-y-6">
            {messages.map((m) =>
              m.role === "user" ? (
                <li key={m.id} className="flex justify-end">
                  <div
                    className="max-w-[80%] rounded-2xl rounded-br-md
                               bg-gradient-to-br from-[var(--accent)]/20 to-amber-600/10
                               border border-[var(--accent)]/30 text-zinc-50 px-4 py-2.5 text-sm
                               shadow-[0_4px_22px_-10px_rgba(245,158,11,0.55)]"
                  >
                    {m.content}
                  </div>
                </li>
              ) : (
                <li key={m.id}>
                  <NarrationCard content={m.content} />
                </li>
              ),
            )}
          </ul>
        )}
      </div>

      {campaignId && (
        <div className="border-t border-[var(--border)] px-4 py-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="max-w-3xl mx-auto flex items-end gap-2 bg-[#1a1410]/50 border border-[var(--border)] rounded-2xl
                       focus-within:border-[var(--accent)]/50 focus-within:shadow-[0_0_0_3px_rgba(245,158,11,0.12)]
                       transition-all px-3 py-2"
          >
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="What do you do?"
              disabled={busy}
              className="flex-1 resize-none bg-transparent outline-none text-sm py-1.5
                         placeholder:text-zinc-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || busy}
              className="shrink-0 flex items-center justify-center w-9 h-9 rounded-xl
                         bg-[var(--accent)] text-zinc-950
                         disabled:bg-[#2a1f15] disabled:text-zinc-600
                         hover:brightness-110 transition-all"
              aria-label="Send"
            >
              <SendIcon className="w-4 h-4" />
            </button>
          </form>
          <p className="max-w-3xl mx-auto mt-2 text-[11px] text-[var(--muted)] text-center">
            Type any action — &ldquo;I open the lantern&rdquo;, &ldquo;I creep
            forward&rdquo;, &ldquo;I call out&rdquo;.
          </p>
        </div>
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <div className="max-w-2xl mx-auto h-full flex flex-col items-center justify-center text-center pb-12">
      <div
        className="relative w-14 h-14 rounded-2xl bg-[var(--accent)]/15 border border-[var(--accent)]/30
                   flex items-center justify-center mb-4
                   shadow-[0_0_40px_-5px_rgba(245,158,11,0.55)] text-[var(--accent)] text-2xl"
      >
        ✦
      </div>
      <h3 className="text-lg font-medium">A campfire awaits a story.</h3>
      <p className="mt-1.5 text-sm text-[var(--muted)] max-w-md">
        Start a new adventure from the sidebar, or revisit one you&apos;ve
        already begun. Every action you take is saved, so you can close the
        tab and return whenever the night feels right.
      </p>
    </div>
  );
}

function SkeletonChat() {
  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-pulse">
      <div className="rounded-2xl border border-[var(--border)] bg-[#1a1410]/40 px-5 py-4">
        <div className="h-3 bg-[#2a1f15] rounded w-5/6 mb-2" />
        <div className="h-3 bg-[#2a1f15] rounded w-4/6 mb-2" />
        <div className="h-3 bg-[#2a1f15] rounded w-3/6" />
      </div>
    </div>
  );
}

function NarrationCard({ content }: { content: string }) {
  const isEmpty = content.length === 0;
  return (
    <div className="relative rounded-2xl border border-[var(--border)] bg-[#1a1410]/40 px-5 py-4 overflow-hidden">
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)]/60 to-transparent" />
      {isEmpty ? (
        <div className="flex items-center gap-3 text-sm text-[var(--muted)] py-1">
          <span className="flex gap-1">
            <span
              className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] pulse-dot"
              style={{ animationDelay: "0ms" }}
            />
            <span
              className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] pulse-dot"
              style={{ animationDelay: "200ms" }}
            />
            <span
              className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] pulse-dot"
              style={{ animationDelay: "400ms" }}
            />
          </span>
          The DM considers your action…
        </div>
      ) : (
        <MarkdownAnswer text={content} />
      )}
    </div>
  );
}
