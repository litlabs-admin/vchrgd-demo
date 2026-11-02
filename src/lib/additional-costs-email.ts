type AdditionalCostLine = {
  label: string;
  amount: number;
};

type AdditionalCostsEmailInput = {
  firstName: string;
  customerName: string;
  chargerName: string;
  installationPostcode: string;
  orderReference: string;
  originalAmount: number;
  revisedTotal: number;
  alreadyPaid: number;
  balanceDue: number;
  additionalCostLines: AdditionalCostLine[];
  explanation: string;
  progressLink: string;
  paymentLink: string;
  brandLogoUrl?: string;
};

type AdditionalCostsEmail = {
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

function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Number.isFinite(amount) ? amount : 0);
}

function summaryRows(input: AdditionalCostsEmailInput) {
  return [
    ["Customer", clean(input.customerName)],
    ["Charger", clean(input.chargerName)],
    ["Installation postcode", clean(input.installationPostcode)],
    ["Order reference", clean(input.orderReference)],
  ];
}

function amountRows(input: AdditionalCostsEmailInput) {
  return [
    ["Original order", formatMoney(input.originalAmount)],
    ["Revised installation total", formatMoney(input.revisedTotal)],
    ["Already paid", formatMoney(input.alreadyPaid)],
    ["Balance to pay", formatMoney(input.balanceDue)],
  ];
}

function renderRows(rows: string[][]) {
  return rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:13px 0;border-bottom:1px solid #dbe5ee;color:#536985;font-size:14px;line-height:20px;">${escapeHtml(label)}</td>
          <td align="right" style="padding:13px 0;border-bottom:1px solid #dbe5ee;color:#020719;font-size:14px;line-height:20px;font-weight:700;">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join("");
}

