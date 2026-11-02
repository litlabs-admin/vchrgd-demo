import { JWT } from "google-auth-library";
import { getVercelOidcToken } from "@vercel/oidc";

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const IAM_SCOPE = "https://www.googleapis.com/auth/iam";
const STS_TOKEN_URL = "https://sts.googleapis.com/v1/token";

type SendGmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  oidcToken?: string | null;
};

function clean(value: string | undefined) {
  return value?.trim() ?? "";
}

function getGmailSenderConfig() {
  const sender = clean(process.env.GOOGLE_GMAIL_IMPERSONATE_USER);
  const allowedSender = clean(process.env.GOOGLE_GMAIL_ALLOWED_SENDER);

  return {
    sender,
    allowedSender,
    serviceAccountEmail:
      clean(process.env.GOOGLE_GMAIL_SERVICE_ACCOUNT_EMAIL) ||
      clean(process.env.GCP_SERVICE_ACCOUNT_EMAIL),
    projectNumber: clean(process.env.GCP_PROJECT_NUMBER),
    workloadIdentityPoolId:
      clean(process.env.GCP_WORKLOAD_IDENTITY_POOL_ID) || "vercel",
    workloadIdentityProviderId:
      clean(process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID) || "vercel",
    audience:
      clean(process.env.GCP_AUDIENCE) ||
      clean(process.env.GOOGLE_WORKLOAD_IDENTITY_AUDIENCE),
    clientEmail: clean(process.env.GOOGLE_GMAIL_CLIENT_EMAIL),
    privateKey: clean(process.env.GOOGLE_GMAIL_PRIVATE_KEY).replace(/\\n/g, "\n"),
  };
}

function assertSenderIsLocked(sender: string, allowedSender: string) {
  if (!sender || !allowedSender || sender.toLowerCase() !== allowedSender.toLowerCase()) {
    throw new Error("Gmail sender is not locked to the configured allowed sender.");
  }
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function encodeHeader(value: string) {
  if (/^[\x20-\x7e]*$/.test(value)) {
    return value;
  }

  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function buildMimeMessage({
  from,
  to,
  subject,
  html,
  text,
}: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}) {
  const boundary = `vchrgd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  return [
    `From: VCHRGD Sales <${from}>`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

function getWorkloadIdentityAudience() {
  const config = getGmailSenderConfig();
  const audience =
    config.audience ||
    `//iam.googleapis.com/projects/${config.projectNumber}/locations/global/workloadIdentityPools/${config.workloadIdentityPoolId}/providers/${config.workloadIdentityProviderId}`;

  if (!config.projectNumber || !config.serviceAccountEmail || !audience) {
    throw new Error("Missing Google Workload Identity Federation configuration.");
  }

  return audience;
}

function buildKeyBasedClient() {
  const config = getGmailSenderConfig();
  const allowPrivateKeyFallback =
    process.env.NODE_ENV !== "production" ||
    process.env.GOOGLE_GMAIL_ALLOW_PRIVATE_KEY_FALLBACK === "true";

  if (!allowPrivateKeyFallback && (config.clientEmail || config.privateKey)) {
    throw new Error("Gmail private-key fallback is disabled in production. Use Vercel OIDC and Google Workload Identity Federation.");
  }

  if (!config.clientEmail || !config.privateKey) {
    return null;
  }

  return new JWT({
    email: config.clientEmail,
    key: config.privateKey,
    scopes: [GMAIL_SEND_SCOPE],
    subject: config.sender,
  });
}

async function getAccessToken(oidcToken?: string | null) {
  const config = getGmailSenderConfig();
  assertSenderIsLocked(config.sender, config.allowedSender);

  const keyClient = buildKeyBasedClient();
  if (keyClient) {
    const token = await keyClient.getAccessToken();
    if (!token.token) {
      throw new Error("Google did not return a Gmail access token.");
    }
    return token.token;
  }

  const workloadIdentityAudience = getWorkloadIdentityAudience();
  let subjectToken = oidcToken;

  try {
    subjectToken = await getVercelOidcToken({
      audience: workloadIdentityAudience,
    });
  } catch (error) {
    if (process.env.NODE_ENV === "production" || !subjectToken) {
      throw new Error(
        error instanceof Error
          ? `Missing Vercel OIDC token for keyless Gmail sending: ${error.message}`
          : "Missing Vercel OIDC token for keyless Gmail sending.",
      );
    }
  }

  const stsResponse = await fetch(STS_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience: workloadIdentityAudience,
      scope: IAM_SCOPE,
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      subject_token: subjectToken,
    }),
  });
  const stsData = (await stsResponse.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!stsResponse.ok || !stsData.access_token) {
    throw new Error(
      stsData.error_description ||
        stsData.error ||
        "Google STS did not exchange the Vercel OIDC token.",
    );
  }

  const impersonationResponse = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(config.serviceAccountEmail)}:generateAccessToken`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stsData.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: [IAM_SCOPE],
        lifetime: "3600s",
      }),
    },
  );
  const impersonationData = (await impersonationResponse.json()) as {
    accessToken?: string;
    error?: { message?: string };
  };

  if (!impersonationResponse.ok || !impersonationData.accessToken) {
    throw new Error(
      impersonationData.error?.message ||
        "Google IAM Credentials could not generate an access token for the Gmail service account.",
    );
  }

  const jwtPayload = JSON.stringify({
      iss: config.serviceAccountEmail,
      scope: GMAIL_SEND_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      sub: config.sender,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const signResponse = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(config.serviceAccountEmail)}:signJwt`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stsData.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ payload: jwtPayload }),
    },
  );
  const signedJwt = (await signResponse.json()) as {
    signedJwt?: string;
    error?: { message?: string };
  };

  if (!signResponse.ok || !signedJwt.signedJwt) {
    throw new Error(
      signedJwt.error?.message ||
        "Google IAM Credentials could not sign the delegated Gmail JWT.",
    );
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedJwt.signedJwt,
    }),
  });
  const data = (await response.json()) as { access_token?: string; error?: string; error_description?: string };

  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Google did not return a Gmail access token.");
  }

  return data.access_token;
}

export async function sendGmailMessage(input: SendGmailInput) {
  const config = getGmailSenderConfig();
  assertSenderIsLocked(config.sender, config.allowedSender);

  const raw = encodeBase64Url(
    buildMimeMessage({
      from: config.sender,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  );
  const accessToken = await getAccessToken(input.oidcToken);

  const response = await fetch(GMAIL_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  const data = await response.json();

  if (!response.ok) {
    const detail =
      typeof data?.error?.message === "string"
        ? data.error.message
        : "Gmail rejected the message send request.";
    throw new Error(detail);
  }

  return data as { id?: string; threadId?: string };
}

export function isGmailSenderConfigured() {
  const config = getGmailSenderConfig();
  return Boolean(
    config.sender &&
      config.allowedSender &&
      config.sender.toLowerCase() === config.allowedSender.toLowerCase() &&
      ((process.env.NODE_ENV !== "production" &&
          config.clientEmail &&
          config.privateKey) ||
        (config.serviceAccountEmail &&
          config.projectNumber &&
          config.workloadIdentityPoolId &&
          config.workloadIdentityProviderId)),
  );
}
