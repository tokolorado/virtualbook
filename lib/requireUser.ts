import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

type RequireUserOk = {
  ok: true;
  userId: string;
  jwt: string;
  supabase: SupabaseClient;
  profile: {
    id: string;
    is_banned: boolean;
  };
};

type RequireUserFail = {
  ok: false;
  status: number;
  error: string;
};

export type RequireUserResult = RequireUserOk | RequireUserFail;

export async function requireUser(req: Request): Promise<RequireUserResult> {
  const authHeader = req.headers.get("authorization") || "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!jwt) {
    return {
      ok: false,
      status: 401,
      error: "Brak autoryzacji.",
    };
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      },
    }
  );

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user?.id) {
    return {
      ok: false,
      status: 401,
      error: "Nieprawidłowa sesja.",
    };
  }

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("id,is_banned")
    .eq("id", user.id)
    .maybeSingle();

  if (profileErr) {
    return {
      ok: false,
      status: 500,
      error: profileErr.message,
    };
  }

  if (!profile) {
    return {
      ok: false,
      status: 404,
      error: "Nie znaleziono profilu użytkownika.",
    };
  }

  if (profile.is_banned) {
    return {
      ok: false,
      status: 403,
      error: "Twoje konto zostało zablokowane.",
    };
  }

  return {
    ok: true,
    userId: user.id,
    jwt,
    supabase,
    profile: {
      id: profile.id,
      is_banned: Boolean(profile.is_banned),
    },
  };
}