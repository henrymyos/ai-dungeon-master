"use client";

import { useEffect, useRef, useState } from "react";
import { MarkdownAnswer } from "@/components/markdown-answer";
import { SendIcon } from "@/components/icons";
import { useToast } from "@/components/toast";

type Message = { id: string; role: "user" | "assistant"; content: string };

const OPENING_NARRATION =
  "Fog pools knee-deep between the trees. The path you've been walking is gone — somewhere behind you, lost in the gloaming. A single lantern hangs from a low branch ahead, its flame steady despite the windless air. You hear something move, just out of sight.";

export function DmChat() {
  const [messages, setMessages] = useState<Message[]>([
    { id: "opening", role: "assistant", content: OPENING_NARRATION },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy]);

  function reset() {
    setMessages([
      { id: "opening", role: "assistant", content: OPENING_NARRATION },
    ]);
    setInput("");
  }

  async function send() {
    const action = input.trim();
    if (!action || busy) return;

    const userId = `u-${Date.now()}`;
    const dmId = `a-${Date.now()}`;
    const userMsg: Message = { id: userId, role: "user", content: action };

    setMessages((m) => [
      ...m,
      userMsg,
      { id: dmId, role: "assistant", content: "" },
    ]);
    setInput("");
    setBusy(true);

    try {
      // Build the history payload from messages + the action we just queued
      // (state hasn't flushed yet, so include it explicitly).
      const history = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch("/api/dm/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `DM call failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamErr: string | null = null;

      // Batch token deltas with rAF so the markdown tree doesn't re-render
      // per byte.
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
          } else if (parsed.type === "error") {
            streamErr = parsed.message ?? "DM call failed.";
          }
        }
      }
      if (pending) flush();
      if (streamErr) throw new Error(streamErr);
    } catch (e) {
      setMessages((m) => m.filter((msg) => msg.id !== dmId));
      toast.error(e instanceof Error ? e.message : "DM call failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex-1 flex flex-col min-w-0">
      <header className="px-4 md:px-6 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden
            className="relative inline-flex items-center justify-center w-7 h-7 rounded-lg
                       bg-[var(--accent)]/15 border border-[var(--accent)]/30
                       shadow-[0_0_18px_rgba(245,158,11,0.4)] text-[var(--accent)] text-sm"
          >
            ✦
          </span>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold tracking-tight">
              AI Dungeon Master
            </h1>
            <p className="text-[11px] text-[var(--muted)]">
              A foggy forest at dusk · Phase 1 demo
            </p>
          </div>
        </div>
        <button
          onClick={reset}
          className="text-xs text-[var(--muted)] hover:text-zinc-100 px-2.5 py-1.5 rounded-md
                     border border-[var(--border)] hover:border-zinc-700 transition-colors"
        >
          New adventure
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-6 py-6">
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
      </div>

      <div className="border-t border-[var(--border)] px-4 py-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="max-w-3xl mx-auto flex items-end gap-2 bg-zinc-900/40 border border-[var(--border)] rounded-2xl
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
                       disabled:bg-zinc-800 disabled:text-zinc-600
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
    </section>
  );
}

function NarrationCard({ content }: { content: string }) {
  const isEmpty = content.length === 0;
  return (
    <div className="relative rounded-2xl border border-[var(--border)] bg-zinc-900/30 px-5 py-4 overflow-hidden">
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
