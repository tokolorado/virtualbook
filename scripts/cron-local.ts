// scripts/cron-local.ts
// Uruchamiasz: npm run cron:local
// Wymaga: CRON_SECRET w .env.local (i Next dev na localhost:3000)

type Json = any;

const BASE = process.env.CRON_BASE_URL || "http://localhost:3000";
const SECRET = process.env.CRON_SECRET || "";

// interwały
const INTERVAL_MS = Number(process.env.CRON_INTERVAL_MS || 5 * 60 * 1000); // 5 min
const RANGE_EVERY_N_TICKS = Number(process.env.CRON_RANGE_EVERY_N_TICKS || 12); // co 12 ticków ~ 60 min (przy 5 min)

// limity
const STALE_LIMIT = Number(process.env.CRON_STALE_LIMIT || 10);
const RANGE_LIMIT = Number(process.env.CRON_RANGE_LIMIT || 200);

// ile dni wstecz ma obejmować range (1 => wczoraj+dzisiaj)
const RANGE_DAYS_BACK = Number(process.env.CRON_RANGE_DAYS_BACK || 1);

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// YYYY-MM-DD w UTC
function utcYmd(d: Date) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function addDaysUTC(d: Date, days: number) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

async function post(path: string): Promise<Json> {
  const url = `${BASE}${path}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(SECRET ? { "x-cron-secret": SECRET } : {}),
    },
    body: JSON.stringify({}),
  });

  const text = await r.text();
  let j: any = null;
  try {
    j = JSON.parse(text);
  } catch {
    j = { raw: text?.slice(0, 500) };
  }

  if (!r.ok) {
    throw new Error(`[${r.status}] ${path} -> ${JSON.stringify(j)}`);
  }
  return j;
}

async function tick(tickNo: number) {
    
  // 1) stale-timed (często)
  const stale = await post(`/api/cron/results?limit=${STALE_LIMIT}`);
  console.log("[CRON] results stale-timed -> OK", stale);

  // 2) range (rzadziej, np. co godzinę)
  if (tickNo % RANGE_EVERY_N_TICKS === 0) {
    
    const today = new Date();
    const dateTo = utcYmd(today);
    const dateFrom = utcYmd(addDaysUTC(today, -RANGE_DAYS_BACK));

    const range = await post(
      `/api/cron/results?mode=range&dateFrom=${encodeURIComponent(
        dateFrom
      )}&dateTo=${encodeURIComponent(dateTo)}&limit=${RANGE_LIMIT}`
    );

    console.log("[CRON] results range -> OK", range);
  }

// 2.5) odds (po aktualizacji meczów)
  const odds = await post(`/api/odds/sync`);
  console.log("[CRON] odds -> OK", odds);

  // 3) settle (po aktualizacji wyników)
  const settle = await post(`/api/cron/settle`);
  console.log("[CRON] settle -> OK", settle);
}

async function main() {
  console.log(`[CRON] starting locally: ${BASE}`);
  console.log(
    `[CRON] interval=${INTERVAL_MS}ms staleLimit=${STALE_LIMIT} rangeEveryTicks=${RANGE_EVERY_N_TICKS} rangeDaysBack=${RANGE_DAYS_BACK}`
  );

  let tickNo = 1;

  // pierwsze odpalenie od razu
  try {
    await tick(tickNo);
  } catch (e: any) {
    console.error("[CRON] tick error:", e?.message || e);
  }

  tickNo++;

  setInterval(async () => {
    try {
      await tick(tickNo);
    } catch (e: any) {
      console.error("[CRON] tick error:", e?.message || e);
    } finally {
      tickNo++;
    }
  }, INTERVAL_MS);
}

main().catch((e) => {
  console.error("[CRON] fatal:", e?.message || e);
  process.exit(1);
});