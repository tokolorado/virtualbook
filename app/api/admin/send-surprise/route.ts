// app/api/admin/send-surprise/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return json(guard.status, { ok: false, error: guard.error });
  }

  try {
    const supabase = supabaseAdmin();
    const body = await req.json().catch(() => ({}));

    const email = String(body?.email ?? "").trim().toLowerCase();
    const message = String(body?.message ?? "").trim();

    if (!email) return json(400, { ok: false, error: "Brak email" });
    if (!message) return json(400, { ok: false, error: "Brak message" });

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("id,email")
      .eq("email", email)
      .maybeSingle();

    if (profileErr) {
      return json(500, { ok: false, error: profileErr.message });
    }

    if (!profile?.id) {
      return json(404, { ok: false, error: "Nie znaleziono użytkownika o takim emailu" });
    }

    const { error: upsertErr } = await supabase
      .from("user_surprises")
      .upsert(
        {
          user_id: profile.id,
          message,
          is_active: true,
          shown_at: null,
        },
        { onConflict: "user_id" }
      );

    if (upsertErr) {
      return json(500, { ok: false, error: upsertErr.message });
    }

    return json(200, {
      ok: true,
      userId: profile.id,
      email: profile.email,
      message,
    });
    } catch (e: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    },
    { status: 500 }
  );
}
}

export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return json(guard.status, { ok: false, error: guard.error });
  }

  return json(405, { ok: false, error: "Method Not Allowed" });
}