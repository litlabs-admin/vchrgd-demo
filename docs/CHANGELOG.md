# VCHRGD D2C lifetime changelog

Reconciled 21 October 2026; updated through 29 October 2026. Early entries preserve the original application history (May–September); later entries are reconstructed from dated release records. This is a release history, not an assertion that every exploratory edit was shipped. Date ranges are retained where a precise original release date is unavailable.

Statuses describe each entry at its date. In particular, September preparation entries marked Configured do not mean Frasers remains disabled: production activation occurred on 15 September. The 21 October handover is local only.

The same entries are maintained in `src/lib/changelog.ts` for the back-office changelog. Future changes should update both records together. See [provenance](SOURCE_PROVENANCE.md) and [verification](VERIFICATION.md).

## 29 Oct 2026 — D2C review fixes verified for repository handover, pending deployment

Status: Configured. Areas: Security, Payments, Persistence, Handover.

Prepared and verified the eight review fixes without changing the live site.

- Updated affected dependencies; the final lockfile audit reports zero known vulnerabilities.
- Added transactional state mutations and durable balance-checkout reservations; verified concurrent orders and rollback against isolated PostgreSQL.
- Hardened legacy Frasers captures, terminal refunds, administrator session revocation, notification receipts and payment-session lookup.
- Passed eleven offline suites, including 57 new remediation assertions, security controls, lint, TypeScript and production build checks.
- Updated handover, source provenance and release gates. Provider staging acceptance and production deployment remain separate owner actions.

## 28 Oct 2026 — Frasers Plus eligibility URL corrected locally, pending publication

Status: Configured. Areas: Frasers Plus, Popup, Marketing.

Prepared the supplied application URL in the D2C popup and Squarespace handover embeds; not deployed.

- Corrected the application query to partner=VCHRGD, template=online and location=frasersplus_webpage.
- Updated the local popup, Squarespace embed/test pack and installation instructions together.
- No live Vercel or Squarespace publication, provider configuration or customer data change was made.

## 28 Oct 2026 — Private company GitHub repository prepared for initial publication

Status: Operational. Areas: GitHub, Source control, Handover.

Connected the reviewed production handover source to VCHRGD/vchrgd-d2c without connecting live deployments.

- Verified the company repository is private and empty before initial upload.
- Rechecked all 205 uploaded production hashes against the active deployment and reviewed reachable history for private artifacts and credential findings.
- Prepared main and the handover branch for publication; Chapeau collaborator access remains a separate explicit grant.
- Preserved the live Vercel deployment, environment settings, customer data and provider configuration.

## 21 Oct 2026 — Production source recovery and company handover prepared locally

Status: Operational. Areas: Git, Documentation, Handover.

Consolidated verified production source, documentation and supporting tools in Git without deploying.

- Matched all 205 Vercel source files to the active 15 October deployment and matched the live fixed-IP proxy SHA-256.
- Preserved previous uncommitted work outside the repository and retained the existing Git history.
- Updated the README, lifetime history, operating guide, environment inventory and development checks.
- No live deployment, configuration, customer data, financial operation or notification was changed. The extended application changelog is local until a later release.

## 15 Oct 2026 — Landing statistics simplified to daily aggregate counters

Status: Live. Areas: Landing page, Analytics, Privacy.

Replaced the initial visitor/session analytics and large prompt with simple site statistics.

- Counted page views, visible-time engagement and repeat button interactions with short-lived delivery keys.
- Removed persistent analytics visitor/session identifiers; retained an opt-out preference and respected GPC, Do Not Track and existing refusal.
- Added a collapsed footer notice and aggregate back-office KPIs; checkout/payment source was preserved.

## 15 Oct 2026 — Home-charging landing page published on production

Status: Live. Areas: Landing page, Marketing, Reporting.

Published the approved home-charging campaign page alongside the existing production checkout.

- Added responsive product, finance, app, calculator, review and footer content under /home-charging/.
- Pointed purchase links to live checkout and added canonical/indexing settings.
- Added landing statistics and a protected daily cleanup job; the initial visitor/session implementation was superseded later the same day.
- Preserved the production payment handlers, customer data and existing scheduled jobs.

## 14 Oct 2026 — Landing brand, alignment and purchase CTA reviewed on staging

