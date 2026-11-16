"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import Link from "next/link";

// Replaces Next's bare "Application error" when a page throws.
// retry() re-renders the failed page.
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-6 text-center">
      <p className="text-5xl" aria-hidden>🎲</p>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">The dice rolled a 1</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">Something went wrong loading this page. Try again in a moment.</p>
      <div className="mt-6 flex gap-3">
        <button
          onClick={() => retry()}
          className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-black"
        >
          Try again
        </button>
        <Link href="/" className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold">
          Home
        </Link>
      </div>
    </main>
  );
}
