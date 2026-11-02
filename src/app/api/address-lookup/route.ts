import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error: "Address lookup is no longer available in this checkout. Enter the address manually to continue.",
    },
    { status: 410 },
  );
}
