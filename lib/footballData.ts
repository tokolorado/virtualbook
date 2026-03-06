export async function fetchMatchesByDate(dateISO: string) {
  // dateISO: YYYY-MM-DD
  const url = new URL("https://api.football-data.org/v4/matches");
  url.searchParams.set("dateFrom", dateISO);
  url.searchParams.set("dateTo", dateISO);

  const res = await fetch(url.toString(), {
    headers: { "X-Auth-Token": process.env.FOOTBALL_DATA_API_KEY! },
  });
  if (!res.ok) throw new Error(`football-data error ${res.status}`);
  return res.json();
}