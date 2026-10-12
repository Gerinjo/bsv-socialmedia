import {cleanupSummary, normalizeRetentionDays, withHistoryState} from '../../../src/history-retention.mjs';

// Only the opened area is loaded. Unscoped requests remain compatible with older clients.
export async function loadSuiteDashboard({request,admin,userId,hasArea,suiteAreas,runtimeConfig,homeVenues,helpers}) {
  const {suiteUsersRpc,suiteMemberDirectory,freshPreviewUrls,freshPostUrls,freshIndependentStoryUrls,freshSponsorUrls,freshClubUrls,json} = helpers;
  const params = new URL(request.url).searchParams;
  const area = params.get('area');
  if (area && !suiteAreas.includes(area)) return json({error:'invalid_area'},400);
  if (area && !hasArea(area)) return json({error:'area_forbidden',area},403);
  // Membership is verified by the caller on every request, including bootstrap.
  const canRead = (...areas) => area ? areas.includes(area) : areas.some(hasArea);
  const [identity, {data:brandSettings,error:brandError}] = await Promise.all([
    suiteUsersRpc(admin,userId,{action:'identity'}),
    admin.from('social_brand_settings').select('color_scheme,theme_key,updated_at').eq('id',true).single(),
  ]);
  if (brandError) return json({error:brandError.message},500);
  const base = {user:identity,brandSettings,testMode:runtimeConfig.testMode};
  if (params.get('bootstrap') === '1' || (area && ['cashbook','referees','editorial','trainer_management'].includes(area))
    || (!area && !['social_media','sponsoring','corporate_identity','club_crests','social_media_admin','user_management'].some(hasArea))) return json(base);
  // A skipped query never reaches PostgREST; choosing another area cannot broaden permissions.
  const read = (areas, query) => canRead(...areas) ? query() : Promise.resolve({data:[],error:null});
  const [
    { data: games, error: gamesError },
    { data: birthdays, error: birthdaysError },
    { data: teamSettings, error: teamsError },
    { data: teamColorGroups, error: teamColorGroupsError },
    { data: people, error: peopleError },
    { data: clubs, error: clubsError },
    { data: members, error: membersError },
    { data: postAudiences, error: postAudiencesError },
    { data: websiteAudiences, error: websiteAudiencesError },
    { data: posts, error: postsError },
    { data: storyCategories, error: storyCategoriesError },
    { data: independentStories, error: independentStoriesError },
    { data: sponsors, error: sponsorsError },
    { data: sponsorTypes, error: sponsorTypesError },
    { data: sponsorAssignments, error: sponsorAssignmentsError },
    { data: sponsorWebsiteAssignments, error: sponsorWebsiteAssignmentsError },
    { data: cleanupSettings, error: cleanupSettingsError },
  ] = await Promise.all([
    read(['social_media', 'social_media_admin'], () => admin
      .from('social_games')
      .select('*, jobs:social_story_jobs(*), referee_assignments(id)')
      .order('kickoff_at', { ascending: true })),
    read(['social_media'], () => admin
      .from('social_birthdays')
      .select('*, person:social_people(id, display_name, roles, source_photo_url, cutout_path, birth_date), jobs:social_birthday_jobs(*)')
      .order('birth_date', { ascending: true })),
    read(['social_media', 'corporate_identity'], () => admin
      .from('social_teams')
      .select('id, slug, name, competition, website_path, fussball_de_url, fussball_de_widget_id, sync_enabled, last_synced_at, last_sync_error, active, content_enabled, publishing_mode, family_key, color_source, color_scheme, sort_order')
      .order('sort_order', { ascending: true })),
    read(['corporate_identity'], () => admin
      .from('social_team_color_groups')
      .select('key, label, color_scheme, sort_order')
      .order('sort_order', { ascending: true })),
    read(['social_media'], () => admin
      .from('social_people')
      .select('id, slug, display_name, roles, source_photo_url, cutout_path, birth_date')
      .eq('active', true)
      .order('display_name', { ascending: true })),
    read(['social_media', 'club_crests'], () => admin
      .from('social_clubs')
      .select('*, aliases:social_club_aliases(alias, normalized_alias)')
      .order('name', { ascending: true })),
    read(['user_management'], () => admin
      .from('social_admins')
      .select('*')
      .order('email', { ascending: true })),
    read(['social_media', 'sponsoring'], () => admin
      .from('social_post_audiences')
      .select('id, slug, audience_group, label, sort_order, team_id')
      .eq('active', true)
      .order('sort_order', { ascending: true })),
    read(['sponsoring'], () => admin
      .from('social_post_audiences')
      .select('id, slug, audience_group, label, sort_order, team_id, active')
      .order('sort_order', { ascending: true })),
    read(['social_media', 'social_media_admin'], () => admin
      .from('social_posts')
      .select('*, audience:social_post_audiences(id, slug, audience_group, label), job:social_post_jobs(*)')
      .order('updated_at', { ascending: false })),
    read(['social_media'], () => admin
      .from('social_story_categories')
      .select('id, slug, label, sort_order')
      .eq('active', true)
      .order('sort_order', { ascending: true })),
    read(['social_media', 'social_media_admin'], () => admin
      .from('social_independent_stories')
      .select('*, category:social_story_categories(id, slug, label), audience:social_post_audiences(id, slug, audience_group, label, team_id), jobs:social_independent_story_jobs(*)')
      .order('updated_at', { ascending: false })),
    read(['social_media', 'sponsoring'], () => admin
      .from('social_sponsors')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })),
    read(['social_media', 'sponsoring'], () => admin
      .from('social_sponsor_types')
      .select('id, slug, label, description, active, sort_order, display_weight, created_at, updated_at')
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true })),
    read(['social_media', 'sponsoring'], () => admin
      .from('social_sponsor_assignments')
      .select('sponsor_id, audience_id, context, slot')
      .order('slot', { ascending: true })),
    read(['sponsoring'], () => admin
      .from('social_sponsor_website_assignments')
      .select('sponsor_id, audience_id, sponsor_type_id, description, page_size, updated_at')),
    read(['social_media', 'social_media_admin'], () => admin
      .from('social_cleanup_settings')
      .select('retention_days, updated_at')
      .eq('id', 1)
      .maybeSingle()),
  ]);
  const readError = gamesError ?? birthdaysError ?? teamsError ?? teamColorGroupsError ?? peopleError ?? clubsError ?? membersError
    ?? postAudiencesError ?? websiteAudiencesError ?? postsError ?? storyCategoriesError ?? independentStoriesError ?? sponsorsError ?? sponsorTypesError ?? sponsorAssignmentsError
    ?? sponsorWebsiteAssignmentsError ?? cleanupSettingsError;
  if (readError) return json({ error: readError.message }, 500);
  const retentionDays = normalizeRetentionDays(cleanupSettings?.retention_days);
  const [preparedGames, preparedPosts, preparedIndependentStories, preparedBirthdays, preparedSponsors, preparedClubs, preparedMembers, rolesResult] = await Promise.all([
    canRead('social_media') ? freshPreviewUrls(admin, games ?? []) : games ?? [],
    canRead('social_media') ? freshPostUrls(admin, posts ?? []) : posts ?? [],
    canRead('social_media') ? freshIndependentStoryUrls(admin, independentStories ?? []) : independentStories ?? [],
    canRead('social_media') ? freshPreviewUrls(admin, birthdays ?? []) : [],
    canRead('social_media','sponsoring') ? freshSponsorUrls(admin, sponsors ?? []) : [],
    canRead('social_media','club_crests') ? freshClubUrls(admin, clubs ?? []) : [],
    canRead('user_management') ? suiteMemberDirectory(admin,userId,members ?? []) : [],
    canRead('user_management') ? suiteUsersRpc(admin,userId,{action:'roles'}) : {roles:[]},
  ]);
  const historyRecords = {
    game: preparedGames.map((record) => withHistoryState(record, 'game', retentionDays)),
    post: preparedPosts.map((record) => withHistoryState(record, 'post', retentionDays)),
    story: preparedIndependentStories.map((record) => withHistoryState(record, 'story', retentionDays)),
  };
  return json({
    ...base, suiteRoles: rolesResult.roles,
    members: canRead('user_management') ? preparedMembers : [],
    venues: canRead('social_media') ? [...homeVenues] : [],
    teams: canRead('social_media', 'corporate_identity') ? (teamSettings ?? []).filter((team) => team.active) : [],
    teamSettings: canRead('social_media', 'corporate_identity') ? teamSettings ?? [] : [],
    teamColorGroups: canRead('corporate_identity') ? teamColorGroups ?? [] : [],
    people: canRead('social_media') ? people ?? [] : [],
    postAudiences: canRead('social_media', 'sponsoring') ? postAudiences ?? [] : [],
    websiteAudiences: canRead('sponsoring') ? websiteAudiences ?? [] : [],
    posts: canRead('social_media') ? historyRecords.post : [],
    storyCategories: canRead('social_media') ? storyCategories ?? [] : [],
    independentStories: canRead('social_media') ? historyRecords.story : [],
    sponsors: canRead('social_media', 'sponsoring') ? preparedSponsors : [],
    sponsorTypes: canRead('social_media', 'sponsoring') ? sponsorTypes ?? [] : [],
    sponsorAssignments: canRead('social_media', 'sponsoring') ? sponsorAssignments ?? [] : [],
    sponsorWebsiteAssignments: canRead('sponsoring') ? sponsorWebsiteAssignments ?? [] : [],
    clubs: canRead('social_media', 'club_crests') ? preparedClubs : [],
    games: canRead('social_media') ? historyRecords.game : [],
    birthdays: canRead('social_media') ? preparedBirthdays : [],
    cleanupSettings: canRead('social_media_admin') ? { retentionDays, updatedAt: cleanupSettings?.updated_at ?? null } : null,
    cleanupSummary: canRead('social_media_admin') ? cleanupSummary(historyRecords, retentionDays) : null,
    instagramConfiguration: canRead('social_media_admin') ? {
      accountIdConfigured: Boolean(runtimeConfig.instagramAccountId),
      accessTokenConfigured: Boolean(runtimeConfig.instagramAccessToken),
      graphApiVersion: runtimeConfig.metaGraphApiVersion,
    } : null,
  });
}
