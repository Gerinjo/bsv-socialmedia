grant usage on schema private to service_role;

revoke execute on function private.birthday_date_for_year(date, integer) from public;
grant execute on function private.birthday_date_for_year(date, integer) to service_role;
