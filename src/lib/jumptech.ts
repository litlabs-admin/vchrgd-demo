import { createHmac, timingSafeEqual } from "node:crypto";
import type { SurveyWorkflow } from "@/lib/post-survey-workflows";

type JumptechAddressInput = {
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  country: string;
};

type JumptechCreateProjectRequest = {
  projectType: string;
  address: Array<{
    line1: string;
    line2?: string;
    line3?: string;
    line4?: string;
    town: string;
    county?: string;
    country: string;
    countryCode: string;
    postCode: string;
  }>;
  data?: {
    address: {
      line1: string;
      line2?: string;
      line3?: string;
      line4?: string;
      town: string;
      county?: string;
      country: string;
      countryCode: string;
      postCode: string;
    };
    postCode: string;
    makeModel?: string;
    chargerMakeModel?: string;
    discountAmount?: number;
    discountCode?: string;
    discountLabel?: string;
    totalBeforeDiscount?: number;
  };
  firstName: string;
  lastName: string;
  email?: string;
  phoneNumber?: string;
  integrationName: string;
  integrationId: string;
  makeModel?: string;
  chargerMakeModel?: string;
  projectSource?: string;
  installChargePoint?: boolean;
  initialAction?: "SendRelaySMS";
  preferredLocale?: string;
};

type JumptechCreateProjectEnvelope = {
  statusCode?: number;
  body?: string;
  headers?: Record<string, string>;
};

type JumptechJobSummary = {
  id?: string;
  status?: string;
  scheduledFor?: string;
  assignee?: string;
  assigneeEmail?: string;
  assigneePhone?: string;
  completedAt?: string;
};

type JumptechProjectSnapshot = {
  projectId: string;
  integrationName?: string;
  integrationId?: string;
  applicationId?: string;
  projectType?: string;
  status?: string;
  currentStatusLabel?: string;
  currentStatusDetail?: string;
  externalOwnerId?: string;
  jobs?: JumptechJobSummary[];
  completedAt?: string;
  lastSyncedAt?: string;
  lastWebhookAt?: string;
  quoteTotal?: number;
  additionalInstallationCosts?: number;
  additionalInstallationCostDetail?: string;
};

type JumptechSearchProjectItem = {
  projectId?: string;
  id?: string;
  projectType?: string;
  status?: string;
  currentStatus?: {
    status?: string;
    label?: string;
    updatedOn?: string;
  };
  externalIds?: Record<string, { id?: string } | undefined>;
  jobs?: JumptechJobSummary[];
};

type JumptechWebhookEvent = {
  subscriptionType: string;
  projectId: string;
  integrationId?: string;
  applicationId?: string;
  projectType?: string;
  status?: string;
  currentStatusLabel?: string;
  currentStatusDetail?: string;
  externalOwnerId?: string;
  jobs?: JumptechJobSummary[];
  completedAt?: string;
  quoteTotal?: number;
  additionalInstallationCosts?: number;
  additionalInstallationCostDetail?: string;
  receivedAt: string;
};

function isPlaceholderValue(value: string | undefined) {
  return !value || value.startsWith("replace-with-");
}

function splitCustomerName(name?: string) {
  const trimmed = name?.trim() || "";
  if (!trimmed) {
    return { firstName: "VCHRGD", lastName: "Customer" };
  }

  const parts = trimmed.split(/\s+/);
  return {
    firstName: parts.shift() || "VCHRGD",
    lastName: parts.join(" ") || "Customer",
  };
}

function normaliseCountryCode(value?: string) {
  const input = (value || "GB").trim().toUpperCase();
  if (input.length === 2) {
    return input;
  }

  if (input === "UNITED KINGDOM" || input === "GREAT BRITAIN") {
    return "GB";
  }

  return "GB";
}

function mapAddress(address?: JumptechAddressInput) {
  return [
    {
      line1: address?.line1 || "",
      line2: address?.line2 || "",
      town: address?.city || "",
      county: "",
      country: address?.country || "GB",
      countryCode: normaliseCountryCode(address?.country),
      postCode: address?.postalCode || "",
    },
  ];
}

