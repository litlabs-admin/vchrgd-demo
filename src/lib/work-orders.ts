import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readJsonFile, writeJsonFile, withJsonFileTransaction } from "@/lib/server-data";
import {
  getInstallerById,
  matchInstallerByName,
  reservePurchaseOrderNumber,
  type InstallerRecord,
} from "@/lib/installers";
import {
  getResolvedWorkflowAmount,
  type SurveyWorkflow,
} from "@/lib/post-survey-workflows";

type WorkOrderRecord = {
  workflowId: string;
  purchaseOrderNumber: string;
  installerId: string;
  installerMatchedName: string;
  installerMatchScore: number;
  generatedAt: string;
  sentAt?: string;
  sentBy?: string;
};

type WorkOrderFile = {
  workOrders: WorkOrderRecord[];
};

type WorkOrderBuildResult = {
  record: WorkOrderRecord;
  installer: InstallerRecord;
};

type PdfFonts = {
  regular: PDFFont;
  bold: PDFFont;
};

type TextOptions = {
  align?: "left" | "right" | "center";
  color?: string;
  font?: PDFFont;
  lineHeight?: number;
  maxLines?: number;
  size?: number;
  width?: number;
};

const WORK_ORDERS_FILE = "work-orders.json";
const VCHRGD_LOGO_PATH = path.join(process.cwd(), "public", "content", "vchrgd-logo-light.png");
const WORK_ORDER_FONT_PATH = path.join(process.cwd(), "public", "content", "work-order-font.ttf");

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const LEFT = 42;
const CONTENT_WIDTH = PAGE_WIDTH - LEFT * 2;

const PDF_COLOURS = {
  navy: "#07142b",
  ink: "#111827",
  muted: "#52627a",
  rule: "#d8dee8",
  panel: "#f6f8fb",
  cyan: "#00cfe8",
  white: "#ffffff",
};

function formatDate(value?: string) {
  if (!value) {
    return "";
  }

  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function customerReference(workflow: SurveyWorkflow) {
  const name = workflow.customerName?.trim();
  if (!name) {
    return workflow.sourcePaymentId;
  }

  const parts = name.split(/\s+/);
  if (parts.length === 1) {
    return parts[0];
  }

  return `${parts[0][0]}.${parts.slice(1).join(" ")}`;
}

function readWorkOrderFile() {
  return readJsonFile<WorkOrderFile>(WORK_ORDERS_FILE, { workOrders: [] });
}

async function writeWorkOrderFile(file: WorkOrderFile) {
  await writeJsonFile(WORK_ORDERS_FILE, file);
}

function isWorkflowReadyForWorkOrder(workflow: SurveyWorkflow) {
  return Boolean(workflow.installerName?.trim());
}

async function resolveInstaller(workflow: SurveyWorkflow, installerId?: string) {
  if (installerId) {
    return {
      installer: await getInstallerById(installerId),
      matchedOn: "Manual selection",
      score: 1,
    };
  }

  const match = await matchInstallerByName(workflow.installerName);
  if (!match) {
    return null;
  }

  return {
    installer: match.installer,
    matchedOn: match.matchedOn,
    score: match.score,
  };
}

export async function getWorkOrderForWorkflow(workflowId: string) {
  const file = await readWorkOrderFile();
  return file.workOrders.find((record) => record.workflowId === workflowId) ?? null;
}

export async function listWorkOrders() {
  return (await readWorkOrderFile()).workOrders;
}

export async function deleteWorkOrderForWorkflow(workflowId: string) {
  return withJsonFileTransaction(WORK_ORDERS_FILE, async () => {
  const file = await readWorkOrderFile();
  const retained = file.workOrders.filter((record) => record.workflowId !== workflowId);
  if (retained.length === file.workOrders.length) {
    return false;
  }

  await writeWorkOrderFile({ workOrders: retained });
  return true;

  });
}

export async function markWorkOrderSent(workflowId: string, actor: string) {
  return withJsonFileTransaction(WORK_ORDERS_FILE, async () => {
  const file = await readWorkOrderFile();
  const existing = file.workOrders.find((record) => record.workflowId === workflowId);
  if (!existing) {
    throw new Error("Generate the PO before marking it as sent.");
  }

  if (existing.sentAt) {
    return { changed: false, record: existing };
  }

  const record: WorkOrderRecord = {
    ...existing,
    sentAt: new Date().toISOString(),
    sentBy: actor,
  };

  await writeWorkOrderFile({
    workOrders: [record, ...file.workOrders.filter((entry) => entry.workflowId !== workflowId)],
  });

  return { changed: true, record };

  });
}

function normaliseWorkOrderNumber(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalised = trimmed.toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9_-]{4,40}$/.test(normalised)) {
    throw new Error("Work order number must use letters, numbers, underscores or hyphens only.");
  }

  return normalised;
}

