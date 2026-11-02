"use client";

import type { FormEvent } from "react";

type DeleteWorkflowButtonProps = {
  workflowId: string;
  returnTo: string;
  label?: string;
  reference?: string;
};

export function DeleteWorkflowButton({
  workflowId,
  returnTo,
  label = "Delete from back office",
  reference,
}: DeleteWorkflowButtonProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    const target = reference || "this project";
    if (
      !window.confirm(
        `Remove ${target} from the back office? This will remove its workflow, tracking, payment-session summary, and generated PO record from these views. Provider records in Square, Jumptech, and audit history are not deleted.`,
      )
    ) {
      event.preventDefault();
    }
  };

  return (
    <form action="/api/backoffice/post-survey" method="post" onSubmit={handleSubmit}>
      <input type="hidden" name="workflowId" value={workflowId} />
      <input type="hidden" name="action" value="delete-workflow" />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button
        type="submit"
        className="inline-flex min-h-11 items-center justify-center rounded-full border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-100 active:scale-[0.98]"
      >
        {label}
      </button>
    </form>
  );
}
