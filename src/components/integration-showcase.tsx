"use client";

import Image from "next/image";
import { createPortal } from "react-dom";
import { TrustpilotWidget } from "@/components/trustpilot-widget";
import { captureCheckoutClick, trackCheckoutClick } from "@/lib/checkout-click-client";
import { CONTINUE_CLICK_EVENTS, type CheckoutClickEvent } from "@/lib/checkout-click-events";
import {
  Building,
  Building2,
  Cable,
  CalendarDays,
  CarFront,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleParking,
  ClipboardCheck,
  CreditCard,
  Headset,
  Home,
  House,
  Info,
  Lock,
  Mail,
  MapPinned,
  PackageCheck,
  Pencil,
  Phone,
  Route,
  ShieldCheck,
  Warehouse,
  Waypoints,
  Wrench,
  X,
} from "lucide-react";
import {
  startTransition,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getEmailValidationMessage,
  getUkMobileValidationMessage,
  normaliseEmailInput,
  normaliseUkMobileInput,
} from "@/lib/email-validation";
import type { DemoScenario, PaymentType } from "@/lib/mock-tymit";
import type { ProductDiscount, ProductSettings } from "@/lib/product-settings";
import type { CheckoutAccess } from "@/lib/checkout-access";

type JourneyStep = 1 | 2 | 3 | 4 | 5 | 6;
type StepIconKind = "selection" | "property" | "parking" | "cable" | "estimate" | "payment";
type PaymentChoice = "card" | "frasers-plus";
type SandboxProfileKey = "fast-track" | "partial-match" | "new-customer";
type FrasersPlusTerm = {
  months: number;
  interestFree: boolean;
  apr: number;
};
type InteractionStatus =
  | "ACTIVE"
  | "PAYMENT_PENDING"
  | "PAYMENT_COMPLETED"
  | "EXITED_SURVEY_LATER"
  | "ABANDONED";

type ChargerOption = {
  slug: string;
  name: string;
  power: string;
  unitPrice: number;
  installedPrice: number;
  summary: string;
  image: string;
  features: Array<{
    label: string;
    icon: "wifi" | "type2" | "tariff" | "support";
  }>;
};

type ResumePaymentSession = {
  paymentId: string;
  uniquePaymentReference?: string;
  redirectUrl?: string;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  chargerName?: string;
  chargerSlug?: string;
  amount?: number;
  discountAmount?: number;
  discountCode?: string;
  discountLabel?: string;
  propertyType?: string;
  parkingType?: string;
  fuseBoxDistance?: string;
  billingAddress?: {
    line1: string;
    line2?: string;
    city: string;
    postalCode: string;
    country: string;
  };
  deliveryAddress?: {
    line1: string;
    line2?: string;
    city: string;
    postalCode: string;
    country: string;
  };
  latestStatus?: {
    currentType?: string;
    status: string;
  };
};

type AppliedDiscount = {
  id: string;
  kind: ProductDiscount["kind"];
  label: string;
  code?: string;
  amount: number;
};

type AnswerOption = {
  value: string;
  label: string;
  detail: string;
  icon: string;
};

const STEPS = [
  { id: 1, title: "Selection", note: "Confirm chosen charger", icon: "selection" },
  { id: 2, title: "Property", note: "Identify home type", icon: "property" },
  { id: 3, title: "Parking", note: "Identify charging position", icon: "parking" },
  { id: 4, title: "Cable run", note: "Estimate routing distance", icon: "cable" },
  { id: 5, title: "Details", note: "Send digital survey", icon: "estimate" },
  { id: 6, title: "Payment", note: "Choose payment path", icon: "payment" },
] as const satisfies ReadonlyArray<{ id: JourneyStep; title: string; note: string; icon: StepIconKind }>;

const CHARGERS: ChargerOption[] = [
  {
    slug: "seven-pro-tethered",
    name: "Seven Pro Tethered",
    power: "7kW",
    unitPrice: 550,
    installedPrice: 935,
    summary: "Integrated cable for the simplest home charging setup.",
    image: "/content/seven-pro-tethered.png",
    features: [
      { label: "WiFi & RFID", icon: "wifi" },
      { label: "7.5M cable, Type 2", icon: "type2" },
      { label: "Smart Tariff Integration", icon: "tariff" },
      { label: "UK Based Support", icon: "support" },
    ],
  },
  {
    slug: "seven-pro-untethered",
    name: "Seven Pro Untethered",
    power: "7kW",
    unitPrice: 500,
    installedPrice: 895,
    summary: "Socket-only finish for a cleaner look and more cable flexibility.",
    image: "/content/seven-pro-untethered.png",
    features: [
      { label: "WiFi & RFID", icon: "wifi" },
      { label: "Type 2", icon: "type2" },
      { label: "Smart Tariff Integration", icon: "tariff" },
      { label: "UK Based Support", icon: "support" },
    ],
  },
];

const PROPERTY_OPTIONS: AnswerOption[] = [
  { value: "Semi-detached", label: "Semi-detached", detail: "Typical external wall access and driveway routing.", icon: "house" },
  { value: "Terraced", label: "Terraced", detail: "Tighter access and a more constrained install route.", icon: "building" },
  { value: "Detached", label: "Detached", detail: "Usually the most straightforward install conditions.", icon: "house-plug" },
  { value: "Flat / apartment", label: "Flat / apartment", detail: "Additional routing and permissions may affect cost.", icon: "apartment" },
];

const PARKING_OPTIONS: AnswerOption[] = [
  { value: "Driveway", label: "Driveway", detail: "Best-case home charging position close to the property.", icon: "car" },
  { value: "Garage", label: "Garage", detail: "Protected location that may need a longer cable route.", icon: "warehouse" },
  { value: "Car port", label: "Car port", detail: "Straightforward external mounting in a covered bay.", icon: "parking" },
  { value: "Street parking", label: "Street parking", detail: "Likely to need extra cabling and more complexity.", icon: "map" },
];

const DISTANCE_OPTIONS: AnswerOption[] = [
  { value: "Up to 10m", label: "Up to 10m", detail: "Standard cable run for a typical installation.", icon: "cable" },
  { value: "10m to 20m", label: "10m to 20m", detail: "Longer cable run may be reviewed after survey.", icon: "route" },
  { value: "Over 20m", label: "Over 20m", detail: "Longer cable run may be reviewed after survey.", icon: "waypoints" },
];

const LONG_CABLE_RUN_SURCHARGE = 150;

const DEFAULT_CLIENT_PRODUCT_SETTINGS: ProductSettings = {
  chargers: CHARGERS.map((charger) => ({
    slug: charger.slug as "seven-pro-tethered" | "seven-pro-untethered",
    name: charger.name,
    unitPrice: charger.unitPrice,
    installedPrice: charger.installedPrice,
  })),
  adjustments: {
    longCableRun: {
      key: "longCableRun",
      label: "Cable run above 10m",
      amount: LONG_CABLE_RUN_SURCHARGE,
      guidanceText:
        "Your standard installation includes up to 10m of cable. Longer cable runs may need additional work, which will be confirmed after your digital survey before any extra payment is requested.",
    },
    cableRun10To20: {
      key: "cableRun10To20",
      label: "Cable run 10m to 20m",
      amount: LONG_CABLE_RUN_SURCHARGE,
      guidanceText:
        "Your standard installation includes up to 10m of cable. If your installation needs a 10m to 20m cable run, we will confirm any additional cost after the digital survey has been reviewed.",
    },
    cableRunOver20: {
      key: "cableRunOver20",
      label: "Cable run over 20m",
      amount: LONG_CABLE_RUN_SURCHARGE,
      guidanceText:
        "Your standard installation includes up to 10m of cable. Cable runs over 20m may need additional work and will be reviewed after your digital survey before any extra payment is requested.",
    },
    streetParking: {
      key: "streetParking",
      label: "Street parking installation complexity",
      amount: 250,
      guidanceText:
        "Street parking or shared parking can need additional routing, permissions, or installation work. We will review this after your survey and confirm any extra cost before proceeding.",
    },
    flatApartment: {
      key: "flatApartment",
      label: "Flat / apartment installation complexity",
      amount: 180,
      guidanceText:
        "Flats, apartments, and properties with shared access can need additional permissions or installation work. We will review this after your survey and confirm any extra cost before proceeding.",
    },
  },
  discounts: [],
  updatedAt: new Date(0).toISOString(),
};

const scenarioLabels: Record<DemoScenario, string> = {
  approved: "Approves on second poll",
  declined: "Declines immediately",
  pending: "Stays pending",
};

const sandboxOutcomeTabs: Array<{
  value: DemoScenario;
  label: string;
  detail: string;
}> = [
  {
    value: "approved",
    label: "Approved",
    detail: "Opens a Frasers-styled mock approval page and then returns an approved response.",
  },
  {
    value: "pending",
    label: "Pending",
    detail: "Opens a Frasers-styled mock waiting page and then returns a pending response.",
  },
  {
    value: "declined",
    label: "Declined",
    detail: "Opens a Frasers-styled mock not-approved page and then returns a declined response.",
  },
];

const sandboxApprovalOutcomes = {
  pending: {
    uniquePaymentReference: "7232fb1e-2140-4848-bf13-8045a974a8d0",
    paymentResult: "PENDING",
    label: "Authorization pending",
  },
  approved: {
    uniquePaymentReference: "c7680b93-f014-4ccb-9338-9aef4f4d4eed",
    paymentResult: "COMPLETED",
    label: "Authorization approved",
  },
  declined: {
    uniquePaymentReference: "e0ecc8b5-9b34-4f63-a6b1-c25cf921e9b8",
    paymentResult: "DECLINED",
    label: "Authorization declined",
  },
} as const;

const PAYMENT_POPUP_MESSAGE_TYPE = "vchrgd:payment-return";
const PAYMENT_POPUP_NAME = "vchrgd_secure_payment";
const PAYMENT_POPUP_WIDTH = 820;
const PAYMENT_POPUP_HEIGHT = 820;

const FRASERS_PLUS_TERMS: FrasersPlusTerm[] = [
  { months: 1, interestFree: true, apr: 0 },
  { months: 3, interestFree: true, apr: 0 },
  { months: 6, interestFree: false, apr: 0.299 },
  { months: 12, interestFree: false, apr: 0.299 },
  { months: 24, interestFree: false, apr: 0.299 },
  { months: 36, interestFree: false, apr: 0.299 },
];

const sandboxProfileLabels: Record<SandboxProfileKey, string> = {
  "fast-track": "Existing member (Fast Track)",
  "partial-match": "Existing member (Partial Match)",
  "new-customer": "New customer onboarding",
};

const sandboxProfiles: Record<
  SandboxProfileKey,
  {
    customerId: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    line1: string;
    line2: string;
    city: string;
    postalCode: string;
    country: string;
  }
> = {
  "fast-track": {
    customerId: "tymit-existing-member-accept-noonfido",
    firstName: "Accept",
    lastName: "Noonfido",
    email: "alex@vchrgd.com",
    phone: "+447786345432",
    line1: "1A Eghams Court",
    line2: "",
    city: "Bourne End",
    postalCode: "SL8 5YS",
    country: "GB",
  },
  "partial-match": {
    customerId: "tymit-partial-match-accept-noonfido",
    firstName: "Alex",
    lastName: "Noonfido",
    email: "alex@vchrgd.com",
    phone: "+447786345432",
    line1: "1A Eghams Court",
    line2: "",
    city: "Bourne End",
    postalCode: "SL8 5YS",
    country: "GB",
  },
  "new-customer": {
    customerId: "tymit-new-customer-demo",
    firstName: "Morgan",
    lastName: "Reed",
    email: "alex@vchrgd.com",
    phone: "+447700900555",
    line1: "44 Green Lane",
    line2: "",
    city: "Oxford",
    postalCode: "OX1 4BH",
    country: "GB",
  },
};

const currency = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 });
const input = "mt-1.5 h-12 w-full rounded-xl border border-line-strong bg-white px-4 text-base text-ink outline-none focus:border-ink focus:ring-4 focus:ring-brand/20";

function buildCustomerReference(paymentId?: string) {
  const seed = paymentId?.trim();
  if (seed) {
    return `cust-${seed.toLowerCase()}`;
  }

  return `cust-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function normalisePostcode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function formatPostcode(value: string) {
  const normalized = normalisePostcode(value);
  if (normalized.length <= 3) return normalized;
  return `${normalized.slice(0, -3)} ${normalized.slice(-3)}`;
}

function buildPaymentResumeUrl(paymentId: string, token: string) {
  const resumeUrl = new URL(window.location.href);
  resumeUrl.pathname = "/";
  resumeUrl.search = "";
  resumeUrl.searchParams.set("resume", "payment");
  resumeUrl.searchParams.set("paymentId", paymentId);
  resumeUrl.searchParams.set("ct", token);
  return resumeUrl.toString();
}

function writePaymentPopupPlaceholder(popup: Window) {
  try {
    popup.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Opening secure payment</title>
          <style>
            body {
              margin: 0;
              min-height: 100vh;
              display: grid;
              place-items: center;
              font-family: Arial, sans-serif;
              color: #0f172a;
              background: #f8fafc;
            }
            main {
              max-width: 320px;
              padding: 28px;
              border: 1px solid #dbe3ef;
              border-radius: 24px;
              background: white;
              text-align: center;
              box-shadow: 0 24px 60px rgba(15, 23, 42, 0.12);
            }
          </style>
        </head>
        <body>
          <main>
            <strong>Opening secure payment...</strong>
            <p>Please complete the next step in this window.</p>
          </main>
        </body>
      </html>
    `);
    popup.document.close();
  } catch {
    // The payment window may already have navigated cross-origin.
  }
}