export async function getOrCreateWorkOrder(
  workflow: SurveyWorkflow,
  installerId?: string,
  workOrderNumber?: string,
): Promise<WorkOrderBuildResult> {
  return withJsonFileTransaction(WORK_ORDERS_FILE, async () => {
  if (!isWorkflowReadyForWorkOrder(workflow)) {
    throw new Error("Assign an installer before generating the work order.");
  }

  const resolvedInstaller = await resolveInstaller(workflow, installerId);
  if (!resolvedInstaller?.installer) {
    throw new Error(
      "Installer legal details could not be matched. Select an installer from the directory before generating the work order.",
    );
  }

  const file = await readWorkOrderFile();
  const existing = file.workOrders.find((record) => record.workflowId === workflow.id);
  const manualWorkOrderNumber = normaliseWorkOrderNumber(workOrderNumber);
  if (manualWorkOrderNumber) {
    const duplicate = file.workOrders.find(
      (record) =>
        record.workflowId !== workflow.id &&
        record.purchaseOrderNumber.toUpperCase() === manualWorkOrderNumber,
    );
    if (duplicate) {
      throw new Error("That work order number is already assigned to another order.");
    }
  }

  if (existing && !installerId && !manualWorkOrderNumber) {
    const installer = await getInstallerById(existing.installerId);
    if (installer) {
      return { record: existing, installer };
    }
  }

  const record: WorkOrderRecord = {
    workflowId: workflow.id,
    purchaseOrderNumber:
      manualWorkOrderNumber ?? existing?.purchaseOrderNumber ?? await reservePurchaseOrderNumber(),
    installerId: resolvedInstaller.installer.id,
    installerMatchedName: resolvedInstaller.matchedOn,
    installerMatchScore: resolvedInstaller.score,
    generatedAt: new Date().toISOString(),
    sentAt: existing?.sentAt,
    sentBy: existing?.sentBy,
  };

  await writeWorkOrderFile({
    workOrders: [record, ...file.workOrders.filter((entry) => entry.workflowId !== workflow.id)],
  });

  return { record, installer: resolvedInstaller.installer };

  });
}

function formatAddress(lines: Array<string | undefined>) {
  return lines.map((line) => line?.trim()).filter(Boolean) as string[];
}

