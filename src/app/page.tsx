import { CheckoutPage, type CheckoutSearchParams } from "@/components/checkout-page";

export default async function Home({ searchParams }: { searchParams: CheckoutSearchParams }) {
  return <CheckoutPage searchParams={searchParams} />;
}
