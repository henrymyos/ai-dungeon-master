import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "visitor_id";
const ONE_YEAR_S = 60 * 60 * 24 * 365;

// `crypto.randomUUID` is available in every Edge runtime Next.js targets.
function uuidv4(): string {
  return crypto.randomUUID();
}

/**
 * Ensures every visitor has a stable `visitor_id` cookie. The server uses
 * it as the user_id when reading/writing documents and annotations — so
 * each browser sees an isolated library without forcing a sign-in.
 */
export function proxy(req: NextRequest) {
  const existing = req.cookies.get(COOKIE)?.value;
  if (existing) return NextResponse.next();

  const id = uuidv4();
  const res = NextResponse.next();
  res.cookies.set(COOKIE, id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ONE_YEAR_S,
  });
  return res;
}

export const config = {
  // Skip static assets and Next internals.
  matcher: ["/((?!_next/|favicon.ico|.*\\..*).*)"],
};
