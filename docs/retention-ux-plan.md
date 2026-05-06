# Retention UX - bezpieczny plan

## Małe poprawki do obecnego UI

- Daily streak: pokazuj dyskretny licznik dni aktywności przy profilu lub saldzie VB.
- Bonus za powrót: komunikat po zalogowaniu po przerwie, bez automatycznych zmian w ledgerze bez osobnej logiki.
- Mikrocopy przy kuponie: krótkie teksty wzmacniające powrót do gry ze znajomymi, ale bez presji finansowej.
- Poczucie progresu: pasek poziomu konta lub sezonu użytkownika oparty o aktywność.
- VB balance jako element gry: mocniejsze wizualne wyróżnienie salda, bez zmiany mechaniki portfela.
- Delikatne CTA do powrotu: mały prompt na stronie meczów, gdy są nowe mecze lub kupony znajomych.

## Osobny etap gamifikacji

Te elementy wymagają osobnej architektury, tabel i reguł audytu:

- quizy,
- misje,
- sklep VB,
- dzienne losowanie kołem fortuny,
- jawne prawdopodobieństwa nagród,
- jackpot 5000 VB z prawdopodobieństwem 1 na 10000 zakręceń.

## Zasady wdrożenia

- Nie mieszać gamifikacji z krytyczną logiką kursów, kuponów i settlementu.
- Każda nagroda VB musi przechodzić przez ledger.
- Każda losowość musi mieć audytowalny zapis wyniku i źródła losowania.
- UX ma wzmacniać powrót i progres, ale nie ukrywać ryzyk ani nie udawać realnych pieniędzy.
