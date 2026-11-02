import { NextResponse, type NextRequest } from "next/server";

const CUSTOMER_HOST = "payments.vchrgd.app";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host")?.toLowerCase() ?? "";

  // Standalone preview projects (for example a client demo) set this flag so their
  // *.vercel.app address is not sent to the live checkout. Unset = live behaviour.
  const redirectDisabled = process.env.DISABLE_CUSTOMER_HOST_REDIRECT === "true";

  if (!redirectDisabled && host.endsWith(".vercel.app") && !request.nextUrl.pathname.startsWith("/api/")) {
    const url = request.nextUrl.clone();
    url.protocol = "https";
    url.host = CUSTOMER_HOST;
    return NextResponse.redirect(url, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
