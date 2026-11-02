import Link from "next/link";
import { redirect } from "next/navigation";
import {
  changelogEntries,
  changelogLastUpdated,
  type ChangelogEntry,
  type ChangelogStatus,
} from "@/lib/changelog";
import { getAdminSession } from "@/lib/admin-auth";
import { isSuperAdminUsername } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Change Log | VCHRGD Back Office",
  robots: {
    index: false,
    follow: false,
  },
};

const statusStyles: Record<ChangelogStatus, string> = {
  Live: "border-emerald-200 bg-emerald-50 text-emerald-800",
  Configured: "border-cyan-200 bg-cyan-50 text-cyan-800",
  Demo: "border-purple-200 bg-purple-50 text-purple-800",
  Operational: "border-slate-200 bg-slate-50 text-slate-700",
};

export default async function BackofficeChangelogPage() {
  const session = await getAdminSession();
  if (!session) {
    redirect("/backoffice/login");
  }

  const categoryCounts = changelogEntries.reduce<Record<string, number>>(
    (counts, entry) => {
      entry.areas.forEach((area) => {
        counts[area] = (counts[area] ?? 0) + 1;
      });
      return counts;
    },
    {},
  );
  const topAreas = Object.entries(categoryCounts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8);

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f6fafc_0%,#eef4f8_100%)] px-4 py-8 text-slate-950">
      <div className="mx-auto max-w-[1280px]">
        <header className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00eaff]">
                Back-office change log
              </p>
              <h1 className="mt-3 text-4xl font-bold tracking-[-0.05em] text-slate-950">
                Development history and active release notes
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
                A maintained record of the VCHRGD/Frasers Plus integration work completed to date.
                This is separate from the operational audit trail, which records live admin and
                payment events.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <span className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-5 text-sm font-semibold text-slate-900">
                {session.sub} / {(await isSuperAdminUsername(session.sub)) ? "Super admin" : "Admin"}
              </span>
              <Link
                href="/backoffice"
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-900 no-underline transition hover:border-[#00c7ef] hover:text-[#008fb5]"
              >
                Back to orders
              </Link>
              <form action="/api/admin/logout" method="post">
                <button
                  type="submit"
                  className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </header>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          <StatCard
            label="Entries"
            value={String(changelogEntries.length)}
            detail="Back-filled product and integration changes recorded so far."
          />
          <StatCard
            label="Last updated"
            value={changelogLastUpdated}
            detail="Current changelog snapshot for the staging build."
          />
          <StatCard
            label="Live items"
            value={String(changelogEntries.filter((entry) => entry.status === "Live").length)}
            detail="Items currently shipped into the customer or back-office journey."
          />
        </section>

        <section className="mt-8 rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
          <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#00eaff]">
                Covered areas
              </p>
              <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-slate-950">
                Main areas changed during development
              </h2>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-slate-500">
              Use this as the quick overview; each full entry below records the actual shipped behaviour.
            </p>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {topAreas.map(([area, count]) => (
              <span
                key={area}
                className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800"
              >
                {area} ({count})
              </span>
            ))}
          </div>
        </section>

        <section className="mt-8 grid gap-5">
          {changelogEntries.map((entry) => (
            <ChangelogCard key={`${entry.date}-${entry.title}`} entry={entry} />
          ))}
        </section>
      </div>
    </main>
  );
}

function ChangelogCard({ entry }: { entry: ChangelogEntry }) {
  return (
    <article className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700">
              {entry.date}
            </span>
            <span
              className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${statusStyles[entry.status]}`}
            >
              {entry.status}
            </span>
          </div>
          <h2 className="mt-4 text-2xl font-bold tracking-[-0.04em] text-slate-950">
            {entry.title}
          </h2>
          <p className="mt-3 max-w-4xl text-sm leading-7 text-slate-600">{entry.summary}</p>
        </div>
        <div className="flex max-w-xl flex-wrap gap-2">
          {entry.areas.map((area) => (
            <span
              key={area}
              className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600"
            >
              {area}
            </span>
          ))}
        </div>
      </div>

      <ul className="mt-5 grid gap-3 text-sm leading-7 text-slate-700 md:grid-cols-2">
        {entry.details.map((detail) => (
          <li key={detail} className="rounded-[20px] border border-slate-200 bg-slate-50 p-4">
            {detail}
          </li>
        ))}
      </ul>
    </article>
  );
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#00eaff]">{label}</p>
      <strong className="mt-3 block text-3xl font-bold tracking-[-0.04em] text-slate-950">
        {value}
      </strong>
      <p className="mt-3 text-sm leading-6 text-slate-600">{detail}</p>
    </div>
  );
}
