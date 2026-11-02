type PreferredDatesWorkflow = { preferredInstallationDatesEnabled?: boolean };

export function preferredDatesEnabledForNewOrder(createdAt = new Date().toISOString()) {
  const cutoff = Date.parse(process.env.PREFERRED_INSTALLATION_DATES_DISABLED_FROM || "");
  const created = Date.parse(createdAt);
  // An absent flag or an unknown legacy timestamp must not change existing promises.
  return !Number.isFinite(cutoff) || !Number.isFinite(created) || created < cutoff;
}

export function preferredDatesEnabledForWorkflow(workflow: PreferredDatesWorkflow) {
  // Missing means legacy. Never reclassify an existing order when a flag changes.
  return workflow.preferredInstallationDatesEnabled !== false;
}
