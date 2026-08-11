update public.social_games as game
set
  team_id = team.id,
  is_home = game.home_team = team.name
from public.social_teams as team
where game.team_id is null
  and team.active
  and (game.home_team = team.name or game.away_team = team.name);
