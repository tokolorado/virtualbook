//app/api/admin/users/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

type AuthAdminUserLite = {
  id: string;
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
};

async function writeAdminAudit(args: {
  adminUserId: string;
  action: string;
  targetUserId?: string | null;
  details?: any;
}) {
  const supabase = supabaseAdmin();

  await supabase.from("admin_audit_logs").insert({
    admin_user_id: args.adminUserId,
    action: args.action,
    target_user_id: args.targetUserId ?? null,
    details: args.details ?? {},
  });
}

export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return json(guard.status, { ok: false, error: guard.error });
  }

  try {
    const supabase = supabaseAdmin();

    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select(`
        id,
        username,
        email,
        balance_vb,
        is_banned,
        email_confirmation_sent_at,
        email_confirmed_at
      `)
      .order("id", { ascending: true });

    if (profilesError) {
      return json(500, { ok: false, error: profilesError.message });
    }

    const authListResult = await supabase.auth.admin.listUsers();

    if (authListResult.error) {
      return json(500, { ok: false, error: authListResult.error.message });
    }

    const authUsersRaw = authListResult.data?.users ?? [];

    const authUsers: AuthAdminUserLite[] = authUsersRaw.map((u: any) => ({
      id: String(u.id),
      email: u.email ?? null,
      created_at: u.created_at ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null,
      email_confirmed_at: u.email_confirmed_at ?? null,
    }));

    const authUsersById = new Map<string, AuthAdminUserLite>(
      authUsers.map((u) => [u.id, u])
    );

    const profileIds = (profiles ?? []).map((p: any) => p.id).filter(Boolean);

    const betsCountByUser = new Map<string, number>();
    const leaderboardByUser = new Map<
      string,
      {
        profit: number;
        roi: number;
        winrate: number;
        bets_count: number;
        won_bets: number;
        lost_bets: number;
        void_bets: number;
      }
    >();

    if (profileIds.length > 0) {
      const { data: betsAgg, error: betsAggError } = await supabase
        .from("bets")
        .select("user_id")
        .in("user_id", profileIds);

      if (betsAggError) {
        return json(500, { ok: false, error: betsAggError.message });
      }

      const { data: leaderboardRows, error: leaderboardError } = await supabase
        .from("leaderboard_global")
        .select("id, profit, roi, winrate, bets_count, won_bets, lost_bets, void_bets")
        .in("id", profileIds);

      if (leaderboardError) {
        return json(500, { ok: false, error: leaderboardError.message });
      }

      for (const row of betsAgg ?? []) {
        const uid = String((row as any).user_id ?? "");
        if (!uid) continue;
        betsCountByUser.set(uid, (betsCountByUser.get(uid) ?? 0) + 1);
      }

      for (const row of leaderboardRows ?? []) {
        const id = String((row as any).id ?? "");
        if (!id) continue;

        leaderboardByUser.set(id, {
          profit: Number((row as any).profit ?? 0),
          roi: Number((row as any).roi ?? 0),
          winrate: Number((row as any).winrate ?? 0),
          bets_count: Number((row as any).bets_count ?? 0),
          won_bets: Number((row as any).won_bets ?? 0),
          lost_bets: Number((row as any).lost_bets ?? 0),
          void_bets: Number((row as any).void_bets ?? 0),
        });
      }
    }

    const users = (profiles ?? []).map((p: any) => {
      const authRow = authUsersById.get(String(p.id));
      const lb = leaderboardByUser.get(String(p.id));

      const sentAt =
        p.email_confirmation_sent_at ??
        authRow?.created_at ??
        null;

      const confirmedAt =
        p.email_confirmed_at ??
        authRow?.email_confirmed_at ??
        null;

      return {
        id: p.id,
        username: p.username ?? null,
        email: p.email ?? authRow?.email ?? null,
        balance_vb: Number(p.balance_vb ?? 0),
        is_banned: Boolean(p.is_banned ?? false),

        email_confirmation_sent_at: sentAt,
        email_confirmed_at: confirmedAt,
        email_status: confirmedAt ? "mail confirmed" : "confirmation mail sent",

        created_at: authRow?.created_at ?? null,
        last_sign_in_at: authRow?.last_sign_in_at ?? null,

        bets_count: lb?.bets_count ?? betsCountByUser.get(String(p.id)) ?? 0,
        won_bets: lb?.won_bets ?? 0,
        lost_bets: lb?.lost_bets ?? 0,
        void_bets: lb?.void_bets ?? 0,
        profit: lb?.profit ?? 0,
        roi: lb?.roi ?? 0,
        winrate: lb?.winrate ?? 0,
      };
    });

    await writeAdminAudit({
      adminUserId: guard.userId,
      action: "ADMIN_USERS_LIST_VIEW",
      details: { count: users.length },
    });

    return json(200, {
      ok: true,
      users,
    });
  } catch (e: any) {
    return json(500, {
      ok: false,
      error: e?.message ?? "Server error",
    });
  }
}