Status: Configured. Areas: Landing page, Staging, Brand.

Applied brand/footer feedback, aligned finance plan headings and refined the hero purchase CTA.

- Used the official horizontal Frasers logo and reviewed desktop/mobile presentation.
- Changed the first-section button to Buy your Seven Pro.
- These staging changes preceded the approved 15 October production publication.

## 12 Oct 2026 — Checkout estimate and payment wording aligned

Status: Live. Areas: Checkout, Content.

Clarified estimate wording before payment selection and the selected payment method afterwards.

- Labelled the pre-selection total Installation estimate and the card summary Pay today by card.
- Kept Frasers repayment-plan selection in the provider app.
- Applied the copy changes to staging and production without changing payment logic.

## 6 Oct 2026 — Home-charging landing preview introduced on staging

Status: Configured. Areas: Landing page, Staging.

Introduced the static responsive home-charging page for design and content review.

- Added product exploration, installation pricing, a charging-cost calculator, Frasers information and Trustpilot embeds.
- Kept staging CTAs within the staging checkout; production publication followed on 15 October.

## 29 Sep 2026 — Overdue-stage Google Chat delivery repaired

Status: Live. Areas: Google Chat, Operations, Reliability.

Repaired rejected incoming-webhook request IDs and confirmed a scheduled production alert.

- Added safe error-category diagnostics and switched new deliveries to plain incoming-webhook transport.
- Used durable atomic reservations and receipts to prevent duplicate delivery.
- Held ambiguous outcomes for operator review instead of blindly resending.
- The historical release record confirmed the scheduled 16:00 UTC run succeeded; handover did not send a test message.

## 25 Sep 2026 — Manual and provider refund controls unified

Status: Live. Areas: Refunds, Back office, Audit.

Added consistent cancellation/refund controls across project stages and the refund queue.

- Separated recording an already completed external refund from requesting a real provider refund.
- Verified original transactions, amounts and currency; tracked pending/uncertain outcomes rather than assuming completion.
- Added dedupe reservations and required separate reconciliation for paid extras/replacement payments.

## 24 Sep 2026 — Production checkout and webhook security hardened

Status: Live. Areas: Security, Payments, Webhooks.

Hardened order access, pricing authority, callback replay protection and administrative sessions.

- Required order-bound access capabilities and server-calculated prices for checkout mutations.
- Rejected client-asserted payment completion and protected private voucher/offer information.
- Failed closed on missing Jumptech signing configuration, rejected stale timestamps and deduplicated authenticated replays.
- Tightened disabled-admin access, Frasers return binding and redirect destinations; updated dependencies.

## 23 Sep 2026 — Approved DNO orders progress to booking

Status: Live. Areas: DNO, Booking, Jumptech.

Reconciled approved DNO and survey states so eligible orders can enter the booking queue.

- Preserved actual booking, installation, payment, installer and purchase-order state.
- Prevented completed/terminal orders being reopened by operational reconciliation.

## 17 Sep 2026 — Preferred installation dates limited to legacy cohorts

Status: Live. Areas: Customer portal, Booking, Policy.

Removed preferred-date selection for new orders while preserving eligible historical orders.

- Snapshotted eligibility from original checkout/payment start and the configured cutoff.
- Removed the picker and rejected preference writes for disabled cohorts.
- Preserved confirmed booking, historical preferences and existing operational data.

## 17 Sep 2026 — Checkout finance click reporting introduced

Status: Live. Areas: Analytics, Checkout.

Added day-zero aggregate reporting for Frasers eligibility and checkout actions.

- Tracked action activations rather than unique people, without historical backfill.
- Kept Squarespace activity and completed-payment reporting separate.

## 16 Sep 2026 — Paid-order stage clocks and overdue alerts added

Status: Live. Areas: Operations, Google Chat, Back office.

Added stage timing and scheduled alerts for eligible overdue paid orders.

- Used durable stage episodes and sent receipts to avoid repeated alerts for an unchanged stage.
- Preserved payment and booking behaviour; later transport repair is recorded on 29 September.

## 16 Sep 2026 — Frasers promotion added to charger selection

Status: Live. Areas: Checkout, Frasers Plus, Marketing.

Added a responsive finance-promotion popup to the initial selection journey.

