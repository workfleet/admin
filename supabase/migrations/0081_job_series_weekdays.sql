-- Which days of the week a weekly series runs on.
--
-- Until now a weekly repeat could only mean "the same weekday as the first
-- job", so a Mon/Wed/Fri contract had to be set up as three separate series
-- and edited three times whenever anything changed. The form now offers a
-- tick box per weekday, and the days ticked are kept here so the series
-- still says what it was meant to be once the individual jobs have been
-- moved about.
--
-- Values are JavaScript Date#getDay() numbers (0 = Sunday .. 6 = Saturday),
-- because that is what the app generates the dates with. Null means the
-- series predates this column, or is daily/monthly, where the question does
-- not arise.
alter table job_series add column weekdays smallint[]
  check (weekdays is null or weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]);

comment on column job_series.weekdays is
  'Weekly series only: Date#getDay() values (0 = Sunday) the job repeats on. Null for daily/monthly or pre-existing series.';
