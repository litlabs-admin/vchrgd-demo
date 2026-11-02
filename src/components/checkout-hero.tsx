import Image from "next/image";
import { ArrowDown, Lock, Phone } from "lucide-react";
import { TrustpilotWidget } from "@/components/trustpilot-widget";

const wholePounds = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

// Full-bleed, value-led hero. The site header sits on the photo so the page opens as one
// image. Uses only claims already made elsewhere on the site; finance stays at payment.
export function CheckoutHero({ fromPrice }: { fromPrice: number }) {
  const price = Number.isFinite(fromPrice) ? wholePounds.format(fromPrice) : "";

  return (
    <section
      aria-labelledby="ck-hero-title"
      className="ck-hero relative isolate z-40 flex h-[100svh] min-h-[600px] w-full flex-col overflow-hidden bg-ink text-white"
    >
      <Image
        src="/content/hero-header.jpg"
        alt="A Seven Pro charger on a brick wall, charging an electric car on a driveway"
        fill
        priority
        sizes="100vw"
        className="ck-hero-media -z-20 object-cover object-[50%_42%]"
      />
      {/* Light scrims only where text sits, so the photo stays the hero. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-40 bg-gradient-to-b from-black/45 to-transparent" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-r from-black/70 via-black/30 to-transparent" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-1/2 bg-gradient-to-t from-black/60 to-transparent" aria-hidden="true" />

      <header className="ck-hero-in relative" style={{ "--d": "150ms" } as React.CSSProperties}>
        <div className="flex h-16 w-full items-center justify-between gap-4 px-5 sm:h-20 sm:px-10 lg:px-14">
          <a href="https://www.vchrgd.com" className="flex items-center" aria-label="VCHRGD home">
            <Image src="/home-charging/assets/logo.png" alt="VCHRGD" width={146} height={44} priority className="h-6 w-auto sm:h-7" />
          </a>
          <p className="hidden items-center gap-2 text-sm text-white/85 sm:flex">
            <Lock className="h-4 w-4" aria-hidden="true" />
            Secure checkout
          </p>
          <a
            href="tel:+441494370525"
            className="ck-press inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold !text-ink hover:bg-white/90"
          >
            <Phone className="h-4 w-4" aria-hidden="true" />
            <span className="ck-num">01494 370525</span>
          </a>
        </div>
      </header>

      <div className="relative flex w-full flex-1 flex-col justify-end px-5 pb-12 sm:px-10 sm:pb-16 lg:justify-center lg:px-14 lg:pb-20">
        <div className="ck-hero-in max-w-[940px]" style={{ "--d": "300ms" } as React.CSSProperties}>
          <p className="text-sm font-medium text-white/80 lg:text-base">Seven Pro · Installed from {price}</p>
          <h1
            id="ck-hero-title"
            className="mt-3 text-balance text-[36px] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[56px] lg:text-[76px]"
          >
            Your home charger, fitted and ready to go.
          </h1>
          <p className="mt-5 max-w-[34ch] text-balance text-base leading-7 text-white/85 sm:text-lg lg:text-xl lg:leading-8">
            Standard installation included. Most installs in around two weeks.
          </p>
        </div>

        <div className="ck-hero-in mt-8 max-w-[720px] lg:mt-10" style={{ "--d": "480ms" } as React.CSSProperties}>
          <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap">
            <a
              href="#checkout"
              className="ck-press inline-flex h-[52px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-white px-7 text-base font-semibold !text-ink hover:bg-white/90"
            >
              Choose your charger
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </a>
            <a
              href="tel:+441494370525"
              className="ck-press inline-flex h-[52px] items-center justify-center gap-2 rounded-full border border-white/25 bg-white/10 px-6 text-base font-medium !text-white backdrop-blur-md hover:bg-white/20"
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
              Talk to us
            </a>
          </div>
          <div className="-ml-1 mt-5 w-[280px] max-w-full">
            <TrustpilotWidget variant="plain-dark" />
          </div>
        </div>
      </div>
    </section>
  );
}
