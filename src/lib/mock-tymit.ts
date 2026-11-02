import { readJsonFile, writeJsonFile, withJsonFileTransaction } from "@/lib/server-data";

export type PaymentType = "AUTHORIZATION" | "CAPTURE" | "REVERSAL" | "CREDIT";
export type PaymentStatus =
  | "PENDING"
  | "APPROVED"
  | "DECLINED"
  | "COMPLETED"
  | "CANCELLED";
export type DemoScenario = "approved" | "declined" | "pending";
export type MockApprovalOutcome = "pending" | "approved" | "declined";

export type MockPaymentRecord = {
  uniquePaymentReference: string;
  paymentId: string;
  redirectUrl: string;
  merchantRedirectUrl: string;
  amount: number;
  currency: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  charger: string;
  scenario: DemoScenario;
  sandboxProfile?: string;
  status: PaymentStatus;
  currentType: PaymentType;
  pollCount: number;
  authorizationMethod: string;
  mcc: string;
  basketTimestamp?: string;
  expiresAt?: string;
  metadata?: Record<string, string>;
  history: Array<{
    type: PaymentType;
    status: PaymentStatus;
    actionDate: string;
    amount: number;
    currency: string;
  }>;
};

export const MOCK_API_KEY = "test-api-token";
export const MOCK_SWAGGER_API_BASE_URL = "https://tymit.proxy.beeceptor.com/v1";
export const MOCK_SWAGGER_AUTH_HEADER = "test-api-token";

export const MAGIC_PAYMENT_RESPONSES: Record<
  string,
  { status: number; message?: string }
> = {
  "09900022030372702871537096": { status: 200 },
  "09900022030372702871537097": { status: 500 },
  "09900022030372702871537098": {
    status: 400,
    message: "Payment already exists",
  },
};

export const MAGIC_GET_REFERENCES = {
  "7232fb1e-2140-4848-bf13-8045a974a8d0": {
    type: "AUTHORIZATION",
    status: "PENDING",
  },
  "c7680b93-f014-4ccb-9338-9aef4f4d4eed": {
    type: "AUTHORIZATION",
    status: "APPROVED",
  },
  "e0ecc8b5-9b34-4f63-a6b1-c25cf921e9b8": {
    type: "AUTHORIZATION",
    status: "DECLINED",
  },
  "819784f6-09e3-4d44-b901-a920f242aa86": {
    type: "CAPTURE",
    status: "COMPLETED",
  },
  "bf01f62f-e434-469d-8b5f-1e7174bb1256": {
    type: "REVERSAL",
    status: "CANCELLED",
  },
  "4a4de685-7142-4fd6-a88c-dd41d3b93604": {
    type: "CREDIT",
    status: "COMPLETED",
  },
} as const satisfies Record<string, { type: PaymentType; status: PaymentStatus }>;

export const MAGIC_APPROVAL_OUTCOMES: Record<
  MockApprovalOutcome,
  {
    uniquePaymentReference: string;
    paymentResult: "PENDING" | "COMPLETED" | "DECLINED";
    label: string;
  }
> = {
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
};

export const MAGIC_PUT_REFERENCES = {
  "7232fb1e-2140-4848-bf13-8045a974a8d0": "CAPTURE",
  "f625e66f-b8ff-46a9-a493-eb33806f3e51": "REVERSAL",
  "605a7057-8285-45a5-abf1-4d104a6b7547": "CREDIT",
} as const satisfies Record<string, PaymentType>;

export function buildHistoryEntry(
  type: PaymentType,
  status: PaymentStatus,
  amount: number,
  currency: string,
) {
  return {
    type,
    status,
    actionDate: new Date().toISOString(),
    amount,
    currency,
  };
}

export function buildMagicRecord(uniquePaymentReference: string): MockPaymentRecord {
  const magic = MAGIC_GET_REFERENCES[uniquePaymentReference as keyof typeof MAGIC_GET_REFERENCES];

  return {
    uniquePaymentReference,
    paymentId: "magic-value",
    redirectUrl: `https://frasersplus.tymit.com/checkout/redirect?sessionId=${uniquePaymentReference}`,
    merchantRedirectUrl: "https://merchant.example/frasers-plus/return",
    amount: 1349,
    currency: "GBP",
    customerName: "Magic Value Customer",
    customerEmail: "magic@example.com",
    customerPhone: "+447700900123",
    charger: "Seven Pro + standard install",
    scenario:
      magic.status === "DECLINED"
        ? "declined"
        : magic.status === "PENDING"
          ? "pending"
          : "approved",
    sandboxProfile: "fast-track",
    status: magic.status,
    currentType: magic.type,
    pollCount: 0,
    authorizationMethod: "ONLINE",
    mcc: "2017",
    history: [buildHistoryEntry(magic.type, magic.status, 1349, "GBP")],
  };
}

export function buildMockSwaggerHeaders(initHeaders?: HeadersInit) {
  return {
    "x-api-key": MOCK_API_KEY,
    Authorization: MOCK_SWAGGER_AUTH_HEADER,
    ...(initHeaders ?? {}),
  };
}

const MOCK_PAYMENTS_FILE = "mock-tymit-payments.json";

declare global {
  var __mockTymitPayments: Map<string, MockPaymentRecord> | undefined;
}

export function paymentStore() {
  globalThis.__mockTymitPayments ??= new Map<string, MockPaymentRecord>();
  return globalThis.__mockTymitPayments;
}

type MockPaymentStoreFile = Record<string, MockPaymentRecord>;

async function readMockPaymentFile() {
  return await readJsonFile<MockPaymentStoreFile>(MOCK_PAYMENTS_FILE, {});
}

async function writeMockPaymentFile(store: MockPaymentStoreFile) {
  await writeJsonFile(MOCK_PAYMENTS_FILE, store);
}

export async function getStoredMockPayment(upr: string) {
  const inMemory = paymentStore().get(upr);
  if (inMemory) {
    return inMemory;
  }

  const stored = (await readMockPaymentFile())[upr];
  if (stored) {
    paymentStore().set(upr, stored);
  }
  return stored;
}

export async function setStoredMockPayment(record: MockPaymentRecord) {
  return withJsonFileTransaction(MOCK_PAYMENTS_FILE, async () => {
  paymentStore().set(record.uniquePaymentReference, record);
  const store = await readMockPaymentFile();
  store[record.uniquePaymentReference] = record;
  await writeMockPaymentFile(store);
  return record;

  });
}
