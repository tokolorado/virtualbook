// Retired: account discovery must never expose the Supabase admin user list.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { error: "This endpoint is no longer available." },
    { status: 410, headers: { "Cache-Control": "no-store" } }
  );
}
