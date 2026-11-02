import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getJsonFileVersion } from "@/lib/server-data";

const STATE_FILES = [
  "post-survey-workflows.json",
  "merchant-state.json",
  "checkout-interactions.json",
] as const;

function buildVersion(payload: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

export async function GET() {
  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stateVersions = await Promise.all(
    STATE_FILES.map(async (file) => [file, await getJsonFileVersion(file)]),
  );

  return NextResponse.json(
    {
      version: buildVersion(stateVersions),
      checkedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
