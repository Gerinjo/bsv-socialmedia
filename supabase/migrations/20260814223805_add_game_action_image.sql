alter table public.social_games
  add column if not exists action_image_path text;

comment on column public.social_games.action_image_path is
  'Privater Storage-Pfad des für Ergebnis und Spielbericht hochgeladenen Action-Bildes';
