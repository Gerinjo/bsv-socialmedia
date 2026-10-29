begin;
alter table private.hall_training_days alter column block_minutes set default 120;
-- Keep reservations intact if a booking was made while this correction was prepared.
do $$
begin
 if exists(
  select 1 from private.hall_training_days d join private.hall_training_bookings b on b.day_id=d.id
  where d.date in ('2026-11-07','2026-11-21','2026-11-28','2026-12-05','2026-12-12','2026-12-19','2027-01-17','2027-01-24','2027-01-31')
   and d.block_minutes<>120
 ) then raise exception 'Bestehende BSZ-Buchungen müssen vor der Umstellung auf 120 Minuten freigegeben werden.';
 end if;
 update private.hall_training_days set block_minutes=120,version=version+1
 where date in ('2026-11-07','2026-11-21','2026-11-28','2026-12-05','2026-12-12','2026-12-19','2027-01-17','2027-01-24','2027-01-31')
  and block_minutes<>120;
end $$;
commit;
