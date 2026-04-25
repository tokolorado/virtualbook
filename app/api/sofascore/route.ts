export async function GET(req: Request) {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");

  if (!path) {
    return Response.json({ error: "Missing path" }, { status: 400 });
  }

  const target = `https://api.sofascore.com/api/v1${path}`;

  const response = await fetch(target, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      accept: "application/json, text/plain, */*",
      referer: "https://www.sofascore.com/",
      origin: "https://www.sofascore.com",
    },
  });

  const text = await response.text();

  return new Response(text, {
    status: response.status,
    headers: {
      "content-type": "application/json",
    },
  });
}