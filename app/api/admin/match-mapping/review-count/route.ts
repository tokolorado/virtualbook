//app/api/admin/match-mapping/review-count/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Brak konfiguracji SUPABASE dla review count.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function getBearerToken(req: Request) {
  const header = req.headers.get("authorization") || "";
  const [type, token] = header.split(" ");

  if (type?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();

    const { data: userData, error: userError } =
      await supabase.auth.getUser(token);

    const userId = userData?.user?.id;

    if (userError || !userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: adminRow, error: adminError } = await supabase
      .from("admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (adminError || !adminRow) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const nowIso = new Date().toISOString();
    const next120hIso = new Date(Date.now() + 120 * 60 * 60 * 1000).toISOString();

    const { count, error } = await supabase
      .from("match_mapping_queue")
      .select(
        `
          match_id,
          match:matches!inner (
            utc_date
          )
        `,
        { count: "exact", head: true }
      )
      .in("status", ["needs_review", "failed"])
      .gte("match.utc_date", nowIso)
      .lte("match.utc_date", next120hIso);

    if (error) {
      return NextResponse.json(
        { error: error.message, count: 0, hasReview: false },
        { status: 500 }
      );
    }

    const safeCount = count ?? 0;

    return NextResponse.json({
      count: safeCount,
      hasReview: safeCount > 0,
      window: "next_120h",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nie udało się pobrać review count.",
        count: 0,
        hasReview: false,
      },
      { status: 500 }
    );
  }
}