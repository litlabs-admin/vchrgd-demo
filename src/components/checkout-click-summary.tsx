import Link from "next/link";
import { getCheckoutClickSummary, type CheckoutClickSummary } from "@/lib/checkout-clicks";

export async function CheckoutClickAnalytics({ range }: { range?: string }) {
  const days = range === "90" ? 90 : range === "30" ? 30 : 7;
  let data: CheckoutClickSummary;
  try { data = await getCheckoutClickSummary(days); }
  catch {
    return <section id="checkout-clicks" className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
      Click activity is temporarily unavailable. Orders, payments and the rest of this dashboard are unaffected.
    </section>;
  }
  return <CheckoutClickPanel data={data} />;
}

export function CheckoutClickPanel({ data }: { data: CheckoutClickSummary }) {
  const count = (event: string) => data.events.find(item => item.event === event)?.count ?? 0;
  const format = (n: number) => n.toLocaleString("en-GB");
  const shortDate = (day: string) => new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
  const highlights = [
    { label: "Check eligibility", count: count("frasers_eligibility"), detail: "Clicks from the checkout popup" },
    { label: "Frasers Plus chosen", count: count("payment_frasers"), detail: "Payment-option clicks" },
    { label: "Continue with Frasers", count: count("frasers_continue"), detail: "Secure checkout button clicks" },
    { label: "Continue with card", count: count("card_continue"), detail: "Secure card button clicks" },
  ];
  return <section id="checkout-clicks" className="mt-8 rounded-[24px] border border-slate-200 bg-slate-50 p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#00738a]">Checkout clicks</p>
        <h3 className="mt-2 text-xl font-bold tracking-tight text-slate-950">What customers click before payment</h3>
        <p className="mt-2 text-sm text-slate-600">{shortDate(data.from)} to {shortDate(data.to)} (UK days). Separate from the journey filters above.</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">Day zero: {shortDate(data.trackingStartedOn)} {data.trackingStartedOn.slice(0, 4)}. New checkout and Frasers Plus click data only; no historical backfill.</p>
      </div>
      <nav aria-label="Click activity date range" className="flex gap-1 rounded-full border border-slate-200 bg-white p-1">
        {([7, 30, 90] as const).map(days => <Link key={days}
          href={`/backoffice?tab=kpis&clickDays=${days}#checkout-clicks`}
          aria-current={data.days === days ? "page" : undefined}
          className={`inline-flex min-h-10 items-center rounded-full px-4 text-sm font-semibold ${data.days === days ? "!bg-slate-950 !text-white" : "!text-slate-700 hover:bg-slate-100"}`}>
          {days} days
        </Link>)}
      </nav>
    </div>
    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {highlights.map(item => <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-700">{item.label}</p>
        <strong className="mt-2 block text-3xl tabular-nums text-slate-950">{format(item.count)}</strong>
        <p className="mt-1 text-xs leading-5 text-slate-500">{item.detail}</p>
      </div>)}
    </div>
    <p className="mt-5 text-sm leading-6 text-slate-600">
      {data.total === 0 ? "No clicks recorded in this window yet. Tracking starts when this feature is enabled; historical clicks cannot be recovered. " : ""}
      Counts are button activations, not unique people, successful sign-ups or payments. Repeat clicks count again.
      Privacy preferences and blocked requests may reduce totals. Squarespace clicks are not included.
    </p>
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
        <table className="w-full table-fixed text-left text-sm">
          <caption className="mb-3 text-left font-semibold text-slate-950">All tracked actions</caption>
          <thead><tr className="border-b border-slate-200 text-slate-600"><th scope="col" className="pb-2 font-medium">Action</th><th scope="col" className="w-20 pb-2 text-right font-medium">Clicks</th></tr></thead>
          <tbody>{data.events.map(item => <tr key={item.event} className="border-b border-slate-100 last:border-0">
            <th scope="row" className="py-2 pr-3 font-normal text-slate-700">{item.label}</th>
            <td className="py-2 text-right font-semibold tabular-nums text-slate-950">{format(item.count)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
        <h4 className="font-semibold text-slate-950">Recent daily activity</h4>
        <p className="mt-1 text-xs leading-5 text-slate-500">All tracked actions combined. Latest seven days in this window.</p>
        <ol className="mt-4 space-y-3">
          {data.daily.slice(0, 7).map(item => <li key={item.day} className="grid grid-cols-[4rem_1fr_3rem] items-center gap-3 text-sm">
            <span className="text-slate-600">{shortDate(item.day)}</span>
            <span className="h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true"><span className="block h-full rounded-full bg-[#00738a]"
              style={{ width: `${item.count / Math.max(1, ...data.daily.slice(0, 7).map(day => day.count)) * 100}%` }} /></span>
            <span className="text-right font-semibold tabular-nums text-slate-950">{format(item.count)}</span>
          </li>)}
        </ol>
        <p className="mt-6 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">Only action names and daily totals are stored here. No analytics cookies, customer details, payment IDs or destination tokens are recorded.</p>
      </div>
    </div>
  </section>;
}
