export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  const secFetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();

  if (!origin) {
    return secFetchSite === "same-origin" || secFetchSite === "none";
  }

  try {
    return new URL(request.url).origin === origin;
  } catch {
    return false;
  }
}

export function isSameOriginMutationRequest(request: Request) {
  const origin = request.headers.get("origin");
  const secFetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();

  if (origin) {
    return isSameOriginRequest(request);
  }

  return secFetchSite === "same-origin" || secFetchSite === "none";
}

export function getSafeInternalRedirect(
  request: Request,
  target: string | null | undefined,
  fallbackPath: string,
) {
  if (!target) {
    return new URL(fallbackPath, request.url);
  }

  try {
    const url = new URL(target, request.url);
    const requestUrl = new URL(request.url);

    if (url.origin !== requestUrl.origin || !url.pathname.startsWith("/backoffice")) {
      return new URL(fallbackPath, request.url);
    }

    return url;
  } catch {
    return new URL(fallbackPath, request.url);
  }
}
