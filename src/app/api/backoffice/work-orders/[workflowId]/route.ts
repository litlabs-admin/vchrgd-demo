import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { getPostSurveyWorkflowById } from "@/lib/post-survey-workflows";
import { generateWorkOrderPdf, getOrCreateWorkOrder } from "@/lib/work-orders";

type WorkOrderRouteProps = {
  params: Promise<{
    workflowId: string;
  }>;
};

function safeFilename(value: string) {
  return value.replace(/[^A-Za-z0-9_-]+/g, "_");
}

export async function GET(request: Request, { params }: WorkOrderRouteProps) {
  const session = await getAdminSession();
  if (!session?.sub) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const { workflowId } = await params;
  const workflow = await getPostSurveyWorkflowById(workflowId);
  if (!workflow) {
    return NextResponse.json({ error: "Workflow not found." }, { status: 404 });
  }

  const url = new URL(request.url);
  const installerId = url.searchParams.get("installerId") || undefined;
  const workOrderNumber = url.searchParams.get("workOrderNumber") || undefined;

  try {
    const { record, installer } = await getOrCreateWorkOrder(
      workflow,
      installerId,
      workOrderNumber,
    );
    const pdf = await generateWorkOrderPdf({ workflow, installer, record });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeFilename(record.purchaseOrderNumber)}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to generate work order.",
      },
      { status: 400 },
    );
  }
}
