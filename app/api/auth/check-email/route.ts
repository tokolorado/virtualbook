// app/api/auth/check-email/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawEmail = searchParams.get("email") ?? "";
  const email = normalizeEmail(rawEmail);

  if (!email || !isValidEmail(email)) {
    return NextResponse.json(
      { exists: false, confirmed: false, error: "Invalid email" },
      { status: 400 }
    );
  }

  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { exists: false, confirmed: false, error: "Missing env" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      return NextResponse.json(
        { exists: false, confirmed: false, error: error.message },
        { status: 500 }
      );
    }

    const users = data?.users ?? [];
    const found = users.find(
      (u) => String(u.email ?? "").trim().toLowerCase() === email
    );

    if (found) {
      return NextResponse.json({
        exists: true,
        confirmed: !!found.email_confirmed_at,
        email: found.email ?? null,
      });
    }

    if (users.length < perPage) break;
    page += 1;
  }

  return NextResponse.json({
    exists: false,
    confirmed: false,
    email: null,
  });
}