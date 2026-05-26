# 🔥 AI Dungeon Master

A text adventure where Claude is the dungeon master. Type what you do; the world responds with vivid second-person narration, streamed token-by-token.

Built on Next.js 16 · TypeScript · Tailwind v4 · Anthropic Claude (Haiku 4.5).

> **Status:** Phase 1 — the streaming chat loop. No persistence, no character sheet, no tool use yet. See the roadmap below.

## Run it

```bash
cp .env.example .env.local
# Fill in ANTHROPIC_API_KEY

npm install
npm run dev
# → http://localhost:3000
```

## Phase 1 — what's here

- A page with a chat input.
- Type any action; the DM streams 2–4 sentences of narration via Server-Sent Events.
- "New adventure" button resets the thread.
- The system prompt and message history live entirely in React state — refreshing the page starts you over.
- The system prompt uses Anthropic's `cache_control: ephemeral` so repeated turns within ~5 minutes get a ~90% discount on those tokens.

The opening setting is a fog-shrouded forest at dusk, hardcoded. Later phases will let the player pick a setting or generate one.

## Phased roadmap

- **Phase 2** — persistent campaigns. Supabase tables for `campaigns(id, user_id, title)` and `messages(id, campaign_id, role, content)`. Sidebar of past sessions; reload picks up where you left off.
- **Phase 3** — structured character + world state. `characters(id, campaign_id, name, class, hp, max_hp, inventory jsonb, attributes jsonb)`. Passed to the DM as JSON context each turn.
- **Phase 4 — the big one** — Anthropic **tool use**. The DM calls `roll_dice`, `apply_damage`, `add_item`, `update_hp`, `set_scene` as needed. Sidebar reflects state changes live. This is the phase that turns the project into a real game and the strongest resume bullet (*agentic loop with tool use*).
- **Phase 5** — polish: per-campaign save/load, share-link URLs, conversation summarization every N turns to keep the context window bounded, optional ambience audio.

## Repository layout

```
app/
  page.tsx               main chat shell
  api/dm/stream/         POST → Server-Sent Events with token deltas
  layout.tsx · globals.css · icon.svg
components/
  dm-chat.tsx            chat + streaming consumption
  markdown-answer.tsx    react-markdown renderer
  toast.tsx              portaled toast notifications
  icons.tsx · icons-extra.tsx
lib/
  dm.ts                  system prompt + Claude streaming wrapper
  user.ts                visitor_id cookie helper (Phase 2)
  supabase/              client / server / admin (Phase 2)
proxy.ts                 sets visitor_id cookie on first request (Phase 2)
```

## Tech stack rationale

- **Claude Haiku 4.5** — fast and cheap (~$0.001 per turn) while writing surprisingly vivid prose. Sonnet works too if you want richer narration at ~5x cost.
- **SSE over `fetch` + `ReadableStream`** — same protocol pattern I used in my Paper Summarizer; reuses the rAF-batched client-side reader so the markdown tree only re-renders once per frame.
- **Prompt caching** — the DM's system prompt is identical across every turn, so it's the perfect cache target. ~30 tokens of overhead, ~90% discount on every subsequent turn.

Built by [Henry Myos](https://github.com/henrymyos).
