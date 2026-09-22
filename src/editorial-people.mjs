export function editorialPersonCandidates(article, people) {
  return people.filter(person => person.active !== false).flatMap(person => {
    const roles = article?.kind === 'coach'
      ? (person.teams || []).filter(team => team.team_id === article.team_id && /trainer|coach/i.test(team.role)).map(team => team.role)
      : (person.roles || []).filter(role => article?.kind === 'board'
        ? /(?:[12]\.\s*(?:vorstand|vorsitz)|vorstandsvorsitz|vorsitzend)/i.test(role) && !/jugend/i.test(role)
        : article?.kind === 'youth' ? /jugendleit|jugendvorstand/i.test(role) : false);
    return roles.length ? [{ ...person, role: [...new Set(roles)].join(' · ') }] : [];
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
