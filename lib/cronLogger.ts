import { supabaseAdmin } from "@/lib/supabaseServer";

export async function cronLogStart(job: string, source = "system") {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("cron_logs")
    .insert({
      job_name: job,
      status: "started",
      source,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error("cronLogStart error:", error);
    return null;
  }

  return data.id as number;
}

export async function cronLogSuccess(id: number | null, details?: any) {
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

export async function cronLogError(id: number | null, error: any) {
  if (!id) return;

  const sb = supabaseAdmin();

  await sb
    .from("cron_logs")
    .update({
      status: "error",
      finished_at: new Date().toISOString(),
      details: { message: String(error) },
    })
    .eq("id", id);
}