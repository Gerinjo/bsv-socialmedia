-- Contacts remain server-only; these explicit policies document that boundary.
create policy employee_contacts_service_only on private.employee_contacts for all to service_role using(true) with check(true);
create policy employee_contact_routes_service_only on private.employee_contact_routes for all to service_role using(true) with check(true);
