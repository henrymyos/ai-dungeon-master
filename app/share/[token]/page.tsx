import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { MarkdownAnswer } from "@/components/markdown-answer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const admin = db();
  const { data: campaign } = await admin
    .from("dm_campaigns")
    .select("id, title, summary, created_at")
    .eq("share_token", token)
    .single();
  if (!campaign) return notFound();

  const [{ data: messages }, { data: character }] = await Promise.all([
    admin
      .from("dm_messages")
      .select("id, role, content")
      .eq("campaign_id", campaign.id)
      .order("created_at", { ascending: true }),
    admin
      .from("dm_characters")
      .select("name, class")
      .eq("campaign_id", campaign.id)
      .single(),
  ]);

  return (
    <main className="min-h-dvh">
      <header className="px-6 py-5 border-b border-[var(--border)] flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
            Shared adventure
          </p>
          <h1 className="text-base font-semibold tracking-tight">
            {campaign.title}
          </h1>
          {character?.name && (
            <p className="text-[11px] text-[var(--muted)] mt-0.5">
              with {character.name} the {character.class}
            </p>
          )}
        </div>
        <Link
          href="/"
          className="text-xs text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
        >
          Start your own →
        </Link>
      </header>

      <div className="max-w-3xl mx-auto px-4 md:px-6 py-8 space-y-6">
        {campaign.summary && (
          <section className="rounded-2xl border border-[var(--border)] bg-[#1a1410]/30 px-5 py-4">
            <p className="text-[10px] uppercase tracking-wider text-[var(--muted)] mb-1.5">
              Previously
            </p>
            <p className="text-sm text-zinc-300 leading-relaxed italic">
              {campaign.summary}
            </p>
          </section>
        )}
        <ul className="space-y-5">
          {(messages ?? []).map((m) =>
            m.role === "user" ? (
              <li key={m.id} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-md bg-gradient-to-br from-[var(--accent)]/20 to-amber-600/10 border border-[var(--accent)]/30 text-zinc-50 px-4 py-2.5 text-sm">
                  {m.content}
                </div>
              </li>
            ) : (
              <li key={m.id}>
                <div className="relative rounded-2xl border border-[var(--border)] bg-[#1a1410]/40 px-5 py-4 overflow-hidden">
                  <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)]/60 to-transparent" />
                  <MarkdownAnswer text={m.content} />
                </div>
              </li>
            ),
          )}
        </ul>
      </div>
    </main>
  );
}