function getPaymentPopupFeatures() {
  const availableWidth = window.screen.availWidth || window.outerWidth || window.innerWidth;
  const availableHeight = window.screen.availHeight || window.outerHeight || window.innerHeight;
  const width = Math.min(PAYMENT_POPUP_WIDTH, Math.max(720, Math.round(availableWidth * 0.74)));
  const height = Math.min(PAYMENT_POPUP_HEIGHT, Math.max(720, Math.round(availableHeight * 0.86)));
  const left = Math.max(0, Math.round(window.screenX + (availableWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (availableHeight - height) / 2));

  return [
    "popup=yes",
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    "resizable=yes",
    "scrollbars=yes",
  ].join(",");
}

function openPaymentPopupShell() {
  if (typeof window === "undefined") {
    return null;
  }

  const popup = window.open("", PAYMENT_POPUP_NAME, getPaymentPopupFeatures());
  if (!popup) {
    return null;
  }

  writePaymentPopupPlaceholder(popup);
  popup.focus();
  return popup;
}

function leaveCheckoutForExternalPayment(
  paymentId: string,
  handoffUrl: string,
  popup?: Window | null,
  checkoutToken = "",
) {
  if (typeof window === "undefined" || !handoffUrl.trim()) {
    return false;
  }

  window.history.replaceState(window.history.state, "", buildPaymentResumeUrl(paymentId, checkoutToken));

  if (popup && !popup.closed) {
    popup.location.replace(handoffUrl);
    popup.focus();
    return true;
  }

  const fallbackPopup = window.open(handoffUrl, PAYMENT_POPUP_NAME, getPaymentPopupFeatures());
  if (fallbackPopup) {
    fallbackPopup.focus();
    return true;
  }

  window.location.assign(handoffUrl);
  return false;
}

function calculateFrasersPlusIllustration(amount: number, term: FrasersPlusTerm) {
  if (amount <= 0) {
    return {
      monthly: 0,
      totalRepayable: 0,
      interest: 0,
    };
  }

  if (term.interestFree) {
    return {
      monthly: amount / term.months,
      totalRepayable: amount,
      interest: 0,
    };
  }

  const monthlyRate = Math.pow(1 + term.apr, 1 / 12) - 1;
  const monthly =
    (amount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -term.months));
  const totalRepayable = monthly * term.months;

  return {
    monthly,
    totalRepayable,
    interest: totalRepayable - amount,
  };
}

function splitCustomerName(name?: string) {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) {
    return {
      firstName: "",
      lastName: "",
    };
  }

  const [firstName, ...rest] = trimmed.split(/\s+/);
  return {
    firstName,
    lastName: rest.join(" ") || "Customer",
  };
}

function resolveChargerSlug(session?: ResumePaymentSession | null) {
  if (session?.chargerSlug) {
    return session.chargerSlug;
  }

  const matched = CHARGERS.find((charger) => charger.name === session?.chargerName);
  return matched?.slug ?? "seven-pro-untethered";
}

function isDiscountActive(discount: ProductDiscount, chargerSlug: string | null) {
  if (!discount.enabled) {
    return false;
  }

  if (discount.appliesTo !== "all" && discount.appliesTo !== chargerSlug) {
    return false;
  }

  const today = new Date();
  const start = discount.startsAt ? new Date(`${discount.startsAt}T00:00:00`) : null;
  const end = discount.expiresAt ? new Date(`${discount.expiresAt}T23:59:59.999`) : null;

  if (start && today < start) {
    return false;
  }

  if (end && today > end) {
    return false;
  }

  return true;
}

function normaliseVoucherCode(value: string) {
  return value.trim().toUpperCase();
}

function shouldCreateFreshCardPaymentId(session?: ResumePaymentSession | null) {
  const status = session?.latestStatus?.status?.toUpperCase();
  return (
    status === "FAILED" ||
    status === "CANCELLED" ||
    status === "CANCELED" ||
    status === "DECLINED" ||
    status === "EXPIRED"
  );
}

