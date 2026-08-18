alter table public.social_independent_stories
  add column show_activity_heading boolean not null default true,
  add column show_motivation_heading boolean not null default true;
