export async function loadRefereePortalPeople(db, includeBirthdayStatus = false) {
  const fields = 'team_id,team_name,person_id,display_name,role,is_club_role' + (includeBirthdayStatus ? ',birthday_ready' : '');
  const { data, error } = await db.from('referee_portal_people').select(fields);
  if (error) throw error;
  return (data || []).map(row => ({
    team_id: row.team_id, person_id: row.person_id, role: row.role, is_club_role: row.is_club_role,
    team: { id: row.team_id, name: row.team_name },
    person: { id: row.person_id, display_name: row.display_name },
    ...(includeBirthdayStatus ? { birthdayReady: row.birthday_ready } : {}),
  }));
}
