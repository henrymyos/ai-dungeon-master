import Link from "next/link";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-6 text-center">
      <p className="text-5xl" aria-hidden>🗺️</p>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">This path leads nowhere</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        The page or shared adventure doesn&apos;t exist, or its link was changed.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-black"
      >
        Start an adventure
      </Link>
    </main>
  );
}
