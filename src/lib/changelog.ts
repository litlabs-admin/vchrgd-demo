export type ChangelogStatus = "Live" | "Configured" | "Demo" | "Operational";

export type ChangelogEntry = {
  date: string;
  title: string;
  status: ChangelogStatus;
  summary: string;
  details: string[];
  areas: string[];
};

export const changelogEntries: ChangelogEntry[] = [
  {
    date: "29 Oct 2026",
    title: "D2C review fixes verified for repository handover, pending deployment",
    status: "Configured",
    summary: "Prepared and verified the eight review fixes without changing the live site.",
    details: [
      "Updated affected dependencies; the final lockfile audit reports zero known vulnerabilities.",
      "Added transactional state mutations and durable balance-checkout reservations; verified concurrent orders and rollback against isolated PostgreSQL.",
      "Hardened legacy Frasers captures, terminal refunds, administrator session revocation, notification receipts and payment-session lookup.",
      "Passed eleven offline suites, including 57 new remediation assertions, security controls, lint, TypeScript and production build checks.",
      "Updated handover, source provenance and release gates. Provider staging acceptance and production deployment remain separate owner actions."
    ],
    areas: ["Security", "Payments", "Persistence", "Handover"]
  },
  {
    date: "28 Oct 2026",
    title: "Frasers Plus eligibility URL corrected locally, pending publication",
    status: "Configured",
    summary: "Prepared the supplied application URL in the D2C popup and Squarespace handover embeds; not deployed.",
    details: [
      "Corrected the application query to partner=VCHRGD, template=online and location=frasersplus_webpage.",
      "Updated the local popup, Squarespace embed/test pack and installation instructions together.",
      "No live Vercel or Squarespace publication, provider configuration or customer data change was made."
    ],
    areas: ["Frasers Plus", "Popup", "Marketing"]
  },
  {
    "date": "28 Oct 2026",
    "title": "Private company GitHub repository prepared for initial publication",
    "status": "Operational",
    "summary": "Connected the reviewed production handover source to VCHRGD/vchrgd-d2c without connecting live deployments.",
    "details": [
      "Verified the company repository is private and empty before initial upload.",
      "Rechecked all 205 uploaded production hashes against the active deployment and reviewed reachable history for private artifacts and credential findings.",
      "Prepared main and the handover branch for publication; Chapeau collaborator access remains a separate explicit grant.",
      "Preserved the live Vercel deployment, environment settings, customer data and provider configuration."
    ],
    "areas": [
      "GitHub",
      "Source control",
      "Handover"
    ]
  },
  {
    "date": "21 Oct 2026",
    "title": "Production source recovery and company handover prepared locally",
    "status": "Operational",
    "summary": "Consolidated verified production source, documentation and supporting tools in Git without deploying.",
    "details": [
      "Matched all 205 Vercel source files to the active 15 October deployment and matched the live fixed-IP proxy SHA-256.",
      "Preserved previous uncommitted work outside the repository and retained the existing Git history.",
      "Updated the README, lifetime history, operating guide, environment inventory and development checks.",
      "No live deployment, configuration, customer data, financial operation or notification was changed. The extended application changelog is local until a later release."
    ],
    "areas": [
      "Git",
      "Documentation",
      "Handover"
    ]
  },
  {
    "date": "15 Oct 2026",
    "title": "Landing statistics simplified to daily aggregate counters",
    "status": "Live",
    "summary": "Replaced the initial visitor/session analytics and large prompt with simple site statistics.",
    "details": [
      "Counted page views, visible-time engagement and repeat button interactions with short-lived delivery keys.",
      "Removed persistent analytics visitor/session identifiers; retained an opt-out preference and respected GPC, Do Not Track and existing refusal.",
      "Added a collapsed footer notice and aggregate back-office KPIs; checkout/payment source was preserved."
    ],
    "areas": [
      "Landing page",
      "Analytics",
      "Privacy"
    ]
  },
  {
    "date": "15 Oct 2026",
    "title": "Home-charging landing page published on production",
    "status": "Live",
    "summary": "Published the approved home-charging campaign page alongside the existing production checkout.",
    "details": [
      "Added responsive product, finance, app, calculator, review and footer content under /home-charging/.",
      "Pointed purchase links to live checkout and added canonical/indexing settings.",
      "Added landing statistics and a protected daily cleanup job; the initial visitor/session implementation was superseded later the same day.",
      "Preserved the production payment handlers, customer data and existing scheduled jobs."
    ],
    "areas": [
      "Landing page",
      "Marketing",
      "Reporting"
    ]
  },
  {
    "date": "14 Oct 2026",
    "title": "Landing brand, alignment and purchase CTA reviewed on staging",
    "status": "Configured",
    "summary": "Applied brand/footer feedback, aligned finance plan headings and refined the hero purchase CTA.",
    "details": [
      "Used the official horizontal Frasers logo and reviewed desktop/mobile presentation.",
      "Changed the first-section button to Buy your Seven Pro.",
      "These staging changes preceded the approved 15 October production publication."
    ],
    "areas": [
      "Landing page",
      "Staging",
      "Brand"
    ]
  },
  {
    "date": "12 Oct 2026",
    "title": "Checkout estimate and payment wording aligned",
    "status": "Live",
    "summary": "Clarified estimate wording before payment selection and the selected payment method afterwards.",
    "details": [
      "Labelled the pre-selection total Installation estimate and the card summary Pay today by card.",
      "Kept Frasers repayment-plan selection in the provider app.",
      "Applied the copy changes to staging and production without changing payment logic."
    ],
    "areas": [
      "Checkout",
      "Content"
    ]
  },
  {
    "date": "6 Oct 2026",
    "title": "Home-charging landing preview introduced on staging",
    "status": "Configured",
    "summary": "Introduced the static responsive home-charging page for design and content review.",
    "details": [
      "Added product exploration, installation pricing, a charging-cost calculator, Frasers information and Trustpilot embeds.",
      "Kept staging CTAs within the staging checkout; production publication followed on 15 October."
    ],
    "areas": [
      "Landing page",
      "Staging"
    ]
  },
  {
    "date": "29 Sep 2026",
    "title": "Overdue-stage Google Chat delivery repaired",
    "status": "Live",
    "summary": "Repaired rejected incoming-webhook request IDs and confirmed a scheduled production alert.",
    "details": [
      "Added safe error-category diagnostics and switched new deliveries to plain incoming-webhook transport.",
      "Used durable atomic reservations and receipts to prevent duplicate delivery.",
      "Held ambiguous outcomes for operator review instead of blindly resending.",
      "The historical release record confirmed the scheduled 16:00 UTC run succeeded; handover did not send a test message."
    ],
    "areas": [
      "Google Chat",
      "Operations",
      "Reliability"
    ]
  },
  {
    "date": "25 Sep 2026",
    "title": "Manual and provider refund controls unified",
    "status": "Live",
    "summary": "Added consistent cancellation/refund controls across project stages and the refund queue.",
    "details": [
      "Separated recording an already completed external refund from requesting a real provider refund.",
      "Verified original transactions, amounts and currency; tracked pending/uncertain outcomes rather than assuming completion.",
      "Added dedupe reservations and required separate reconciliation for paid extras/replacement payments."
    ],
    "areas": [
      "Refunds",
      "Back office",
      "Audit"
    ]
  },
  {
    "date": "24 Sep 2026",
    "title": "Production checkout and webhook security hardened",
    "status": "Live",
    "summary": "Hardened order access, pricing authority, callback replay protection and administrative sessions.",
    "details": [
      "Required order-bound access capabilities and server-calculated prices for checkout mutations.",
      "Rejected client-asserted payment completion and protected private voucher/offer information.",
      "Failed closed on missing Jumptech signing configuration, rejected stale timestamps and deduplicated authenticated replays.",
      "Tightened disabled-admin access, Frasers return binding and redirect destinations; updated dependencies."
    ],
    "areas": [
      "Security",
      "Payments",
      "Webhooks"
    ]
  },
  {
    "date": "23 Sep 2026",
    "title": "Approved DNO orders progress to booking",
    "status": "Live",
    "summary": "Reconciled approved DNO and survey states so eligible orders can enter the booking queue.",
    "details": [
      "Preserved actual booking, installation, payment, installer and purchase-order state.",
      "Prevented completed/terminal orders being reopened by operational reconciliation."
    ],
    "areas": [
      "DNO",
      "Booking",
      "Jumptech"
    ]
  },
  {
    "date": "17 Sep 2026",
    "title": "Preferred installation dates limited to legacy cohorts",
    "status": "Live",
    "summary": "Removed preferred-date selection for new orders while preserving eligible historical orders.",
    "details": [
      "Snapshotted eligibility from original checkout/payment start and the configured cutoff.",
      "Removed the picker and rejected preference writes for disabled cohorts.",
      "Preserved confirmed booking, historical preferences and existing operational data."
    ],
    "areas": [
      "Customer portal",
      "Booking",
      "Policy"
    ]
  },
  {
    "date": "17 Sep 2026",
    "title": "Checkout finance click reporting introduced",
    "status": "Live",
    "summary": "Added day-zero aggregate reporting for Frasers eligibility and checkout actions.",
    "details": [
      "Tracked action activations rather than unique people, without historical backfill.",
      "Kept Squarespace activity and completed-payment reporting separate."
    ],
    "areas": [
      "Analytics",
      "Checkout"
    ]
  },
  {
    "date": "16 Sep 2026",
    "title": "Paid-order stage clocks and overdue alerts added",
    "status": "Live",
    "summary": "Added stage timing and scheduled alerts for eligible overdue paid orders.",
    "details": [
      "Used durable stage episodes and sent receipts to avoid repeated alerts for an unchanged stage.",
      "Preserved payment and booking behaviour; later transport repair is recorded on 29 September."
    ],
    "areas": [
      "Operations",
      "Google Chat",
      "Back office"
    ]
  },
  {
    "date": "16 Sep 2026",
    "title": "Frasers promotion added to charger selection",
    "status": "Live",
    "summary": "Added a responsive finance-promotion popup to the initial selection journey.",
    "details": [
      "Kept the established checkout/payment flow and pricing intact.",
      "Used approved finance presentation and dismissal controls."
    ],
    "areas": [
      "Checkout",
      "Frasers Plus",
      "Marketing"
    ]
  },
  {
    "date": "15 Sep 2026",
    "title": "Frasers Plus activated on production",
    "status": "Live",
    "summary": "Enabled the approved production Frasers route after the hidden presentation and webhook preparation.",
    "details": [
      "Enabled both server and public Frasers feature flags on the production project.",
      "Retained authenticated callbacks, signed returns and the fixed-IP live proxy.",
      "Applied the approved logo and CTA presentation; earlier Configured entries below record preparation, not the current disabled state.",
      "Activation records and synthetic checks do not constitute a new live transaction certification."
    ],
    "areas": [
      "Frasers Plus",
      "Production",
      "Checkout"
    ]
  },
  {
    date: "15 Sep 2026",
    title: "Frasers Plus production presentation prepared behind feature flags",
    status: "Configured",
    summary:
      "Prepared the approved Frasers checkout branding and disclosure on the production application without enabling public Frasers checkout.",
    details: [
      "Included the approved brand colourways, official horizontal logos and dark plum continue button.",
      "Kept both Frasers enable flags off and retained the authenticated production webhook.",
      "Preserved current production pricing, orders, back office, additional-cost emails, Revolut auto-capture and integration settings.",
      "No real payment was initiated. Public activation remains a separate release step.",
    ],
    areas: ["Frasers Plus", "Checkout", "Release preparation"],
  },
  {
    date: "15 Sep 2026",
    title: "Frasers Plus production webhook handoff",
    status: "Configured",
    summary:
      "Prepared the authenticated production callback while keeping public Frasers Plus checkout disabled.",
    details: [
      "Added fail-closed bearer verification and retryable capture failures.",
      "Preserved completed capture and refund state when delayed callbacks are received.",
      "Required capture confirmation rather than treating a pending HTTP acknowledgement as paid.",
      "Kept unfamiliar callbacks out of production orders, including any outstanding staging payments.",
      "Retained the existing static-IP live proxy, checkout screens, back office, Revolut settings and operational data.",
    ],
    areas: ["Frasers Plus", "Webhooks", "Security"],
  },
  {
    date: "8 Sep 2026",
    title: "Outstanding balances remain payable after booking",
    status: "Live",
    summary:
      "Kept additional-payment controls available on booked and installed orders until the outstanding balance is settled.",
    details: [
      "Added a direct secure payment link to the outstanding-balance prompt.",
      "Preserved booking and installation stages when late balance payments start, fail or complete.",
      "Prevented completed balance payments from moving scheduled Jumptech projects back to quote approved.",
      "Cleared the persisted outstanding-balance flag after confirmed payment and prevented stale quote updates reopening it.",
      "Added exact-order, deduplicated email recovery and a non-sending preflight while keeping automatic emails restricted to quote approval.",
    ],
    areas: ["Customer journey", "Payments", "Jumptech", "Email"],
  },
  {
    date: "4 Sep 2026",
    title: "Automatic additional costs customer emails",
    status: "Live",
    summary:
      "Added automatic, personalised additional-cost emails when Jumptech moves an unpaid amended order to quote approved.",
    details: [
      "Restricted automatic delivery to quote-approved orders with a valid customer email and a positive unpaid balance.",
      "Included the customer progress link, secure balance-payment link, revised order total, and additional-work explanation.",
      "Added persistent sent, amount, Gmail message, and failure details to the order workflow and audit trail.",
      "Added database-backed deduplication so repeated Jumptech webhooks cannot resend the same balance email.",
      "Added a protected operational endpoint for deliberate recovery sends to eligible customers.",
    ],
    areas: ["Email", "Jumptech", "Customer journey", "Payments", "Audit"],
  },
  {
    date: "17 Aug 2026",
    title: "Installer PO dispatch confirmation",
    status: "Configured",
    summary:
      "Added a durable back-office confirmation for sent installer purchase orders with an auditable Google Chat notification.",
    details: [
      "Added a PO-sent checkbox and confirmation action after a work order has been generated.",
      "Recorded the confirming administrator and timestamp against the persisted work-order record.",
      "Added a deduplicated Google Chat notification containing the PO number, order reference, customer, installer, and confirming administrator.",
      "Preserved the sent state when an existing PO is downloaded or regenerated.",
    ],
    areas: ["Back office", "Work orders", "Google Chat", "Audit"],
  },
  {
    date: "31 Jul 2026",
    title: "Revolut production payment hardening",
    status: "Configured",
    summary:
      "Prepared Revolut hosted checkout for the live card route with captured-payment gating, signed webhook replay protection, and reconciliation fallback.",
    details: [
      "Changed new Revolut orders to automatic capture so the amount is taken when the hosted checkout succeeds.",
      "Separated AUTHORISED from COMPLETED so an authorisation alone cannot mark an order paid or create a Jumptech project.",
      "Added a five-minute timestamp tolerance to Revolut webhook signature verification to reject replayed signed payloads.",
      "Added persistent deduplication for repeated Revolut webhook events.",
      "Added initial-payment and balance-payment Google Chat notifications using the same customer and order context as the established card flow.",
      "Added balance-payment completion and automatic Jumptech quote approval after a captured Revolut top-up.",
      "Expanded card reconciliation to recover Revolut payments if a provider webhook or browser return is missed.",
      "Added production-ready environment controls for Revolut API base URL, API version, capture mode, redirect URL, webhook secret, and reconciliation authentication.",
    ],
    areas: ["Revolut", "Card payments", "Webhooks", "Reconciliation", "Jumptech"],
  },
  {
    date: "30 Jul 2026",
    title: "Production baseline, recovery, and operational controls",
    status: "Live",
    summary:
      "Established a consolidated production baseline covering payment recovery, work orders, installer records, admin controls, and durable operational data.",
    details: [
      "Added server-side card payment reconciliation so completed Square payments can recover when the browser return or webhook path is interrupted.",
      "Added secure checkout recovery links and responsive 24-hour and 72-hour follow-up emails for customers who supplied details but did not pay.",
      "Restricted recovery emails to new eligible interactions and stopped them once payment is confirmed.",
      "Added Gmail sending through Google Workload Identity Federation and domain-wide delegated access without storing a long-lived service-account key.",
      "Added manual paid-customer entry for externally completed card payments and retained the original order workflow.",
      "Added CSV export for unpaid customer details with date filtering.",
      "Added installer legal records, Jumptech installer matching, and downloadable installer work-order PDFs.",
      "Added manual work-order numbering from the VD2C26 sequence and corrected VAT-inclusive installation calculations.",
      "Added project deletion controls that update back-office KPIs without deleting unrelated platform configuration.",
      "Added a fixed-egress Frasers Plus proxy package with systemd and Caddy deployment guidance.",
    ],
    areas: ["Production", "Payments", "Email", "Back office", "Work orders", "Security"],
  },
  {
    date: "9 Jul 2026",
    title: "Live card checkout, wallets, and return resilience",
    status: "Live",
    summary:
      "Moved the production card journey to hosted Square checkout and hardened payment return, wallet, webhook, and notification behavior.",
    details: [
      "Sent card customers directly to the hosted Square checkout rather than an intermediate handover page.",
      "Enabled Apple Pay and Google Pay in hosted checkout settings and served the Apple Pay domain association file.",
      "Kept Square order IDs as stable references when customers retry with another card and Square creates multiple payment attempts.",
      "Fixed the production return host and accelerated the success-page transition while provider state settles.",
      "Added unique paid-customer and balance-payment Google Chat notifications to prevent duplicate operational alerts.",
      "Added a persistent customer status link after successful card payment.",
      "Removed provider and demo controls from production-facing checkout pages.",
      "Replaced the default framework favicon with VCHRGD branding.",
    ],
    areas: ["Square", "Card payments", "Apple Pay", "Google Pay", "Customer journey"],
  },
  {
    date: "9 Jul 2026",
    title: "Jumptech webhook and project-read resilience",
    status: "Live",
    summary:
      "Improved production Jumptech synchronization, customer context, and recovery when direct project reads are unavailable.",
    details: [
      "Hardened webhook processing and enriched survey-received alerts with customer, order, address, and portal-link context.",
      "Reduced noisy project-update alerts and deduplicated repeated webhook notifications.",
      "Added project search as a fallback when direct project retrieval is unavailable.",
      "Added delayed enrichment polls after webhook updates so installer, schedule, additional-cost, and status details can settle before being stored.",
      "Kept Jumptech project creation idempotent and limited it to the original captured payment.",
      "Persisted charger make/model, installation address, and postcode in project creation data.",
    ],
    areas: ["Jumptech", "Webhooks", "Google Chat", "Back office"],
  },
  {
    date: "7-8 Jul 2026",
    title: "Product settings, promotions, and installer configuration",
    status: "Live",
    summary:
      "Added super-admin product controls for installed pricing, guidance copy, promotions, voucher codes, and installer records.",
    details: [
      "Added editable installed prices and customer-facing installation guidance.",
      "Added dated promotions with optional charger targeting, banner content, disclaimer text, pause, edit, and delete controls.",
      "Added generated or custom voucher codes with values, expiry dates, pause, edit, and delete controls.",
      "Prevented active promotions and voucher codes from being combined.",
      "Carried the final discounted amount into checkout, payment provider payloads, back-office records, and Jumptech workflow data.",
      "Preserved back-office scroll position after save actions and added consistent CTA feedback.",
      "Separated installer legal records into their own product-settings tab to reduce page noise.",
    ],
    areas: ["Product settings", "Pricing", "Promotions", "Vouchers", "Back office"],
  },
  {
    date: "22 Jun 2026",
    title: "Square card payments and popup handoff",
    status: "Live",
    summary:
      "Added Square as a card payment option and moved card and Frasers Plus handoffs into a centred popup flow.",
    details: [
      "Added Square hosted checkout session creation for initial card payment and post-survey balance top-ups.",
      "Added Square webhook handling for payment/order updates and signature validation support.",
      "Added configurable Square environment variables for sandbox and production operation.",
      "Changed card and Frasers Plus payment handoffs to open in a centred popup window instead of navigating the main page away.",
      "Added a blurred originating-page backdrop while the popup is open.",
      "If the popup is closed early, the originating checkout or order overview remains alive and retryable.",
      "If the payment returns successfully, the popup closes and the main page loads the returned success or status page.",
    ],
    areas: ["Card payments", "Frasers Plus", "Customer journey", "Webhooks"],
  },
  {
    date: "Jun 2026",
    title: "Google sign-in and managed admin access",
    status: "Live",
    summary:
      "Added Google sign-in and a super-admin controlled team access area for managed back-office accounts.",
    details: [
      "Added Google OAuth sign-in for back-office users.",
      "Fixed the Google sign-in callback flow so users do not need to click the Google button twice.",
      "Kept the env-backed admin account as the super admin.",
      "Added managed admin user creation, enable/disable controls, password reset, and optional authenticator MFA.",
      "Added audit logging for login, logout, Google auth, and managed-admin access changes.",
    ],
    areas: ["Back office", "Security", "Admin users"],
  },
  {
    date: "Jun 2026",
    title: "Post-survey amendments, top-ups, and refund requests",
    status: "Live",
    summary:
      "Built the amended-price customer journey after survey review, including balance payments and cancellation/refund request handling.",
    details: [
      "Added customer status pages that show revised total, amount already paid or allocated, and balance left to pay.",
      "For Frasers Plus orders, added the option to pay the balance with a separate Frasers Plus top-up transaction or by card.",
      "For card orders, added a separate card top-up transaction for the balance only.",
      "Ensured top-up payment amount is the outstanding balance only, not the full revised order value.",
      "Ensured refund requests relate back to the original paid or allocated amount and are completed by an agent in the refunds queue.",
      "Added cancellation confirmation copy explaining that the request will be reviewed and refunds can take up to 3 working days depending on provider or bank.",
      "Added failure and pending handling so declined/pending Frasers Plus top-ups do not move the order state forward and can be retried from the portal link.",
    ],
    areas: ["Survey review", "Payments", "Refunds", "Customer portal"],
  },
  {
    date: "Jun 2026",
    title: "Back-office booking, refunds, dispatch, and live refresh",
    status: "Live",
    summary:
      "Expanded the back office into booking, survey review, refund, KPI, journey tracking, audit, and access work areas.",
    details: [
      "Added booking queue visibility once orders are ready for installation scheduling.",
      "Added agent controls for survey received, survey reviewed, amended total, amendment notes, and booking details.",
      "Added refund requested workflow for customer cancellation requests.",
      "Added charger dispatch controls so back-office agents can mark charger dispatched and add an expected delivery date.",
      "Added customer portal charger dispatched hero notification when dispatch is confirmed.",
      "Added live refresh/state-version polling so agents see external updates such as Jumptech webhook changes without manual reloads.",
      "Added KPI and journey tracking views for checkout starts, details submissions, payment handoffs, stalls, and conversions.",
    ],
    areas: ["Back office", "Booking", "Refunds", "Operations"],
  },
  {
    date: "Jun 2026",
    title: "Customer portal mobile cleanup and quick-action warnings",
    status: "Live",
    summary:
      "Improved the long-form customer status link for mobile and added icon-led quick actions for important updates.",
    details: [
      "Reduced premature text wrapping in mobile summary and process update cards.",
      "Aligned process update status pills so pending/updated tags stay consistent across desktop and mobile.",
      "Added quick-action links at the top of the customer portal for balance outstanding, add preferred dates, top-up pending, charger dispatched, and survey reviewed states.",
      "Suppressed failed top-up warning banners until a customer has actually attempted a top-up payment.",
      "Improved order summary preferred date rendering so selected dates stack cleanly instead of overlapping.",
    ],
    areas: ["Customer portal", "Mobile", "UX"],
  },
  {
    date: "Jun 2026",
    title: "Preferred installation dates",
    status: "Live",
    summary:
      "Added customer-selected preferred installation dates after payment and brought them through to the back office.",
    details: [
      "Added a customer calendar from two weeks after payment date for choosing up to three preferred installation dates.",
      "Made it clear dates are preferences only, not guaranteed, and that earlier dates may be possible.",
      "Moved the calendar into the summary area to reduce page length.",
      "Changed the calendar to one month in customer status view with arrows to browse future months.",
      "Allowed dates to be edited until installation is booked.",
      "Removed the customer edit option once booking is confirmed.",
      "Persisted saved dates to the order summary and back-office order views.",
    ],
    areas: ["Customer portal", "Back office", "Scheduling"],
  },
  {
    date: "Jun 2026",
    title: "Frasers Plus hosted approval simulation and legal copy alignment",
    status: "Live",
    summary:
      "Reworked the Frasers Plus prepayment and approval journey around supplied amendment feedback and hosted-flow constraints.",
    details: [
      "Removed the duplicate second Frasers Plus approval page from the customer checkout flow.",
      "Added outcome tabs for approved, pending, and declined demo states that drive the Frasers Plus approval path.",
      "Added a Frasers Plus-styled approval timer page and auto-continue behaviour for approved demo flows.",
      "Changed top-up payment flow language from cancel and return to store to cancel and return to order overview.",
      "Added required prepayment copy that the quote is an estimate and may change if the survey indicates non-standard installation or extra works.",
      "Aligned surfaced UI copy with legal/compliance requirements from the Frasers Plus amendment feedback.",
      "Cleaned dev/sandbox copy from the customer-facing approval selector pages.",
    ],
    areas: ["Frasers Plus", "Compliance copy", "Demo flow"],
  },
  {
    date: "May-Jun 2026",
    title: "Jumptech integration and webhook sync",
    status: "Live",
    summary:
      "Connected Jumptech project creation, webhook registration, and survey-status sync into the customer and admin journeys.",
    details: [
      "Changed Jumptech project creation to use VCHRGD Domestic Ev Installation instead of Domestic EV Installation.",
      "Added initialAction: sendRelaySMS to the Jumptech project create payload.",
      "Registered Jumptech hooks and webhook secret flow for project status updates.",
      "Added webhook signature checking for Jumptech webhook payloads.",
      "Wired survey completion/project updates into admin and customer portal views.",
      "Added project detail retrieval and manual sync path for missing Jumptech webhooks.",
      "Guarded Jumptech project creation so amendment/top-up transactions do not create new Jumptech projects.",
    ],
    areas: ["Jumptech", "Webhooks", "Survey sync"],
  },
  {
    date: "May-Jun 2026",
    title: "Card payment return handling and provider abstraction",
    status: "Live",
    summary:
      "Generalised the card payment route so Revolut, Square, or mock card checkout can update the same order workflow.",
    details: [
      "Fixed the card provider return path so customers return to the final page rather than restarting the checkout flow.",
      "Changed customer-facing card copy away from provider-specific Revolut wording where a generic secure-card route is more accurate.",
      "Added mock card checkout result handling for local/demo testing.",
      "Added provider-specific session state for Revolut, Square, and mock card checkout.",
      "Ensured card returns update the original checkout interaction and workflow state.",
    ],
    areas: ["Card payments", "Customer journey", "Provider abstraction"],
  },
  {
    date: "May-Jun 2026",
    title: "Pricing and charger selection updates",
    status: "Live",
    summary:
      "Updated charger pricing and package presentation to match current installed-price rules.",
    details: [
      "Changed Seven Pro Untethered standard installed price to GBP 850.",
      "Changed Seven Pro Tethered standard installed price to GBP 900.",
      "Included up to 10m cable run in standard installation.",
      "Added GBP 150 surcharge for cable runs above 10m.",
      "Displayed +GBP 150 next to longer cable-run selections in the overview.",
      "Changed charger selection labels to Installed from GBP 900 and Installed from GBP 850.",
      "Removed charger-only pricing from the customer-facing flow and mobile optimisation paths.",
    ],
    areas: ["Pricing", "Checkout", "Mobile"],
  },
  {
    date: "May 2026",
    title: "Customer link privacy and security tightening",
    status: "Live",
    summary:
      "Reviewed the open customer link and reduced unnecessary exposure while keeping the operational status page useful.",
    details: [
      "Tightened customer-facing status information to avoid exposing unnecessary internal/provider details.",
      "Masked long order references in customer views where appropriate.",
      "Separated operational back-office detail from customer link detail.",
      "Added clearer customer status wording for awaiting survey, review, booking, cancellation, and refund states.",
    ],
    areas: ["Security", "Customer portal", "Privacy"],
  },
  {
    date: "May 2026",
    title: "Frasers Plus content deck amendments",
    status: "Live",
    summary:
      "Applied requested Frasers Plus journey and copy amendments from the supplied deck.",
    details: [
      "Matched legal and compliance wording in the surfaced UI as closely as possible where relevant to the journey.",
      "Removed steps that should redirect to Frasers Plus/Tymit hosted approval pages instead of being duplicated in VCHRGD.",
      "Reviewed Tymit staging/sandbox documentation and implemented a safe demo-hosted equivalent where the real hosted asset could not be completed end-to-end.",
      "Added output-ready screen assets for charger selection, Frasers Plus elements, and slider screen for slide deck use.",
    ],
    areas: ["Content", "Frasers Plus", "Presentation assets"],
  },
  {
    date: "May 2026",
    title: "Data reset and demo-readiness operations",
    status: "Operational",
    summary:
      "Added and used data-clearing/reset workflows to keep the demo back office manageable.",
    details: [
      "Cleared stored test projects/responses from the back-office dataset when requested for demo reset.",
      "Retained implementation code while removing noisy test data from operational views.",
      "Validated staging deployments after major feature batches.",
    ],
    areas: ["Back office", "Demo data", "Operations"],
  },
];

export const changelogLastUpdated = "8 Sep 2026";
