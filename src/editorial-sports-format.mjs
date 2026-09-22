export function editorialSportsBody(team, snapshot) {
  const lines = matches => matches.map(match => `${match.date.split('-').reverse().join('.')} | ${match.time || 'offen'} | ${match.home} – ${match.away} | ${match.score || '–'}`).join('\n');
  const table = snapshot.table?.rows.length
    ? `${snapshot.table.competition}\nPlatz | Mannschaft | Spiele | Tore | Punkte\n${snapshot.table.rows.map(row => [row.position, row.team, row.matches, row.goals, row.points].join(' | ')).join('\n')}`
    : 'Keine Verbandstabelle verfügbar.';
  return [
    `${snapshot.compact ? 'SPORT KOMPAKT · ' : ''}${team.name}`,
    `TABELLE · Abruf ${new Date(snapshot.fetchedAt).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}\n${table}`,
    `LETZTE PARTIE\n${snapshot.lastMatches.length ? 'Datum | Uhrzeit | Begegnung | Ergebnis\n' + lines(snapshot.lastMatches) : 'Keine abgeschlossenen Ergebnisse in der verfügbaren Quelle.'}`,
    `NÄCHSTE SPIELE · ab ${snapshot.referenceDate}\n${snapshot.upcoming.length ? 'Datum | Uhrzeit | Begegnung | Ergebnis\n' + lines(snapshot.upcoming) : 'Keine kommenden Partien im verfügbaren Spielplan für diesen Zeitraum.'}`,
    ...(snapshot.notices?.length ? ['HINWEISE\n' + snapshot.notices.join('\n')] : []),
    `QUELLENSTAND · ${new Date(snapshot.fetchedAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}\n${snapshot.matchSourceLabel}${snapshot.warning ? '\n' + snapshot.warning : ''}`,
  ].join('\n\n');
}
