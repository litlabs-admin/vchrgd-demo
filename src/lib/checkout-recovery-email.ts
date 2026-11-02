type CheckoutRecoveryEmailStage = "24h" | "72h";

type CheckoutRecoveryEmailInput = {
  stage: CheckoutRecoveryEmailStage;
  firstName: string;
  customerName: string;
  chargerName: string;
  totalAmount: string;
  postcode: string;
  orderReference: string;
  recoveryLink: string;
  expiresAtLabel: string;
  brandLogoUrl?: string;
};

type CheckoutRecoveryEmail = {
  subject: string;
  previewText: string;
  html: string;
  text: string;
};

const SALES_EMAIL = "sales@vchrgd.com";
const SALES_PHONE = "+44 1494 370525";
const DEFAULT_BRAND_LOGO_URL =
  "https://payments.vchrgd.app/content/vchrgd-email-logo.png";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clean(value: string | null | undefined, fallback = "-") {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function buildCopy(input: CheckoutRecoveryEmailInput) {
  if (input.stage === "72h") {
    return {
      eyebrow: "Checkout reminder",
      subject: "Reminder: your VCHRGD checkout link expires soon",
      previewText:
        "Your charger quote and checkout are still saved, but the link will expire after 5 days.",
      heading: "Your charger checkout is still saved",
      intro:
        "Just a reminder that your VCHRGD checkout is still open. We have kept your details and charger quote saved so you can complete your order without starting again.",
      cta: "Return to secure checkout",
      note:
        "After the saved checkout expires, you may need to restart the checkout so we can confirm current pricing and availability.",
      help:
        "If you have changed your mind or need help choosing the right charger, reply to this email and we will help you.",
    };
  }

  return {
    eyebrow: "Checkout saved",
    subject: "Your VCHRGD charger checkout is still saved",
    previewText:
      "Complete your secure checkout within 5 days to keep your installation request moving.",
    heading: "Complete your charger checkout",
    intro:
      "Thanks for starting your VCHRGD home charger order. It looks like your checkout was not completed, so we have saved your details and quote for you.",
    cta: "Complete secure checkout",
    note:
      "Once payment is complete, we will send your digital survey and start the installation review process.",
    help: "If you had any issues completing payment, reply to this email and our team will help.",
  };
}

function summaryRows(input: CheckoutRecoveryEmailInput) {
  return [
    ["Customer", clean(input.customerName)],
    ["Charger", clean(input.chargerName)],
    ["Estimated total", clean(input.totalAmount)],
    ["Installation postcode", clean(input.postcode)],
    ["Reference", clean(input.orderReference)],
  ];
}

export function renderCheckoutRecoveryEmail(input: CheckoutRecoveryEmailInput): CheckoutRecoveryEmail {
  const copy = buildCopy(input);
  const firstName = clean(input.firstName, "there");
  const rows = summaryRows(input);
  const escapedLink = escapeHtml(input.recoveryLink);
  const escapedBrandLogoUrl = escapeHtml(
    clean(input.brandLogoUrl, DEFAULT_BRAND_LOGO_URL),
  );
  const textRows = rows.map(([label, value]) => `${label}: ${value}`).join("\n");

  const text = [
    `Hi ${firstName},`,
    "",
    copy.intro,
    "",
    "Order summary:",
    textRows,
    "",
    `Complete your secure checkout here: ${input.recoveryLink}`,
    "",
    `Your checkout link is available until ${input.expiresAtLabel}. ${copy.note}`,
    "",
    copy.help,
    "",
    "Thanks,",
    "VCHRGD Sales",
    SALES_EMAIL,
    SALES_PHONE,
  ].join("\n");

  const htmlRows = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:13px 0;border-bottom:1px solid #dbe5ee;color:#536985;font-size:14px;line-height:20px;">${escapeHtml(label)}</td>
          <td align="right" style="padding:13px 0;border-bottom:1px solid #dbe5ee;color:#020719;font-size:14px;line-height:20px;font-weight:700;">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${escapeHtml(copy.subject)}</title>
    <style>
      @media only screen and (max-width: 620px) {
        .container { width: 100% !important; }
        .card { border-radius: 24px !important; padding: 24px !important; }
        .hero-title { font-size: 32px !important; line-height: 34px !important; }
        .summary-card { padding: 18px !important; }
        .button { display: block !important; width: 100% !important; box-sizing: border-box !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#eef4f8;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;color:#020719;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(copy.previewText)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef4f8;">
      <tr>
        <td align="center" style="padding:28px 14px;">
          <table role="presentation" class="container" width="600" cellspacing="0" cellpadding="0" style="width:600px;max-width:600px;">
            <tr>
              <td align="center" style="padding:0 0 14px 0;text-align:center;">
                <img src="${escapedBrandLogoUrl}" width="152" height="46" alt="VCHRGD" style="display:block;width:152px;max-width:100%;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;">
              </td>
            </tr>
            <tr>
              <td class="card" style="background:#ffffff;border:1px solid #d8e3ec;border-radius:32px;padding:34px;box-shadow:0 22px 60px rgba(15,23,42,0.08);">
                <p style="margin:0 0 16px 0;color:#00cfe8;font-size:12px;line-height:16px;font-weight:800;text-transform:uppercase;letter-spacing:0.22em;">${escapeHtml(copy.eyebrow)}</p>
                <h1 class="hero-title" style="margin:0;color:#020719;font-size:40px;line-height:42px;font-weight:800;letter-spacing:-0.06em;">${escapeHtml(copy.heading)}</h1>
                <p style="margin:20px 0 0 0;color:#233b57;font-size:16px;line-height:27px;">Hi ${escapeHtml(firstName)},</p>
                <p style="margin:12px 0 0 0;color:#233b57;font-size:16px;line-height:27px;">${escapeHtml(copy.intro)}</p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="summary-card" style="margin-top:24px;background:#f8fbfd;border:1px solid #dbe5ee;border-radius:24px;padding:22px;">
                  <tr>
                    <td>
                      <p style="margin:0 0 6px 0;color:#5a7090;font-size:12px;line-height:16px;font-weight:800;text-transform:uppercase;letter-spacing:0.18em;">Order summary</p>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${htmlRows}</table>
                    </td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:28px;">
                  <tr>
                    <td align="center">
                      <a class="button" href="${escapedLink}" style="display:inline-block;background:#00d9ef;color:#020719;text-decoration:none;border-radius:999px;padding:16px 28px;font-size:16px;line-height:20px;font-weight:800;">${escapeHtml(copy.cta)}</a>
                    </td>
                  </tr>
                </table>

                <div style="margin-top:26px;background:#162449;border-radius:22px;padding:20px;">
                  <p style="margin:0;color:#ffffff;font-size:14px;line-height:23px;font-weight:700;">Your saved checkout is available until ${escapeHtml(input.expiresAtLabel)}.</p>
                  <p style="margin:10px 0 0 0;color:#d9e8f4;font-size:14px;line-height:23px;">${escapeHtml(copy.note)}</p>
                </div>

                <p style="margin:24px 0 0 0;color:#233b57;font-size:15px;line-height:25px;">${escapeHtml(copy.help)}</p>
                <p style="margin:22px 0 0 0;color:#020719;font-size:15px;line-height:24px;font-weight:700;">Thanks,<br>VCHRGD Sales</p>
                <p style="margin:8px 0 0 0;color:#536985;font-size:14px;line-height:22px;"><a href="mailto:${SALES_EMAIL}" style="color:#005f7a;text-decoration:underline;">${SALES_EMAIL}</a><br>${SALES_PHONE}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 8px 0 8px;color:#6c809a;font-size:12px;line-height:19px;text-align:center;">
                You are receiving this because you submitted your details on the VCHRGD checkout but did not complete payment.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    subject: copy.subject,
    previewText: copy.previewText,
    html,
    text,
  };
}

export type { CheckoutRecoveryEmailInput, CheckoutRecoveryEmailStage };
