# Supabase SQL Source Of Truth

Production SQL changes must be represented in this folder as migrations before
they are considered part of the project state.

Minimum rule for wallet, ledger, bets, settlement, admin, and cron SQL:

1. Add or update a migration in `supabase/migrations`.
2. Keep the migration idempotent where possible.
3. Include revoke/grant statements for security-definer functions.
4. Keep repair/backfill SQL separate from permanent function changes.
5. Verify the live database definition with `pg_get_functiondef(...)` after
   applying the migration in Supabase.

The local `supabase/sql schema.txt` file and files in `supabase/functions` are
snapshots for inspection, not the canonical migration history.
