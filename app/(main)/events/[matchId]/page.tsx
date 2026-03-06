// app/events/[matchId]/page.tsx  (SERVER)
import MatchMarketsClient from "./MatchMarketsClient";

export default async function Page({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  return <MatchMarketsClient matchId={matchId} />;
}