import { listCheckoutInteractions } from "@/lib/checkout-interactions";
import { listPaymentSessions } from "@/lib/frasers-plus-merchant-state";
import { releaseDedupeKey, tryReserveDedupeKey } from "@/lib/server-data";
import {
  buildJumptechCreateProjectRequest,
  createJumptechProject,
  findJumptechProjectByIntegrationId,
  getJumptechProject,
  isJumptechConfigured,
  updateJumptechProjectStatus,
} from "@/lib/jumptech";
import {
  attachJumptechProjectToWorkflow,
  findEligibleJumptechWorkflows,
  getPostSurveyWorkflowById,
  isWorkflowBooked,
  markJumptechQuoteApprovedOnWorkflow,
  recordJumptechProjectUpdate,
  recordJumptechProjectError,
  reserveJumptechProjectCreation,
  syncPostSurveyWorkflows,
  type SurveyWorkflow,
} from "@/lib/post-survey-workflows";

function isSuccessfulPayment(payment: {
  provider: string;
  cardProcessor?: string;
  latestStatus?: { status: string };
}) {
  const status = payment.latestStatus?.status;
  if (payment.provider === "CARD" && payment.cardProcessor === "REVOLUT") {
    return status === "COMPLETED";
  }

  return (
    status === "AUTHORISED" ||
    status === "AUTHORIZED" ||
    status === "APPROVED" ||
    status === "COMPLETED"
  );
}

function isOriginalWorkflowPayment(workflow: SurveyWorkflow, paymentId: string) {
  return (
    workflow.sourcePaymentId === paymentId &&
    workflow.currentPaymentId === paymentId &&
    workflow.topUpPaymentId !== paymentId &&
    workflow.replacementPaymentId !== paymentId
  );
}