export function renderAdditionalCostsEmail(
  input: AdditionalCostsEmailInput,
): AdditionalCostsEmail {
  const firstName = clean(input.firstName, "there");
  const balanceDue = formatMoney(input.balanceDue);
  const subject = `Action needed: review your ${balanceDue} installation balance`;
  const previewText =
    "Review the additional installation work identified from your survey and securely pay the remaining balance.";
  const additionalCostLines = input.additionalCostLines.length
    ? input.additionalCostLines
    : [{ label: "Additional installation work", amount: input.balanceDue }];
  const summary = summaryRows(input);
  const amounts = amountRows(input);
  const escapedPaymentLink = escapeHtml(input.paymentLink);
  const escapedProgressLink = escapeHtml(input.progressLink);
  const escapedBrandLogoUrl = escapeHtml(
    clean(input.brandLogoUrl, DEFAULT_BRAND_LOGO_URL),
  );

  const textCostLines = additionalCostLines
    .map((line) => `${clean(line.label)}: ${formatMoney(line.amount)}`)
    .join("\n");
  const textSummary = summary.map(([label, value]) => `${label}: ${value}`).join("\n");
  const textAmounts = amounts.map(([label, value]) => `${label}: ${value}`).join("\n");
  const text = [
    `Hi ${firstName},`,
    "",
    "Our installation team has reviewed your survey. Additional work is required to complete your installation safely and to the required standard.",
    "",
    clean(input.explanation, "The additional work is explained below."),
    "",
    "Additional costs:",
    textCostLines,
    "",
    textAmounts,
    "",
    `Review the costs and pay securely: ${input.paymentLink}`,
    `Track your order: ${input.progressLink}`,
    "",
    "Your tracking page will update when the balance is confirmed. Follow your progress link for the latest installation details.",
    "",
    "For your security, these links are unique to your order. VCHRGD will never ask you to send card details by email.",
    "",
    "Order summary:",
    textSummary,
    "",
    "If you have a question about the additional work, reply to this email or call our team before making payment.",
    "",
    "Thanks,",
    "VCHRGD Sales",
    SALES_EMAIL,
    SALES_PHONE,
  ].join("\n");

  const htmlCostRows = renderRows(
    additionalCostLines.map((line) => [clean(line.label), formatMoney(line.amount)]),
  );
  const htmlSummaryRows = renderRows(summary);
  const htmlAmountRows = renderRows(amounts);

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${escapeHtml(subject)}</title>
    <style>
      @media only screen and (max-width: 620px) {
        .container { width: 100% !important; }
        .card { border-radius: 24px !important; padding: 24px !important; }
        .hero-title { font-size: 32px !important; line-height: 35px !important; }
        .summary-card { padding: 18px !important; }
        .button { display: block !important; width: 100% !important; box-sizing: border-box !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#eef4f8;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;color:#020719;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(previewText)}</div>
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
                <p style="margin:0 0 16px 0;color:#00738a;font-size:12px;line-height:16px;font-weight:800;text-transform:uppercase;letter-spacing:0.22em;">Survey review update</p>
                <h1 class="hero-title" style="margin:0;color:#020719;font-size:40px;line-height:42px;font-weight:800;letter-spacing:-0.055em;">Additional installation work is required</h1>
                <p style="margin:20px 0 0 0;color:#233b57;font-size:16px;line-height:27px;">Hi ${escapeHtml(firstName)},</p>
                <p style="margin:12px 0 0 0;color:#233b57;font-size:16px;line-height:27px;">Our installation team has reviewed your survey. Additional work is required to complete your installation safely and to the required standard.</p>

                <div style="margin-top:24px;background:#f4fbfd;border:1px solid #bfeaf1;border-radius:22px;padding:20px;">
                  <p style="margin:0;color:#00738a;font-size:12px;line-height:16px;font-weight:800;text-transform:uppercase;letter-spacing:0.18em;">Why the cost has changed</p>
                  <p style="margin:10px 0 0 0;color:#233b57;font-size:15px;line-height:25px;">${escapeHtml(clean(input.explanation, "The additional work is explained below."))}</p>
                </div>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="summary-card" style="margin-top:24px;background:#f8fbfd;border:1px solid #dbe5ee;border-radius:24px;padding:22px;">
                  <tr>
                    <td>
                      <p style="margin:0 0 6px 0;color:#5a7090;font-size:12px;line-height:16px;font-weight:800;text-transform:uppercase;letter-spacing:0.18em;">Additional work</p>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${htmlCostRows}</table>
                    </td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="summary-card" style="margin-top:16px;background:#ffffff;border:2px solid #020719;border-radius:24px;padding:22px;">
                  <tr>
                    <td>
                      <p style="margin:0 0 6px 0;color:#5a7090;font-size:12px;line-height:16px;font-weight:800;text-transform:uppercase;letter-spacing:0.18em;">Payment summary</p>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${htmlAmountRows}</table>
                    </td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:28px;">
                  <tr>
                    <td align="center">
                      <a class="button" href="${escapedPaymentLink}" style="display:inline-block;background:#00d9ef;color:#020719;text-decoration:none;border-radius:999px;padding:16px 28px;font-size:16px;line-height:20px;font-weight:800;">Review costs and pay ${escapeHtml(balanceDue)} securely</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:16px 0 0 0;text-align:center;color:#536985;font-size:14px;line-height:22px;">
                  <a href="${escapedProgressLink}" style="color:#005f7a;text-decoration:underline;font-weight:700;">View your installation progress</a>
                </p>

                <div style="margin-top:26px;background:#162449;border-radius:22px;padding:20px;">
                  <p style="margin:0;color:#ffffff;font-size:14px;line-height:23px;font-weight:700;">What happens next</p>
                  <p style="margin:10px 0 0 0;color:#d9e8f4;font-size:14px;line-height:23px;">Your tracking page will update when the balance is confirmed. Follow your progress link for the latest installation details.</p>
                  <p style="margin:10px 0 0 0;color:#d9e8f4;font-size:13px;line-height:21px;">For your security, these links are unique to your order. VCHRGD will never ask you to send card details by email.</p>
                </div>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="summary-card" style="margin-top:24px;background:#f8fbfd;border:1px solid #dbe5ee;border-radius:24px;padding:22px;">
                  <tr>
                    <td>
                      <p style="margin:0 0 6px 0;color:#5a7090;font-size:12px;line-height:16px;font-weight:800;text-transform:uppercase;letter-spacing:0.18em;">Order summary</p>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${htmlSummaryRows}</table>
                    </td>
                  </tr>
                </table>

                <p style="margin:24px 0 0 0;color:#233b57;font-size:15px;line-height:25px;">If you have a question about the additional work, reply to this email or call our team before making payment.</p>
                <p style="margin:22px 0 0 0;color:#020719;font-size:15px;line-height:24px;font-weight:700;">Thanks,<br>VCHRGD Sales</p>
                <p style="margin:8px 0 0 0;color:#536985;font-size:14px;line-height:22px;"><a href="mailto:${SALES_EMAIL}" style="color:#005f7a;text-decoration:underline;">${SALES_EMAIL}</a><br>${SALES_PHONE}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 8px 0 8px;color:#6c809a;font-size:12px;line-height:19px;text-align:center;">
                You are receiving this because the VCHRGD installation team reviewed the survey for your paid charger order and identified additional work.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    subject,
    previewText,
    html,
    text,
  };
}

export type { AdditionalCostLine, AdditionalCostsEmailInput };
