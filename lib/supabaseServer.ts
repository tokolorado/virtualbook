// /lib/supabaseServer.ts
import { createClient } from "@supabase/supabase-js";

function cleanEnv(value: string | undefined) {
  const trimmed = String(value ?? "").trim();
  return trimmed.length ? trimmed : undefined;
}

function normalizeSupabaseUrl(value: string | undefined) {
  const url = cleanEnv(value);
  if (!url) return undefined;

  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    throw new Error(
      "Invalid Supabase URL env: use project URL like https://PROJECT_REF.supabase.co, not a database connection string"
    );
  }

  if (!url.startsWith("https://") && !url.startsWith("http://")) {
    throw new Error(
      "Invalid Supabase URL env: missing https:// prefix"
    );
  }

  try {
    new URL(url);
  } catch {
    throw new Error("Invalid Supabase URL env: malformed URL");
  }

  return url.replace(/\/+$/, "");
}

// Backend ma używać tego samego project URL co frontend.
// SUPABASE_URL zostaje jako fallback, ale nie ma pierwszeństwa.
const SUPABASE_URL = normalizeSupabaseUrl(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
);

const SUPABASE_SERVICE_ROLE_KEY = cleanEnv(
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SUPABASE_ANON_KEY = cleanEnv(
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
);

export function supabaseAdmin() {
  if (!SUPABASE_URL) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL");
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function supabaseAuthVerifier() {
  if (!SUPABASE_URL) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL");
  }

  if (!SUPABASE_ANON_KEY) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY");
  }

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}