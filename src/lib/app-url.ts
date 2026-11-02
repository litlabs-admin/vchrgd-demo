const DEFAULT_CUSTOMER_APP_URL = "https://payments.vchrgd.app";

function cleanUrl(value: string | null | undefined) {
  const cleaned = value?.trim().replace(/\/+$/, "");
  if (!cleaned) {
    return "";
  }

  try {
    return new URL(cleaned).origin;
  } catch {
    return "";
  }
}

function isVercelDeploymentOrigin(origin: string) {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

export function getCustomerAppUrl(requestUrl?: string) {
  const configured =
    cleanUrl(process.env.NEXT_PUBLIC_APP_URL) ||
    cleanUrl(process.env.APP_URL) ||
    cleanUrl(process.env.PUBLIC_APP_URL);

  if (configured) {
    return configured;
  }

  const requestOrigin = requestUrl ? cleanUrl(new URL(requestUrl).origin) : "";
  if (requestOrigin && !isVercelDeploymentOrigin(requestOrigin)) {
    return requestOrigin;
  }

  return DEFAULT_CUSTOMER_APP_URL;
}