function formatNotes(lines: Array<string | undefined>) {
  const seen = new Set<string>();

  return lines
    .flatMap((line) => (line || "").split(/\r?\n/))
    .map((line) => line.trim())
    .filter((line): line is string => {
      if (!line) {
        return false;
      }

      if (/^\d+$/.test(line)) {
        return false;
      }

      const key = line.toLowerCase();
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function getVatMultiplier(vatRate: number) {
  return 1 + vatRate / 100;
}

function installerDefaultGrossAmount(installer: InstallerRecord, fallback: number) {
  const configuredAmount = installer.defaultNetAmount || fallback;

  // Legacy imported installer records used 366.67 as the standard net amount.
  // The PO configuration now stores the standard amount inclusive of VAT.
  if (installer.vatRate === 20 && Math.abs(configuredAmount - 366.67) <= 0.01) {
    return 440;
  }

  return configuredAmount;
}

function getWorkOrderAmounts(workflow: SurveyWorkflow, installer: InstallerRecord) {
  const vatMultiplier = getVatMultiplier(installer.vatRate);
  const standardGross = installerDefaultGrossAmount(
    installer,
    Math.min(getResolvedWorkflowAmount(workflow), workflow.originalAmount),
  );
  const standardNet = Number((standardGross / vatMultiplier).toFixed(2));
  const additionalGross = Math.max(workflow.additionalInstallationCosts ?? 0, 0);
  const additionalNet = Number((additionalGross / vatMultiplier).toFixed(2));
  const subtotalNet = Number((standardNet + additionalNet).toFixed(2));
  const grossAmount = Number((standardGross + additionalGross).toFixed(2));
  const vatAmount = Number((grossAmount - subtotalNet).toFixed(2));

  return {
    additionalGross,
    additionalNet,
    grossAmount,
    standardGross,
    standardNet,
    subtotalNet,
    vatAmount,
  };
}

function toPdfColour(hex: string) {
  const value = hex.replace("#", "");
  const parsed = Number.parseInt(value, 16);
  return rgb(
    ((parsed >> 16) & 255) / 255,
    ((parsed >> 8) & 255) / 255,
    (parsed & 255) / 255,
  );
}

function topY(top: number, height = 0) {
  return PAGE_HEIGHT - top - height;
}

function safePdfText(value: string) {
  return value
    .replace(/£/g, "GBP ")
    .replace(/£/g, "GBP ")
    .replace(/\uFFFD(?=\d)/g, "GBP ")
    .replace(/\?(?=\d)/g, "GBP ")
    .replace(/[^\t\n\r\u0020-\u00ff]/g, "");
}

function textWidth(text: string, font: PDFFont, size: number) {
  return font.widthOfTextAtSize(text, size);
}

function wrapPdfText(text: string, font: PDFFont, size: number, width: number) {
  const paragraphs = safePdfText(text || "-").split(/\r?\n/);
  const lines: string[] = [];

  paragraphs.forEach((paragraph) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      return;
    }

    let current = "";
    words.forEach((word) => {
      const next = current ? `${current} ${word}` : word;
      if (textWidth(next, font, size) <= width || !current) {
        current = next;
        return;
      }

      lines.push(current);
      current = word;
    });

    if (current) {
      lines.push(current);
    }
  });

  return lines;
}

function drawTextLine(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  fonts: PdfFonts,
  options: TextOptions = {},
) {
  const size = options.size ?? 9;
  const font = options.font ?? fonts.regular;
  const width = options.width;
  const content = safePdfText(text || "-").replace(/\s+/g, " ").trim() || "-";
  const measuredWidth = textWidth(content, font, size);
  let drawX = x;

  if (width && options.align === "right") {
    drawX = x + width - measuredWidth;
  } else if (width && options.align === "center") {
    drawX = x + (width - measuredWidth) / 2;
  }

  page.drawText(content, {
    x: drawX,
    y: topY(y, size),
    size,
    font,
    color: toPdfColour(options.color ?? PDF_COLOURS.ink),
  });
}

function drawWrappedText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  fonts: PdfFonts,
  options: TextOptions = {},
) {
  const size = options.size ?? 9;
  const font = options.font ?? fonts.regular;
  const width = options.width ?? 220;
  const lineHeight = options.lineHeight ?? size + 4;
  const maxLines = options.maxLines ?? 99;
  const wrappedLines = wrapPdfText(text, font, size, width);
  const lines = wrappedLines.slice(0, maxLines);

  lines.forEach((line, index) => {
    const content =
      index === maxLines - 1 && wrappedLines.length > maxLines
        ? `${line.replace(/\s+\S*$/, "")}...`
        : line;
    drawTextLine(page, content, x, y + index * lineHeight, fonts, {
      ...options,
      font,
      size,
      width,
    });
  });

  return y + Math.max(lines.length, 1) * lineHeight;
}

function drawRectangle(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  options: {
    borderColor?: string;
    borderWidth?: number;
    fillColor?: string;
  } = {},
) {
  page.drawRectangle({
    x,
    y: topY(y, height),
    width,
    height,
    color: options.fillColor ? toPdfColour(options.fillColor) : undefined,
    borderColor: options.borderColor ? toPdfColour(options.borderColor) : undefined,
    borderWidth: options.borderWidth,
  });
}

function drawRule(page: PDFPage, x: number, y: number, width: number, color = PDF_COLOURS.rule) {
  page.drawLine({
    start: { x, y: topY(y) },
    end: { x: x + width, y: topY(y) },
    thickness: 0.7,
    color: toPdfColour(color),
  });
}

