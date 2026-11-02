import { AdminLoginScreen } from "@/app/admin/login/page";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type BackofficeLoginPageProps = {
  searchParams: Promise<{
    error?: string | string[];
  }>;
};

export const metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function BackofficeLoginPage(props: BackofficeLoginPageProps) {
  return <AdminLoginScreen {...props} />;
}
