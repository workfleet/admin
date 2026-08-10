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
