import type { SurveyWorkflow, SurveyWorkflowStatus } from "@/lib/post-survey-workflows";

export function trackSurveyStage(
  workflow: SurveyWorkflow,
  previousStatus: SurveyWorkflowStatus | undefined,
  now = new Date().toISOString(),
) {
  const changed = previousStatus !== workflow.surveyStatus;
  const clock = workflow.stageClock;
  if (
    changed || !clock || clock.status !== workflow.surveyStatus ||
    !Number.isFinite(Date.parse(clock.enteredAt))
  ) {
    workflow.stageClock = {
      status: workflow.surveyStatus,
      enteredAt: now,
      source: changed ? "transition" : "first-observed",
    };
    return true;
  }
  return false;
}

// Legacy jobs have no transition clock. Only use their recorded milestones when
// an operator explicitly enables the historical backlog; never use updatedAt.
export function getSurveyStageEnteredAt(workflow: SurveyWorkflow, includeExisting: boolean) {
  const clock = workflow.stageClock;
  if (!clock || clock.status !== workflow.surveyStatus) return null;
  const observed = Date.parse(clock.enteredAt);
  if (!Number.isFinite(observed)) return null;
  if (!includeExisting || clock.source !== "first-observed") return observed;

  const milestones: Partial<Record<SurveyWorkflowStatus, string | undefined>> = {
    AWAITING_SURVEY: workflow.createdAt,
    SURVEY_RECEIVED: workflow.surveyReceivedAt,
    REVIEW_READY: workflow.surveyReviewedAt,
    BALANCE_PENDING: workflow.topUpRequestedAt || workflow.customerDecisionAt || workflow.surveyReviewedAt,
    READY_FOR_BOOKING: workflow.bookingApprovedAt,
  };
  const recorded = Date.parse(milestones[workflow.surveyStatus] || "");
  const created = Date.parse(workflow.createdAt);
  return Number.isFinite(recorded) && recorded >= created && recorded <= observed
    ? recorded : observed;
}