- Kept the established checkout/payment flow and pricing intact.
- Used approved finance presentation and dismissal controls.

## 15 Sep 2026 — Frasers Plus activated on production

Status: Live. Areas: Frasers Plus, Production, Checkout.

Enabled the approved production Frasers route after the hidden presentation and webhook preparation.

- Enabled both server and public Frasers feature flags on the production project.
- Retained authenticated callbacks, signed returns and the fixed-IP live proxy.
- Applied the approved logo and CTA presentation; earlier Configured entries below record preparation, not the current disabled state.
- Activation records and synthetic checks do not constitute a new live transaction certification.

## 15 Sep 2026 — Frasers Plus production presentation prepared behind feature flags

Status: Configured. Areas: Frasers Plus, Checkout, Release preparation.

Prepared the approved Frasers checkout branding and disclosure on the production application without enabling public Frasers checkout.

- Included the approved brand colourways, official horizontal logos and dark plum continue button.
- Kept both Frasers enable flags off and retained the authenticated production webhook.
- Preserved current production pricing, orders, back office, additional-cost emails, Revolut auto-capture and integration settings.
- No real payment was initiated. Public activation remains a separate release step.

## 15 Sep 2026 — Frasers Plus production webhook handoff

Status: Configured. Areas: Frasers Plus, Webhooks, Security.

Prepared the authenticated production callback while keeping public Frasers Plus checkout disabled.

- Added fail-closed bearer verification and retryable capture failures.
- Preserved completed capture and refund state when delayed callbacks are received.
- Required capture confirmation rather than treating a pending HTTP acknowledgement as paid.
- Kept unfamiliar callbacks out of production orders, including any outstanding staging payments.
- Retained the existing static-IP live proxy, checkout screens, back office, Revolut settings and operational data.

## 8 Sep 2026 — Outstanding balances remain payable after booking

Status: Live. Areas: Customer journey, Payments, Jumptech, Email.

Kept additional-payment controls available on booked and installed orders until the outstanding balance is settled.

- Added a direct secure payment link to the outstanding-balance prompt.
- Preserved booking and installation stages when late balance payments start, fail or complete.
- Prevented completed balance payments from moving scheduled Jumptech projects back to quote approved.
- Cleared the persisted outstanding-balance flag after confirmed payment and prevented stale quote updates reopening it.
- Added exact-order, deduplicated email recovery and a non-sending preflight while keeping automatic emails restricted to quote approval.

## 4 Sep 2026 — Automatic additional costs customer emails

Status: Live. Areas: Email, Jumptech, Customer journey, Payments, Audit.

Added automatic, personalised additional-cost emails when Jumptech moves an unpaid amended order to quote approved.

- Restricted automatic delivery to quote-approved orders with a valid customer email and a positive unpaid balance.
- Included the customer progress link, secure balance-payment link, revised order total, and additional-work explanation.
- Added persistent sent, amount, Gmail message, and failure details to the order workflow and audit trail.
- Added database-backed deduplication so repeated Jumptech webhooks cannot resend the same balance email.
- Added a protected operational endpoint for deliberate recovery sends to eligible customers.

## 17 Aug 2026 — Installer PO dispatch confirmation

Status: Configured. Areas: Back office, Work orders, Google Chat, Audit.

Added a durable back-office confirmation for sent installer purchase orders with an auditable Google Chat notification.

- Added a PO-sent checkbox and confirmation action after a work order has been generated.
- Recorded the confirming administrator and timestamp against the persisted work-order record.
- Added a deduplicated Google Chat notification containing the PO number, order reference, customer, installer, and confirming administrator.
- Preserved the sent state when an existing PO is downloaded or regenerated.

## 31 Jul 2026 — Revolut production payment hardening

Status: Configured. Areas: Revolut, Card payments, Webhooks, Reconciliation, Jumptech.

Prepared Revolut hosted checkout for the live card route with captured-payment gating, signed webhook replay protection, and reconciliation fallback.