async function createJumptechProjectForWorkflow(workflow: SurveyWorkflow) {
  let creationDedupeKey: string | null = null;

  try {
    const latestWorkflow = await getPostSurveyWorkflowById(workflow.id);
    if (latestWorkflow?.jumptech?.projectId) {
      return;
    }

    if (latestWorkflow?.jumptech?.lastError === "Jumptech project creation is in progress.") {
      return;
    }

    const payload = buildJumptechCreateProjectRequest(latestWorkflow ?? workflow);
    creationDedupeKey = payload.integrationId;
    const installationAddress = payload.address[0];
    if (!installationAddress?.line1 || !installationAddress.postCode) {
      await recordJumptechProjectError(
        workflow.id,
        "jumptech",
        "Jumptech project was not created because the installation address or postcode is missing.",
      );
      return;
    }

    const existing = await findJumptechProjectByIntegrationId(payload.integrationId);
    if (existing.response.ok && existing.project?.projectId) {
      const retrieved = await getJumptechProject(existing.project.projectId);
      const snapshot = retrieved.snapshot;
      await attachJumptechProjectToWorkflow(workflow.id, "jumptech", {
        projectId: existing.project.projectId,
        integrationName: payload.integrationName,
        integrationId: payload.integrationId,
        projectType: snapshot?.projectType ?? existing.project.projectType ?? payload.projectType,
        status: snapshot?.status ?? existing.project.status,
        currentStatusLabel: snapshot?.currentStatusLabel ?? existing.project.currentStatusLabel,
        currentStatusDetail: snapshot?.currentStatusDetail ?? existing.project.currentStatusDetail,
        externalOwnerId: snapshot?.externalOwnerId,
        jobs: snapshot?.jobs ?? existing.project.jobs,
        quoteTotal: snapshot?.quoteTotal,
        additionalInstallationCosts: snapshot?.additionalInstallationCosts,
        additionalInstallationCostDetail: snapshot?.additionalInstallationCostDetail,
        createdAt: new Date().toISOString(),
        lastSyncedAt: snapshot?.lastSyncedAt ?? existing.project.lastSyncedAt ?? new Date().toISOString(),
      });
      return;
    }

    const reservedCreate = await tryReserveDedupeKey(
      "jumptech-project-create",
      creationDedupeKey,
    );

    if (!reservedCreate) {
      return;
    }

    await reserveJumptechProjectCreation(workflow.id, "jumptech");
    const created = await createJumptechProject(workflow);
    if (!created.response.ok || !created.projectId) {
      await recordJumptechProjectError(
        workflow.id,
        "jumptech",
        created.response.ok
          ? "Jumptech did not return a project identifier."
          : `Jumptech project creation failed with ${created.response.status}.`,
      );
      await releaseDedupeKey("jumptech-project-create", creationDedupeKey);
      return;
    }

    const retrieved = await getJumptechProject(created.projectId);
    await attachJumptechProjectToWorkflow(workflow.id, "jumptech", {
      projectId: created.projectId,
      integrationName: created.integrationName,
      integrationId: created.integrationId,
      projectType: created.projectType,
      applicationId: retrieved.snapshot?.applicationId,
      status: retrieved.snapshot?.status,
      currentStatusLabel: retrieved.snapshot?.currentStatusLabel,
      currentStatusDetail: retrieved.snapshot?.currentStatusDetail,
      externalOwnerId: retrieved.snapshot?.externalOwnerId,
      jobs: retrieved.snapshot?.jobs,
      quoteTotal: retrieved.snapshot?.quoteTotal,
      additionalInstallationCosts: retrieved.snapshot?.additionalInstallationCosts,
      additionalInstallationCostDetail: retrieved.snapshot?.additionalInstallationCostDetail,
      completedAt: retrieved.snapshot?.completedAt,
      createdAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (creationDedupeKey) {
      await releaseDedupeKey("jumptech-project-create", creationDedupeKey);
    }
    await recordJumptechProjectError(
      workflow.id,
      "jumptech",
      error instanceof Error ? error.message : "Jumptech project creation failed.",
    );
  }
}

export async function syncWorkflowStateFromCurrentData(): Promise<SurveyWorkflow[]> {
  const payments = await listPaymentSessions();
  const interactions = await listCheckoutInteractions();
  return await syncPostSurveyWorkflows(payments, interactions);
}

export async function ensureJumptechProjectForOriginalPayment(
  paymentId: string,
): Promise<SurveyWorkflow[]> {
  const payments = await listPaymentSessions();
  const interactions = await listCheckoutInteractions();
  const workflows = await syncPostSurveyWorkflows(payments, interactions);
  const payment = payments.find((entry) => entry.paymentId === paymentId);

  if (!isJumptechConfigured() || !payment || !isSuccessfulPayment(payment)) {
    return workflows;
  }

  const workflow = findEligibleJumptechWorkflows(workflows).find((entry) =>
    isOriginalWorkflowPayment(entry, paymentId),
  );

  if (!workflow) {
    return workflows;
  }

  await createJumptechProjectForWorkflow(workflow);
  return await syncWorkflowStateFromCurrentData();
}

export async function markJumptechQuoteApprovedForWorkflow(
  workflowId: string,
  actor = "system",
) {
  const workflow = await getPostSurveyWorkflowById(workflowId);
  if (!workflow?.jumptech?.projectId || !isJumptechConfigured()) {
    return;
  }

  // A late balance payment must not move a scheduled/installed project backwards.
  if (isWorkflowBooked(workflow) || workflow.surveyStatus === "DECLINED") {
    return;
  }

  if (
    workflow.jumptech.status === "QUOTE APPROVED" ||
    workflow.jumptech.currentStatusLabel === "QUOTE APPROVED"
  ) {
    return;
  }

  const reserved = await tryReserveDedupeKey(
    "jumptech-quote-approval",
    workflow.jumptech.projectId,
  );

  if (!reserved) {
    return;
  }

  const detail =
    "Customer paid the amended balance through the portal; quote approved for booking.";
  const result = await updateJumptechProjectStatus(
    workflow.jumptech.projectId,
    "QUOTE APPROVED",
  );

  if (!result.response.ok) {
    await releaseDedupeKey("jumptech-quote-approval", workflow.jumptech.projectId);
    await recordJumptechProjectError(
      workflow.id,
      actor,
      `Jumptech quote approval update failed with ${result.response.status}.`,
    );
    return;
  }

  await markJumptechQuoteApprovedOnWorkflow(workflow.id, actor, detail);
}

export async function syncJumptechProjectDetails(
  projectId: string,
  actor = "jumptech",
): Promise<SurveyWorkflow | null> {
  if (!projectId || !isJumptechConfigured()) {
    return null;
  }

  const result = await getJumptechProject(projectId);
  if (!result.snapshot) {
    return null;
  }

  return await recordJumptechProjectUpdate(projectId, actor, {
    applicationId: result.snapshot.applicationId,
    projectType: result.snapshot.projectType,
    status: result.snapshot.status,
    currentStatusLabel: result.snapshot.currentStatusLabel,
    currentStatusDetail: result.snapshot.currentStatusDetail,
    externalOwnerId: result.snapshot.externalOwnerId,
    jobs: result.snapshot.jobs,
    completedAt: result.snapshot.completedAt,
    quoteTotal: result.snapshot.quoteTotal,
    additionalInstallationCosts: result.snapshot.additionalInstallationCosts,
    additionalInstallationCostDetail: result.snapshot.additionalInstallationCostDetail,
    lastSyncedAt: new Date().toISOString(),
  });
}

export async function ensureJumptechProjectsForEligibleWorkflows(): Promise<SurveyWorkflow[]> {
  const payments = await listPaymentSessions();
  const interactions = await listCheckoutInteractions();
  const workflows = await syncPostSurveyWorkflows(payments, interactions);
  const paymentById = new Map(payments.map((payment) => [payment.paymentId, payment]));

  if (!isJumptechConfigured()) {
    return workflows;
  }

  for (const workflow of findEligibleJumptechWorkflows(workflows)) {
    const activePayment =
      paymentById.get(workflow.currentPaymentId) ??
      paymentById.get(workflow.sourcePaymentId);

    if (
      !activePayment ||
      (activePayment.provider !== "CARD" &&
        activePayment.provider !== "FRASERS_PLUS")
    ) {
      continue;
    }

    if (!isSuccessfulPayment(activePayment)) {
      continue;
    }

    await createJumptechProjectForWorkflow(workflow);
  }

  return await syncWorkflowStateFromCurrentData();
}