function drawLabel(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  fonts: PdfFonts,
  options: TextOptions = {},
) {
  drawTextLine(page, text.toUpperCase(), x, y, fonts, {
    color: options.color ?? PDF_COLOURS.muted,
    font: fonts.bold,
    size: options.size ?? 7,
    width: options.width,
    align: options.align,
  });
}

function drawAddressBlock(
  page: PDFPage,
  title: string,
  lines: string[],
  x: number,
  y: number,
  width: number,
  fonts: PdfFonts,
) {
  drawLabel(page, title, x, y, fonts, { width });
  const contentY = y + 19;
  lines.forEach((line, index) => {
    drawWrappedText(page, line, x, contentY + index * 13, fonts, {
      color: PDF_COLOURS.ink,
      font: index === 0 ? fonts.bold : fonts.regular,
      lineHeight: 12,
      size: 9,
      width,
    });
  });

  return contentY + Math.max(lines.length, 1) * 13;
}

function drawMetaRow(
  page: PDFPage,
  label: string,
  value: string,
  x: number,
  y: number,
  fonts: PdfFonts,
  labelWidth = 112,
  valueWidth = 118,
) {
  drawTextLine(page, label, x, y, fonts, {
    font: fonts.bold,
    size: 8.5,
    width: labelWidth,
  });
  drawTextLine(page, value || "-", x + labelWidth, y, fonts, {
    font: fonts.regular,
    size: 8.5,
    width: valueWidth,
  });
}