- Changed new Revolut orders to automatic capture so the amount is taken when the hosted checkout succeeds.
- Separated AUTHORISED from COMPLETED so an authorisation alone cannot mark an order paid or create a Jumptech project.
- Added a five-minute timestamp tolerance to Revolut webhook signature verification to reject replayed signed payloads.
- Added persistent deduplication for repeated Revolut webhook events.
- Added initial-payment and balance-payment Google Chat notifications using the same customer and order context as the established card flow.
- Added balance-payment completion and automatic Jumptech quote approval after a captured Revolut top-up.
- Expanded card reconciliation to recover Revolut payments if a provider webhook or browser return is missed.
- Added production-ready environment controls for Revolut API base URL, API version, capture mode, redirect URL, webhook secret, and reconciliation authentication.

## 30 Jul 2026 — Production baseline, recovery, and operational controls

Status: Live. Areas: Production, Payments, Email, Back office, Work orders, Security.

Established a consolidated production baseline covering payment recovery, work orders, installer records, admin controls, and durable operational data.

- Added server-side card payment reconciliation so completed Square payments can recover when the browser return or webhook path is interrupted.
- Added secure checkout recovery links and responsive 24-hour and 72-hour follow-up emails for customers who supplied details but did not pay.
- Restricted recovery emails to new eligible interactions and stopped them once payment is confirmed.
- Added Gmail sending through Google Workload Identity Federation and domain-wide delegated access without storing a long-lived service-account key.
- Added manual paid-customer entry for externally completed card payments and retained the original order workflow.
- Added CSV export for unpaid customer details with date filtering.
- Added installer legal records, Jumptech installer matching, and downloadable installer work-order PDFs.
- Added manual work-order numbering from the VD2C26 sequence and corrected VAT-inclusive installation calculations.
- Added project deletion controls that update back-office KPIs without deleting unrelated platform configuration.
- Added a fixed-egress Frasers Plus proxy package with systemd and Caddy deployment guidance.

## 9 Jul 2026 — Live card checkout, wallets, and return resilience

Status: Live. Areas: Square, Card payments, Apple Pay, Google Pay, Customer journey.

Moved the production card journey to hosted Square checkout and hardened payment return, wallet, webhook, and notification behavior.

- Sent card customers directly to the hosted Square checkout rather than an intermediate handover page.
- Enabled Apple Pay and Google Pay in hosted checkout settings and served the Apple Pay domain association file.
- Kept Square order IDs as stable references when customers retry with another card and Square creates multiple payment attempts.
- Fixed the production return host and accelerated the success-page transition while provider state settles.
- Added unique paid-customer and balance-payment Google Chat notifications to prevent duplicate operational alerts.
- Added a persistent customer status link after successful card payment.
- Removed provider and demo controls from production-facing checkout pages.
- Replaced the default framework favicon with VCHRGD branding.

## 9 Jul 2026 — Jumptech webhook and project-read resilience

Status: Live. Areas: Jumptech, Webhooks, Google Chat, Back office.

Improved production Jumptech synchronization, customer context, and recovery when direct project reads are unavailable.

- Hardened webhook processing and enriched survey-received alerts with customer, order, address, and portal-link context.
- Reduced noisy project-update alerts and deduplicated repeated webhook notifications.
- Added project search as a fallback when direct project retrieval is unavailable.
- Added delayed enrichment polls after webhook updates so installer, schedule, additional-cost, and status details can settle before being stored.
- Kept Jumptech project creation idempotent and limited it to the original captured payment.
- Persisted charger make/model, installation address, and postcode in project creation data.

## 7-8 Jul 2026 — Product settings, promotions, and installer configuration

Status: Live. Areas: Product settings, Pricing, Promotions, Vouchers, Back office.

Added super-admin product controls for installed pricing, guidance copy, promotions, voucher codes, and installer records.

- Added editable installed prices and customer-facing installation guidance.
- Added dated promotions with optional charger targeting, banner content, disclaimer text, pause, edit, and delete controls.
- Added generated or custom voucher codes with values, expiry dates, pause, edit, and delete controls.
- Prevented active promotions and voucher codes from being combined.
- Carried the final discounted amount into checkout, payment provider payloads, back-office records, and Jumptech workflow data.
- Preserved back-office scroll position after save actions and added consistent CTA feedback.
- Separated installer legal records into their own product-settings tab to reduce page noise.

## 22 Jun 2026 — Square card payments and popup handoff

Status: Live. Areas: Card payments, Frasers Plus, Customer journey, Webhooks.

Added Square as a card payment option and moved card and Frasers Plus handoffs into a centred popup flow.