export function IntegrationShowcase({
  initialCheckoutAccess,
  preferredDatesEnabled = true,
  showMerchantControls = false,
  enableFrasersPlus = false,
  showSandboxOutcomeTabs = false,
  resumePaymentSession = null,
  resumePaymentId = null,
  forceFreshPaymentAttempt = false,
  productSettings = DEFAULT_CLIENT_PRODUCT_SETTINGS,
}: {
  initialCheckoutAccess: CheckoutAccess;
  preferredDatesEnabled?: boolean;
  showMerchantControls?: boolean;
  enableFrasersPlus?: boolean;
  showSandboxOutcomeTabs?: boolean;
  resumePaymentSession?: ResumePaymentSession | null;
  resumePaymentId?: string | null;
  forceFreshPaymentAttempt?: boolean;
  productSettings?: ProductSettings;
}) {
  const shouldResumePaymentStep = Boolean(resumePaymentSession || resumePaymentId);
  const initialName = splitCustomerName(resumePaymentSession?.customerName);
  const initialBillingAddress = resumePaymentSession?.billingAddress;
  const initialDeliveryAddress =
    resumePaymentSession?.deliveryAddress ?? resumePaymentSession?.billingAddress;
  const initialPaymentState = resumePaymentSession?.latestStatus?.status
    ? `${resumePaymentSession.latestStatus.currentType ?? "AUTHORIZATION"}: ${resumePaymentSession.latestStatus.status}`
    : "No payment started yet.";

  const [step, setStep] = useState<JourneyStep>(shouldResumePaymentStep ? 6 : 1);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(
    resolveChargerSlug(resumePaymentSession),
  );
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice | null>(
    enableFrasersPlus ? null : "card",
  );
  const [selectedFrasersTermIndex, setSelectedFrasersTermIndex] = useState(5);
  const [scenario, setScenario] = useState<DemoScenario>("approved");
  const [sandboxProfile, setSandboxProfile] = useState<SandboxProfileKey>("fast-track");
  const [customerFirstName, setCustomerFirstName] = useState(initialName.firstName);
  const [customerLastName, setCustomerLastName] = useState(initialName.lastName);
  const [customerId, setCustomerId] = useState(
    resumePaymentSession?.customerId ?? "",
  );
  const [paymentId, setPaymentId] = useState(initialCheckoutAccess.paymentId);
  const accessTokens = useRef<Record<string, string>>({ [initialCheckoutAccess.paymentId]: initialCheckoutAccess.token });
  async function freshCheckout() {
    const response = await fetch("/api/checkout-session", { method: "POST" });
    const access = await response.json();
    if (!response.ok || !access.paymentId || !access.token) throw new Error(access.error || "Unable to prepare secure checkout. Please try again.");
    accessTokens.current[access.paymentId] = access.token;
    setPaymentId(access.paymentId);
    return access.paymentId as string;
  }
  const [phone, setPhone] = useState(resumePaymentSession?.customerPhone ?? "");
  const [email, setEmail] = useState(resumePaymentSession?.customerEmail ?? "");
  const [billingLine1, setBillingLine1] = useState(initialBillingAddress?.line1 ?? "");
  const [billingLine2, setBillingLine2] = useState(initialBillingAddress?.line2 ?? "");
  const [billingCity, setBillingCity] = useState(initialBillingAddress?.city ?? "");
  const [billingPostalCode, setBillingPostalCode] = useState(
    initialBillingAddress?.postalCode ?? "",
  );
  const [billingCountry, setBillingCountry] = useState(initialBillingAddress?.country ?? "GB");
  const [deliverySameAsBilling] = useState(true);
  const [deliveryLine1, setDeliveryLine1] = useState(initialDeliveryAddress?.line1 ?? "");
  const [deliveryLine2, setDeliveryLine2] = useState(initialDeliveryAddress?.line2 ?? "");
  const [deliveryCity, setDeliveryCity] = useState(initialDeliveryAddress?.city ?? "");
  const [deliveryPostalCode, setDeliveryPostalCode] = useState(
    initialDeliveryAddress?.postalCode ?? "",
  );
  const [deliveryCountry, setDeliveryCountry] = useState(
    initialDeliveryAddress?.country ?? "GB",
  );
  const [expiresAt, setExpiresAt] = useState("2026-12-31T23:59:59.000Z");
  const [propertyType, setPropertyType] = useState<string | null>(
    resumePaymentSession?.propertyType ?? null,
  );
  const [parkingType, setParkingType] = useState<string | null>(
    resumePaymentSession?.parkingType ?? null,
  );
  const [fuseBoxDistance, setFuseBoxDistance] = useState<string | null>(
    resumePaymentSession?.fuseBoxDistance ?? null,
  );
  const [isHomeOwner, setIsHomeOwner] = useState(true);
  const [voucherCode, setVoucherCode] = useState(resumePaymentSession?.discountCode ?? "");
  const [validatedVoucher, setValidatedVoucher] = useState<{ slug: string; code: string; voucher: ProductDiscount | null } | null>(null);
  const [voucherChecking, setVoucherChecking] = useState(false);
  const [upr, setUpr] = useState(resumePaymentSession?.uniquePaymentReference ?? "");
  const [paymentState, setPaymentState] = useState(initialPaymentState);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [approvalUrl, setApprovalUrl] = useState(resumePaymentSession?.redirectUrl ?? "");
  const [, setCardCheckoutUrl] = useState("");
  const [cardCheckoutState, setCardCheckoutState] = useState(
    "No secure card checkout link has been created yet.",
  );
  const [paymentPopupActive, setPaymentPopupActive] = useState(false);
  const interactionStatusRef = useRef<InteractionStatus>("ACTIVE");
  const trackingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepFlowSectionRef = useRef<HTMLDivElement | null>(null);
  const paymentSectionRef = useRef<HTMLDivElement | null>(null);
  const paymentChoiceCardsRef = useRef<HTMLDivElement | null>(null);
  const stepIntroRef = useRef<HTMLDivElement | null>(null);
  const resumeScrollDoneRef = useRef(false);
  const stepNavigationPendingRef = useRef(false);
  const hasMountedRef = useRef(false);
  const paymentPopupCompletedRef = useRef(false);
  const paymentPopupCloseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [navDirection, setNavDirection] = useState<"forward" | "back">("forward");

  const configuredChargers = useMemo(() => {
    const configuredBySlug = new Map(
      productSettings.chargers.map((item) => [item.slug, item]),
    );
    return CHARGERS.map((charger) => {
      const configured = configuredBySlug.get(charger.slug as "seven-pro-tethered" | "seven-pro-untethered");
      return {
        ...charger,
        unitPrice: configured?.unitPrice ?? charger.unitPrice,
        installedPrice: configured?.installedPrice ?? charger.installedPrice,
      };
    });
  }, [productSettings]);
  const charger = useMemo(
    () => configuredChargers.find((item) => item.slug === selectedSlug) ?? null,
    [configuredChargers, selectedSlug],
  );
  const cableRunGuidanceAmount = useMemo(() => {
    if (fuseBoxDistance === "10m to 20m") {
      return productSettings.adjustments.cableRun10To20.amount;
    }

    if (fuseBoxDistance === "Over 20m") {
      return productSettings.adjustments.cableRunOver20.amount;
    }

    return 0;
  }, [
    fuseBoxDistance,
    productSettings.adjustments.cableRun10To20.amount,
    productSettings.adjustments.cableRunOver20.amount,
  ]);
  const distanceOptions = useMemo(
    () =>
      DISTANCE_OPTIONS.map((option) =>
        option.value === "Up to 10m"
          ? option
          : {
              ...option,
              detail:
                option.value === "10m to 20m"
                  ? productSettings.adjustments.cableRun10To20.guidanceText ?? option.detail
                  : productSettings.adjustments.cableRunOver20.guidanceText ?? option.detail,
            },
      ),
    [
      productSettings.adjustments.cableRun10To20.guidanceText,
      productSettings.adjustments.cableRunOver20.guidanceText,
    ],
  );
  const propertyOptions = useMemo(
    () =>
      PROPERTY_OPTIONS.map((option) =>
        option.value === "Flat / apartment"
          ? {
              ...option,
              detail: productSettings.adjustments.flatApartment.guidanceText ?? option.detail,
            }
          : option,
      ),
    [productSettings.adjustments.flatApartment.guidanceText],
  );
  const parkingOptions = useMemo(
    () =>
      PARKING_OPTIONS.map((option) =>
        option.value === "Street parking"
          ? {
              ...option,
              detail: productSettings.adjustments.streetParking.guidanceText ?? option.detail,
            }
          : option,
      ),
    [productSettings.adjustments.streetParking.guidanceText],
  );
  const hasInstallationGuidance =
    cableRunGuidanceAmount > 0 ||
    parkingType === "Street parking" ||
    propertyType === "Flat / apartment";
  const installationGuidanceSummaryLabel = hasInstallationGuidance
    ? "May be reviewed after survey"
    : "No guidance items selected";

  const standardInstallPrice = charger ? charger.installedPrice : 0;
  const installedPrice = standardInstallPrice;
  const surveyAdjustment = 0;
  const activeSpecialOffers = useMemo(
    () =>
      productSettings.discounts.filter(
        (discount) =>
          discount.kind === "SPECIAL_OFFER" &&
          isDiscountActive(discount, charger?.slug ?? selectedSlug),
      ),
    [charger?.slug, productSettings.discounts, selectedSlug],
  );
  const selectionBanners = useMemo(
    () =>
      productSettings.discounts.filter((discount) => {
        if (discount.kind !== "SPECIAL_OFFER") {
          return false;
        }

        if (!discount.bannerContent) {
          return false;
        }

        const targetSlug =
          discount.appliesTo === "all" ? charger?.slug ?? selectedSlug : discount.appliesTo;
        return isDiscountActive(discount, targetSlug);
      }),
    [charger?.slug, productSettings.discounts, selectedSlug],
  );
  const matchingVoucher = useMemo(() => {
    if (activeSpecialOffers.length > 0) {
      return null;
    }

    const code = normaliseVoucherCode(voucherCode);
    if (!code) {
      return null;
    }

    return validatedVoucher?.slug === (charger?.slug ?? selectedSlug) && validatedVoucher.code === code ? validatedVoucher.voucher : null;
  }, [activeSpecialOffers.length, charger?.slug, selectedSlug, validatedVoucher, voucherCode]);
  useEffect(() => {
    const code = normaliseVoucherCode(voucherCode);
    if (!code || !selectedSlug || activeSpecialOffers.length) { setVoucherChecking(false); return; }
    const controller = new AbortController();
    setVoucherChecking(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/checkout-quote", {
          method: "POST", headers: { "Content-Type": "application/json", "x-checkout-token": accessTokens.current[paymentId] || "" },
          body: JSON.stringify({ paymentId, slug: selectedSlug, code }), signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to check voucher.");
        if (!controller.signal.aborted) setValidatedVoucher({ slug: selectedSlug, code, voucher: data.voucher });
      } catch { if (!controller.signal.aborted) setValidatedVoucher(null); }
      finally { if (!controller.signal.aborted) setVoucherChecking(false); }
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [activeSpecialOffers.length, paymentId, selectedSlug, voucherCode]);
  const appliedDiscounts = useMemo<AppliedDiscount[]>(() => {
    const discounts = [
      ...activeSpecialOffers,
      ...(matchingVoucher ? [matchingVoucher] : []),
    ];
    return discounts.map((discount) => ({
      id: discount.id,
      kind: discount.kind,
      label: discount.label,
      code: discount.code,
      amount: discount.amount,
    }));
  }, [activeSpecialOffers, matchingVoucher]);
  const discountAmount = Math.min(
    installedPrice,
    appliedDiscounts.reduce((sum, discount) => sum + discount.amount, 0),
  );
  const totalBeforeDiscount = charger ? installedPrice : 0;
  const total = charger ? Math.max(totalBeforeDiscount - discountAmount, 0) : 0;
  const summaryAmountLabel =
    step === 6 && paymentChoice === "card" ? "Pay today by card" : "Installation estimate";
  const summaryPaymentGuidance =
    step === 6 && paymentChoice === "card"
      ? "Pay in full through secure card checkout."
      : step === 6 && paymentChoice === "frasers-plus"
        ? "Frasers Plus selected. Choose your repayment plan in the app after checkout."
        : enableFrasersPlus
          ? "Choose how to pay after your installation pre-check."
          : "Review your estimate before secure card checkout.";
  const discountSummary = appliedDiscounts
    .map((discount) => `${discount.label}${discount.code ? ` (${discount.code})` : ""}: -${currency.format(discount.amount)}`)
    .join(" | ");
  const discountAmountLabel = `-${currency.format(discountAmount)}`;
  const cableRunSummary = fuseBoxDistance ?? "Not selected";
  const selectedFrasersTerm =
    FRASERS_PLUS_TERMS[selectedFrasersTermIndex] ??
    FRASERS_PLUS_TERMS[5];
  const frasersPlusIllustration = calculateFrasersPlusIllustration(total, selectedFrasersTerm);
  const frasersPlusTermLabel = selectedFrasersTerm.interestFree
    ? `${selectedFrasersTerm.months} month${selectedFrasersTerm.months === 1 ? "" : "s"} interest free`
    : `${selectedFrasersTerm.months} months at representative 29.9% APR variable`;
  const selectedSandboxOutcome =
    sandboxApprovalOutcomes[
      scenario === "declined" || scenario === "pending" ? scenario : "approved"
    ];
  const [basketTimestamp, setBasketTimestamp] = useState("");
  const merchantId = "merchant-checkout-reference";
  const merchantName = "VCHRGD checkout";
  const redirectUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/frasers-plus/return`
      : "http://localhost:3000/frasers-plus/return";
  const deliveryAddress = deliverySameAsBilling
    ? { line1: billingLine1, line2: billingLine2, city: billingCity, postalCode: billingPostalCode, country: billingCountry, state: "", region: "" }
    : { line1: deliveryLine1, line2: deliveryLine2, city: deliveryCity, postalCode: deliveryPostalCode, country: deliveryCountry, state: "", region: "" };
  const billingCountryLabel = billingCountry === "GB" ? "United Kingdom" : billingCountry;
  const normalizedEmail = normaliseEmailInput(email);
  const emailValidationMessage = email ? getEmailValidationMessage(email) : "";
  const normalizedPhone = normaliseUkMobileInput(phone);
  const phoneValidationMessage = phone ? getUkMobileValidationMessage(phone) : "";
  const detailsComplete = Boolean(
    customerFirstName.trim() &&
      customerLastName.trim() &&
      normalizedEmail &&
      !emailValidationMessage &&
      normalizedPhone &&
      !phoneValidationMessage &&
      billingLine1.trim() &&
      billingCity.trim() &&
      billingPostalCode.trim(),
  );
  const maxUnlockedStep: JourneyStep = !selectedSlug
    ? 1
    : !propertyType
      ? 2
      : !parkingType
        ? 3
        : parkingType === "Street parking"
          ? 3
          : !fuseBoxDistance
            ? 4
            : !detailsComplete
              ? 5
              : 6;

  useEffect(() => {
    if (!basketTimestamp) {
      setBasketTimestamp(new Date().toISOString());
    }
  }, [basketTimestamp, paymentId]);

  const buildInteractionPayload = useCallback(
    (
      status: InteractionStatus,
      reason?: string,
      detailsSubmitted = step >= 6,
      paymentIdOverride?: string,
    ) => ({
      paymentId: paymentIdOverride || paymentId,
      checkoutToken: accessTokens.current[paymentIdOverride || paymentId] || "",
      discountCode: matchingVoucher?.code || "",
      lastStep: step,
      selectedSlug,
      chargerName: charger?.name ?? null,
      paymentChoice,
      propertyType,
      parkingType,
      fuseBoxDistance,
      customerFirstName: customerFirstName || null,
      customerLastName: customerLastName || null,
      customerEmail: normalizedEmail || null,
      customerPhone: normalizedPhone || null,
      billingLine1: billingLine1 || null,
      billingLine2: billingLine2 || null,
      billingCity: billingCity || null,
      billingPostalCode: billingPostalCode || null,
      billingCountry: billingCountry || null,
      total,
      status,
      reason,
      detailsSubmitted,
    }),
    [
      billingCity,
      billingCountry,
      billingLine1,
      billingLine2,
      billingPostalCode,
      charger?.name,
      customerFirstName,
      customerLastName,
      normalizedEmail,
      fuseBoxDistance,
      parkingType,
      paymentChoice,
      paymentId,
      matchingVoucher,
      normalizedPhone,
      propertyType,
      selectedSlug,
      step,
      total,
    ],
  );

  const trackInteraction = useCallback(
    async (
      status: InteractionStatus,
      reason?: string,
      detailsSubmitted?: boolean,
      paymentIdOverride?: string,
    ) => {
      interactionStatusRef.current = status;
      await fetch("/api/checkout-interactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildInteractionPayload(
            status,
            reason,
            detailsSubmitted,
            paymentIdOverride,
          ),
        ),
        keepalive: true,
      });
    },
    [buildInteractionPayload],
  );

  const sendInteractionBeacon = useCallback(
    (status: InteractionStatus, reason?: string, detailsSubmitted?: boolean) => {
      interactionStatusRef.current = status;

      if (typeof navigator === "undefined") {
        return;
      }

      const payload = JSON.stringify(buildInteractionPayload(status, reason, detailsSubmitted));
      navigator.sendBeacon(
        "/api/checkout-interactions",
        new Blob([payload], { type: "application/json" }),
      );
    },
    [buildInteractionPayload],
  );

  const clearPaymentPopupCloseWatch = useCallback(() => {
    if (paymentPopupCloseTimerRef.current) {
      clearInterval(paymentPopupCloseTimerRef.current);
      paymentPopupCloseTimerRef.current = null;
    }
  }, []);

  const watchPaymentPopupClose = useCallback(
    (popup: Window | null, onClosedBeforeReturn: () => void) => {
      clearPaymentPopupCloseWatch();

      if (!popup) {
        return;
      }

      paymentPopupCloseTimerRef.current = setInterval(() => {
        if (!popup.closed) {
          return;
        }

        clearPaymentPopupCloseWatch();
        if (!paymentPopupCompletedRef.current) {
          setPaymentPopupActive(false);
          onClosedBeforeReturn();
        }
      }, 750);
    },
    [clearPaymentPopupCloseWatch],
  );

  useEffect(() => {
    function handlePaymentPopupReturn(event: MessageEvent) {
      if (event.origin !== window.location.origin) {
        return;
      }

      const data = event.data as { type?: string; url?: string };
      if (data?.type !== PAYMENT_POPUP_MESSAGE_TYPE) {
        return;
      }

      paymentPopupCompletedRef.current = true;
      clearPaymentPopupCloseWatch();
      setPaymentPopupActive(false);

      if (data.url) {
        window.location.assign(data.url);
      }
    }

    window.addEventListener("message", handlePaymentPopupReturn);
    return () => {
      window.removeEventListener("message", handlePaymentPopupReturn);
      clearPaymentPopupCloseWatch();
      setPaymentPopupActive(false);
    };
  }, [clearPaymentPopupCloseWatch]);

  useEffect(() => {
    if (
      interactionStatusRef.current === "PAYMENT_PENDING" ||
      interactionStatusRef.current === "PAYMENT_COMPLETED" ||
      interactionStatusRef.current === "EXITED_SURVEY_LATER"
    ) {
      return;
    }

    if (trackingTimerRef.current) {
      clearTimeout(trackingTimerRef.current);
    }

    trackingTimerRef.current = setTimeout(() => {
      void trackInteraction("ACTIVE");
    }, 450);

    return () => {
      if (trackingTimerRef.current) {
        clearTimeout(trackingTimerRef.current);
      }
    };
  }, [trackInteraction]);

  useEffect(() => {
    function handlePageHide() {
      if (
        interactionStatusRef.current === "PAYMENT_PENDING" ||
        interactionStatusRef.current === "PAYMENT_COMPLETED" ||
        interactionStatusRef.current === "EXITED_SURVEY_LATER"
      ) {
        return;
      }

      sendInteractionBeacon("ABANDONED", "Customer left checkout before completing payment.");
    }

    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [sendInteractionBeacon]);

  useEffect(() => {
    if (!shouldResumePaymentStep || step !== 6 || resumeScrollDoneRef.current) {
      return;
    }

    resumeScrollDoneRef.current = true;

    const scrollToPaymentChoice = () => {
      (paymentChoiceCardsRef.current ?? paymentSectionRef.current)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    };

    const timer = window.setTimeout(scrollToPaymentChoice, 120);
    return () => window.clearTimeout(timer);
  }, [shouldResumePaymentStep, step]);

  useLayoutEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    if (!stepNavigationPendingRef.current) {
      return;
    }

    stepNavigationPendingRef.current = false;

    if (typeof window === "undefined") {
      return;
    }

    const target = stepFlowSectionRef.current;
    if (!target) {
      return;
    }

    const reposition = () => {
      stepIntroRef.current?.focus({ preventScroll: true });
      target.scrollIntoView({
        block: "start",
        inline: "nearest",
        behavior: "auto",
      });
      const nextTop = Math.max(0, window.scrollY + target.getBoundingClientRect().top - 12);
      window.scrollTo({
        top: nextTop,
        behavior: "auto",
      });
      document.documentElement.scrollTop = nextTop;
      document.body.scrollTop = nextTop;
    };

    reposition();
    const rafA = window.requestAnimationFrame(reposition);
    const rafB = window.requestAnimationFrame(reposition);
    const timerA = window.setTimeout(reposition, 120);
    const timerB = window.setTimeout(reposition, 260);
    const timerC = window.setTimeout(reposition, 420);
    const timerD = window.setTimeout(reposition, 650);

    return () => {
      window.cancelAnimationFrame(rafA);
      window.cancelAnimationFrame(rafB);
      window.clearTimeout(timerA);
      window.clearTimeout(timerB);
      window.clearTimeout(timerC);
      window.clearTimeout(timerD);
    };
  }, [step]);

  function goToStep(target: JourneyStep) {
    const nextStep = Math.min(target, maxUnlockedStep) as JourneyStep;
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    setNavDirection(nextStep >= step ? "forward" : "back");

    if (typeof window !== "undefined") {
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        active.blur();
      }

      const anchor = stepFlowSectionRef.current;
      if (anchor) {
        anchor.scrollIntoView({
          block: "start",
          inline: "nearest",
          behavior: "auto",
        });
        const nextTop = Math.max(0, window.scrollY + anchor.getBoundingClientRect().top - 12);
        window.scrollTo({
          top: nextTop,
          behavior: "auto",
        });
        document.documentElement.scrollTop = nextTop;
        document.body.scrollTop = nextTop;
      }
    }

    stepNavigationPendingRef.current = true;
    window.requestAnimationFrame(() => {
      setStep(nextStep);
    });
  }

  function returnToPaymentOptions() {
    setPaymentChoice(enableFrasersPlus ? null : "card");

    if (typeof window === "undefined") {
      return;
    }

    window.setTimeout(() => {
      (paymentChoiceCardsRef.current ?? paymentSectionRef.current)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 80);
  }

  function exitCheckout() {
    sendInteractionBeacon(
      "EXITED_SURVEY_LATER",
      "Customer chose to leave checkout and complete the survey later.",
      false,
    );
    if (typeof window === "undefined") return;
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    window.location.assign("https://www.vchrgd.com");
  }

  function handleDetailsContinue() {
    if (emailValidationMessage || phoneValidationMessage) {
      return;
    }

    if (email !== normalizedEmail) {
      setEmail(normalizedEmail);
    }

    if (phone !== normalizedPhone) {
      setPhone(normalizedPhone);
    }

    void trackInteraction(
      "ACTIVE",
      "Customer submitted contact and installation details and moved to payment.",
      true,
    );
    goToStep(6);
  }

  async function applySandboxProfile(profileKey: SandboxProfileKey) {
    const profile = sandboxProfiles[profileKey];
    if (!profile) return;

    setSandboxProfile(profileKey);
    setCustomerId(profile.customerId);
    setCustomerFirstName(profile.firstName);
    setCustomerLastName(profile.lastName);
    setEmail(profile.email);
    setPhone(profile.phone);
    setBillingLine1(profile.line1);
    setBillingLine2(profile.line2);
    setBillingCity(profile.city);
    setBillingPostalCode(profile.postalCode);
    setBillingCountry(profile.country);
    setDeliveryLine1(profile.line1);
    setDeliveryLine2(profile.line2);
    setDeliveryCity(profile.city);
    setDeliveryPostalCode(profile.postalCode);
    setDeliveryCountry(profile.country);
    await freshCheckout();
  }

  async function callPaymentApi(path: string, init?: RequestInit, fallbackState?: string) {
    const response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-checkout-token": accessTokens.current[paymentId] || "",
        "x-api-key": "test-api-token",
        ...(init?.headers ?? {}),
      },
    });
    const data = await response.json();
    setPaymentState(data?.status ? `${data.currentType ?? "AUTHORIZATION"}: ${data.status}` : fallbackState ?? `HTTP ${response.status}`);
    if (!response.ok) throw new Error(data?.error ?? `Request failed with ${response.status}`);
    return data;
  }

  async function runAction(action: string, request: () => Promise<void>) {
    setBusyAction(action);
    try {
      await request();
    } catch (error) {
      setPaymentState(error instanceof Error ? error.message : "Request failed");
    } finally {
      startTransition(() => setBusyAction(null));
    }
  }

  async function createAuthorization() {
    await runAction("authorise", async () => {
      paymentPopupCompletedRef.current = false;
      const paymentPopup = openPaymentPopupShell();
      if (!paymentPopup) {
        setPaymentPopupActive(false);
        setPaymentState(
          "Your browser blocked the payment popup, so Frasers Plus approval will continue in the current tab.",
        );
      } else {
        setPaymentPopupActive(true);
      }

      const authorizationPaymentId = forceFreshPaymentAttempt || upr || resumePaymentSession ? await freshCheckout() : paymentId;
      const authorizationCustomerId =
        customerId.trim() || buildCustomerReference(authorizationPaymentId);
      if (authorizationPaymentId !== paymentId) {
        setPaymentId(authorizationPaymentId);
      }
      if (authorizationCustomerId !== customerId) {
        setCustomerId(authorizationCustomerId);
      }

      try {
        const data = await callPaymentApi("/api/frasers-plus/payment", {
          method: "POST",
          headers: { "x-checkout-token": accessTokens.current[authorizationPaymentId] || "" },
          body: JSON.stringify({
            paymentId: authorizationPaymentId,
            type: "AUTHORIZATION",
            method: "ONLINE",
            mcc: "5552",
            customer: {
              id: authorizationCustomerId,
              firstName: customerFirstName,
              lastName: customerLastName,
              phone: normalizedPhone,
              email: normalizedEmail,
              billingAddress: { line1: billingLine1, line2: billingLine2, city: billingCity, postalCode: billingPostalCode, country: billingCountry, state: "", region: "" },
              deliveryAddress,
            },
            merchant: { id: merchantId, name: merchantName, redirectUrl, metadata: { channel: "checkout" } },
            description: `${charger?.name ?? "EV charger"} installation`,
            avs: false,
            paymentAmount: { amount: total, currency: "GBP" },
            expiresAt,
            basketTimestamp,
            metadata: {
              chargerSlug: charger?.slug ?? "",
              scenario,
              sandboxProfile,
              propertyType: propertyType ?? "",
              parkingType: parkingType ?? "",
              fuseBoxDistance: fuseBoxDistance ?? "",
              discountAmount: discountAmount.toFixed(2),
              discountCode: matchingVoucher?.code ?? "",
              discountLabel: appliedDiscounts.map((discount) => discount.label).join(" | "),
              totalBeforeDiscount: totalBeforeDiscount.toFixed(2),
            },
          }),
        });
        setUpr(data.uniquePaymentReference);
        setApprovalUrl(data.redirectUrl);
        setPaymentState("AUTHORIZATION created. Complete Frasers Plus approval in the payment window.");
        await trackInteraction(
          "PAYMENT_PENDING",
          "Customer opened the Frasers Plus hosted approval flow.",
          undefined,
          authorizationPaymentId,
        );

        if (typeof window !== "undefined" && data?.redirectUrl) {
          const openedInPopup = leaveCheckoutForExternalPayment(
            authorizationPaymentId,
            String(data.redirectUrl),
            paymentPopup,
            accessTokens.current[authorizationPaymentId] || "",
          );
          if (openedInPopup) {
            watchPaymentPopupClose(paymentPopup, () => {
              setPaymentState(
                "The Frasers Plus approval window was closed before a result was returned. Your checkout is still open and you can try again.",
              );
              void trackInteraction(
                "ABANDONED",
                "Customer closed the Frasers Plus approval window before completion.",
                undefined,
                authorizationPaymentId,
              );
            });
          } else {
            setPaymentPopupActive(false);
          }
        }
      } catch (error) {
        paymentPopup?.close();
        setPaymentPopupActive(false);
        throw error;
      }
    });
  }

  async function createCardCheckout() {
    if (!charger) {
      setCardCheckoutState("Choose a charger before continuing to card checkout.");
      return;
    }

    setBusyAction("card-checkout");
    let attemptedCardPaymentId = paymentId;
    try {
      const forceFreshPaymentId =
        forceFreshPaymentAttempt || shouldCreateFreshCardPaymentId(resumePaymentSession);
      const cardPaymentId = forceFreshPaymentId || upr || resumePaymentSession ? await freshCheckout() : paymentId;
      attemptedCardPaymentId = cardPaymentId;
      if (cardPaymentId !== paymentId) {
        setPaymentId(cardPaymentId);
        setUpr("");
        setApprovalUrl("");
        setCardCheckoutUrl("");
      }
      const checkoutCustomerId = customerId.trim() || buildCustomerReference(cardPaymentId);
      if (checkoutCustomerId !== customerId) {
        setCustomerId(checkoutCustomerId);
      }
      const response = await fetch("/api/card-checkout/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-checkout-token": accessTokens.current[cardPaymentId] || "",
        },
        body: JSON.stringify({
          paymentId: cardPaymentId,
          customerId: checkoutCustomerId,
          firstName: customerFirstName,
          lastName: customerLastName,
          email: normalizedEmail,
          phone: normalizedPhone,
          charger: {
            slug: charger.slug,
            name: charger.name,
            hardwarePrice: charger.unitPrice,
            installPrice: installedPrice,
          },
          surveyAdjustment,
          discountAmount,
          discountCode: matchingVoucher?.code ?? "",
          discountLabel: appliedDiscounts.map((discount) => discount.label).join(" | "),
          totalBeforeDiscount,
          total,
          propertyType,
          parkingType,
          fuseBoxDistance,
          billingAddress: {
            line1: billingLine1,
            line2: billingLine2,
            city: billingCity,
            postalCode: billingPostalCode,
            country: billingCountry,
          },
          deliveryAddress: {
            line1: deliveryAddress.line1,
            line2: deliveryAddress.line2,
            city: deliveryAddress.city,
            postalCode: deliveryAddress.postalCode,
            country: deliveryAddress.country,
          },
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error ?? `Request failed with ${response.status}`);
      }

      const checkoutUrl = typeof data.url === "string" ? data.url : "";

      setCardCheckoutUrl(checkoutUrl);
      setCardCheckoutState(data.status ?? "Secure card checkout ready.");
      await trackInteraction(
        "PAYMENT_PENDING",
        "Customer opened the secure card checkout flow.",
        undefined,
        cardPaymentId,
      );

      if (checkoutUrl) {
        window.history.replaceState(window.history.state, "", buildPaymentResumeUrl(cardPaymentId, accessTokens.current[cardPaymentId] || ""));
        window.location.assign(checkoutUrl);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to start card checkout.";
      setPaymentPopupActive(false);
      setCardCheckoutState(message);
      await trackInteraction(
        "ABANDONED",
        `Secure card checkout could not be created: ${message}`,
        undefined,
        attemptedCardPaymentId,
      );
    } finally {
      startTransition(() => setBusyAction(null));
    }
  }

  async function pollStatus() {
    if (!upr) {
      setPaymentState("Start payment authorisation first.");
      return;
    }
    await runAction("poll", async () => {
      await callPaymentApi(`/api/frasers-plus/payment/${upr}`, { method: "GET" });
    });
  }

  async function updatePayment(type: PaymentType) {
    if (!upr) {
      setPaymentState("Start payment authorisation first.");
      return;
    }
    await runAction(type.toLowerCase(), async () => {
      await callPaymentApi(`/api/frasers-plus/payment/${upr}`, {
        method: "PUT",
        body: JSON.stringify({
          type,
          paymentAmount: { amount: type === "CREDIT" ? Number((total * 0.35).toFixed(2)) : total, currency: "GBP" },
          basket: {
            orderId: `VCHRGD-${(charger?.slug ?? "charger").toUpperCase()}`,
            internalOrderId: `INSTALL-${new Date().getFullYear()}-${charger?.slug ?? "charger"}`,
            orderStatus: "FULLFILLED",
            paymentMethods: ["FRASERSPLUSCREDIT"],
            discount: discountAmount,
            basketItems: {
              discount: discountAmount,
              products: [
                {
                  id: `${charger?.slug ?? "charger"}-installed`,
                  name: `${charger?.name ?? "EV charger"} installed package`,
                  category: "EV charger installation",
                  price: installedPrice,
                  quantity: 1,
                  total: installedPrice,
                },
              ],
            },
            subtotal: totalBeforeDiscount,
            tax: 0,
            total,
            currency: "GBP",
          },
        }),
      });
    });
  }

  const stage = STAGE_FOR_STEP[step];
  const [showDetailErrors, setShowDetailErrors] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [voucherOpen, setVoucherOpen] = useState(Boolean(resumePaymentSession?.discountCode));

  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
      }
    };
  }, []);

  // Answering a pre-check question moves on by itself after a short pause, so the
  // customer sees their choice register. The same click event as "Continue" is recorded.
  function answerQuestion(fromStep: 2 | 3 | 4, value: string) {
    if (fromStep === 2) setPropertyType(value);
    if (fromStep === 3) setParkingType(value);
    if (fromStep === 4) setFuseBoxDistance(value);

    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }

    // Answers that show a note (possible extra cost or a stop) wait for the customer
    // to read it and press Continue themselves.
    const needsReading =
      (fromStep === 2 && value === "Flat / apartment") ||
      (fromStep === 3 && value === "Street parking") ||
      (fromStep === 4 && value !== "Up to 10m");
    if (needsReading) {
      return;
    }

    autoAdvanceTimerRef.current = setTimeout(() => {
      autoAdvanceTimerRef.current = null;
      const continueEvent = CONTINUE_CLICK_EVENTS[fromStep];
      if (continueEvent) {
        trackCheckoutClick(continueEvent);
      }
      setNavDirection("forward");
      stepNavigationPendingRef.current = true;
      setStep((fromStep + 1) as JourneyStep);
    }, 260);
  }

  const phoneFormatError = phone && phoneValidationMessage
    ? "Enter a UK mobile number, for example 7700 900123."
    : "";
  const detailErrors = {
    firstName: customerFirstName.trim() ? "" : "Enter your first name.",
    lastName: customerLastName.trim() ? "" : "Enter your last name.",
    email: !email.trim() ? "Enter your email address." : emailValidationMessage,
    phone: !phone.trim() ? "Enter your mobile number." : phoneFormatError,
    postcode: billingPostalCode.trim() ? "" : "Enter your postcode.",
    line1: billingLine1.trim() ? "" : "Enter the first line of your address.",
    city: billingCity.trim() ? "" : "Enter your town or city.",
  };
  const visibleError = (key: keyof typeof detailErrors) => {
    if (key === "email" && email && emailValidationMessage) return emailValidationMessage;
    if (key === "phone" && phoneFormatError && (showDetailErrors || normalizedPhone.length >= 11)) return phoneFormatError;
    return showDetailErrors ? detailErrors[key] : "";
  };

  function submitDetails() {
    if (!detailsComplete) {
      setShowDetailErrors(true);
      const order: Array<[keyof typeof detailErrors, string]> = [
        ["firstName", "ck-first-name"],
        ["lastName", "ck-last-name"],
        ["email", "ck-email"],
        ["phone", "ck-phone"],
        ["line1", "ck-line1"],
        ["city", "ck-city"],
        ["postcode", "ck-postcode"],
      ];
      const first = order.find(([key]) => detailErrors[key]);
      if (first) {
        const field = document.getElementById(first[1]);
        field?.scrollIntoView({ block: "center", behavior: "smooth" });
        field?.focus({ preventScroll: true });
      }
      return;
    }

    trackCheckoutClick("continue_details");
    handleDetailsContinue();
  }

  const totalDisplay = charger ? money(total) : "—";
  const answers = [propertyType, parkingType, fuseBoxDistance].filter(Boolean) as string[];
  // The summary reflects progress: answers are remembered when going back, but only
  // answers from steps already passed are listed.
  const showPropertyInSummary = Boolean(propertyType) && step > 2;
  const showParkingInSummary = Boolean(parkingType) && step > 3;
  const showCableInSummary = Boolean(fuseBoxDistance) && step > 4;

  function renderSummary() {
    return (
      <div className="rounded-[20px] bg-white p-5 sm:p-6">
        <p className="text-[15px] font-semibold">Order summary</p>
        {charger ? (
          <div className="mt-4 flex items-center gap-4">
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-wash">
              <Image src={charger.image} alt="" width={900} height={1000} className="h-12 w-auto object-contain" />
            </span>
            <div className="min-w-0 flex-1">
              <p key={charger.slug} className="ck-reveal text-[15px] font-semibold leading-5">{charger.name}</p>
              <p className="mt-1 text-sm leading-5 text-muted">Charger and standard installation</p>
            </div>
            <p className="ck-num text-[15px] font-semibold">{money(installedPrice)}</p>
          </div>
        ) : (
          <p className="mt-4 text-sm leading-6 text-muted">
            Your selected charger and installation details will appear here as you move through checkout.
          </p>
        )}

        {showPropertyInSummary || showParkingInSummary || showCableInSummary || discountAmount > 0 ? (
          <dl className="mt-5 grid gap-3 border-t border-line pt-5 text-sm">
            {showPropertyInSummary ? <SummaryRow label="Property" value={propertyType ?? ""} /> : null}
            {showParkingInSummary ? <SummaryRow label="Parking" value={parkingType ?? ""} /> : null}
            {showCableInSummary ? <SummaryRow label="Cable run" value={cableRunSummary} /> : null}
            {showCableInSummary && hasInstallationGuidance ? (
              <SummaryRow label="Installation" value={installationGuidanceSummaryLabel} />
            ) : null}
            {discountAmount > 0 ? <SummaryRow label="Discount" value={discountAmountLabel} tone="ok" /> : null}
          </dl>
        ) : null}

        <div className="mt-5 flex items-baseline justify-between gap-4 border-t border-line pt-5">
          <span className="text-[15px] font-semibold">{summaryAmountLabel}</span>
          <span key={total} className="ck-value-change ck-num text-2xl font-bold tracking-tight">{totalDisplay}</span>
        </div>
        <p className="mt-2 text-sm leading-5 text-muted">{summaryPaymentGuidance}</p>

        <ul className="mt-5 grid gap-2 border-t border-line pt-5 text-sm text-ink-soft">
          <li className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-brand-ink" aria-hidden="true" />
            Secure payment
          </li>
          <li className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-brand-ink" aria-hidden="true" />
            3-year charger warranty
          </li>
          <li className="flex items-center gap-2">
            <Headset className="h-4 w-4 text-brand-ink" aria-hidden="true" />
            UK based support
          </li>
        </ul>
        <div className="mt-4">
          <TrustpilotWidget variant="plain" />
        </div>
      </div>
    );
  }

  const nextLabel = step === 1 && charger ? `Continue · ${totalDisplay}` : "Continue";

  return (
    <>
      {paymentPopupActive ? <PaymentPopupBackdrop /> : null}
      <section onClickCapture={captureCheckoutClick} className="ck-root">
        <div ref={stepFlowSectionRef} className="scroll-mt-4" style={{ overflowAnchor: "none" }}>
          <Stepper stage={stage} maxUnlockedStep={maxUnlockedStep} onStageClick={(target) => goToStep(STAGE_FIRST_STEP[target])} />
        </div>

        <div className="mt-6 grid gap-6 sm:mt-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-8">
          <div className="relative z-10 min-w-0">
            <div className="rounded-[20px] bg-white p-5 sm:p-8">
              <div key={step} data-direction={navDirection} className="ck-step-enter">
                {step === 1 ? (
                  <div>
                    <div ref={stepIntroRef} tabIndex={-1} className="outline-none">
                      <StepTitle title="Choose your Seven Pro" subtitle="Each price includes the charger and standard installation." />
                    </div>

                    {selectionBanners.length > 0 ? (
                      <div className="mt-5 grid gap-2">
                        {selectionBanners.map((discount) => (
                          <Notice key={discount.id} tone="ok">
                            <span className="block font-semibold">{discount.bannerContent}</span>
                            {discount.disclaimerContent ? (
                              <span className="mt-1 block text-xs opacity-80">{discount.disclaimerContent}</span>
                            ) : null}
                          </Notice>
                        ))}
                      </div>
                    ) : null}

                    <div role="radiogroup" aria-label="Charger" className="mt-6 grid grid-cols-2 gap-3 sm:gap-4">
                      {configuredChargers.map((item) => {
                        const cardSpecialOfferAmount = productSettings.discounts
                          .filter((discount) => discount.kind === "SPECIAL_OFFER" && isDiscountActive(discount, item.slug))
                          .reduce((sum, discount) => sum + discount.amount, 0);
                        const cardDiscountedPrice = Math.max(item.installedPrice - cardSpecialOfferAmount, 0);

                        return (
                          <ChargerCard
                            key={item.slug}
                            name={item.name}
                            summary={item.summary}
                            features={item.features.map((feature) => feature.label)}
                            image={item.image}
                            power={item.power}
                            price={money(cardSpecialOfferAmount > 0 ? cardDiscountedPrice : item.installedPrice)}
                            originalPrice={cardSpecialOfferAmount > 0 ? money(item.installedPrice) : null}
                            selected={item.slug === selectedSlug}
                            onSelect={() => setSelectedSlug(item.slug)}
                            trackingEvent={item.slug === "seven-pro-tethered" ? "charger_tethered" : "charger_untethered"}
                          />
                        );
                      })}
                    </div>

                    <WhatsIncluded className="mt-4" />

                    <div className="mt-8">
                      <p id="ck-homeowner-label" className="text-[15px] font-semibold">
                        Do you own the home where the charger will be installed?
                      </p>
                      <div role="radiogroup" aria-labelledby="ck-homeowner-label" className="mt-3 grid grid-cols-2 gap-3">
                        <SegmentButton selected={isHomeOwner} onClick={() => setIsHomeOwner(true)}>Yes</SegmentButton>
                        <SegmentButton selected={!isHomeOwner} onClick={() => setIsHomeOwner(false)}>No, it&apos;s rented</SegmentButton>
                      </div>
                      {!isHomeOwner ? (
                        <Notice tone="caution" className="mt-3">
                          Landlord or property-owner permission may be required before installation.
                          We cannot process an OZEV grant application or voucher through this online
                          checkout. Please call{" "}
                          <a className="font-semibold underline underline-offset-2" href="tel:+441494370525">01494 370525</a>{" "}
                          and speak to our team before placing your order.
                        </Notice>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {step === 2 ? (
                  <QuestionStep
                    introRef={stepIntroRef}
                    counter="Question 1 of 3"
                    title="What kind of property is it?"
                    body="This helps us understand whether the installation is likely to need any extra review."
                    info={
                      <InfoTip label="Why we ask about your property" title="Why we ask">
                        <p>This helps us understand whether the installation is likely to need any extra review.</p>
                        <p className="mt-2">{productSettings.adjustments.flatApartment.guidanceText}</p>
                      </InfoTip>
                    }
                    options={PROPERTY_OPTIONS}
                    selected={propertyType}
                    onSelect={(value) => answerQuestion(2, value)}
                    guidance={
                      propertyType === "Flat / apartment"
                        ? propertyOptions.find((option) => option.value === "Flat / apartment")?.detail ?? null
                        : null
                    }
                  />
                ) : null}

                {step === 3 ? (
                  <QuestionStep
                    introRef={stepIntroRef}
                    counter="Question 2 of 3"
                    title="Where will you park to charge?"
                    body="This helps us understand the likely charger position and cable route."
                    recap={[{ name: "property", value: propertyType, icon: iconForAnswer(propertyType), onChange: () => goToStep(2) }]}
                    info={
                      <InfoTip label="Why we ask about parking" title="Why we ask">
                        <p>This helps us understand the likely charger position and cable route.</p>
                        <p className="mt-2">
                          Street parking installations may require council approval and other permissions before
                          work can begin, so we cannot process them through this online checkout.
                        </p>
                      </InfoTip>
                    }
                    options={PARKING_OPTIONS}
                    selected={parkingType}
                    onSelect={(value) => answerQuestion(3, value)}
                    after={
                      parkingType === "Street parking" ? (
                        <Notice tone="caution" title="Street parking installations">
                          We cannot process street parking applications through this online checkout. These
                          installations may require council approval and other permissions before work can begin.
                          Please call our team on{" "}
                          <a className="font-semibold underline underline-offset-2" href="tel:+441494370525">01494 370525</a>{" "}
                          so we can review the location and advise you on the next steps.
                        </Notice>
                      ) : null
                    }
                  />
                ) : null}

                {step === 4 ? (
                  <QuestionStep
                    introRef={stepIntroRef}
                    counter="Question 3 of 3"
                    title="How far is the charger from your fuse box?"
                    body="Your standard installation includes up to 10m of cable. Longer cable runs will be reviewed after your digital survey."
                    recap={[
                      { name: "property", value: propertyType, icon: iconForAnswer(propertyType), onChange: () => goToStep(2) },
                      { name: "parking", value: parkingType, icon: iconForAnswer(parkingType), onChange: () => goToStep(3) },
                    ]}
                    info={
                      <InfoTip label="About cable distance" title="Cable distance">
                        <p>{productSettings.adjustments.longCableRun.guidanceText}</p>
                      </InfoTip>
                    }
                    options={DISTANCE_OPTIONS}
                    selected={fuseBoxDistance}
                    onSelect={(value) => answerQuestion(4, value)}
                    guidance={
                      fuseBoxDistance && fuseBoxDistance !== "Up to 10m"
                        ? distanceOptions.find((option) => option.value === fuseBoxDistance)?.detail ?? null
                        : null
                    }
                  />
                ) : null}

                {step === 5 ? (
                  <div>
                    <div ref={stepIntroRef} tabIndex={-1} className="outline-none">
                      <StepTitle title="Your details" subtitle="We use these to set up your order. Your digital survey link is sent after you pay." />
                    </div>

                    <div className="mt-6 grid grid-cols-2 gap-x-3 gap-y-4 sm:gap-x-4">
                      <TextField id="ck-first-name" label="First name" autoComplete="given-name" value={customerFirstName} onChange={setCustomerFirstName} error={visibleError("firstName")} />
                      <TextField id="ck-last-name" label="Last name" autoComplete="family-name" value={customerLastName} onChange={setCustomerLastName} error={visibleError("lastName")} />
                      <TextField
                        id="ck-email"
                        label="Email"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        value={email}
                        onChange={setEmail}
                        onBlur={(value) => setEmail(normaliseEmailInput(value))}
                        error={visibleError("email")}
                        valid={Boolean(normalizedEmail && !emailValidationMessage)}
                        className="col-span-2 sm:col-span-1"
                      />
                      <PhoneField
                        value={phone}
                        onChange={setPhone}
                        error={visibleError("phone")}
                        valid={Boolean(normalizedPhone && !phoneValidationMessage)}
                        className="col-span-2 sm:col-span-1"
                        info={
                          <InfoTip label="Why we need your mobile number" title="Why we need your mobile">
                            <p>We will send the next survey step to your mobile number so the installation can be reviewed properly.</p>
                          </InfoTip>
                        }
                      />
                    </div>

                    <p className="mt-8 text-[15px] font-semibold">Installation address</p>
                    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-4 sm:gap-x-4">
                      <TextField
                        id="ck-line1"
                        label="Address line 1"
                        autoComplete="address-line1"
                        value={billingLine1}
                        onChange={(value) => {
                          setBillingLine1(value);
                          setDeliveryLine1(value);
                        }}
                        error={visibleError("line1")}
                        className="col-span-2"
                      />
                      <TextField
                        id="ck-line2"
                        label="Address line 2 (optional)"
                        autoComplete="address-line2"
                        value={billingLine2}
                        onChange={(value) => {
                          setBillingLine2(value);
                          setDeliveryLine2(value);
                        }}
                        className="col-span-2 sm:col-span-1"
                      />
                      <TextField
                        id="ck-city"
                        label="Town or city"
                        autoComplete="address-level2"
                        value={billingCity}
                        onChange={(value) => {
                          setBillingCity(value);
                          setDeliveryCity(value);
                        }}
                        error={visibleError("city")}
                        className="col-span-1"
                      />
                      <TextField
                        id="ck-postcode"
                        label="Postcode"
                        autoComplete="postal-code"
                        value={billingPostalCode}
                        onChange={(value) => {
                          setBillingPostalCode(value.toUpperCase());
                          setDeliveryPostalCode(value.toUpperCase());
                        }}
                        onBlur={(value) => {
                          const formatted = formatPostcode(value);
                          setBillingPostalCode(formatted);
                          setDeliveryPostalCode(formatted);
                        }}
                        error={visibleError("postcode")}
                        className="col-span-1"
                      />
                      <div className="col-span-2 sm:col-span-1">
                        <p className="flex min-h-6 items-center text-sm font-medium text-ink-soft">Country</p>
                        <div className="mt-1.5 flex h-12 items-center gap-2 rounded-xl bg-wash px-4 text-base text-ink-soft" aria-label="Country: United Kingdom">
                          <UkFlag />
                          {billingCountry === "GB" ? "United Kingdom" : billingCountry}
                        </div>
                      </div>
                    </div>

                    <ActionRow
                      back={<SecondaryButton onClick={() => goToStep(4)} trackingEvent="navigation_back">Back</SecondaryButton>}
                      next={<PrimaryButton onClick={submitDetails}><span className="sm:hidden">Continue</span><span className="hidden sm:inline">Continue to payment</span></PrimaryButton>}
                    />

                    <p className="mt-6 text-center text-sm text-muted">
                      Not ready to pay yet?{" "}
                      <button type="button" onClick={exitCheckout} className="ck-press font-medium text-ink underline underline-offset-4 hover:decoration-2">
                        Leave checkout for now
                      </button>
                    </p>
                  </div>
                ) : null}

                {step === 6 ? (
                  <div id="payment-method" ref={paymentSectionRef} className="scroll-mt-24">
                    <div ref={stepIntroRef} tabIndex={-1} className="outline-none">
                      <StepTitle title="Review and pay" subtitle="Check your order, then choose how you would like to pay." />
                    </div>

                    <div className="mt-6 divide-y divide-white rounded-2xl bg-wash">
                      <ReviewRow label="Charger" value={charger ? `${charger.name} · ${money(installedPrice)}` : "Not selected"} onChange={() => goToStep(1)} />
                      <ReviewRow label="Your home" value={answers.join(" · ") || "Not answered"} onChange={() => goToStep(2)} />
                      <ReviewRow
                        label="Installation address"
                        value={[billingLine1, billingLine2, billingCity, billingPostalCode].filter(Boolean).join(", ") || "Not provided"}
                        onChange={() => goToStep(5)}
                      />
                      <ReviewRow
                        label="Contact"
                        value={[`${customerFirstName} ${customerLastName}`.trim(), email, phone].filter(Boolean).join(" · ") || "Not provided"}
                        onChange={() => goToStep(5)}
                      />
                    </div>
                    <p className="mt-3 text-sm leading-6 text-muted">
                      Installation cost may still change if the site differs from the information provided.
                    </p>

                    <div className="mt-5">
                      {voucherOpen || activeSpecialOffers.length > 0 ? (
                        <div className="ck-reveal">
                          <label htmlFor="ck-voucher" className="text-sm font-medium text-ink-soft">Promotion or voucher code</label>
                          <input
                            id="ck-voucher"
                            value={voucherCode}
                            onChange={(event) => setVoucherCode(event.target.value.toUpperCase())}
                            placeholder="VCHRGD-ABCD"
                            disabled={activeSpecialOffers.length > 0}
                            className="mt-1.5 h-12 w-full rounded-xl border border-line-strong bg-white px-4 text-base outline-none focus:border-ink focus:ring-4 focus:ring-brand/20 sm:max-w-xs"
                          />
                          <p className="mt-1.5 text-sm text-muted">
                            Active special offers are applied automatically and cannot be combined with voucher codes.
                          </p>
                          {activeSpecialOffers.length > 0 || matchingVoucher ? (
                            <Notice tone="ok" className="mt-3">
                              {activeSpecialOffers.length > 0
                                ? `${money(discountAmount)} promotional discount applied. Voucher codes cannot be used with this offer.`
                                : discountSummary || "Voucher applied."}
                            </Notice>
                          ) : voucherCode.trim() ? (
                            <Notice tone={voucherChecking ? "info" : "caution"} className="mt-3">
                              {voucherChecking ? "Checking your voucher..." : "This code is not active for the selected charger or has expired."}
                            </Notice>
                          ) : null}
                        </div>
                      ) : (
                        <button type="button" onClick={() => setVoucherOpen(true)} className="ck-press min-h-11 text-sm font-medium text-ink underline underline-offset-4 hover:decoration-2">
                          Have a promotion or voucher code?
                        </button>
                      )}
                    </div>

                    <h2 className="mt-8 text-lg font-semibold">How would you like to pay?</h2>
                    <div ref={paymentChoiceCardsRef} role="radiogroup" aria-label="Payment method" className="mt-4 grid gap-3">
                      <PaymentOption
                        selected={paymentChoice === "card"}
                        onSelect={() => setPaymentChoice("card")}
                        trackingEvent={enableFrasersPlus ? "payment_card" : undefined}
                        title="Pay in full"
                        price={totalDisplay}
                        description={
                          <>
                            <span className="block">Pay securely with your debit or credit card, or use Revolut Pay, Apple Pay or Google Pay.</span>
                            <span className="mt-2 flex items-center gap-1.5">
                              {PAYMENT_LOGOS.map((logo) => (
                                <Image key={logo.src} src={logo.src} alt={logo.alt} width={36} height={24} className="h-6 w-9 rounded bg-white" />
                              ))}
                            </span>
                          </>
                        }
                      >
                        <div className="rounded-2xl bg-wash p-4">
                          <p className="text-sm font-semibold">Before you continue</p>
                          <ul className="mt-2 grid list-disc gap-1.5 pl-5 text-sm leading-6 text-ink-soft">
                            <li>Your card payment is taken up front for the quoted amount.</li>
                            <li>
                              The quoted amount is an estimate and may change if the survey shows that the installation is
                              non-standard or that additional works are required to make the property suitable for installation.
                            </li>
                            <li>
                              Your order still depends on the digital survey being received, reviewed and approved by VCHRGD
                              before installation can go ahead.
                            </li>
                            <li>If your survey is not received within 3 days, your order may be cancelled and refunded.</li>
                          </ul>
                        </div>
                        <PrimaryButton
                          onClick={createCardCheckout}
                          trackingEvent="card_continue"
                          disabled={voucherChecking || busyAction !== null || !charger || paymentChoice !== "card"}
                          loading={busyAction === "card-checkout"}
                          className="mt-4 w-full"
                        >
                          {busyAction === "card-checkout" ? "Opening secure payment..." : `Pay ${totalDisplay} securely`}
                        </PrimaryButton>
                        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted">
                          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                          You will enter your card details on a secure payment page.
                        </p>
                        {cardCheckoutState !== CARD_CHECKOUT_IDLE_MESSAGE && busyAction !== "card-checkout" ? (
                          <p role="status" className="mt-3 text-sm leading-6 text-ink-soft">{cardCheckoutState}</p>
                        ) : null}
                      </PaymentOption>

                      {enableFrasersPlus ? (
                        <PaymentOption
                          selected={paymentChoice === "frasers-plus"}
                          onSelect={() => setPaymentChoice("frasers-plus")}
                          trackingEvent="payment_frasers"
                          title="Pay monthly with Frasers Plus"
                          badge={
                            <Image
                              src="/content/frasers-plus-official-horizontal-background.svg"
                              alt="Frasers Plus"
                              width={2000}
                              height={544}
                              unoptimized
                              className="h-5 w-auto rounded-sm"
                            />
                          }
                          description={
                            <>
                              <span className="block">0% interest for 3 months available when you choose a 3 month plan.</span>
                              <span className="mt-1 block font-semibold text-ink">Representative 29.9% APR variable.</span>
                              <span className="mt-1 block">New to Frasers Plus? Check your eligibility in minutes without affecting your credit score.</span>
                            </>
                          }
                        >
                          <div className="rounded-2xl bg-wash p-4">
                            <div className="flex items-center gap-1">
                              <p className="text-sm font-semibold">Choose your Frasers Plus plan</p>
                              <InfoTip label="How Frasers Plus approval works" title="How Frasers Plus approval works">
                                <p><strong>Got Frasers Plus?</strong> If you already have an account, the secure checkout may recognise you and help you checkout in seconds.</p>
                                <p className="mt-2"><strong>Need to confirm a few details?</strong> If anything needs checking, Frasers Plus may ask you to verify your details before you carry on.</p>
                                <p className="mt-2"><strong>New to Frasers Plus?</strong> Check your eligibility in minutes without affecting your credit score.</p>
                                <p className="mt-2 text-muted">
                                  Frasers Plus approval is requested up front, but your order still depends on survey completion and
                                  review by VCHRGD. If the survey shows that the installation is non-standard or that additional works
                                  are required to make the property suitable for installation, VCHRGD will confirm any revised price
                                  before proceeding.
                                </p>
                              </InfoTip>
                            </div>
                            <p className="mt-1 text-sm leading-6 text-muted">
                              We will send you to a secure Frasers Plus page. If you already have Frasers Plus, you can checkout in
                              seconds. If you are new, you can check your eligibility in minutes without affecting your credit score.
                            </p>

                            <p className="ck-num mt-5 text-lg font-semibold">
                              {selectedFrasersTerm.months} month{selectedFrasersTerm.months === 1 ? "" : "s"}
                            </p>
                            <div className="mt-4 px-1">
                              <input
                                type="range"
                                min={0}
                                max={FRASERS_PLUS_TERMS.length - 1}
                                step={1}
                                value={selectedFrasersTermIndex}
                                onChange={(event) => setSelectedFrasersTermIndex(Number(event.target.value))}
                                aria-label="Choose a representative Frasers Plus term"
                                className="term-slider term-slider--frasers w-full"
                                style={{
                                  background: `linear-gradient(90deg, var(--fp-purple) 0%, var(--fp-purple) ${(selectedFrasersTermIndex / (FRASERS_PLUS_TERMS.length - 1)) * 100}%, #d7d9e5 ${(selectedFrasersTermIndex / (FRASERS_PLUS_TERMS.length - 1)) * 100}%, #d7d9e5 100%)`,
                                }}
                              />
                              <div className="mt-2 flex justify-between text-xs text-muted">
                                {FRASERS_PLUS_TERMS.map((term, index) => (
                                  <span key={term.months} className={`ck-num ${index === selectedFrasersTermIndex ? "font-semibold text-[var(--fp-purple-strong)]" : ""}`}>
                                    {term.months}m
                                  </span>
                                ))}
                              </div>
                            </div>
                            <p className="mt-4 text-sm leading-6 text-muted">
                              Or spread the cost for longer. Move the slider to see how you can reduce your monthly payments. This is
                              for illustrative purposes only. Choose your repayment plan in your account after checkout. You have up
                              until your payment due date to choose a plan.
                            </p>
                            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                              <PlanFigure label="Price" value={charger ? currency.format(total) : "Not available yet"} />
                              <PlanFigure label="Selected term" value={frasersPlusTermLabel} />
                              <PlanFigure label="Monthly payment" value={charger ? currency.format(frasersPlusIllustration.monthly) : "Not available yet"} />
                              <PlanFigure label="Total repayable" value={charger ? currency.format(frasersPlusIllustration.totalRepayable) : "Not available yet"} />
                            </dl>
                            <p className="mt-3 text-xs font-medium text-muted">Representative example</p>
                          </div>

                          <div className="mt-4 rounded-2xl bg-wash p-4">
                            <p className="text-sm font-semibold">Before you continue</p>
                            <ul className="mt-2 grid list-disc gap-1.5 pl-5 text-sm leading-6 text-ink-soft">
                              <li>If approved, the transaction is authorised now for the quoted amount.</li>
                              <li>
                                The quoted amount is an estimate and may change if the survey shows that the installation is
                                non-standard or that additional works are required to make the property suitable for installation.
                              </li>
                              <li>The digital survey still needs to be received and reviewed by VCHRGD before installation can go ahead.</li>
                              <li>
                                If the digital survey is not received within 3 days, the order may be cancelled and the transaction made
                                via Frasers Plus refunded.
                              </li>
                            </ul>
                          </div>

                          <p className="mt-4 text-xs leading-5 text-muted">
                            {"VCHRGD Technologies Limited (FRN: xxxxxxx), trading as ‘VCHRGD’, is an introducer appointed representative of Frasers Group Financial Services Limited (Registered Company no. 00718151) which is authorised and regulated by the Financial Conduct Authority (FRN 311908) for consumer credit and general insurance and a member of the Finance and Leasing Association. For regulated payment services, Frasers Group Financial Services Limited is a payment agent of Transact Payments Limited, a company authorised and regulated by the Gibraltar Financial Services Commission as an electronic money institution. "}
                            <strong className="font-bold text-ink">Missed payments may affect your credit score and mean your 0% interest plans end</strong>.
                          </p>

                          {showSandboxOutcomeTabs ? (
                            <div className="mt-4 rounded-2xl border border-dashed border-line-strong p-4">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Sandbox response</p>
                              <p className="mt-2 text-sm leading-6 text-muted">
                                Select the Frasers Plus outcome you want this demo flow to return when you continue.
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {sandboxOutcomeTabs.map((option) => (
                                  <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => setScenario(option.value)}
                                    className={`ck-press rounded-full px-4 py-2 text-sm font-medium ${scenario === option.value ? "bg-ink text-white" : "bg-tonal hover:bg-tonal-hover"}`}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                              <p className="mt-3 text-xs leading-5 text-muted">{sandboxOutcomeTabs.find((option) => option.value === scenario)?.detail}</p>
                              <p className="mt-1 text-xs leading-5 text-muted">
                                This demo uses a local Frasers-styled hosted step. The approved path auto-continues after 15 seconds or
                                when the customer clicks Continue in app.
                              </p>
                            </div>
                          ) : null}

                          <button
                            type="button"
                            onClick={createAuthorization}
                            disabled={voucherChecking || busyAction !== null || !charger || paymentChoice !== "frasers-plus"}
                            data-checkout-click="frasers_continue"
                            className="ck-press mt-4 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-[#211551] px-5 text-base font-semibold text-white hover:bg-[#352064] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {busyAction === "authorise" ? (
                              <>
                                <Spinner />
                                Preparing secure checkout...
                              </>
                            ) : (
                              <>
                                Continue with
                                <Image src="/content/frasers-plus-official-horizontal.svg" alt="Frasers Plus" width={2000} height={544} unoptimized className="h-auto w-[132px]" />
                              </>
                            )}
                          </button>
                          <p className="mt-3 text-center text-sm leading-6 text-muted">
                            {showSandboxOutcomeTabs
                              ? `This demo will open a Frasers-style mock step and then return the ${selectedSandboxOutcome.label.toLowerCase()} response.`
                              : approvalUrl
                                ? "Your secure Frasers Plus link is ready."
                                : "We will return you to VCHRGD once the Frasers Plus flow is complete."}
                          </p>
                          {paymentState && paymentState !== initialPaymentState && busyAction !== "authorise" && !paymentState.includes(":") ? (
                            <p role="status" className="mt-2 text-sm leading-6 text-ink-soft">{paymentState}</p>
                          ) : null}
                        </PaymentOption>
                      ) : null}
                    </div>

                    {enableFrasersPlus && paymentChoice === null ? (
                      <p className="mt-3 text-sm text-muted">Select a payment method to continue.</p>
                    ) : null}

                    <Notice tone="caution" title="OZEV applications and vouchers" className="mt-6">
                      We cannot accept or process OZEV grant applications or vouchers through this online payment platform. Please
                      call{" "}
                      <a className="font-semibold underline underline-offset-2" href="tel:+441494370525">01494 370525</a>{" "}
                      and speak to our team before paying online.
                    </Notice>

                    <div className="mt-8">
                      <h2 className="text-[15px] font-semibold">What happens next</h2>
                      <ol className="mt-4 grid gap-4">
                        {NEXT_STEPS.map((item, index) => (
                          <li key={item.title} className="flex gap-3">
                            <span className="ck-num grid h-6 w-6 shrink-0 place-items-center rounded-full bg-wash text-xs font-semibold text-ink-soft">
                              {index + 1}
                            </span>
                            <span>
                              <span className="block text-sm font-medium">{item.title}</span>
                              <span className="mt-0.5 block text-sm leading-5 text-muted">{item.detail}</span>
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>

                    <ActionRow back={<SecondaryButton onClick={() => goToStep(5)} trackingEvent="navigation_back">Back</SecondaryButton>} />

                    <div className="mt-8">{showMerchantControls ? (
                    <details className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                      <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900">
                        Merchant controls
                      </summary>
                      <p className="mt-3 text-sm leading-6 text-slate-600">
                        Hidden from a normal customer flow. Use these controls only while testing
                        the hosted approval handoff.
                      </p>

                      {!showSandboxOutcomeTabs ? (
                        <div className="mt-4 rounded-[20px] border border-[#cbb4ff] bg-[#f8f3ff] p-4">
                          <p className="text-sm font-semibold text-slate-950">
                            Tymit staging approval details
                          </p>
                          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                            <div><dt className="text-slate-500">Customer</dt><dd className="font-semibold text-slate-950">Accept Noonfido</dd></div>
                            <div><dt className="text-slate-500">Mobile</dt><dd className="font-semibold text-slate-950">+44 7786 345432</dd></div>
                            <div><dt className="text-slate-500">Passcode</dt><dd className="font-semibold text-slate-950">1379</dd></div>
                            <div><dt className="text-slate-500">MFA stub</dt><dd className="font-semibold text-slate-950">111111</dd></div>
                          </dl>
                          <p className="mt-3 text-xs leading-6 text-slate-600">
                            Fast Track submits the recognised details above. Partial Match keeps
                            the recognised mobile but changes the first name so Tymit can request
                            verification. New Customer submits an unrecognised mobile for the
                            eligibility and sign-up path. A deterministic decline or failure
                            requires a separate Tymit staging persona.
                          </p>
                        </div>
                      ) : null}

                      <div className="mt-4 rounded-[20px] border border-slate-200 bg-white p-4">
                        <p className="text-sm font-semibold text-slate-950">Customer profile</p>
                        <p className="mt-2 text-sm leading-6 text-slate-600">
                          Load prepared customer details for the main Frasers Plus approval paths,
                          including existing members and new-customer onboarding.
                        </p>
                        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                          <Field label={showSandboxOutcomeTabs ? "Sandbox customer profile" : "Tymit staging test profile"}>
                            <select
                              value={sandboxProfile}
                              onChange={(event) => setSandboxProfile(event.target.value as SandboxProfileKey)}
                              className={input}
                            >
                              {Object.entries(sandboxProfileLabels).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Secondary onClick={() => applySandboxProfile(sandboxProfile)} disabled={false}>
                            Load details
                          </Secondary>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <Field label="Order reference"><input value={paymentId} onChange={(event) => setPaymentId(event.target.value)} className={input} /></Field>
                        <Field label="Customer reference"><input value={customerId} onChange={(event) => setCustomerId(event.target.value)} className={input} /></Field>
                        {showSandboxOutcomeTabs ? (
                          <Field label="Mock approval outcome"><select value={scenario} onChange={(event) => setScenario(event.target.value as DemoScenario)} className={input}>{Object.entries(scenarioLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
                        ) : null}
                        <Field label="Approval link expiry"><input value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className={input} /></Field>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <Secondary onClick={pollStatus} disabled={busyAction !== null || !upr}>{busyAction === "poll" ? "Refreshing..." : "Refresh payment status"}</Secondary>
                        <Secondary onClick={() => updatePayment("CAPTURE")} disabled={busyAction !== null || !upr}>{busyAction === "capture" ? "Confirming..." : "Mark payment as complete"}</Secondary>
                        <Secondary onClick={() => updatePayment("REVERSAL")} disabled={busyAction !== null || !upr}>{busyAction === "reversal" ? "Cancelling..." : "Cancel payment"}</Secondary>
                        <Secondary onClick={() => updatePayment("CREDIT")} disabled={busyAction !== null || !upr}>{busyAction === "credit" ? "Refunding..." : "Issue refund"}</Secondary>
                      </div>

                      <div className="mt-4 grid gap-4 sm:grid-cols-3">
                        <Stat label="Payment reference" value={upr || "Not created yet"} breakWord />
                        <Stat label="Payment status" value={paymentState} />
                        <Stat label="Approval link" value={approvalUrl || "Not created yet"} breakWord />
                      </div>
                    </details>
                    ) : null}</div>
                  </div>
                ) : null}
              </div>

              {step <= 4 ? (
                <div style={{ overflowAnchor: "none" }}>
                  <ActionRow
                    back={
                      step > 1 ? (
                        <SecondaryButton onClick={() => goToStep((step - 1) as JourneyStep)} trackingEvent="navigation_back">Back</SecondaryButton>
                      ) : null
                    }
                    next={
                      <PrimaryButton onClick={() => goToStep((step + 1) as JourneyStep)} trackingEvent={CONTINUE_CLICK_EVENTS[step]} disabled={step >= maxUnlockedStep}>
                        {nextLabel}
                      </PrimaryButton>
                    }
                  />
                  {step >= maxUnlockedStep && !(step === 3 && parkingType === "Street parking") ? (
                    <p className="mt-3 text-center text-sm text-muted">
                      {step === 1 ? "Choose a charger to continue." : "Choose an answer to continue."}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="mt-6 grid gap-6 lg:hidden">
              <InstallationCard preferredDatesEnabled={preferredDatesEnabled} />
              <HelpCard />
            </div>
          </div>

          <aside className="hidden lg:block" aria-label="Order summary">
            <div className="sticky top-6 grid gap-6">
              {renderSummary()}
              <InstallationCard preferredDatesEnabled={preferredDatesEnabled} />
              <HelpCard />
            </div>
          </aside>
        </div>
      </section>

      <div className="ck-root fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 backdrop-blur lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="mx-auto flex max-w-[680px] items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-xs text-muted">{charger?.name ?? summaryAmountLabel}</p>
            <p key={total} className="ck-value-change ck-num text-lg font-bold leading-6">{totalDisplay}</p>
          </div>
          <button
            type="button"
            onClick={() => setSummaryOpen(true)}
            className="ck-press inline-flex h-11 items-center gap-1.5 rounded-full bg-tonal px-5 text-sm font-medium hover:bg-tonal-hover"
          >
            View summary
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      {summaryOpen ? (
        <Sheet title="Your order" onClose={() => setSummaryOpen(false)}>
          <div className="-mx-5 bg-white">{renderSummary()}</div>
        </Sheet>
      ) : null}
    </>
  );
}

const CHECKOUT_STAGES = ["Charger", "Your home", "Details", "Payment"] as const;
const STAGE_FOR_STEP: Record<JourneyStep, 1 | 2 | 3 | 4> = { 1: 1, 2: 2, 3: 2, 4: 2, 5: 3, 6: 4 };
const STAGE_FIRST_STEP: Record<1 | 2 | 3 | 4, JourneyStep> = { 1: 1, 2: 2, 3: 5, 4: 6 };
const CARD_CHECKOUT_IDLE_MESSAGE = "No secure card checkout link has been created yet.";

const PAYMENT_LOGOS = [
  { src: "/home-charging/assets/visa.svg", alt: "Visa" },
  { src: "/home-charging/assets/mastercard.svg", alt: "Mastercard" },
  { src: "/home-charging/assets/apple-pay.svg", alt: "Apple Pay" },
  { src: "/home-charging/assets/google-pay.svg", alt: "Google Pay" },
];

const NEXT_STEPS = [
  { title: "Pay securely today", detail: "Complete secure checkout for the charger and standard installation package." },
  { title: "Return your digital survey", detail: "Your survey is sent after payment. Please return it within 3 days." },
  { title: "We review and confirm", detail: "If additional work is required, we explain it and confirm any revised cost before proceeding." },
  { title: "Installation", detail: "Most standard installations take place around two weeks after order processing." },
] as const;

const wholePoundFormat = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });

function money(amount: number) {
  return Number.isInteger(amount) ? wholePoundFormat.format(amount) : currency.format(amount);
}

const ANSWER_ICONS: Record<string, string> = Object.fromEntries(
  [...PROPERTY_OPTIONS, ...PARKING_OPTIONS, ...DISTANCE_OPTIONS].map((option) => [option.value, option.icon]),
);

function iconForAnswer(value: string | null) {
  return value ? ANSWER_ICONS[value] ?? "house" : "house";
}

function PaymentPopupBackdrop() {
  return <div className="ck-backdrop fixed inset-0 z-40 bg-ink/30 backdrop-blur-sm" aria-hidden="true" />;
}

function Stepper({
  stage,
  maxUnlockedStep,
  onStageClick,
}: {
  stage: 1 | 2 | 3 | 4;
  maxUnlockedStep: JourneyStep;
  onStageClick: (stage: 1 | 2 | 3 | 4) => void;
}) {
  return (
    <nav aria-label="Checkout progress" className="mx-auto max-w-[720px]">
      <ol className="flex items-start">
        {CHECKOUT_STAGES.map((label, index) => {
          const target = (index + 1) as 1 | 2 | 3 | 4;
          const done = target < stage;
          const current = target === stage;
          const reachable = !current && STAGE_FIRST_STEP[target] <= maxUnlockedStep;
          return (
            <li key={label} className="relative flex flex-1 flex-col items-center">
              {index > 0 ? (
                <span className="absolute right-1/2 top-4 h-0.5 w-full -translate-y-1/2 bg-line" aria-hidden="true">
                  <span className="ck-progress-fill block h-full bg-ink" style={{ width: target <= stage ? "100%" : "0%" }} />
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => onStageClick(target)}
                disabled={!reachable}
                aria-current={current ? "step" : undefined}
                aria-label={`Step ${target}: ${label}${done ? " (completed)" : ""}`}
                className="group relative z-10 flex flex-col items-center gap-2 disabled:cursor-default"
              >
                <span
                  className={`ck-num grid h-8 w-8 place-items-center rounded-full text-sm font-semibold transition-colors duration-300 ${
                    current || done ? "bg-ink text-white" : "border border-line-strong bg-white text-muted"
                  } ${current ? "ring-4 ring-ink/10" : ""}`}
                >
                  {done ? <Check className="ck-check-in h-4 w-4" strokeWidth={3} aria-hidden="true" /> : target}
                </span>
                <span className={`text-xs sm:text-sm ${current ? "font-semibold text-ink" : done ? "text-ink-soft group-enabled:group-hover:text-ink" : "text-muted"}`}>
                  {label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepTitle({ title, subtitle, info }: { title: string; subtitle?: string; info?: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1">
        <h1 className="text-[24px] font-semibold leading-8 tracking-[-0.02em] sm:text-[28px] sm:leading-9">{title}</h1>
        {info}
      </div>
      {subtitle ? <p className="mt-1.5 text-[15px] leading-6 text-muted sm:text-base">{subtitle}</p> : null}
    </div>
  );
}

function ActionRow({ back, next }: { back?: React.ReactNode; next?: React.ReactNode }) {
  const both = Boolean(back && next);
  return (
    <div className={`mt-8 grid gap-3 ${both ? "grid-cols-2" : "grid-cols-1"}`}>
      {back ?? null}
      {next ?? null}
    </div>
  );
}

function ChargerCard({
  name,
  summary,
  features,
  image,
  power,
  price,
  originalPrice,
  selected,
  onSelect,
  trackingEvent,
}: {
  name: string;
  summary: string;
  features: string[];
  image: string;
  power: string;
  price: string;
  originalPrice: string | null;
  selected: boolean;
  onSelect: () => void;
  trackingEvent: CheckoutClickEvent;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      data-checkout-click={trackingEvent}
      className={`ck-press relative flex h-full flex-col rounded-2xl p-3 text-left sm:p-4 ${
        selected ? "bg-white shadow-[inset_0_0_0_2px_var(--color-ink)]" : "bg-wash hover:bg-tonal"
      }`}
    >
      <span
        className={`absolute right-3 top-3 z-10 grid h-6 w-6 place-items-center rounded-full transition-colors sm:right-4 sm:top-4 ${
          selected ? "bg-ink text-white" : "border border-line-strong bg-white"
        }`}
        aria-hidden="true"
      >
        {selected ? <Check className="ck-check-in h-3.5 w-3.5" strokeWidth={3} /> : null}
      </span>
      <span className={`grid aspect-[16/11] w-full place-items-center rounded-xl ${selected ? "bg-wash" : "bg-white"}`}>
        <Image
          src={image}
          alt=""
          width={900}
          height={1000}
          className={`h-[72%] w-auto object-contain transition-transform duration-200 ${selected ? "-translate-y-1" : ""}`}
        />
      </span>
      <span className="mt-3 flex items-baseline justify-between gap-2">
        <span className="text-[15px] font-semibold leading-5 sm:text-[17px] sm:leading-6">{name}</span>
      </span>
      <span className="mt-1 flex items-baseline gap-2">
        {originalPrice ? <span className="ck-num text-sm text-subtle line-through">{originalPrice}</span> : null}
        <span className="ck-num text-lg font-bold sm:text-xl">{price}</span>
        <span className="text-xs text-muted">installed<span className="hidden sm:inline"> · {power}</span></span>
      </span>
      <span className="mt-2 hidden text-sm leading-5 text-muted sm:block">{summary}</span>
      <span className="mt-3 grid gap-1.5 border-t border-line pt-3">
        {features.map((feature) => (
          <span key={feature} className="flex items-start gap-1.5 text-xs leading-4 text-ink-soft sm:text-sm sm:leading-5">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" strokeWidth={2.5} aria-hidden="true" />
            {feature}
          </span>
        ))}
      </span>
    </button>
  );
}

function WhatsIncluded({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-2xl bg-wash p-4 sm:p-5 ${className}`}>
      <div className="flex items-center gap-1">
        <p className="text-[15px] font-semibold">What&apos;s included</p>
        <InfoTip label="More about what's included" title="Final installation cost">
          <p>
            If the installation turns out to be non-standard, different to how it has been described, or needs additional
            works to make the property suitable for installation, the final cost may change.
          </p>
          <p className="mt-2">
            Longer cable runs may need additional work, which will be confirmed after your digital survey before any extra
            payment is requested.
          </p>
        </InfoTip>
      </div>
      <ul className="mt-3 grid gap-2 text-sm leading-5 text-ink-soft sm:grid-cols-2 sm:gap-x-6">
        {[
          "Charger supply and standard installation",
          "Up to 10m of cable",
          "Installed, tested and commissioned by your installer",
          "Any extra work is confirmed after your survey, before any extra payment is requested",
        ].map((item) => (
          <li key={item} className="flex gap-2.5">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" strokeWidth={2.5} aria-hidden="true" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SegmentButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`ck-press h-[52px] rounded-full px-4 text-[15px] font-medium ${
        selected ? "bg-white shadow-[inset_0_0_0_2px_var(--color-ink)]" : "bg-wash text-ink-soft hover:bg-tonal"
      }`}
    >
      {children}
    </button>
  );
}

function QuestionStep({
  introRef,
  counter,
  title,
  body,
  info,
  recap = [],
  options,
  selected,
  onSelect,
  guidance = null,
  after = null,
}: {
  introRef: React.RefObject<HTMLDivElement | null>;
  counter: string;
  title: string;
  body: string;
  info?: React.ReactNode;
  recap?: Array<{ name: string; value: string | null; icon: string; onChange: () => void }>;
  options: AnswerOption[];
  selected: string | null;
  onSelect: (value: string) => void;
  guidance?: string | null;
  after?: React.ReactNode;
}) {
  const answered = recap.filter((item) => item.value);
  return (
    <div>
      <div ref={introRef} tabIndex={-1} className="outline-none">
        <p className="text-sm font-medium text-brand-ink">{counter}</p>
        <div className="mt-1">
          <StepTitle title={title} subtitle={body} info={info} />
        </div>
      </div>
      {answered.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Your answers</span>
          {answered.map((item) => (
            <button
              key={item.name}
              type="button"
              onClick={item.onChange}
              aria-label={`Change ${item.name}: ${item.value}`}
              className="ck-press group inline-flex h-9 items-center gap-2 rounded-full bg-wash pl-2 pr-3 text-sm font-medium text-ink hover:bg-tonal"
            >
              <span className="grid h-6 w-6 place-items-center rounded-full bg-white text-ink-soft" aria-hidden="true">
                <OptionIcon kind={item.icon} small />
              </span>
              {item.value}
              <Pencil className="h-3.5 w-3.5 text-muted group-hover:text-ink" aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}
      <div role="radiogroup" aria-label={title} className="mt-6 grid gap-2.5 sm:grid-cols-2">
        {options.map((option) => (
          <ChoiceRow key={option.value} option={option} selected={selected === option.value} onSelect={onSelect} />
        ))}
      </div>
      <div aria-live="polite">
        {guidance ? (
          <Notice tone="info" className="mt-4">
            {guidance}
          </Notice>
        ) : null}
        {after ? <div className="mt-4">{after}</div> : null}
      </div>
    </div>
  );
}

function ChoiceRow({ option, selected, onSelect }: { option: AnswerOption; selected: boolean; onSelect: (value: string) => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(option.value)}
      className={`ck-press flex min-h-[72px] w-full items-center gap-3 rounded-2xl px-4 py-3 text-left ${
        selected ? "bg-white shadow-[inset_0_0_0_2px_var(--color-ink)]" : "bg-wash hover:bg-tonal"
      }`}
    >
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors ${selected ? "bg-ink text-white" : "bg-white text-ink-soft"}`}
        aria-hidden="true"
      >
        <OptionIcon kind={option.icon} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-medium leading-5">{option.label}</span>
        <span className="mt-1 block text-sm leading-5 text-muted">{option.detail}</span>
      </span>
      <span className="grid h-6 w-6 shrink-0 place-items-center" aria-hidden="true">
        {selected ? <Check className="ck-check-in h-5 w-5" strokeWidth={2.5} /> : null}
      </span>
    </button>
  );
}

const fieldClass = (error: string, padRight: boolean, padLeft = false) =>
  `h-12 w-full rounded-xl border bg-white text-base text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-subtle focus:border-ink focus:ring-4 focus:ring-brand/20 ${
    error ? "border-danger" : "border-line-strong"
  } ${padLeft ? "pl-[92px]" : "pl-4"} ${padRight ? "pr-11" : "pr-4"}`;

function FieldShell({
  id,
  label,
  error,
  hint,
  info,
  className = "",
  children,
}: {
  id: string;
  label: string;
  error: string;
  hint?: string;
  info?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="flex min-h-6 items-center gap-1">
        <label htmlFor={id} className="text-sm font-medium text-ink-soft">{label}</label>
        {info}
      </div>
      <div className="relative mt-1.5">{children}</div>
      {error ? (
        <p id={`${id}-error`} className="ck-reveal mt-1.5 text-sm leading-5 text-danger">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-sm leading-5 text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

function ValidTick() {
  return (
    <Check
      className="ck-check-in pointer-events-none absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ok"
      strokeWidth={2.5}
      aria-hidden="true"
    />
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  onBlur,
  error = "",
  hint,
  valid = false,
  type = "text",
  inputMode,
  autoComplete,
  className = "",
  info,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: (value: string) => void;
  error?: string;
  hint?: string;
  valid?: boolean;
  type?: "text" | "email" | "tel";
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  className?: string;
  info?: React.ReactNode;
}) {
  const showTick = valid && !error;
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} info={info} className={className}>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur ? (event) => onBlur(event.target.value) : undefined}
        inputMode={inputMode}
        autoComplete={autoComplete}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={fieldClass(error, showTick)}
      />
      {showTick ? <ValidTick /> : null}
    </FieldShell>
  );
}

// UK mobiles only: +44 is shown as a fixed prefix. The stored value keeps the existing
// 07… format so validation and the payment payloads are unchanged.
function PhoneField({
  value,
  onChange,
  error,
  valid,
  info,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  error: string;
  valid: boolean;
  info?: React.ReactNode;
  className?: string;
}) {
  const display = value.startsWith("0") ? value.slice(1) : value;
  const showTick = valid && !error;
  return (
    <FieldShell id="ck-phone" label="Mobile number" error={error} info={info} className={className}>
      <span className="pointer-events-none absolute inset-y-1.5 left-1.5 flex items-center gap-1.5 rounded-lg bg-wash px-2.5 text-[15px] font-medium text-ink-soft">
        <UkFlag />+44
      </span>
      <input
        id="ck-phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder="7700 900123"
        value={display}
        onChange={(event) => {
          const normalised = normaliseUkMobileInput(event.target.value.replace(/[^\d+]/g, ""));
          onChange(normalised.startsWith("7") ? `0${normalised}` : normalised);
        }}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "ck-phone-error" : undefined}
        className={fieldClass(error, showTick, true)}
      />
      {showTick ? <ValidTick /> : null}
    </FieldShell>
  );
}

function UkFlag() {
  return (
    <svg viewBox="0 0 60 30" className="h-3.5 w-[22px] shrink-0 overflow-hidden rounded-[2px]" aria-hidden="true">
      <clipPath id="ck-uk-clip"><path d="M0 0v30h60V0z" /></clipPath>
      <clipPath id="ck-uk-clip-2"><path d="M30 15h30v15zv15H0zH0V0zV0h30z" /></clipPath>
      <g clipPath="url(#ck-uk-clip)">
        <path d="M0 0v30h60V0z" fill="#012169" />
        <path d="M0 0l60 30m0-30L0 30" stroke="#fff" strokeWidth="6" />
        <path d="M0 0l60 30m0-30L0 30" clipPath="url(#ck-uk-clip-2)" stroke="#C8102E" strokeWidth="4" />
        <path d="M30 0v30M0 15h60" stroke="#fff" strokeWidth="10" />
        <path d="M30 0v30M0 15h60" stroke="#C8102E" strokeWidth="6" />
      </g>
    </svg>
  );
}

function Notice({
  tone = "info",
  title,
  className = "",
  children,
}: {
  tone?: "info" | "caution" | "ok";
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "caution" ? "bg-caution-wash text-caution-ink" : tone === "ok" ? "bg-ok-wash text-ok" : "bg-brand-wash text-ink-soft";
  return (
    <div role={tone === "caution" ? "note" : undefined} className={`ck-reveal flex gap-3 rounded-2xl px-4 py-3 text-sm leading-6 ${toneClass} ${className}`}>
      <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={title ? "mt-0.5" : ""}>{children}</div>
      </div>
    </div>
  );
}

function ReviewRow({ label, value, onChange }: { label: string; value: string; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p className="mt-0.5 break-words text-sm font-medium leading-5">{value}</p>
      </div>
      <button
        type="button"
        onClick={onChange}
        aria-label={`Change ${label.toLowerCase()}`}
        className="ck-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white px-3 text-sm font-medium hover:bg-tonal"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        Change
      </button>
    </div>
  );
}

function SummaryRow({ label, value, tone }: { label: string; value: string; tone?: "ok" }) {
  return (
    <div className="ck-reveal flex items-start justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={`m-0 text-right font-medium ${tone === "ok" ? "text-ok" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

function PlanFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="ck-num m-0 mt-1 font-semibold">{value}</dd>
    </div>
  );
}

function PaymentOption({
  selected,
  onSelect,
  trackingEvent,
  title,
  price,
  badge,
  description,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  trackingEvent?: CheckoutClickEvent;
  title: string;
  price?: string;
  badge?: React.ReactNode;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl transition-colors ${selected ? "bg-white shadow-[inset_0_0_0_2px_var(--color-ink)]" : "bg-wash hover:bg-tonal"}`}>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        data-checkout-click={trackingEvent}
        className="ck-press flex w-full items-start gap-3 p-4 text-left"
      >
        <span
          className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 bg-white ${selected ? "border-ink" : "border-line-strong"}`}
          aria-hidden="true"
        >
          {selected ? <span className="ck-check-in h-2.5 w-2.5 rounded-full bg-ink" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="text-base font-semibold leading-5">{title}</span>
            {price ? <span className="ck-num text-base font-semibold">{price}</span> : null}
            {badge ?? null}
          </span>
          <span className="mt-1.5 block text-sm leading-5 text-muted">{description}</span>
        </span>
      </button>
      {selected ? <div className="ck-reveal px-4 pb-4">{children}</div> : null}
    </div>
  );
}

function Spinner() {
  return <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />;
}

function PrimaryButton({
  children,
  onClick,
  disabled = false,
  loading = false,
  trackingEvent,
  className = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  trackingEvent?: CheckoutClickEvent;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-checkout-click={trackingEvent}
      aria-busy={loading || undefined}
      className={`ck-press inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-ink px-6 text-base font-semibold text-white hover:bg-ink-soft disabled:cursor-not-allowed disabled:bg-ink/25 disabled:text-white ${className}`}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  disabled = false,
  trackingEvent,
  className = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  trackingEvent?: CheckoutClickEvent;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-checkout-click={trackingEvent}
      className={`ck-press inline-flex h-[52px] w-full items-center justify-center rounded-full bg-tonal px-6 text-base font-semibold text-ink hover:bg-tonal-hover disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

function HelpCard() {
  return (
    <div className="rounded-[20px] bg-white p-5 sm:p-6">
      <p className="text-[15px] font-semibold">Need help?</p>
      <p className="mt-1 text-sm leading-5 text-muted">Questions about your home, parking or an OZEV grant? Talk to our team.</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <a href="tel:+441494370525" className="ck-press flex items-center gap-2.5 rounded-2xl bg-wash px-3 py-3 hover:bg-tonal">
          <Phone className="h-4 w-4 shrink-0 text-brand-ink" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Call us</span>
            <span className="ck-num block truncate text-xs text-muted">01494 370525</span>
          </span>
        </a>
        <a href="mailto:sales@vchrgd.com" className="ck-press flex items-center gap-2.5 rounded-2xl bg-wash px-3 py-3 hover:bg-tonal">
          <Mail className="h-4 w-4 shrink-0 text-brand-ink" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Email us</span>
            <span className="block truncate text-xs text-muted">sales@vchrgd.com</span>
          </span>
        </a>
      </div>
    </div>
  );
}

function InstallationCard({ preferredDatesEnabled }: { preferredDatesEnabled: boolean }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const baseId = useId();
  const information = JOURNEY_INFORMATION.map((item, index) =>
    index === 3 && !preferredDatesEnabled
      ? {
          ...item,
          title: "Installation booking",
          detail:
            "Once your survey has been reviewed, the installation team will contact you to arrange a suitable installation date. Your confirmed date and installer name appear in your tracking link once booked.",
        }
      : item,
  );
  return (
    <div className="rounded-[20px] bg-white p-5 sm:p-6">
      <p className="text-[15px] font-semibold">How your installation works</p>
      <p className="mt-1 text-sm leading-5 text-muted">
        Most standard installations take place around two weeks after order processing.
      </p>
      <ol className="mt-4">
        {information.map((item, index) => {
          const Icon = item.icon;
          const open = openIndex === index;
          const panelId = `${baseId}-${index}`;
          const last = index === information.length - 1;
          return (
            <li key={item.title} className="relative flex gap-3">
              {!last ? <span className="absolute left-[15px] top-8 bottom-0 w-px bg-line" aria-hidden="true" /> : null}
              <span className="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-wash text-ink-soft">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className={`min-w-0 flex-1 ${last ? "" : "pb-3"}`}>
                <button
                  type="button"
                  onClick={() => setOpenIndex(open ? null : index)}
                  aria-expanded={open}
                  aria-controls={panelId}
                  className="ck-press flex min-h-8 w-full items-center justify-between gap-2 text-left text-sm font-medium hover:text-brand-ink"
                >
                  {item.title}
                  <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>
                {open ? (
                  <p id={panelId} className="ck-reveal mt-1 text-sm leading-5 text-muted">{item.detail}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="ck-root fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="ck-backdrop absolute inset-0 bg-ink/40" onClick={() => onCloseRef.current()} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="ck-sheet relative max-h-[85vh] w-full overflow-y-auto rounded-t-[20px] bg-white px-5 pb-6 pt-3 outline-none sm:max-w-md sm:rounded-[20px] sm:pt-5"
        style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}
      >
        <span className="mx-auto mb-3 block h-1 w-8 rounded-full bg-line-strong sm:hidden" aria-hidden="true" />
        <div className="flex items-center justify-between gap-4">
          <p className="text-lg font-semibold">{title}</p>
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            aria-label="Close"
            className="ck-press -mr-2 grid h-11 w-11 place-items-center rounded-full text-muted hover:bg-tonal hover:text-ink"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-2 text-base leading-6 text-ink-soft">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// The (i) button: hover or click opens a small popover on desktop; a tap opens a
// bottom sheet on touch screens. Never used for information a customer must see.
function InfoTip({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  const [mode, setMode] = useState<null | "popover" | "sheet">(null);
  const [pinned, setPinned] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelId = useId();

  const close = useCallback(() => {
    setMode(null);
    setPinned(false);
  }, []);

  useEffect(() => {
    if (mode !== "popover") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        buttonRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [mode, close]);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  const prefersPopover = () =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 640px) and (hover: hover) and (pointer: fine)").matches;

  // Open towards whichever side has room so the popover is never clipped.
  function updateAlignment() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setAlignRight(rect.left > window.innerWidth / 2);
  }

  function toggle() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    if (mode && pinned) {
      close();
      return;
    }
    setPinned(true);
    updateAlignment();
    setMode(prefersPopover() ? "popover" : "sheet");
  }

  function hoverIn() {
    if (mode || !prefersPopover()) return;
    hoverTimerRef.current = setTimeout(() => {
      updateAlignment();
      setMode("popover");
    }, 300);
  }

  function hoverOut() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    if (!pinned && mode === "popover") setMode(null);
  }

  return (
    <span ref={wrapperRef} className="relative inline-flex" onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-expanded={mode !== null}
        aria-controls={mode === "popover" ? panelId : undefined}
        className={`ck-press -my-2.5 grid h-11 w-11 place-items-center rounded-full transition-colors ${mode ? "text-brand-ink" : "text-subtle hover:text-ink"}`}
      >
        <Info className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
      </button>
      {mode === "popover" ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={title}
          className={`ck-reveal absolute top-full z-40 mt-1 w-80 rounded-2xl bg-white p-4 text-left text-sm font-normal leading-6 text-ink-soft shadow-[0_12px_40px_rgba(11,15,20,0.14)] ${alignRight ? "right-0" : "left-0"}`}
        >
          <p className="text-[15px] font-semibold text-ink">{title}</p>
          <div className="mt-2">{children}</div>
        </div>
      ) : null}
      {mode === "sheet" ? (
        <Sheet title={title} onClose={close}>
          {children}
          <button
            type="button"
            onClick={close}
            className="ck-press mt-6 inline-flex h-[52px] w-full items-center justify-center rounded-full bg-tonal text-base font-semibold hover:bg-tonal-hover"
          >
            Got it
          </button>
        </Sheet>
      ) : null}
    </span>
  );
}

// Kept for the merchant (test) controls only.
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value, breakWord = false }: { label: string; value: React.ReactNode; breakWord?: boolean }) {
  return (
    <div className="rounded-2xl bg-wash p-4">
      <p className="text-sm text-muted">{label}</p>
      <strong className={`mt-2 block text-base font-semibold ${breakWord ? "break-all" : ""}`}>{value}</strong>
    </div>
  );
}

function Secondary({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled: boolean }) {
  return (
    <SecondaryButton onClick={onClick} disabled={disabled}>
      {children}
    </SecondaryButton>
  );
}

const JOURNEY_INFORMATION = [
  {
    title: "Order and payment",
    detail:
      "Complete secure checkout for the charger and standard installation package. We confirm your order and provide a persistent tracking link for updates.",
    icon: CreditCard,
  },
  {
    title: "Digital survey",
    detail:
      "Your survey is sent after payment. Return it as soon as possible because the installation review and booking timescale starts once we have the information we need.",
    icon: ClipboardCheck,
  },
  {
    title: "Installation review",
    detail:
      "Our installation team reviews the survey to confirm whether the work is a standard installation. If additional work is required, we explain it and confirm any revised cost before proceeding.",
    icon: CheckCircle2,
  },
  {
    title: "Preferred dates and booking",
    detail:
      "Use your tracking link to select up to three preferred installation dates. Preferences are not guaranteed, but we work to meet them and may be able to install sooner. Your confirmed date and installer name appear in the link once booked.",
    icon: CalendarDays,
  },
  {
    title: "Charger delivery",
    detail:
      "We arrange for the charger to arrive at the installation address at least three days before the confirmed installation date. Dispatch and expected delivery updates appear in your tracking link.",
    icon: PackageCheck,
  },
  {
    title: "Installation day",
    detail:
      "Your installer checks the agreed location, completes and tests the installation, commissions the charger, and explains how to use it. Please ensure an adult is present and the working area and parking space are accessible.",
    icon: Wrench,
  },
] as const;

function OptionIcon({ kind, small = false }: { kind: string; small?: boolean }) {
  const className = small ? "h-3.5 w-3.5" : "h-5 w-5";

  switch (kind) {
    case "house":
      return <House className={className} strokeWidth={1.8} />;
    case "building":
      return <Building className={className} strokeWidth={1.8} />;
    case "house-plug":
      return <Home className={className} strokeWidth={1.8} />;
    case "apartment":
      return <Building2 className={className} strokeWidth={1.8} />;
    case "car":
      return <CarFront className={className} strokeWidth={1.8} />;
    case "warehouse":
      return <Warehouse className={className} strokeWidth={1.8} />;
    case "parking":
      return <CircleParking className={className} strokeWidth={1.8} />;
    case "map":
      return <MapPinned className={className} strokeWidth={1.8} />;
    case "cable":
      return <Cable className={className} strokeWidth={1.8} />;
    case "route":
      return <Route className={className} strokeWidth={1.8} />;
    case "waypoints":
      return <Waypoints className={className} strokeWidth={1.8} />;
    default:
      return <House className={className} strokeWidth={1.8} />;
  }
}
