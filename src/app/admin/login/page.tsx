import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSession, isAdminAuthConfigured } from "@/lib/admin-auth";
import { isGoogleAdminAuthConfigured } from "@/lib/google-admin-auth";

type AdminLoginPageProps = {
  searchParams: Promise<{
    error?: string | string[];
  }>;
};

const inputClassName =
  "mt-2 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-[#00eaff] focus:ring-4 focus:ring-[#00eaff]/15";

export default async function AdminLoginPage({ searchParams }: AdminLoginPageProps) {
  void searchParams;
  redirect("/backoffice/login");
}

export async function AdminLoginScreen({ searchParams }: AdminLoginPageProps) {
  const session = await getAdminSession();
  if (session) {
    redirect("/backoffice");
  }

  const configured = await isAdminAuthConfigured();
  const googleConfigured = isGoogleAdminAuthConfigured();
  const params = await searchParams;
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  const lockMessage = error?.startsWith("locked:") ? error.slice("locked:".length) : "";

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,#f4f8fb_100%)] px-4 py-10 text-slate-950">
      <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(320px,0.75fr)]">
        <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00eaff]">
            Merchant access point
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-[-0.05em] text-slate-950">
            Sign in to review orders and payment states.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
            This merchant-only entry point is separated from the customer checkout and is intended
            for operational review of Frasers Plus authorizations, card checkouts, and secure
            return handling.
          </p>

          {!configured ? (
            <div className="mt-8 rounded-[24px] border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
              Admin access is not configured yet. Hosted access needs
              `ADMIN_SESSION_SECRET` plus either a bootstrap env account
              (`ADMIN_USERNAME`, `ADMIN_TOTP_SECRET`, and `ADMIN_PASSWORD_HASH`) or at least one
              managed admin user already saved in the application data store.
            </div>
          ) : null}

          {error === "invalid" ? (
            <div className="mt-8 rounded-[24px] border border-rose-200 bg-rose-50 p-5 text-sm leading-6 text-rose-950">
              The username or password was not accepted.
            </div>
          ) : null}

          {lockMessage ? (
            <div className="mt-8 rounded-[24px] border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
              Too many failed sign-in attempts. Try again in {lockMessage}.
            </div>
          ) : null}

          {error === "unconfigured" ? (
            <div className="mt-8 rounded-[24px] border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
              Admin access is not configured yet.
            </div>
          ) : null}

          {error === "google_unconfigured" ? (
            <div className="mt-8 rounded-[24px] border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
              Google sign-in is not configured yet. Add the Google OAuth client ID and secret to the hosted environment.
            </div>
          ) : null}

          {error === "google_invalid" ? (
            <div className="mt-8 rounded-[24px] border border-rose-200 bg-rose-50 p-5 text-sm leading-6 text-rose-950">
              Google sign-in was not accepted. Use a Google account that matches an enabled back office admin user.
            </div>
          ) : null}

          {error === "google_cancelled" ? (
            <div className="mt-8 rounded-[24px] border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-700">
              Google sign-in was cancelled before access was granted.
            </div>
          ) : null}

          {error === "google_failed" ? (
            <div className="mt-8 rounded-[24px] border border-rose-200 bg-rose-50 p-5 text-sm leading-6 text-rose-950">
              Google sign-in could not be started. Check the OAuth configuration and try again.
            </div>
          ) : null}
        </section>

        <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
          <h2 className="text-2xl font-bold tracking-[-0.04em] text-slate-950">Admin login</h2>
          {googleConfigured ? (
            <div className="mt-6">
              <Link
                href="/api/admin/google/start"
                className="inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-950 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 text-sm font-bold text-[#4285f4]">
                  G
                </span>
                Sign in with Google
              </Link>
              <div className="my-6 flex items-center gap-3 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                <span className="h-px flex-1 bg-slate-200" />
                or
                <span className="h-px flex-1 bg-slate-200" />
              </div>
            </div>
          ) : null}
          <form action="/api/admin/session" method="post" className="mt-6 grid gap-5">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Username</span>
              <input name="username" type="text" autoComplete="username" required className={inputClassName} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Password</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className={inputClassName}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Authenticator code if this account uses MFA
              </span>
              <input
                name="totpCode"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                pattern="[0-9]{6}"
                className={inputClassName}
              />
            </label>
            <button
              type="submit"
              disabled={!configured}
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#00eaff] px-5 text-sm font-semibold text-[#04131d] transition hover:bg-[#00d2f2] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Sign in
            </button>
          </form>

          <div className="mt-8 border-t border-slate-200 pt-6 text-sm leading-6 text-slate-600">
            <p>
              Keep this route separate from the customer flow. The merchant back office lives under{" "}
              <strong className="font-semibold text-slate-950">/backoffice</strong>. The checkout
              itself remains at{" "}
              <Link href="/" className="font-semibold text-slate-950 underline decoration-slate-300">
                /
              </Link>
              .
            </p>
            <p className="mt-3">
              Sign-in uses either Google for enabled admin email accounts, or username and password
              with a 6-digit authenticator code required only for accounts where MFA is enabled.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
