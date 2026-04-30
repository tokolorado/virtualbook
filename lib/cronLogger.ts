// lib/cronLogger.ts
import { supabaseAdmin } from "@/lib/supabaseServer";

type CronLogInsertRow = {
  id: number;
};

export async function cronLogStart(job: string, source = "system"): Promise<number | null> {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("cron_logs")
    .insert({
      job_name: job,
      status: "started",
      source,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    console.error("cronLogStart error:", error);
    return null;
  }

  const row = data as CronLogInsertRow | null;
  return row?.id ?? null;
}

export async function cronLogSuccess(id: number | null, details?: unknown) {
  if (!id) return;

  const sb = supabaseAdmin();

  await sb
    .from("cron_logs")
    .update({
      status: "success",
      finished_at: new Date().toISOString(),
      details,
    })
    .eq("id", id);
}

export async function cronLogError(id: number | null, error: unknown) {
  if (!id) return;

  const sb = supabaseAdmin();
  const details =
    error instanceof Error
      ? { message: error.message }
      : typeof error === "object" && error !== null
        ? error
        : { message: String(error) };

  await sb
    .from("cron_logs")
    .update({
      status: "error",
      finished_at: new Date().toISOString(),
      details,
    })
    .eq("id", id);
}