- Added Square hosted checkout session creation for initial card payment and post-survey balance top-ups.
- Added Square webhook handling for payment/order updates and signature validation support.
- Added configurable Square environment variables for sandbox and production operation.
- Changed card and Frasers Plus payment handoffs to open in a centred popup window instead of navigating the main page away.
- Added a blurred originating-page backdrop while the popup is open.
- If the popup is closed early, the originating checkout or order overview remains alive and retryable.
- If the payment returns successfully, the popup closes and the main page loads the returned success or status page.

## Jun 2026 — Google sign-in and managed admin access

Status: Live. Areas: Back office, Security, Admin users.

Added Google sign-in and a super-admin controlled team access area for managed back-office accounts.

- Added Google OAuth sign-in for back-office users.
- Fixed the Google sign-in callback flow so users do not need to click the Google button twice.
- Kept the env-backed admin account as the super admin.
- Added managed admin user creation, enable/disable controls, password reset, and optional authenticator MFA.
- Added audit logging for login, logout, Google auth, and managed-admin access changes.

## Jun 2026 — Post-survey amendments, top-ups, and refund requests

Status: Live. Areas: Survey review, Payments, Refunds, Customer portal.

Built the amended-price customer journey after survey review, including balance payments and cancellation/refund request handling.

- Added customer status pages that show revised total, amount already paid or allocated, and balance left to pay.
- For Frasers Plus orders, added the option to pay the balance with a separate Frasers Plus top-up transaction or by card.
- For card orders, added a separate card top-up transaction for the balance only.
- Ensured top-up payment amount is the outstanding balance only, not the full revised order value.
- Ensured refund requests relate back to the original paid or allocated amount and are completed by an agent in the refunds queue.
- Added cancellation confirmation copy explaining that the request will be reviewed and refunds can take up to 3 working days depending on provider or bank.
- Added failure and pending handling so declined/pending Frasers Plus top-ups do not move the order state forward and can be retried from the portal link.

## Jun 2026 — Back-office booking, refunds, dispatch, and live refresh

Status: Live. Areas: Back office, Booking, Refunds, Operations.

Expanded the back office into booking, survey review, refund, KPI, journey tracking, audit, and access work areas.

- Added booking queue visibility once orders are ready for installation scheduling.
- Added agent controls for survey received, survey reviewed, amended total, amendment notes, and booking details.
- Added refund requested workflow for customer cancellation requests.
- Added charger dispatch controls so back-office agents can mark charger dispatched and add an expected delivery date.
- Added customer portal charger dispatched hero notification when dispatch is confirmed.
- Added live refresh/state-version polling so agents see external updates such as Jumptech webhook changes without manual reloads.
- Added KPI and journey tracking views for checkout starts, details submissions, payment handoffs, stalls, and conversions.

## Jun 2026 — Customer portal mobile cleanup and quick-action warnings

Status: Live. Areas: Customer portal, Mobile, UX.

Improved the long-form customer status link for mobile and added icon-led quick actions for important updates.

- Reduced premature text wrapping in mobile summary and process update cards.
- Aligned process update status pills so pending/updated tags stay consistent across desktop and mobile.
- Added quick-action links at the top of the customer portal for balance outstanding, add preferred dates, top-up pending, charger dispatched, and survey reviewed states.
- Suppressed failed top-up warning banners until a customer has actually attempted a top-up payment.
- Improved order summary preferred date rendering so selected dates stack cleanly instead of overlapping.

## Jun 2026 — Preferred installation dates

Status: Live. Areas: Customer portal, Back office, Scheduling.

Added customer-selected preferred installation dates after payment and brought them through to the back office.

- Added a customer calendar from two weeks after payment date for choosing up to three preferred installation dates.
- Made it clear dates are preferences only, not guaranteed, and that earlier dates may be possible.
- Moved the calendar into the summary area to reduce page length.
- Changed the calendar to one month in customer status view with arrows to browse future months.
- Allowed dates to be edited until installation is booked.
- Removed the customer edit option once booking is confirmed.
- Persisted saved dates to the order summary and back-office order views.

## Jun 2026 — Frasers Plus hosted approval simulation and legal copy alignment

Status: Live. Areas: Frasers Plus, Compliance copy, Demo flow.

