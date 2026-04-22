import type { SupabaseClient } from "@supabase/supabase-js";

export type CheckSeverity = "info" | "warning" | "critical";

export type SystemCheckResult = {
  checkKey: string;
  severity: CheckSeverity;
  ok: boolean;
  rowsCount: number;
  sample: unknown[];
  details?: Record<string, unknown>;
};

export type SystemCheck = {
  key: string;
  severity: CheckSeverity;
  run: (sb: SupabaseClient) => Promise<SystemCheckResult>;
};

async function runRowsCheck(
  sb: SupabaseClient,
  sql: string,
  checkKey: string,
  severity: CheckSeverity,
  sampleLimit = 20
): Promise<SystemCheckResult> {
  const { data, error } = await sb.rpc("run_sql_json", { p_sql: sql });

  if (error) {
    return {
      checkKey,
      severity,
      ok: false,
      rowsCount: 0,
      sample: [],
      details: { error: error.message },
    };
  }

  const rows = Array.isArray(data) ? data : [];
  return {
    checkKey,
    severity,
    ok: rows.length === 0,
    rowsCount: rows.length,
    sample: rows.slice(0, sampleLimit),
  };
}

/**
 * UWAGA:
 * ten plik zakłada istnienie helpera SQL typu run_sql_json(sql text) -> jsonb.
 * Jeśli go nie masz, checki trzeba puścić przez zwykłe route-level query na znanych tabelach.
 * Jeśli chcesz, dam Ci potem bezpośrednią wersję bez RPC helpera.
 */

export const systemChecks: SystemCheck[] = [
  {
    key: "wallet_balance_vs_latest_ledger",
    severity: "critical",
    run: (sb) =>
      runRowsCheck(
        sb,
        `
        with last_ledger as (
          select distinct on (l.user_id)
            l.user_id,
            l.balance_after,
            l.created_at,
            l.id
          from public.vb_ledger l
          order by l.user_id, l.created_at desc, l.id desc
        )
        select
          p.id as user_id,
          p.balance_vb as profile_balance,
          ll.balance_after as ledger_balance_after,
          round(coalesce(p.balance_vb, 0) - coalesce(ll.balance_after, 0), 2) as diff
        from public.profiles p
        left join last_ledger ll
          on ll.user_id = p.id
        where round(coalesce(p.balance_vb, 0) - coalesce(ll.balance_after, 0), 2) <> 0
        order by abs(coalesce(p.balance_vb, 0) - coalesce(ll.balance_after, 0)) desc
        `,
        "wallet_balance_vs_latest_ledger",
        "critical"
      ),
  },
  {
    key: "duplicate_bet_payout_or_refund",
    severity: "critical",
    run: (sb) =>
      runRowsCheck(
        sb,
        `
        select
          l.ref_id as bet_id,
          l.kind,
          count(*) as rows_count,
          sum(l.amount) as amount_sum
        from public.vb_ledger l
        where l.ref_type = 'bet'
          and l.kind in ('BET_PAYOUT', 'BET_REFUND')
        group by l.ref_id, l.kind
        having count(*) > 1
        order by count(*) desc, l.ref_id
        `,
        "duplicate_bet_payout_or_refund",
        "critical"
      ),
  },
  {
    key: "unsettled_bets_with_payout_or_refund",
    severity: "critical",
    run: (sb) =>
      runRowsCheck(
        sb,
        `
        select
          b.id as bet_id,
          b.user_id,
          b.status,
          b.settled,
          count(*) filter (where l.kind = 'BET_PAYOUT') as payout_rows,
          count(*) filter (where l.kind = 'BET_REFUND') as refund_rows,
          sum(case when l.kind = 'BET_PAYOUT' then l.amount else 0 end) as payout_sum,
          sum(case when l.kind = 'BET_REFUND' then l.amount else 0 end) as refund_sum
        from public.bets b
        join public.vb_ledger l
          on l.ref_type = 'bet'
         and l.ref_id = b.id::text
        where b.settled = false
          and l.kind in ('BET_PAYOUT', 'BET_REFUND')
        group by b.id, b.user_id, b.status, b.settled
        order by b.created_at desc
        `,
        "unsettled_bets_with_payout_or_refund",
        "critical"
      ),
  },
  {
    key: "duplicate_bet_items",
    severity: "critical",
    run: (sb) =>
      runRowsCheck(
        sb,
        `
        select
          bi.bet_id,
          bi.match_id_bigint,
          bi.market,
          bi.pick,
          count(*) as dup_count
        from public.bet_items bi
        group by
          bi.bet_id,
          bi.match_id_bigint,
          bi.market,
          bi.pick
        having count(*) > 1
        order by dup_count desc, bi.bet_id
        `,
        "duplicate_bet_items",
        "critical"
      ),
  },
  {
    key: "resolved_items_but_unsettled_bet",
    severity: "warning",
    run: (sb) =>
      runRowsCheck(
        sb,
        `
        with item_status as (
          select
            bi.bet_id,
            count(*) as items_total,
            count(*) filter (
              where bi.settled = true
                and lower(coalesce(bi.result, '')) in ('won', 'lost', 'void')
            ) as items_resolved
          from public.bet_items bi
          group by bi.bet_id
        )
        select
          b.id,
          b.status,
          b.settled,
          i.items_total,
          i.items_resolved
        from public.bets b
        join item_status i
          on i.bet_id = b.id
        where b.settled = false
          and i.items_total > 0
          and i.items_total = i.items_resolved
        order by b.created_at desc
        `,
        "resolved_items_but_unsettled_bet",
        "warning"
      ),
  },
  {
    key: "bet_total_odds_mismatch",
    severity: "warning",
    run: (sb) =>
      runRowsCheck(
        sb,
        `
        with item_prod as (
          select
            bi.bet_id,
            round(exp(sum(ln(bi.odds::float8)))::numeric, 2) as item_total_odds
          from public.bet_items bi
          group by bi.bet_id
        )
        select
          b.id as bet_id,
          b.total_odds as bet_total_odds,
          i.item_total_odds,
          round(coalesce(b.total_odds, 0) - coalesce(i.item_total_odds, 0), 2) as diff
        from public.bets b
        join item_prod i
          on i.bet_id = b.id
        where round(coalesce(b.total_odds, 0) - coalesce(i.item_total_odds, 0), 2) <> 0
        order by b.created_at desc
        `,
        "bet_total_odds_mismatch",
        "warning"
      ),
  },
  {
    key: "failed_match_settlements",
    severity: "warning",
    run: (sb) =>
      runRowsCheck(
        sb,
        `
        select
          ms.match_id,
          ms.status,
          ms.started_at,
          ms.finished_at,
          ms.error
        from public.match_settlements ms
        where ms.status = 'failed'
        order by ms.started_at desc
        `,
        "failed_match_settlements",
        "warning"
      ),
  },
];