// lib/requireAdmin.ts
import { supabaseAdmin } from "@/lib/supabaseServer";

type RequireAdminResult =
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string };

export async function requireAdmin(req: Request): Promise<RequireAdminResult> {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";

    if (!token) {
      return { ok: false, status: 401, error: "Missing token" };
    }

    const supabase = supabaseAdmin();

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser(token);

    if (userErr || !user) {
      return { ok: false, status: 401, error: "Unauthorized" };
    }

    const { data: adminRow, error: adminErr } = await supabase
      .from("admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (adminErr) {
      return { ok: false, status: 500, error: adminErr.message };
    }

    if (!adminRow) {
      return { ok: false, status: 403, error: "Forbidden" };
    }

    return { ok: true, userId: user.id };
  } catch (e: unknown) {
    return {
      ok: false,
      status: 500,
      error: e instanceof Error ? e.message : "Admin auth failed",
    };
  }
}