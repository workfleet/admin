-- Archiving a quote gets it out of the working list without destroying
-- the record of what was proposed and whether it was won.
--
-- Deliberately not a sixth value in the status check constraint: status
-- is the outcome (draft/sent/accepted/declined/expired) and archiving is
-- orthogonal to it. An accepted quote from last year is still accepted
-- when it's filed away, and folding the two together would lose that.
--
-- Null means live. Non-null is when it was archived, which also gives an
-- ordering for the archive view without a second column.
alter table quotes add column archived_at timestamptz;

-- The working list filters on this every time it loads, and archived
-- quotes accumulate forever while live ones stay few.
create index quotes_archived_at_idx on quotes (archived_at);
