//app/admin/match-mapping/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Brak konfiguracji SUPABASE dla admin match mapping.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function safeNumber(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeString(value: FormDataEntryValue | null, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export async function assignMatchMapping(formData: FormData) {
  const matchId = safeNumber(formData.get("matchId"));
  const sofascoreEventId = safeNumber(formData.get("sofascoreEventId"));
  const confidence = safeNumber(formData.get("confidence")) ?? 1;
  const notes = safeString(formData.get("notes"), "manual review assign");
  const mappingMethod = safeString(formData.get("mappingMethod"), "manual");

  if (matchId === null || sofascoreEventId === null) {
    throw new Error("matchId albo sofascoreEventId są nieprawidłowe.");
  }

  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  const { error: upsertMapError } = await supabase
    .from("match_sofascore_map")
    .upsert(
      {
        match_id: matchId,
        sofascore_event_id: sofascoreEventId,
        mapping_method: mappingMethod,
        confidence,
        notes,
        widget_src: "admin-assign",
        updated_at: nowIso,
      },
      { onConflict: "match_id" }
    );

  if (upsertMapError) {
    throw new Error(
      `Nie udało się zapisać mapowania: ${upsertMapError.message}`
    );
  }

  const { error: updateQueueError } = await supabase
    .from("match_mapping_queue")
    .update({
      status: "mapped",
      attempts: 0,
      last_error: null,
      locked_at: null,
      locked_by: null,
      mapped_at: nowIso,
      updated_at: nowIso,
    })
    .eq("match_id", matchId);

  if (updateQueueError) {
    throw new Error(
      `Nie udało się zaktualizować kolejki: ${updateQueueError.message}`
    );
  }

  revalidatePath("/admin/match-mapping");
}

export async function moveBackToPending(formData: FormData) {
  const matchId = safeNumber(formData.get("matchId"));

  if (matchId === null) {
    throw new Error("Nieprawidłowy matchId.");
  }

  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from("match_mapping_queue")
    .update({
      status: "pending",
      locked_at: null,
      locked_by: null,
      updated_at: nowIso,
    })
    .eq("match_id", matchId);

  if (error) {
    throw new Error(`Nie udało się przywrócić do pending: ${error.message}`);
  }

  revalidatePath("/admin/match-mapping");
}