begin;
-- Extend the existing booking/cancellation transaction without changing its
-- authorization, event classification, or shared resource locking.
do $migration$
declare definition text; marker text:='   update private.resource_bookings set cancelled_at=clock_timestamp(),cancelled_by=actor where id=booking_row.id;';
begin
 definition:=pg_get_functiondef('public.resource_request(uuid,jsonb)'::regprocedure);
 if position(marker in definition)=0 or position($old$elsif act in ('book','cancel') then$old$ in definition)=0 then raise exception 'Ressourcenfunktion wurde geändert. Zeitänderungs-Migration prüfen.';end if;
 definition:=replace(definition,$old$elsif act in ('book','cancel') then$old$,$new$elsif act in ('book','cancel','reschedule') then$new$);
 definition:=replace(definition,$old$if act='cancel' then$old$,$new$if act in ('cancel','reschedule') then$new$);
 definition:=replace(definition,'Du kannst nur eigene Events oder Buchungen deiner Mannschaft freigeben.','Du kannst nur eigene Events oder Buchungen deiner Mannschaft ändern oder freigeben.');
 definition:=replace(definition,marker,$new$
   if act='reschedule' then
    if (payload->>'expectedStartsAt')::timestamptz is distinct from booking_row.starts_at or (payload->>'expectedEndsAt')::timestamptz is distinct from booking_row.ends_at then return jsonb_build_object('error','Die Buchung wurde inzwischen geändert. Bitte neu öffnen.','status',409);end if;
    start_value:=(payload->>'startsAt')::timestamptz;end_value:=(payload->>'endsAt')::timestamptz;
    if start_value is null or end_value is null or start_value<=clock_timestamp() or end_value<=start_value or end_value-start_value>interval '72 hours' then return jsonb_build_object('error','Bitte einen zukünftigen Zeitraum von höchstens 72 Stunden wählen.','status',400);end if;
    if booking_row.booking_kind='match' then
     select * into game from private.resource_matches where id=booking_row.match_id for share;
     if not found or game.is_home or game.status<>'scheduled' or game.kickoff_at<=clock_timestamp() then return jsonb_build_object('error','Dieses Spiel ist kein zukünftiges Auswärtsspiel mehr. Bitte die Buchung prüfen.','status',409);end if;
     if start_value>game.kickoff_at or end_value<game.kickoff_at then return jsonb_build_object('error','Der Zeitraum muss die Anstoßzeit einschließen.','status',400);end if;
    end if;
    if exists(select 1 from private.resource_bookings b where b.resource_id=r.id and b.id<>booking_row.id and b.cancelled_at is null and b.starts_at<end_value and b.ends_at>start_value) then return jsonb_build_object('error','Der Bus ist in diesem Zeitraum bereits reserviert. Bitte andere Zeiten wählen.','status',409);end if;
    update private.resource_bookings set starts_at=start_value,ends_at=end_value where id=booking_row.id;
    return jsonb_build_object('ok',true,'bookingId',booking_row.id);
   end if;
$new$||marker);
 execute definition;
end $migration$;
commit;
