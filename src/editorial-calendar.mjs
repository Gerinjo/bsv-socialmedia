export function editorialCalendarDays(month) {
  const first = new Date(`${month}-01T12:00:00Z`);
  if (Number.isNaN(first.getTime())) throw new Error("Ungültiger Monat.");
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(first);
    day.setUTCDate(day.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}
export function editorialMilestones(issue, date) {
  return [
    ["starts_on", "start", "Redaktionsstart"],
    ["closes_on", "close", "Redaktionsschluss"],
    ["publishes_on", "publish", "Erscheinung"],
  ]
    .filter(([key]) => issue[key] === date)
    .map(([, kind, label]) => ({ kind, label }));
}
