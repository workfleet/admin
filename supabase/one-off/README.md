# One-off scripts

Not migrations. Nothing in here is part of the numbered sequence in
`../migrations/`, and `scripts/replay-schema.sh` does not run it — a fresh
project gets the right shape from `schema.sql` + `migrations/` alone.

These are repair scripts written to bring one particular database back into
line with the migration history, kept in git so there is a record of what was
run against production and why.

| Script | Why |
|---|---|
| `2026-08-31_apply_unapplied_migrations.sql` | Four migrations (0045a, 0046b, 0065, 0071) were in the repo but had never been applied to the live project. Found by `npm run test:schema`. Push notifications had never worked as a result. |

After running one of these, confirm it worked with:

```bash
npm run test:schema
```

which should then report no drift.
