import { AdminDashboardScreen } from "@/app/admin/page";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function BackofficePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <AdminDashboardScreen searchParams={searchParams} />;
}
