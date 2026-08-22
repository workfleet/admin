-- The £120 minimum job price and 3-hour minimum call-out (0042) are
-- one-off job assumptions: they cover mobilising a cleaner, getting them
-- to an unfamiliar property, and the risk of not filling the rest of
-- that day. Charged against every visit of a standing contract they
-- compound into nonsense - a daily two-hour office clean was quoting at
-- £120 a visit, £2,600 a month, roughly triple what that work sells for.
--
-- On a recurring route none of those costs recur per visit, so recurring
-- commercial work is priced on the cost-plus stack alone, floored only
-- by the shortest visit worth dispatching someone for. One-off commercial
-- is still a one-off job and keeps the 0042 floors untouched.
--
-- Hours rather than a price floor deliberately: a contract is sold as
-- hours at a rate, and a minimum visit length is something a client
-- understands and will agree to. A hidden per-visit price floor just
-- makes the rate card stop adding up.
alter table pricing_settings
  add column if not exists commercial_recurring_min_hours numeric(5,2) not null default 1.5;
