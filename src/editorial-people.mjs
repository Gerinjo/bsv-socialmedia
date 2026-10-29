export function editorialPersonCandidates(article, people) {
  return people.filter(person => person.active !== false).flatMap(person => {
    const roleGroup = article?.kind === 'board' ? 'executive' : article?.kind === 'youth' ? 'youth' : null;
    const rolePhotos = (person.role_photos || []).filter(photo => !roleGroup || !photo.group || photo.group === roleGroup);
    const availableRoles = roleGroup && person.role_photos ? rolePhotos.map(photo => photo.role) : person.roles || [];
    const roles = article?.kind === 'coach'
      ? (person.teams || []).filter(team => team.team_id === article.team_id && /trainer|coach/i.test(team.role)).map(team => team.role)
      : availableRoles.filter(role => article?.kind === 'board'
        ? /(?:[12]\.\s*(?:vorstand|vorsitz)|vorstandsvorsitz|vorsitzend)/i.test(role) && !/jugend/i.test(role)
        : article?.kind === 'youth' ? /jugendleit|jugendvorstand/i.test(role) : !article || article.kind === 'free');
    if ((!article || article.kind === 'free') && !roles.length) roles.push('Vereinsmitglied');
    const source = article?.kind === 'coach'
      ? (person.teams || []).find(team => team.team_id === article.team_id && /trainer|coach/i.test(team.role))
      : roleGroup ? rolePhotos.find(photo => roles.includes(photo.role)) : null;
    return roles.length ? [{ ...person, role: [...new Set(roles)].join(' · '), photo_source:source?.photo_source ?? person.photo_source }] : [];
  }).sort((a, b) => a.role.localeCompare(b.role, 'de') || a.display_name.localeCompare(b.display_name, 'de'));
}

export function selectEditorialPeople(article, people, ids) {
  if (!Array.isArray(ids) || ids.length > 4 || new Set(ids).size !== ids.length) throw new Error('Bitte höchstens vier Personen auswählen.');
  const candidates = editorialPersonCandidates(article, people);
  return ids.map(id => {
    const person = candidates.find(person => person.id === id);
    if (!person) throw new Error('Die ausgewählte Person gehört nicht zu dieser Funktion oder Mannschaft. Bitte die Auswahl aktualisieren.');
    return person;
  });
}
