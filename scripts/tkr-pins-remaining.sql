-- One-off (2026-10-05): map pins for the TKR properties that had none, so
-- clock-in can check the cleaner is at the property.
--
-- OpenStreetMap knows these streets but not the houses, so each pin is the
-- postcode's own point (postcodes.io) - for a terrace, usually within a few
-- doors. Where WorkFleet's postcode and TKR's "HMO Cleaners" sheet disagreed,
-- the sheet's is used: WorkFleet's came from the map's guess for the road.
-- Compass House is on Baldwin's Crescent (Jess), but that road runs across
-- four postcodes, so a guessed pin could be hundreds of metres out and turn
-- the cleaner away at the door. It gets its street in the address and no
-- pin: with no pin, the first clock-in there proposes the cleaner's own
-- location as the pin, for the office to approve.
--
-- A pin that's out by more than the 75m fence doesn't stop anyone working:
-- the cleaner gets "I'm at the property", which clocks them in and proposes
-- where they're standing as the better pin.
--
-- on_property_self_update (0061) blocks pin and address changes from this
-- editor, so it is switched off for these statements.
begin;

alter table properties disable trigger on_property_self_update;

update properties set lat = 51.622871, lng = -3.955264
where id = '2cd2b210-c6d6-43fe-9974-f758e7523a8b' and lat is null;  -- 108, Norfolk Street, SA1 6JB (sheet postcode; WorkFleet had SA1 6JE)

update properties set lat = 51.623942, lng = -3.912055
where id = '6aaa1d71-bad1-4ff9-9fe7-7ffcd8fa659b' and lat is null;  -- 158 Danygraig road, Port Tenant SA1 8NF, SA1 8NF

update properties set lat = 51.684938, lng = -4.243956
where id = '470cf6c6-8e2c-44aa-9149-76ba0593ff78' and lat is null;  -- 17, New Street, SA16 0RT (sheet postcode; WorkFleet had SA16 0FH)

update properties set lat = 51.621544, lng = -3.949081
where id = '7ff8b680-0cb0-417a-b8d8-940a641adec1' and lat is null;  -- 20 Carlton terrace, Swansea SA1 6AB, SA1 6AB

update properties set lat = 51.664339, lng = -3.924065
where id = '40db7500-bc83-4ad9-8c3d-ea8f27acc1f6' and lat is null;  -- 23, Slate Street, SA6 8AA

update properties set lat = 51.661225, lng = -3.92642
where id = 'b318bc73-8fae-40b5-bba8-61f40dc0c0b1' and lat is null;  -- 30, Banwell Street, SA6 7BN

update properties set lat = 51.616983, lng = -3.967549
where id = 'bc50cfa2-36b8-4164-9de7-0b5911264561' and lat is null;  -- 43 Gwydr Crescent, Uplands SA2 0AB, SA2 0AB

update properties set lat = 51.592682, lng = -3.800224
where id = 'fbbfec11-81a7-4c08-a71c-e2a2aa425172' and lat is null;  -- 45 Victoria road, Port Talbot SA12 6QG, SA12 6QG

update properties set lat = 51.618164, lng = -3.957691
where id = '711fe74a-0b02-4e32-8150-b116c84585e0' and lat is null;  -- 55, Brunswick Street, SA1 4JP

update properties set lat = 51.62255, lng = -3.950786
where id = '9d569a33-6b12-43c3-a0a5-676303c6d211' and lat is null;  -- Flat 2, 3 The Promenade, SA1 6EN

update properties set lat = 51.663114, lng = -3.926385
where id = 'd3184d67-3b75-4779-bf83-67be9339817a' and lat is null;  -- Hillside, Crown street, SA6 8BD (sheet postcode; WorkFleet had SA6 7BN, which is Banwell Street)

update properties set address = 'Compass House, Baldwin''s Crescent, Swansea'
where id = '8519fe57-bbe0-4354-8b9d-13da55104d9e' and address = 'Compass House, Swansea';

-- Postcodes checked against postcodes.io (Royal Mail / Ordnance Survey
-- data) and the street at each postcode's point. Where WorkFleet and the
-- sheet disagreed, the sheet's postcode is the one on the right street.
--
-- 116 Old Road had SA12 6NF, which is Glyn Street in Aberavon; SA12 8LL is
-- Old Road, Baglan. Its pin was about 400m from there - far enough that the
-- cleaner would be turned away at the door - so it moves too.
update properties set address = '116 Old Road, Baglan, Port Talbot, SA12 8LL', lat = 51.627683, lng = -3.819293
where id = '6e431668-da6e-430e-a976-a14f49237022' and address = '116 Old road, Baglan SA12 6NF';

-- Both postcodes are on Norfolk Street; the sheet's is TKR's own record.
update properties set address = '108 Norfolk Street, Mount Pleasant, Swansea, SA1 6JB'
where id = '2cd2b210-c6d6-43fe-9974-f758e7523a8b' and address like '108, Norfolk Street%SA1 6JE%';

-- SA16 0FH is Clos y Bacca; SA16 0RT is New Street.
update properties set address = '17 New Street, Burry Port, SA16 0RT'
where id = '470cf6c6-8e2c-44aa-9149-76ba0593ff78' and address like '17, New Street%SA16 0FH%';

-- The sheet calls it Roseland Terrace; same house, same SA1 8BJ.
update properties set address = '1 Roseland Terrace, St Thomas, Swansea, SA1 8BJ'
where id = 'c05290ff-b3eb-4216-95e1-cf8d2f40d224' and address = '1 Rosewood terrace, St Thomas SA1 8BJ';

-- SA6 7BN is Banwell Street; SA6 8BD is Crown Street.
update properties set address = 'Hillside, Crown Street, Morriston, Swansea, SA6 8BD'
where id = 'd3184d67-3b75-4779-bf83-67be9339817a' and address = 'Hillside, Crown street, Morriston SA6 7BN';

alter table properties enable trigger on_property_self_update;

commit;

-- Should list only Compass House, Baldwin's Crescent.
select address from properties
where client_id = '10a80ca8-3185-4196-aae8-a6b1be35b942' and lat is null;
