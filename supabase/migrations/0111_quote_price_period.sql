-- A quote's price says what it is for.
--
-- Until now quotes.price was a bare number. For a one-off clean that is
-- fine, but a recurring contract is sold as "£180 a week" or "£650 a
-- month", and the quote had nowhere to say which - the office typed the
-- weekly figure and hoped the description made it clear. The period
-- lives with the price so the form can show what that price comes to
-- per week, per month and per year, and the client's document can print
-- "£180.00 per week" rather than a number with no unit.
--
-- one_off is the default so every existing quote keeps meaning what it
-- meant. 'visit' is for a recurring per-visit price (the commercial
-- calculator's frequency projects it into a contract value).
alter table quotes add column price_period text not null default 'one_off'
  check (price_period in ('one_off', 'visit', 'week', 'month', 'year'));
