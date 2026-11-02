> Historical document archived 21 October 2026. Superseded by the current README, HANDOVER.md and operating guides one directory above. Do not use these old cutover instructions as current deployment guidance.

# VCHRGD Payments Project Overview

## Purpose

This application provides the VCHRGD direct-to-consumer checkout and post-payment workflow for installed EV charger purchases. It covers:

- Product selection and estimate generation.
- Discount, voucher, and promotional banner handling.
- Card payment via Square.
- Optional Frasers Plus financing flow behind feature flags.
- Customer survey/status portal.
- Back-office order, survey, booking, refund, product settings, and audit views.
- Jumptech project creation and status webhook handling.

## Primary Customer Journey

1. Customer selects a Seven Pro charger.
2. Customer answers installation estimate questions.
3. Customer enters contact and installation address details.
4. Customer chooses payment method.
5. Square card checkout is opened in the payment popup/handoff flow.
6. On successful payment, the app records the payment session and moves the order into the survey workflow.
7. Jumptech project creation is triggered for the original paid order.
8. Customer receives or uses their status/survey link.
9. Survey completion and review updates the customer portal and back office.
10. If no additional cost is required, booking can proceed.
11. If additional cost is required, the customer can pay the balance or request cancellation/refund review.

## Payment Routes

### Square

Square is the production card provider for the current cutover.

- Hosted checkout/payment-link flow is used for the main card journey.
- Square Web Payments support is also present for embedded card collection.
- Square webhook verifies signatures before updating state.
- Provider payment references are stored against internal payment IDs.

### Frasers Plus

Frasers Plus is implemented but should remain disabled until production approval is complete.

Required flags:

- `ENABLE_FRASERS_PLUS`
- `NEXT_PUBLIC_ENABLE_FRASERS_PLUS`

When disabled, customer-facing Frasers Plus options are hidden from D2C checkout.

### Revolut

Revolut support remains in the codebase as a previous card route/fallback, but Square is the intended card provider when `CARD_PAYMENT_PROVIDER=square`.

## Jumptech Integration

Jumptech project creation uses the configured project type and integration name.

The create payload includes:

- Customer first/last name.
- Email and phone.
- Installation address and postcode.
- `projectType`.
- `integrationName`.
- `integrationId`.
- `initialAction=SendRelaySMS`, when configured.
- Selected charger model as both root and `data` fields:
  - `makeModel`
  - `chargerMakeModel`
  - `data.makeModel`
  - `data.chargerMakeModel`

Webhook updates from Jumptech update the internal workflow status, survey status, quote totals, and additional installation cost details where present.

## Back Office

Back office areas:

- Booking queue.
- Journey tracking.
- KPIs.
- Survey review.
- Refunds requested.
- Product settings.
- Team access.
- Audit trail.
- Dedicated change log page.

Super-admin capabilities:

- Manage installed prices.
- Manage standard estimate adjustments.
- Create, edit, pause, and delete special offers.
- Create, edit, pause, and delete voucher codes.
- Edit promotional banner and disclaimer copy.
- Create managed admin users and configure MFA.

## Product Settings and Discounts

- Installed pricing is controlled by super-admin product settings.
- Long cable run, street parking, and flat/apartment adjustments are configurable.
- Special offers can have date windows and charger applicability.
- Voucher codes can be generated or manually entered.
- Special offers and vouchers are mutually exclusive in checkout.
- Customer-facing charger cards show sale pricing inline with the original price struck through.

## Customer Portal

The customer status/survey link shows:

- Order summary.
- Survey receipt/review status.
- Revised installation total.
- Balance due where applicable.
- Preferred installation dates.
- Charger dispatch status.
- Cancellation/refund request options where allowed.

If additional payment is required, the portal makes clear that:

- The original quote was an estimate.
- The top-up is a separate transaction.
- Approval of an original Frasers Plus amount does not guarantee top-up approval.
- The customer can request cancellation and refund/reversal review instead.

## Data Stores

The app uses server-side storage helpers for payment sessions, workflows, audit events, product settings, admin users, and checkout interaction events. Production should use the configured production data store rather than local file data.

## Deployment

Staging currently deploys to:

- `https://staging.vchrgd.com`

Production payment domain should be:

- `https://payments.vchrgd.app`

Vercel production promotion should only occur after the production readiness checklist has been completed.
