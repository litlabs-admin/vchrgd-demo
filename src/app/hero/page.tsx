import { CheckoutPage, type CheckoutSearchParams } from "@/components/checkout-page";

// Client demo: the same checkout as "/", with a value-led hero above it.
export default async function HeroCheckout({ searchParams }: { searchParams: CheckoutSearchParams }) {
  return <CheckoutPage searchParams={searchParams} hero />;
}
