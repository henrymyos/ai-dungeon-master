"use client";

import { useEffect, useRef, useState } from "react";
import { MarkdownAnswer } from "@/components/markdown-answer";
import { MenuIcon, SendIcon } from "@/components/icons";
import { useToast } from "@/components/toast";
import type { DmMessageRow } from "@/lib/db";
import type { ToolEvent } from "@/lib/tools";

type Props = {
  campaignId: string | null;
  campaignTitle: string;
  shareToken: string | null;
  onOpenSidebar: () => void;
  onCampaignChanged?: () => void;
  onToolEvent?: (evt: ToolEvent) => void;
  onStreamEnd?: () => void;
  onShareTokenChanged?: () => void;
};

type Message =
  | { id: string; kind: "msg"; role: "user" | "assistant"; content: string }
  | { id: string; kind: "tool"; event: ToolEvent };

export function DmChat({
  campaignId,
  campaignTitle,
  shareToken,
  onOpenSidebar,
  onCampaignChanged,
  onToolEvent,
  onStreamEnd,
  onShareTokenChanged,
}: Props) {
  const [shareOpen, setShareOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
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
            kind: "msg" as const,
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
      { id: userId, kind: "msg", role: "user", content: action },
      { id: dmId, kind: "msg", role: "assistant", content: "" },
    ]);
    setInput("");
    setBusy(true);

    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const res = await fetch("/api/dm/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, action }),
        signal: ctrl.signal,
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
      // Track which assistant message we're appending to. When a tool fires,
      // we close the current assistant card and start a new one for the
      // text that follows.
      let currentDmId = dmId;
      const flush = () => {
        if (!pending) {
          scheduled = false;
          return;
        }
        const t = pending;
        pending = "";
        scheduled = false;
        const targetId = currentDmId;
        setMessages((m) =>
          m.map((msg) =>
            msg.id === targetId && msg.kind === "msg"
              ? { ...msg, content: msg.content + t }
              : msg,
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
          let parsed: {
            type: string;
            text?: string;
            message?: string;
            event?: ToolEvent;
          };
          try {
            parsed = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (parsed.type === "token" && parsed.text) {
            pending += parsed.text;
            schedule();
          } else if (parsed.type === "tool" && parsed.event) {
            // Drain any in-flight tokens to the current card before
            // appending the tool effect so order is preserved visually.
            flush();
            const toolEvt = parsed.event;
            const nextDmId = `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            setMessages((m) => {
              const out = [...m];
              // Drop the current assistant card if it never received any text.
              const lastIdx = out.findIndex((x) => x.id === currentDmId);
              if (
                lastIdx >= 0 &&
                out[lastIdx].kind === "msg" &&
                out[lastIdx].content.length === 0
              ) {
                out.splice(lastIdx, 1);
              }
              out.push({
                id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                kind: "tool",
                event: toolEvt,
              });
              out.push({
                id: nextDmId,
                kind: "msg",
                role: "assistant",
                content: "",
              });
              return out;
            });
            currentDmId = nextDmId;
            onToolEvent?.(toolEvt);
          } else if (parsed.type === "title") {
            titleChanged = true;
          } else if (parsed.type === "error") {
            streamErr = parsed.message ?? "DM call failed.";
          }
        }
      }
      if (pending) flush();

      // Clean up any trailing empty assistant card.
      setMessages((m) =>
        m.filter(
          (x) => !(x.kind === "msg" && x.role === "assistant" && x.content.length === 0),
        ),
      );

      if (streamErr) throw new Error(streamErr);

      onCampaignChanged?.();
      onStreamEnd?.();
    } catch (e) {
      setMessages((m) =>
        m.filter(
          (msg) =>
            !(
              msg.kind === "msg" &&
              msg.role === "assistant" &&
              msg.content.length === 0
            ),
        ),
      );
      if (e instanceof Error && e.name !== "AbortError") {
        toast.error(e.message);
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
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
              ? "A foggy forest at dusk"
              : "Pick an adventure on the left, or start a new one"}
          </p>
        </div>
        {campaignId && (
          <button
            onClick={() => setShareOpen(true)}
            className="text-xs text-[var(--muted)] hover:text-[var(--accent)] border border-[var(--border)] hover:border-[var(--accent)]/40 px-2.5 py-1.5 rounded-md transition-colors"
          >
            Share
          </button>
        )}
      </header>
      {campaignId && (
        <ShareModal
          open={shareOpen}
          campaignId={campaignId}
          shareToken={shareToken}
          onClose={() => setShareOpen(false)}
          onChange={onShareTokenChanged ?? (() => {})}
        />
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-6 py-6">
        {!campaignId ? (
          <EmptyState />
        ) : loading ? (
          <SkeletonChat />
        ) : (
          <ul className="max-w-3xl mx-auto space-y-4">
            {messages.map((m) => {
              if (m.kind === "tool")
                return (
                  <li key={m.id}>
                    <ToolEffectCard event={m.event} />
                  </li>
                );
              return m.role === "user" ? (
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
              );
            })}
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
            {busy ? (
              <button
                type="button"
                onClick={stop}
                className="shrink-0 flex items-center justify-center w-9 h-9 rounded-xl
                           bg-zinc-800 text-zinc-100 border border-zinc-700
                           hover:bg-zinc-700 transition-all"
                aria-label="Stop"
                title="Stop generating"
              >
                <span className="w-2.5 h-2.5 bg-zinc-100 rounded-sm" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="shrink-0 flex items-center justify-center w-9 h-9 rounded-xl
                           bg-[var(--accent)] text-zinc-950
                           disabled:bg-[#2a1f15] disabled:text-zinc-600
                           hover:brightness-110 transition-all"
                aria-label="Send"
              >
                <SendIcon className="w-4 h-4" />
              </button>
            )}
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

function ShareModal({
  open,
  campaignId,
  shareToken,
  onClose,
  onChange,
}: {
  open: boolean;
  campaignId: string;
  shareToken: string | null;
  onClose: () => void;
  onChange: () => void;
}) {
  const [token, setToken] = useState<string | null>(shareToken);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  useEffect(() => setToken(shareToken), [shareToken]);
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const url = token
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/${token}`
    : null;

  async function generate() {
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/share`, {
        method: "POST",
      });
      const body = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !body.token) throw new Error(body.error ?? "failed");
      setToken(body.token);
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create link.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/share`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("revoke failed");
      setToken(null);
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't revoke link.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy.");
    }
  }

  return (
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
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold">Share this adventure</h2>
          <p className="mt-1 text-xs text-[var(--muted)] leading-relaxed">
            Anyone with the link can read the transcript and character sheet.
            They can&apos;t add to your story or see your other campaigns.
          </p>
        </div>
        <div className="px-5 py-4 space-y-3">
          {url ? (
            <>
              <div className="flex items-stretch gap-2">
                <input
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 bg-zinc-900/60 border border-[var(--border)] rounded-md px-3 py-2 text-xs font-mono text-zinc-100 outline-none"
                />
                <button
                  onClick={copy}
                  className="px-3 py-2 text-xs rounded-md font-medium bg-[var(--accent)] text-zinc-950 hover:brightness-110 transition-all"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <button
                disabled={busy}
                onClick={revoke}
                className="text-[11px] text-red-400/80 hover:text-red-300 transition-colors"
              >
                Revoke link
              </button>
            </>
          ) : (
            <button
              disabled={busy}
              onClick={generate}
              className="w-full px-3 py-2 text-sm rounded-md font-medium bg-[var(--accent)] text-zinc-950 hover:brightness-110 disabled:opacity-50 transition-all"
            >
              {busy ? "Creating…" : "Create share link"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolEffectCard({ event }: { event: ToolEvent }) {
  let glyph = "•";
  let title = "";
  let detail = "";
  let tone = "default";

  if (event.kind === "roll_dice") {
    glyph = "🎲";
    const rollText =
      event.rolls.length > 1
        ? `${event.rolls.join(" + ")} = ${event.total}`
        : `${event.total}`;
    title = `${event.count}d${event.sides} — ${event.reason}`;
    detail = rollText;
  } else if (event.kind === "update_hp") {
    const dmg = event.delta < 0;
    glyph = dmg ? "💢" : "✚";
    tone = dmg ? "bad" : "good";
    title = `${dmg ? "" : "+"}${event.delta} HP · ${event.reason}`;
    detail = `${event.hp} / ${event.max_hp}`;
  } else if (event.kind === "add_item") {
    glyph = "🎒";
    tone = "good";
    title = `Picked up ${event.item}${event.quantity > 1 ? ` ×${event.quantity}` : ""}`;
  } else if (event.kind === "remove_item") {
    glyph = "🪤";
    title = `Lost ${event.item}${event.quantity > 1 ? ` ×${event.quantity}` : ""}`;
  }

  const ring =
    tone === "bad"
      ? "border-red-500/40 bg-red-500/[0.06]"
      : tone === "good"
        ? "border-emerald-500/40 bg-emerald-500/[0.06]"
        : "border-[var(--accent)]/40 bg-[var(--accent)]/[0.06]";

  return (
    <div
      className={`inline-flex items-center gap-2.5 rounded-lg border ${ring} px-3 py-1.5 text-xs`}
    >
      <span aria-hidden className="text-base leading-none">
        {glyph}
      </span>
      <span className="text-zinc-200">{title}</span>
      {detail && (
        <span className="font-mono text-[11px] text-[var(--accent)]">
          {detail}
        </span>
      )}
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