function parseJsonResponse(text: string) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function toStatusText(value: string | undefined) {
  return value?.trim() || undefined;
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = Number(value.replace(/<[^>]*>/g, "").replace(/[£,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toCurrencyNumber(value: unknown) {
  const numericValue = toNumber(value);
  if (numericValue !== undefined) {
    return numericValue;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = Number(value.replace(/<[^>]*>/g, "").replace(/[^\d.-]+/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstNumberFrom(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = toCurrencyNumber(source[key]);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function stripHtml(value: unknown) {
  return typeof value === "string"
    ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
    : undefined;
}

function displayInstallerTenantName(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (normalized === "ascentenergy") {
    return "Ascent Energy Services";
  }

  return value;
}

function cleanInstallerCompanyName(value: unknown, depth = 0): string | undefined {
  const rawValue =
    typeof value === "string"
      ? value
      : value && typeof value === "object"
        ? firstStringFrom(value as Record<string, unknown>, [
            "legalName",
            "companyName",
            "businessName",
            "organisationName",
            "organizationName",
            "tradingName",
            "tenantDisplayName",
            "tenantName",
            "displayName",
            "label",
            "name",
          ])
        : undefined;
  const trimmed = rawValue?.trim();
  if (trimmed) {
    const normalised = trimmed.toLowerCase();
    if (
      trimmed.length >= 3 &&
      normalised !== "uk" &&
      normalised !== "vchrgd" &&
      normalised !== "jumptech" &&
      !normalised.includes("@")
    ) {
      return displayInstallerTenantName(trimmed);
    }
  }

  if (!value || typeof value !== "object" || depth >= 3) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  for (const key of [
    "company",
    "business",
    "organisation",
    "organization",
    "tenant",
    "subTenant",
    "installer",
    "installPartner",
    "partner",
    "assignedTenant",
    "contractor",
    "legalEntity",
    "account",
  ]) {
    const cleaned = cleanInstallerCompanyName(source[key], depth + 1);
    if (cleaned) {
      return cleaned;
    }
  }

  return undefined;
}

function firstStringFrom(source: Record<string, unknown> | undefined, keys: string[]) {
  if (!source) {
    return undefined;
  }

  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function firstCleanInstallerCompanyName(
  source: Record<string, unknown> | undefined,
  keys: string[],
) {
  if (!source) {
    return undefined;
  }

  for (const key of keys) {
    const cleaned = cleanInstallerCompanyName(source[key]);
    if (cleaned) {
      return cleaned;
    }
  }

  return undefined;
}

function formatInstallerTenantDisplayName(tenant: unknown, partner: unknown) {
  const partnerName = cleanInstallerCompanyName(partner);
  if (!partnerName) {
    return undefined;
  }

  const tenantName = typeof tenant === "string" ? tenant.trim() : "";
  if (!tenantName || tenantName.includes("@")) {
    return partnerName;
  }

  const displayTenant = tenantName.length <= 3 ? tenantName.toUpperCase() : tenantName;
  if (partnerName.toLowerCase().includes(tenantName.toLowerCase())) {
    return partnerName;
  }

  return `${displayTenant} (${partnerName})`;
}

function latestDelegationChainTenant(payload: Record<string, unknown>) {
  if (Array.isArray(payload.delegationChainArray)) {
    const tenant = [...payload.delegationChainArray]
      .reverse()
      .find((entry) => typeof entry === "string" && entry.trim());
    if (typeof tenant === "string") {
      return tenant.trim();
    }
  }

  if (typeof payload.delegationChain === "string") {
    const tenant = payload.delegationChain
      .split("|")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .at(-1);
    if (tenant) {
      return tenant;
    }
  }

  return undefined;
}

function extractProjectInstallerDisplayName(payload: Record<string, unknown>) {
  const resources =
    "resources" in payload && payload.resources && typeof payload.resources === "object"
      ? (payload.resources as Record<string, unknown>)
      : {};
  const annex =
    "Atom_Annex_D" in resources && resources.Atom_Annex_D && typeof resources.Atom_Annex_D === "object"
      ? (resources.Atom_Annex_D as Record<string, unknown>)
      : {};
  const delegationLog = Array.isArray(payload.delegationLog)
    ? (payload.delegationLog as Record<string, unknown>[])
    : [];
  const latestDelegation = [...delegationLog].reverse().find((entry) =>
    Boolean(entry?.subTenantName || entry?.toTenant),
  );
  const lastAssignment =
    "lastAssignment" in payload && payload.lastAssignment && typeof payload.lastAssignment === "object"
      ? (payload.lastAssignment as Record<string, unknown>)
      : "lastAssigment" in payload && payload.lastAssigment && typeof payload.lastAssigment === "object"
        ? (payload.lastAssigment as Record<string, unknown>)
        : undefined;
  const chainTenant = latestDelegationChainTenant(payload);

  return (
    formatInstallerTenantDisplayName(
      annex.tenant ||
        latestDelegation?.toTenant ||
        lastAssignment?.to ||
        chainTenant ||
        payload.tenant,
      annex.subTenantName ||
        annex.installer ||
        latestDelegation?.subTenantName ||
        lastAssignment?.subTenantName ||
        lastAssignment?.toDisplayName,
    ) ||
    firstCleanInstallerCompanyName(annex, ["subTenantName", "installer"]) ||
    firstCleanInstallerCompanyName(latestDelegation, ["subTenantName"]) ||
    firstCleanInstallerCompanyName(lastAssignment, [
      "subTenantName",
      "toDisplayName",
      "toTenantDisplayName",
      "toTenantName",
      "toTenant",
      "to",
    ]) ||
    cleanInstallerCompanyName(chainTenant) ||
    undefined
  );
}

function cleanInstallerContactEmail(value: unknown, installerName?: string) {
  if (typeof value !== "string") {
    return undefined;
  }

  const email = value.trim();
  if (!email || email.toLowerCase().endsWith("@jumptech.co.uk") || !installerName) {
    return undefined;
  }

  return email;
}

function normaliseProjectId(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  return value.trim().replace(/^"+|"+$/g, "");
}

function extractCurrentStatusInfo(payload: Record<string, unknown>) {
  const currentStatus =
    "currentStatus" in payload && payload.currentStatus && typeof payload.currentStatus === "object"
      ? (payload.currentStatus as Record<string, unknown>)
      : undefined;

  if (!currentStatus) {
    return {
      currentStatusLabel: undefined,
      currentStatusDetail: undefined,
      completedAt: undefined,
    };
  }

  const currentStatusLabel =
    (typeof currentStatus.label === "string" && currentStatus.label) ||
    (typeof currentStatus.name === "string" && currentStatus.name) ||
    (typeof currentStatus.status === "string" && currentStatus.status) ||
    undefined;

  const currentStatusDetail =
    (typeof currentStatus.description === "string" && currentStatus.description) ||
    (typeof currentStatus.detail === "string" && currentStatus.detail) ||
    (typeof currentStatus.reason === "string" && currentStatus.reason) ||
    undefined;

  const completedAt =
    (typeof currentStatus.completedAt === "string" && currentStatus.completedAt) ||
    (typeof currentStatus.updatedAt === "string" &&
    `${currentStatusLabel ?? ""}`.toUpperCase().includes("COMPLETE")
      ? currentStatus.updatedAt
      : undefined) ||
    undefined;

  return {
    currentStatusLabel,
    currentStatusDetail,
    completedAt,
  };
}

function extractExternalOwnerId(payload: Record<string, unknown>) {
  if (!("externalIds" in payload) || !payload.externalIds || typeof payload.externalIds !== "object") {
    return undefined;
  }

  const externalIds = payload.externalIds as Record<string, unknown>;
  const owner =
    "owner" in externalIds && externalIds.owner && typeof externalIds.owner === "object"
      ? (externalIds.owner as Record<string, unknown>)
      : undefined;

  return owner && typeof owner.id === "string" ? owner.id : undefined;
}

function extractExternalIntegrationId(payload: Record<string, unknown>) {
  if (!("externalIds" in payload) || !payload.externalIds || typeof payload.externalIds !== "object") {
    return undefined;
  }

  const externalIds = payload.externalIds as Record<string, unknown>;
  const { integrationName } = getJumptechConfig();
  const configured =
    integrationName in externalIds &&
    externalIds[integrationName] &&
    typeof externalIds[integrationName] === "object"
      ? (externalIds[integrationName] as Record<string, unknown>)
      : undefined;

  if (typeof configured?.id === "string" && configured.id.trim()) {
    return configured.id.trim();
  }

  for (const value of Object.values(externalIds)) {
    if (value && typeof value === "object" && "id" in value) {
      const id = (value as { id?: unknown }).id;
      if (typeof id === "string" && id.trim()) {
        return id.trim();
      }
    }
  }

  return undefined;
}

function extractJobs(payload: Record<string, unknown>) {
  const projectInstallerDisplayName = extractProjectInstallerDisplayName(payload);
  const hasTopLevelJobSignals = [
    "scheduledFor",
    "scheduledDate",
    "startAt",
    "startDate",
    "installer",
    "installerName",
    "installerDisplayName",
    "installerCompanyName",
    "installerTenantDisplayName",
    "installPartnerName",
    "tenantDisplayName",
  ].some((key) => key in payload);
  const rawJobs = Array.isArray(payload.jobs)
    ? payload.jobs
    : payload.job && typeof payload.job === "object"
      ? [payload.job]
      : hasTopLevelJobSignals
        ? [payload]
      : [];

  if (!rawJobs.length) {
    return undefined;
  }

  const jobs = rawJobs
    .map((job) => {
      if (!job || typeof job !== "object") {
        return null;
      }

      const raw = job as Record<string, unknown>;
      const resource =
        "resource" in raw && raw.resource && typeof raw.resource === "object"
          ? (raw.resource as Record<string, unknown>)
          : undefined;
      const assignments = Array.isArray(raw.jobAssignments)
        ? (raw.jobAssignments as Record<string, unknown>[])
        : Array.isArray(raw.assignments)
          ? (raw.assignments as Record<string, unknown>[])
        : [];
      const primaryAssignment = assignments.find((assignment) =>
        Boolean(
          assignment.assignedToDisplayName ||
            assignment.assignedTo ||
            assignment.displayName ||
            assignment.name ||
            assignment.email,
        ),
      );
      const jobCompanyName =
        firstCleanInstallerCompanyName(raw, [
          "installerDisplayName",
          "installerLabel",
          "installerCompanyDisplayName",
          "installerCompanyName",
          "installerCompany",
          "installerTenantDisplayName",
          "installerTenantName",
          "installerTenant",
          "installPartnerDisplayName",
          "installPartnerName",
          "installPartner",
          "partnerDisplayName",
          "partnerName",
          "tenantDisplayName",
          "tenantName",
          "tenant",
          "assignedTenantDisplayName",
          "assignedTenantName",
          "assignedToTenantDisplayName",
          "assignedToTenantName",
          "installer",
        ]);
      const assignmentCompanyName =
        firstCleanInstallerCompanyName(primaryAssignment, [
          "assignedTenantDisplayName",
          "assignedTenantName",
          "assignedToTenantDisplayName",
          "assignedToTenantName",
          "tenantDisplayName",
          "tenantName",
          "tenant",
          "subTenantName",
          "subTenant",
          "installerCompanyDisplayName",
          "installerCompanyName",
          "installerCompany",
          "installerTenantDisplayName",
          "installerTenantName",
          "installerTenant",
          "companyDisplayName",
          "companyName",
          "company",
          "organisationName",
          "organizationName",
          "businessName",
        ]);
      const resourceCompanyName =
        firstCleanInstallerCompanyName(resource, [
          "installerDisplayName",
          "installerCompanyName",
          "installerCompany",
          "installerTenantDisplayName",
          "installerTenantName",
          "installerTenant",
          "tenantDisplayName",
          "tenantName",
          "tenant",
          "partnerDisplayName",
          "partnerName",
          "companyName",
          "company",
          "legalName",
          "displayName",
          "label",
          "name",
        ]);
      const genericInstallerName =
        firstCleanInstallerCompanyName(raw, [
          "installerNameDisplay",
          "installerName",
        ]) ||
        firstCleanInstallerCompanyName(resource, [
          "installerName",
          "name",
        ]);
      const installerCompanyName =
        jobCompanyName ||
        assignmentCompanyName ||
        resourceCompanyName ||
        projectInstallerDisplayName ||
        genericInstallerName;

      return {
        id: typeof raw.id === "string" ? raw.id : undefined,
        status: typeof raw.status === "string" ? raw.status : undefined,
        scheduledFor:
          (typeof raw.scheduledFor === "string" && raw.scheduledFor) ||
          (typeof raw.scheduledDate === "string" && raw.scheduledDate) ||
          (typeof raw.startAt === "string" && raw.startAt) ||
          (typeof raw.startDate === "string" && raw.startDate) ||
          (typeof raw.date === "string" && raw.date) ||
          undefined,
        assignee: installerCompanyName,
        assigneeEmail:
          cleanInstallerContactEmail(raw.installerEmail, installerCompanyName) ||
          cleanInstallerContactEmail(raw.assigneeEmail, installerCompanyName) ||
          cleanInstallerContactEmail(primaryAssignment?.email, installerCompanyName),
        assigneePhone:
          (typeof raw.installerPhone === "string" ? raw.installerPhone : undefined) ||
          (typeof raw.assigneePhone === "string" ? raw.assigneePhone : undefined) ||
          (primaryAssignment && typeof primaryAssignment.phone === "string"
            ? primaryAssignment.phone
            : undefined) ||
          (primaryAssignment && typeof primaryAssignment.phoneNumber === "string"
            ? primaryAssignment.phoneNumber
            : undefined) ||
          undefined,
        completedAt:
          (typeof raw.completedOn === "string" && raw.completedOn) ||
          (typeof raw.completedAt === "string" && raw.completedAt) ||
          undefined,
      } satisfies JumptechJobSummary;
    })
    .filter(Boolean) as JumptechJobSummary[];

  return jobs.length ? jobs : undefined;
}

function extractJumptechQuoteInfo(payload: Record<string, unknown>) {
  const resources =
    "resources" in payload && payload.resources && typeof payload.resources === "object"
      ? (payload.resources as Record<string, unknown>)
      : {};
  const quoteSummary =
    "QuoteSummary" in resources && resources.QuoteSummary && typeof resources.QuoteSummary === "object"
      ? (resources.QuoteSummary as Record<string, unknown>)
      : {};
  const annex =
    "Atom_Annex_D" in resources && resources.Atom_Annex_D && typeof resources.Atom_Annex_D === "object"
      ? (resources.Atom_Annex_D as Record<string, unknown>)
      : {};

  const quotedAdditionalTotal =
    firstNumberFrom(quoteSummary, [
      "total",
      "totalIncVat",
      "totalIncVAT",
      "totalInclVat",
      "totalIncludingVat",
      "totalAmount",
      "customerInstallTotal",
      "totalInstallationCost",
    ]) ??
    firstNumberFrom(annex, [
      "customerInstallTotal",
      "installTotal",
      "totalIncVat",
      "totalIncVAT",
      "totalInclVat",
      "totalIncludingVat",
      "totalAmount",
    ]);
  const labourCost =
    firstNumberFrom(quoteSummary, ["labourCost", "labour", "installLabourCost"]) ?? 0;
  const additionalInstallationLineCost =
    firstNumberFrom(quoteSummary, [
      "additionalInstallationCosts",
      "otherInstallationCosts",
      "installationCosts",
      "otherEligibleCosts",
    ]) ??
    firstNumberFrom(annex, ["installationOtherEligible"]) ??
    0;
  const surveyCost = firstNumberFrom(quoteSummary, ["surveyCost"]) ?? 0;
  const chargepointCost =
    firstNumberFrom(quoteSummary, ["chargepointCost", "chargePointCost"]) ?? 0;
  const calculatedAdditionalNet =
    labourCost + additionalInstallationLineCost + surveyCost + chargepointCost;
  const additionalInstallationCosts =
    quotedAdditionalTotal ??
    (calculatedAdditionalNet > 0 ? Number((calculatedAdditionalNet * 1.2).toFixed(2)) : 0);

  const extraDetail =
    stripHtml(quoteSummary.installationOtherEligible) ||
    stripHtml(quoteSummary.additionalNote) ||
    stripHtml(quoteSummary.additionalNotes) ||
    stripHtml(annex.installationOtherEligible) ||
    stripHtml(annex.installCablingSwitchgearConsumablesByItemIncVat) ||
    stripHtml(annex.installAdminMobilisationByItemIncVat);

  return {
    quoteTotal: undefined,
    additionalInstallationCosts,
    additionalInstallationCostDetail:
      extraDetail || `Additional installation costs: £${additionalInstallationCosts.toFixed(2)}`,
  };
}

function extractSearchProjectItems(payload: unknown): JumptechSearchProjectItem[] {
  if (Array.isArray(payload)) {
    return payload as JumptechSearchProjectItem[];
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const raw = payload as Record<string, unknown>;
  const candidates = [raw.projects, raw.items, raw.results, raw.data];
  const list = candidates.find(Array.isArray);
  return Array.isArray(list) ? (list as JumptechSearchProjectItem[]) : [];
}

function getExternalIntegrationId(item: JumptechSearchProjectItem, integrationName: string) {
  const configured = item.externalIds?.[integrationName]?.id;
  if (configured) {
    return configured;
  }

  const fallback = Object.values(item.externalIds ?? {}).find((entry) => entry?.id)?.id;
  return fallback;
}

function getJumptechSearchStatusPriority(item: JumptechSearchProjectItem) {
  const status = `${item.currentStatus?.label || item.currentStatus?.status || item.status || ""}`
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  if (status.includes("INSTALLED") || status.includes("COMPLETE")) {
    return 60;
  }

  if (status.includes("BOOKED") || status.includes("SCHEDULED")) {
    return 50;
  }

  if (
    status.includes("QUOTE_APPROVED") ||
    status === "DNO_APPROVED" ||
    status.includes("READY_FOR_INSTALL")
  ) {
    return 40;
  }

  if (status.includes("ADDITIONAL_COST") || status.includes("COST_REQUIRED")) {
    return 35;
  }

  if (status.includes("SURVEY") || status === "IN_REVIEW") {
    return 30;
  }

  if (status === "PENDING_APPLICATION") {
    return 20;
  }

  if (status === "CREATED") {
    return 10;
  }

  if (status === "ARCHIVED") {
    return 0;
  }

  return status ? 15 : 0;
}

function mapSearchProjectToSnapshot(project: JumptechSearchProjectItem): JumptechProjectSnapshot {
  const projectId = project.projectId || project.id || "";
  const parsed = parseJumptechProjectSnapshot(project as Record<string, unknown>);
  return {
    ...parsed,
    projectId,
    projectType: parsed.projectType ?? project.projectType,
    status: parsed.status ?? project.status ?? project.currentStatus?.status,
    currentStatusLabel:
      parsed.currentStatusLabel ?? project.currentStatus?.label ?? project.currentStatus?.status,
    jobs: parsed.jobs ?? project.jobs,
    lastSyncedAt: parsed.lastSyncedAt ?? new Date().toISOString(),
  };
}

export function getJumptechConfig() {
  return {
    apiBaseUrl: (process.env.JUMPTECH_API_BASE_URL || "https://api.jumptech.co.uk").replace(/\/+$/, ""),
    apiToken: process.env.JUMPTECH_API_TOKEN || "",
    integrationName: process.env.JUMPTECH_INTEGRATION_NAME || "vchrgd",
    projectType: process.env.JUMPTECH_PROJECT_TYPE || "VCHRGD Domestic EV Installation",
    initialAction: process.env.JUMPTECH_INITIAL_ACTION || "SendRelaySMS",
    preferredLocale: process.env.JUMPTECH_PREFERRED_LOCALE || "en-GB",
    projectSource: process.env.JUMPTECH_PROJECT_SOURCE || "VCHRGD",
    webhookSecret: process.env.JUMPTECH_WEBHOOK_SECRET || "",
  };
}

export function isJumptechConfigured() {
  return !isPlaceholderValue(getJumptechConfig().apiToken);
}

export function buildJumptechAuthorizationHeader() {
  const { apiToken } = getJumptechConfig();
  if (!apiToken) {
    return "";
  }

  return apiToken;
}

export async function jumptechRequest(
  path: string,
  init?: RequestInit,
) {
  const { apiBaseUrl, apiToken } = getJumptechConfig();
  const requestUrl = new URL(`${apiBaseUrl}${path}`);
  if (
    apiToken &&
    requestUrl.hostname.includes(".staging.") &&
    !requestUrl.searchParams.has("apikey")
  ) {
    requestUrl.searchParams.set("apikey", apiToken);
  }

  const response = await fetch(requestUrl.toString(), {
    ...init,
    headers: {
      Authorization: buildJumptechAuthorizationHeader(),
      Accept: "application/json",
      ...(init?.body && typeof init.body === "string"
        ? {
            "Content-Type": "application/json",
          }
        : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const text = await response.text();
  return {
    response,
    data: parseJsonResponse(text),
  };
}

export function buildJumptechCreateProjectRequest(workflow: SurveyWorkflow): JumptechCreateProjectRequest {
  const address = workflow.deliveryAddress ?? workflow.billingAddress;
  const mappedAddress = mapAddress(address)[0];
  const { firstName, lastName } = splitCustomerName(workflow.customerName);
  const { integrationName, projectType, initialAction, preferredLocale, projectSource } = getJumptechConfig();
  const integrationId =
    workflow.currentPaymentId || workflow.sourcePaymentId || workflow.id;

  return {
    projectType,
    address: [mappedAddress],
    data: {
      address: mappedAddress,
      postCode: mappedAddress.postCode,
      makeModel: workflow.chargerName,
      chargerMakeModel: workflow.chargerName,
      discountAmount: workflow.discountAmount,
      discountCode: workflow.discountCode,
      discountLabel: workflow.discountLabel,
      totalBeforeDiscount: workflow.totalBeforeDiscount,
    },
    firstName,
    lastName,
    email: workflow.customerEmail,
    phoneNumber: workflow.customerPhone,
    integrationName,
    integrationId,
    makeModel: workflow.chargerName,
    chargerMakeModel: workflow.chargerName,
    projectSource,
    installChargePoint: true,
    initialAction: initialAction === "SendRelaySMS" ? "SendRelaySMS" : undefined,
    preferredLocale,
  };
}

export async function findJumptechProjectByIntegrationId(integrationId: string) {
  const { integrationName, projectType } = getJumptechConfig();
  const result = await jumptechRequest("/projects/searchProjects?maxResults=100&sortOrder=desc", {
    method: "GET",
  });

  if (!result.response.ok) {
    return {
      ...result,
      project: null,
    };
  }

  const project = extractSearchProjectItems(result.data)
    .filter((item) => {
      const itemProjectId = item.projectId || item.id;
      return (
        Boolean(itemProjectId) &&
        item.projectType === projectType &&
        getExternalIntegrationId(item, integrationName) === integrationId
      );
    })
    .sort(
      (left, right) =>
        getJumptechSearchStatusPriority(right) - getJumptechSearchStatusPriority(left),
    )[0];

  return {
    ...result,
    project: project ? mapSearchProjectToSnapshot(project) : null,
  };
}

export async function findJumptechProjectByProjectId(projectId: string) {
  const result = await jumptechRequest("/projects/searchProjects?maxResults=100&sortOrder=desc", {
    method: "GET",
  });

  if (!result.response.ok) {
    return {
      ...result,
      project: null,
    };
  }

  const project = extractSearchProjectItems(result.data).find(
    (item) => item.projectId === projectId || item.id === projectId,
  );

  return {
    ...result,
    project: project ? mapSearchProjectToSnapshot(project) : null,
  };
}

export async function createJumptechProject(workflow: SurveyWorkflow) {
  const { integrationName } = getJumptechConfig();
  const payload = buildJumptechCreateProjectRequest(workflow);
  const result = await jumptechRequest(
    `/projects/newProject?integration=${encodeURIComponent(integrationName)}`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );

  const envelope = result.data as JumptechCreateProjectEnvelope | Record<string, unknown> | null;
  const projectId = normaliseProjectId(
    envelope && typeof envelope === "object" && "body" in envelope && typeof envelope.body === "string"
      ? envelope.body
      : envelope && typeof envelope === "object" && "projectId" in envelope && typeof envelope.projectId === "string"
        ? envelope.projectId
        : undefined,
  );

  return {
    ...result,
    projectId,
    integrationName: payload.integrationName,
    integrationId: payload.integrationId,
    projectType: payload.projectType,
  };
}

export async function updateJumptechProjectStatus(projectId: string, status: string) {
  return jumptechRequest("/projects/updateStatus", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      status,
    }),
  });
}

export async function getJumptechProject(projectId: string) {
  const result = await jumptechRequest(`/projects/project/${encodeURIComponent(projectId)}`, {
    method: "GET",
  });
  const directSnapshot =
    result.data && typeof result.data === "object"
      ? parseJumptechProjectSnapshot(result.data as Record<string, unknown>)
      : null;

  if (result.response.ok && directSnapshot?.projectId) {
    return {
      ...result,
      snapshot: directSnapshot,
    };
  }

  if ([401, 403, 404].includes(result.response.status)) {
    const fallback = await findJumptechProjectByProjectId(projectId);
    if (fallback.response.ok && fallback.project) {
      return {
        ...fallback,
        snapshot: fallback.project,
      };
    }
  }

  return {
    ...result,
    snapshot: directSnapshot,
  };
}

export async function createJumptechWebhookSubscription(hookUrl: string) {
  return jumptechRequest("/webhooks/subscription", {
    method: "POST",
    body: JSON.stringify({
      projectUpdateType: "STATUS",
      hookUrl,
    }),
  });
}

export async function setJumptechWebhookSecret(secret: string) {
  return jumptechRequest("/webhooks/hooks/secret", {
    method: "POST",
    body: secret,
    headers: {
      "Content-Type": "text/plain",
    },
  });
}

export function parseJumptechProjectSnapshot(payload: Record<string, unknown>): JumptechProjectSnapshot {
  const { currentStatusLabel, currentStatusDetail, completedAt } = extractCurrentStatusInfo(payload);
  const quoteInfo = extractJumptechQuoteInfo(payload);
  return {
    projectId: String(payload.projectId || ""),
    integrationId: extractExternalIntegrationId(payload),
    applicationId: typeof payload.applicationId === "string" ? payload.applicationId : undefined,
    projectType: typeof payload.projectType === "string" ? payload.projectType : undefined,
    status: toStatusText(typeof payload.status === "string" ? payload.status : undefined),
    currentStatusLabel,
    currentStatusDetail,
    externalOwnerId: extractExternalOwnerId(payload),
    jobs: extractJobs(payload),
    completedAt,
    ...quoteInfo,
  };
}

export function parseJumptechWebhookEvent(
  payload: unknown,
  subscriptionTypeHeader: string,
): JumptechWebhookEvent | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const raw = payload as Record<string, unknown>;
  const snapshot = parseJumptechProjectSnapshot(raw);
  if (!snapshot.projectId) {
    return null;
  }

  return {
    subscriptionType:
      (typeof raw.subscriptionType === "string" ? raw.subscriptionType : undefined) ||
      subscriptionTypeHeader ||
      "STATUS",
    projectId: snapshot.projectId,
    integrationId: snapshot.integrationId,
    applicationId: snapshot.applicationId,
    projectType: snapshot.projectType,
    status: snapshot.status,
    currentStatusLabel: snapshot.currentStatusLabel,
    currentStatusDetail: snapshot.currentStatusDetail,
    externalOwnerId: snapshot.externalOwnerId,
    jobs: snapshot.jobs,
    completedAt: snapshot.completedAt,
    quoteTotal: snapshot.quoteTotal,
    additionalInstallationCosts: snapshot.additionalInstallationCosts,
    additionalInstallationCostDetail: snapshot.additionalInstallationCostDetail,
    receivedAt: new Date().toISOString(),
  };
}

export function verifyJumptechWebhookSignature(
  rawPayload: string,
  signatureHeader: string,
  timestamp: string,
) {
  const { webhookSecret } = getJumptechConfig();

  if (!webhookSecret) {
    return false;
  }

  if (!signatureHeader || !timestamp) {
    return false;
  }

  // Jumptech signs each retry with a fresh ISO timestamp, independently of update time.
  const signedAt = /^\d{4}-\d{2}-\d{2}T/.test(timestamp) ? Date.parse(timestamp) : NaN;
  if (!Number.isFinite(signedAt) || Math.abs(Date.now() - signedAt) > 5 * 60 * 1000) return false;

  const hmac = createHmac("sha256", webhookSecret)
    .update(`${timestamp}${rawPayload}`)
    .digest();
  const expectedHex = hmac.toString("hex");
  const expectedBase64 = hmac.toString("base64");
  const provided = signatureHeader.replace(/^sha256=/i, "").trim();

  return [expectedHex, expectedBase64].some((expected) => {
    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(provided);

    return (
      expectedBuffer.length === providedBuffer.length &&
      timingSafeEqual(expectedBuffer, providedBuffer)
    );
  });
}

export function isJumptechProjectComplete(status?: string, currentStatusLabel?: string) {
  const normalized = `${status || currentStatusLabel || ""}`
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  return (
    normalized.includes("COMPLETE") ||
    normalized.includes("COMPLETED") ||
    normalized.includes("INSTALLED") ||
    normalized.includes("CLOSED")
  );
}

export type {
  JumptechCreateProjectEnvelope,
  JumptechJobSummary,
  JumptechProjectSnapshot,
  JumptechWebhookEvent,
};