Reworked the Frasers Plus prepayment and approval journey around supplied amendment feedback and hosted-flow constraints.

- Removed the duplicate second Frasers Plus approval page from the customer checkout flow.
- Added outcome tabs for approved, pending, and declined demo states that drive the Frasers Plus approval path.
- Added a Frasers Plus-styled approval timer page and auto-continue behaviour for approved demo flows.
- Changed top-up payment flow language from cancel and return to store to cancel and return to order overview.
- Added required prepayment copy that the quote is an estimate and may change if the survey indicates non-standard installation or extra works.
- Aligned surfaced UI copy with legal/compliance requirements from the Frasers Plus amendment feedback.
- Cleaned dev/sandbox copy from the customer-facing approval selector pages.

## May-Jun 2026 — Jumptech integration and webhook sync

Status: Live. Areas: Jumptech, Webhooks, Survey sync.

Connected Jumptech project creation, webhook registration, and survey-status sync into the customer and admin journeys.

- Changed Jumptech project creation to use VCHRGD Domestic Ev Installation instead of Domestic EV Installation.
- Added initialAction: sendRelaySMS to the Jumptech project create payload.
- Registered Jumptech hooks and webhook secret flow for project status updates.
- Added webhook signature checking for Jumptech webhook payloads.
- Wired survey completion/project updates into admin and customer portal views.
- Added project detail retrieval and manual sync path for missing Jumptech webhooks.
- Guarded Jumptech project creation so amendment/top-up transactions do not create new Jumptech projects.

## May-Jun 2026 — Card payment return handling and provider abstraction

Status: Live. Areas: Card payments, Customer journey, Provider abstraction.

Generalised the card payment route so Revolut, Square, or mock card checkout can update the same order workflow.

- Fixed the card provider return path so customers return to the final page rather than restarting the checkout flow.
- Changed customer-facing card copy away from provider-specific Revolut wording where a generic secure-card route is more accurate.
- Added mock card checkout result handling for local/demo testing.
- Added provider-specific session state for Revolut, Square, and mock card checkout.
- Ensured card returns update the original checkout interaction and workflow state.

## May-Jun 2026 — Pricing and charger selection updates

Status: Live. Areas: Pricing, Checkout, Mobile.

Updated charger pricing and package presentation to match current installed-price rules.

- Changed Seven Pro Untethered standard installed price to GBP 850.
- Changed Seven Pro Tethered standard installed price to GBP 900.
- Included up to 10m cable run in standard installation.
- Added GBP 150 surcharge for cable runs above 10m.
- Displayed +GBP 150 next to longer cable-run selections in the overview.
- Changed charger selection labels to Installed from GBP 900 and Installed from GBP 850.
- Removed charger-only pricing from the customer-facing flow and mobile optimisation paths.

## May 2026 — Customer link privacy and security tightening

Status: Live. Areas: Security, Customer portal, Privacy.

Reviewed the open customer link and reduced unnecessary exposure while keeping the operational status page useful.

- Tightened customer-facing status information to avoid exposing unnecessary internal/provider details.
- Masked long order references in customer views where appropriate.
- Separated operational back-office detail from customer link detail.
- Added clearer customer status wording for awaiting survey, review, booking, cancellation, and refund states.

## May 2026 — Frasers Plus content deck amendments

Status: Live. Areas: Content, Frasers Plus, Presentation assets.

Applied requested Frasers Plus journey and copy amendments from the supplied deck.

- Matched legal and compliance wording in the surfaced UI as closely as possible where relevant to the journey.
- Removed steps that should redirect to Frasers Plus/Tymit hosted approval pages instead of being duplicated in VCHRGD.
- Reviewed Tymit staging/sandbox documentation and implemented a safe demo-hosted equivalent where the real hosted asset could not be completed end-to-end.
- Added output-ready screen assets for charger selection, Frasers Plus elements, and slider screen for slide deck use.

## May 2026 — Data reset and demo-readiness operations

Status: Operational. Areas: Back office, Demo data, Operations.

Added and used data-clearing/reset workflows to keep the demo back office manageable.

- Cleared stored test projects/responses from the back-office dataset when requested for demo reset.
- Retained implementation code while removing noisy test data from operational views.
- Validated staging deployments after major feature batches.
