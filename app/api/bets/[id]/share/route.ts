import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type BetShareRow = {
  id: string;
  user_id: string;
  public_share_enabled: boolean | null;
  public_share_token: string | null;
};

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(
    value
  );
}

function makeShareToken() {
  return randomBytes(24).toString("base64url");
}

function publicUrl(req: Request, token: string) {
  return new URL(`/shared/bets/${token}`, req.url).toString();
}

export async function POST(req: Request, context: RouteContext) {
  const user = await requireUser(req);

  if (!user.ok) {
    return json(user.status, { ok: false, error: user.error });
  }

  const { id } = await context.params;
  const betId = String(id ?? "").trim();

  if (!isUuid(betId)) {
    return json(400, { ok: false, error: "Invalid bet id" });
  }

  try {
    const admin = supabaseAdmin();
    const { data: betRow, error: betError } = await admin
      .from("bets")
      .select("id,user_id,public_share_enabled,public_share_token")
      .eq("id", betId)
      .maybeSingle<BetShareRow>();

    if (betError) {
      return json(500, { ok: false, error: betError.message });
    }

    if (!betRow) {
      return json(404, { ok: false, error: "Bet not found" });
    }

    if (String(betRow.user_id) !== user.userId) {
      return json(403, { ok: false, error: "Forbidden" });
    }

    if (betRow.public_share_enabled && betRow.public_share_token) {
      return json(200, {
        ok: true,
        betId: betRow.id,
        token: betRow.public_share_token,
        shareUrl: publicUrl(req, betRow.public_share_token),
        reused: true,
      });
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = makeShareToken();
      const { data, error } = await admin
        .from("bets")
        .update({
          public_share_enabled: true,
          public_share_token: token,
          public_share_created_at: new Date().toISOString(),
        })
        .eq("id", betId)
        .eq("user_id", user.userId)
        .select("id,public_share_token")
        .maybeSingle<{ id: string; public_share_token: string | null }>();

      if (!error && data?.public_share_token) {
        return json(200, {
          ok: true,
          betId: data.id,
          token: data.public_share_token,
          shareUrl: publicUrl(req, data.public_share_token),
          reused: false,
        });
      }

      if (!error || !String(error.message).toLowerCase().includes("duplicate")) {
        return json(500, {
          ok: false,
          error: error?.message ?? "Could not create share link",
        });
      }
    }

    return json(500, { ok: false, error: "Could not create unique share token" });
  } catch (error: unknown) {
    return json(500, {
      ok: false,
      error: error instanceof Error ? error.message : "Server error",
    });
  }
}