export async function generateWorkOrderPdf({
  workflow,
  installer,
  record,
}: {
  workflow: SurveyWorkflow;
  installer: InstallerRecord;
  record: WorkOrderRecord;
}) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  pdfDoc.setTitle(`Purchase Order ${record.purchaseOrderNumber}`);
  pdfDoc.setAuthor("VCHRGD Technologies Ltd");
  pdfDoc.setSubject(`Installer work order for ${workflow.sourcePaymentId}`);
  pdfDoc.setCreationDate(new Date(record.generatedAt));

  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const fonts: PdfFonts = {
    regular: existsSync(WORK_ORDER_FONT_PATH)
      ? await pdfDoc.embedFont(readFileSync(WORK_ORDER_FONT_PATH), { subset: true })
      : await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
  };

  const deliveryAddress = workflow.deliveryAddress ?? workflow.billingAddress;
  const installerAddress = formatAddress([
    installer.address.line1,
    installer.address.line2,
    installer.address.town,
    installer.address.county,
    installer.address.postcode,
    installer.address.country,
  ]);
  const deliveryLines = formatAddress([
    deliveryAddress?.line1,
    deliveryAddress?.line2,
    deliveryAddress?.city,
    deliveryAddress?.postalCode,
    deliveryAddress?.country || "United Kingdom",
  ]);
  const {
    additionalGross,
    additionalNet,
    grossAmount,
    standardGross,
    standardNet,
    subtotalNet,
    vatAmount,
  } = getWorkOrderAmounts(workflow, installer);
  const description = workflow.chargerName
    ? `VCHRGD Installation - ${workflow.chargerName}`
    : "VCHRGD Installation";

  drawRectangle(page, 0, 0, PAGE_WIDTH, 86, { fillColor: PDF_COLOURS.white });
  if (existsSync(VCHRGD_LOGO_PATH)) {
    const logo = await pdfDoc.embedPng(readFileSync(VCHRGD_LOGO_PATH));
    const logoDimensions = logo.scaleToFit(142, 38);
    page.drawImage(logo, {
      x: LEFT,
      y: topY(21, logoDimensions.height),
      width: logoDimensions.width,
      height: logoDimensions.height,
    });
  } else {
    drawTextLine(page, "VCHRGD", LEFT, 28, fonts, {
      color: PDF_COLOURS.ink,
      font: fonts.bold,
      size: 15,
    });
  }

  drawLabel(page, "INSTALLER WORK ORDER", 388, 25, fonts, {
    align: "right",
    color: PDF_COLOURS.cyan,
    width: 165,
  });
  drawTextLine(page, record.purchaseOrderNumber, 388, 42, fonts, {
    align: "right",
    color: PDF_COLOURS.ink,
    font: fonts.bold,
    size: 11,
    width: 165,
  });
  drawRule(page, LEFT, 82, CONTENT_WIDTH, PDF_COLOURS.navy);

  drawTextLine(page, "PURCHASE ORDER", 318, 96, fonts, {
    width: 235,
    align: "right",
    font: fonts.bold,
    size: 23,
  });
  drawTextLine(page, "Generated for installer dispatch", 318, 124, fonts, {
    width: 235,
    align: "right",
    color: PDF_COLOURS.muted,
    size: 8,
  });

  drawAddressBlock(page, "Installation address", ["Installation Address", ...deliveryLines], LEFT, 100, 218, fonts);
  const supplierBlockEnd = drawAddressBlock(
    page,
    "Installer",
    [installer.legalName, ...installerAddress],
    318,
    158,
    235,
    fonts,
  );

  drawAddressBlock(
    page,
    "Customer",
    [workflow.customerName || "-", workflow.customerPhone || "-", workflow.customerEmail || ""].filter(Boolean),
    LEFT,
    214,
    218,
    fonts,
  );

  const metaY = Math.max(276, supplierBlockEnd + 18);
  drawRule(page, 318, metaY - 12, 235);
  drawMetaRow(page, "Purchase Order Date", formatDate(record.generatedAt), 318, metaY, fonts);
  drawMetaRow(page, "Installation Date", formatDate(workflow.installationDate), 318, metaY + 18, fonts);
  drawMetaRow(page, "Purchase Order Number", record.purchaseOrderNumber, 318, metaY + 36, fonts);
  drawMetaRow(page, "Reference", customerReference(workflow), 318, metaY + 54, fonts);
  drawMetaRow(page, "VAT Number", installer.vatNumber || "-", 318, metaY + 72, fonts);
  drawRule(page, 318, metaY + 94, 235);

  const buyerBlockEnd = drawAddressBlock(
    page,
    "Buyer",
    [
      "VCHRGD Technologies Ltd",
      "1a Eghams Court",
      "Boston Drive",
      "Bourne End",
      "Buckinghamshire",
      "SL8 5YS",
      "UNITED KINGDOM",
    ],
    LEFT,
    302,
    218,
    fonts,
  );

  const tableTop = Math.max(455, buyerBlockEnd + 34);
  drawRectangle(page, LEFT, tableTop - 15, CONTENT_WIDTH, 36, {
    fillColor: PDF_COLOURS.panel,
    borderColor: PDF_COLOURS.rule,
    borderWidth: 0.5,
  });
  drawLabel(page, "Description", LEFT + 14, tableTop - 3, fonts, { width: 190 });
  drawLabel(page, "Qty", 258, tableTop - 3, fonts, { width: 40, align: "right" });
  drawLabel(page, "Unit price", 314, tableTop - 3, fonts, { width: 66, align: "right" });
  drawLabel(page, "Discount", 394, tableTop - 3, fonts, { width: 54, align: "right" });
  drawLabel(page, "VAT", 462, tableTop - 3, fonts, { width: 34, align: "right" });
  drawLabel(page, "Amount", 506, tableTop - 3, fonts, { width: 47, align: "right" });

  const rowY = tableTop + 36;
  drawWrappedText(page, description, LEFT + 14, rowY, fonts, {
    size: 9,
    width: 185,
  });
  drawTextLine(page, "1.00", 258, rowY, fonts, { width: 40, align: "right", size: 9 });
  drawTextLine(page, formatMoney(standardNet), 314, rowY, fonts, { width: 66, align: "right", size: 9 });
  drawTextLine(page, "0.00%", 394, rowY, fonts, { width: 54, align: "right", size: 9 });
  drawTextLine(page, `${installer.vatRate.toFixed(0)}%`, 462, rowY, fonts, { width: 34, align: "right", size: 9 });
  drawTextLine(page, formatMoney(standardGross), 506, rowY, fonts, { width: 47, align: "right", size: 9 });

  const additionalRowY = rowY + 26;
  if (additionalGross > 0.01) {
    drawWrappedText(page, "Additional installation works", LEFT + 14, additionalRowY, fonts, {
      size: 9,
      width: 185,
    });
    drawTextLine(page, "1.00", 258, additionalRowY, fonts, { width: 40, align: "right", size: 9 });
    drawTextLine(page, formatMoney(additionalNet), 314, additionalRowY, fonts, { width: 66, align: "right", size: 9 });
    drawTextLine(page, "0.00%", 394, additionalRowY, fonts, { width: 54, align: "right", size: 9 });
    drawTextLine(page, `${installer.vatRate.toFixed(0)}%`, 462, additionalRowY, fonts, { width: 34, align: "right", size: 9 });
    drawTextLine(page, formatMoney(additionalGross), 506, additionalRowY, fonts, { width: 47, align: "right", size: 9 });
  }
  const tableBottomY = additionalGross > 0.01 ? additionalRowY + 35 : rowY + 35;
  drawRule(page, LEFT, tableBottomY, CONTENT_WIDTH);

  const installerNotes = formatNotes([
    workflow.additionalInstallationCostDetail,
    workflow.jumptech?.additionalInstallationCostDetail,
    workflow.installerNotes,
    workflow.installerEmail ? `Installer email: ${workflow.installerEmail}` : undefined,
    workflow.installerPhone ? `Installer phone: ${workflow.installerPhone}` : undefined,
  ]);

  if (installerNotes.length) {
    drawLabel(page, "Installation notes", LEFT + 14, tableBottomY + 23, fonts, { width: 180 });
    drawWrappedText(page, installerNotes.join("\n"), LEFT + 14, tableBottomY + 40, fonts, {
      color: PDF_COLOURS.muted,
      lineHeight: 11,
      maxLines: 8,
      size: 8.2,
      width: 238,
    });
  }

  const totalsX = 380;
  const totalsY = tableBottomY + 23;
  drawRectangle(page, totalsX - 12, totalsY - 18, 185, 102, {
    fillColor: PDF_COLOURS.white,
    borderColor: PDF_COLOURS.rule,
    borderWidth: 0.7,
  });
  drawMetaRow(page, "Subtotal", formatMoney(subtotalNet), totalsX, totalsY, fonts, 84, 72);
  drawMetaRow(page, `TOTAL VAT ${installer.vatRate.toFixed(0)}%`, formatMoney(vatAmount), totalsX, totalsY + 22, fonts, 84, 72);
  drawRule(page, totalsX, totalsY + 46, 145);
  drawTextLine(page, "TOTAL GBP", totalsX, totalsY + 60, fonts, {
    font: fonts.bold,
    size: 11,
    width: 84,
  });
  drawTextLine(page, formatMoney(grossAmount), totalsX + 84, totalsY + 60, fonts, {
    width: 72,
    align: "right",
    font: fonts.bold,
    size: 11,
  });

  drawRectangle(page, LEFT, 700, CONTENT_WIDTH, 54, {
    fillColor: PDF_COLOURS.panel,
    borderColor: PDF_COLOURS.rule,
    borderWidth: 0.5,
  });
  drawLabel(page, "Job reference", LEFT + 14, 716, fonts, { width: 120 });
  drawWrappedText(
    page,
    `VCHRGD order reference: ${workflow.sourcePaymentId}. Assigned installer: ${installer.legalName}. Please complete the works in line with the confirmed installation scope and submit completion evidence to VCHRGD.`,
    LEFT + 14,
    733,
    fonts,
    {
      color: PDF_COLOURS.muted,
      lineHeight: 10,
      size: 8,
      width: CONTENT_WIDTH - 28,
    },
  );

  drawRule(page, LEFT, 785, CONTENT_WIDTH);
  drawWrappedText(
    page,
    "Registered Office: VCHRGD Technologies Ltd, 1a Eghams Court, Boston Drive, Bourne End, Buckinghamshire, SL8 5YS, United Kingdom.",
    LEFT,
    800,
    fonts,
    {
      color: PDF_COLOURS.muted,
      lineHeight: 8,
      size: 6.6,
      width: CONTENT_WIDTH,
    },
  );

  return Buffer.from(await pdfDoc.save());
}

export type { WorkOrderRecord };
