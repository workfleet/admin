# Migrations

`../schema.sql` is the original bootstrap script — run it once against a
brand-new Supabase project (see the main README).

Everything in this folder is applied **after** `schema.sql`, in filename
order, to bring a fresh project up to the current schema. These have
**already been applied** to the live project this app currently points at —
this folder exists so the schema has a reviewable history in git and so a
new/second Supabase project can be brought to the same state, not so these
get re-run here.

When making a future schema change: write a new numbered file (e.g.
`0007_something.sql`), apply it to the database, and commit the file in the
same change — don't run one-off SQL that isn't captured anywhere.

## Filename order is the apply order

Between 0043 and 0046 there were two files sharing each number, which meant
the order they ran in was decided by whatever came first alphabetically
rather than by anything deliberate. They now carry `a`/`b` suffixes
(`0043a_`, `0043b_`, ...) chosen to preserve the exact order they already ran
in, so nothing about the live database changed - but a future pair can no
longer collide silently. Two files must never share a number again.

## Checking the history is actually complete

Two checks, because they catch different failures:

```bash
npm run test:schema
```

Compares the live database against these files and reports both directions -
a column that exists in the database but in no file (someone changed the
schema by hand in the dashboard), and a table or column these files create
that the database has not got (a migration that was never run). It reads
schema metadata only, never rows.

```bash
DATABASE_URL=postgres://... scripts/replay-schema.sh
```

Replays `schema.sql` and every migration into an *empty* Postgres, which is
the only real proof this repo can rebuild its own database. CI runs this on
every push (`.github/workflows/ci.yml`); `supabase/ci/prelude.sql` provides
the thin `auth`/`storage` stubs that make Supabase-flavoured SQL apply to a
plain Postgres.

This is not hypothetical. `jobs.duration_minutes` was added by hand and
missing from every file here until `0075_jobs_duration_minutes.sql`, so a
fresh project came up broken and nothing noticed for months.