export async function POST(req: Request) {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return json(guard.status, { ok: false, error: guard.error });
  }

  try {
    const body = await req.json().catch(() => null);

    const action = String(body?.action ?? "").trim();
    const targetUserId = String(body?.targetUserId ?? "").trim();

    if (!action) {
      return json(400, { ok: false, error: "Brak action." });
    }

    if (!targetUserId) {
      return json(400, { ok: false, error: "Brak targetUserId." });
    }

    if (targetUserId === guard.userId && (action === "delete_user" || action === "ban_user")) {
      return json(400, { ok: false, error: "Nie możesz wykonać tej akcji na sobie." });
    }

    const supabase = supabaseAdmin();

    if (action === "add_vb") {
      const amount = Number(String(body?.amount ?? "").replace(",", "."));

      if (!Number.isFinite(amount) || amount <= 0) {
        return json(400, { ok: false, error: "Nieprawidłowa kwota." });
      }

      const { error } = await supabase.rpc("apply_vb_transaction", {
        p_user_id: targetUserId,
        p_amount: amount,
        p_kind: "MANUAL_RECONCILIATION",
        p_ref_type: "admin",
        p_ref_id: guard.userId,
      });

      if (error) {
        return json(500, { ok: false, error: error.message });
      }

      await writeAdminAudit({
        adminUserId: guard.userId,
        action: "ADMIN_ADD_VB",
        targetUserId,
        details: { amount },
      });

      return json(200, { ok: true });
    }

    if (action === "reset_balance") {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("balance_vb")
        .eq("id", targetUserId)
        .maybeSingle();

      if (profileError) {
        return json(500, { ok: false, error: profileError.message });
      }

      if (!profile) {
        return json(404, { ok: false, error: "Nie znaleziono profilu." });
      }

      const currentBalance = Number((profile as any).balance_vb ?? 0);

      if (currentBalance !== 0) {
        const { error } = await supabase.rpc("apply_vb_transaction", {
          p_user_id: targetUserId,
          p_amount: -currentBalance,
          p_kind: "MANUAL_RECONCILIATION",
          p_ref_type: "admin_reset",
          p_ref_id: guard.userId,
        });

        if (error) {
          return json(500, { ok: false, error: error.message });
        }
      }

      await writeAdminAudit({
        adminUserId: guard.userId,
        action: "ADMIN_RESET_BALANCE",
        targetUserId,
        details: { previousBalance: currentBalance },
      });

      return json(200, { ok: true });
    }

    if (action === "ban_user") {
      const { error } = await supabase
        .from("profiles")
        .update({ is_banned: true })
        .eq("id", targetUserId);

      if (error) {
        return json(500, { ok: false, error: error.message });
      }

      await writeAdminAudit({
        adminUserId: guard.userId,
        action: "ADMIN_BAN_USER",
        targetUserId,
      });

      return json(200, { ok: true });
    }

    if (action === "unban_user") {
      const { error } = await supabase
        .from("profiles")
        .update({ is_banned: false })
        .eq("id", targetUserId);

      if (error) {
        return json(500, { ok: false, error: error.message });
      }

      await writeAdminAudit({
        adminUserId: guard.userId,
        action: "ADMIN_UNBAN_USER",
        targetUserId,
      });

      return json(200, { ok: true });
    }

    if (action === "delete_user") {
  await writeAdminAudit({
    adminUserId: guard.userId,
    action: "ADMIN_DELETE_USER_BLOCKED",
    targetUserId,
    details: {
      reason: "hard_delete_disabled_non_transactional",
    },
  });

  return json(409, {
    ok: false,
    error:
      "Hard delete użytkownika jest tymczasowo wyłączony. Najpierw wdrożymy bezpieczne, transakcyjne RPC do archiwizacji lub usuwania konta.",
  });
}

    return json(400, { ok: false, error: "Nieobsługiwana akcja." });
  } catch (e: any) {
    return json(500, {
      ok: false,
      error: e?.message ?? "Server error",
    });
  }
}