alter table public.social_sponsor_types
  add column display_weight smallint not null default 1
  constraint social_sponsor_types_display_weight_check
  check (display_weight between 1 and 3);

comment on column public.social_sponsor_types.display_weight is
  'Visuelle Gewichtung in der Website-Sponsorenübersicht: 1 Standard, 2 hervorgehoben, 3 Premium.';
