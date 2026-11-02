function withoutPreferredDatesPolicy(name, source) {
  name = name.replaceAll('\\', '/');
  source = require('./dno-source-guards.cjs').withoutDnoGate(name, source);
  source = source.replace(/\r\n/g, '\n').replace(/^import .* from "@\/lib\/preferred-installation-dates-policy";\n/gm, '');
  if(name === 'src/lib/post-survey-workflows.ts') source = source
    .replace('  preferredInstallationDatesEnabled?: boolean;\n', '')
    .replace(/    preferredInstallationDatesEnabled: existing\n[\s\S]*?        \),\n/, '')
    .replace('    if (!preferredDatesEnabledForWorkflow(workflow)) {\n      throw new Error("Preferred date selection is not available for this order.");\n    }\n', '');
  if(name === 'src/app/api/customer-installation-preferences/route.ts') source = source
    .replace('\n  if (!preferredDatesEnabledForWorkflow(workflow)) {\n    return NextResponse.json(\n      { error: "Your installation date will be arranged with the installation team." },\n      { status: 409 },\n    );\n  }\n', '');
  if(name === 'src/app/page.tsx') source = source
    .replace('import { getPostSurveyWorkflowByPaymentId } from "@/lib/post-survey-workflows";\n', '')
    .replace(/  const resumeWorkflow = resumePaymentSession\n[\s\S]*?: preferredDatesEnabledForNewOrder\(resumePaymentSession\?\.createdAt\);\n/, '')
    .replace('          preferredDatesEnabled={preferredDatesEnabled}\n', '');
  if(name === 'src/components/integration-showcase.tsx') source = source
    .replace('  preferredDatesEnabled = true,\n', '').replace('  preferredDatesEnabled?: boolean;\n', '')
    .replace('<JourneyInformation preferredDatesEnabled={preferredDatesEnabled} />','<JourneyInformation />')
    .replace(/function JourneyInformation\(\{ preferredDatesEnabled \}: \{ preferredDatesEnabled: boolean \}\) \{\n  const information = JOURNEY_INFORMATION.map\([\s\S]*?\n  \);\n/, 'function JourneyInformation() {\n')
    .replace('{information.map((item, index) => {','{JOURNEY_INFORMATION.map((item, index) => {');
  if(name === 'src/app/card/return/page.tsx') source = source.replace('preferredDateToken = preferredDatesEnabledForWorkflow(workflow) ? workflow.reviewToken : null;', 'preferredDateToken = workflow.reviewToken;');
  if(name === 'src/app/frasers-plus/return/page.tsx') source = source.replace('preferredDateToken={workflow && preferredDatesEnabledForWorkflow(workflow) ? workflow.reviewToken ?? null : null}', 'preferredDateToken={workflow?.reviewToken ?? null}');
  if(name === 'src/app/survey-review/[token]/page.tsx') source = source
    .replace('    preferredDatesEnabledForWorkflow(workflow) &&\n','')
    .replaceAll('preferredDatesEnabledForWorkflow(workflow) && workflow.preferredInstallationDates?.length','workflow.preferredInstallationDates?.length')
    .replace('{preferredDatesEnabledForWorkflow(workflow) ? <SummaryList','<SummaryList')
    .replace('/> : null}\n            {showCancellationConfirmation ? (','/>\n            {showCancellationConfirmation ? (');
  if(name === 'src/app/admin/page.tsx') source = source
    .replaceAll('preferredDatesEnabledForWorkflow(workflow) ? workflow.preferredInstallationDates?.join(" ") : undefined', 'workflow.preferredInstallationDates?.join(" ")')
    .replaceAll('preferredDatesEnabledForWorkflow(workflow) && workflow.preferredInstallationDates?.length', 'workflow.preferredInstallationDates?.length')
    .replace(') : preferredDatesEnabledForWorkflow(workflow) ? (\n              <FlatField\n                label="Preferred dates"', ') : (\n              <FlatField\n                label="Preferred dates"')
    .replace(') : <FlatField label="Installer" value={workflow.installerName || "Installer not assigned"} />}\n', ')}\n');
  return source;
}
module.exports = {withoutPreferredDatesPolicy};
