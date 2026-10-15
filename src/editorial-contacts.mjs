import {EMPLOYEE_GROUPS} from './employee-management.mjs';
const base = 'https://bsvnordstern.de/';
function website(path) {
  if (!path) return null;
  try {
    const url = new URL(path,base);
    if (url.origin !== new URL(base).origin || url.username || url.password) return null;
    url.hash='';url.search='';
    return url.href.replace(/\/?$/,'/');
  } catch { return null; }
}
function personLink(url,name) {
  return url && name ? `${url}#:~:text=${encodeURIComponent(name)}` : null;
}
// Only fields intended for the public contact page leave the service feeds.
export function editorialContactDirectory({assignments,trainerTeams,teams}, {now = new Date()} = {}) {
  if (!Array.isArray(assignments) || !Array.isArray(trainerTeams) || !Array.isArray(teams)) throw new Error('Die aktuelle Kontaktkonfiguration ist unvollständig.');
  const links = {executive:'verein/vorstandschaft/',board:'verein/vorstandschaft/',youth:'jugend/vorstandschaft/',supporters:'foerderverein/'};
  const groups=[];
  const addGroup = key => {
    const url=website(links[key]);
    const people=new Map();
    for (const [index,a] of assignments.entries()) {
      if (a.groupKey !== key || a.active === false) continue;
      const identity=a.personId || `vacant-${index}`;
      const name=a.personId ? String(a.name || '').trim() : 'Aktuell vakant';
      if (!name || !a.role) continue;
      const previous=people.get(identity);
      if (previous) { if (!previous.roles.includes(a.role)) previous.roles.push(a.role); }
      else people.set(identity,{name,roles:[a.role],websiteUrl:a.personId ? personLink(url,name) : null});
    }
    if (people.size) groups.push({title:EMPLOYEE_GROUPS.find(group=>group.key===key).label,websiteUrl:url,teamSlug:null,
      people:[...people.values()].map(person=>({name:person.name,role:person.roles.join(' · '),websiteUrl:person.websiteUrl}))});
  };
  for (const key of ['executive','board','youth']) addGroup(key);
  const teamUrls={};
  for (const team of teams) {
    const url=website(team.website_path || team.websitePath);
    if (!url) continue;
    teamUrls[team.slug]=url;
    const source=trainerTeams.find(entry=>website(entry.path)===url);
    const people=(source?.coaches || []).filter(person=>person.active !== false && person.name && person.role).map(person=>({
      name:person.name,role:person.role,websiteUrl:personLink(url,person.name),
    }));
    if (people.length) groups.push({title:`Trainerteam · ${team.name}`,websiteUrl:url,teamSlug:team.slug,people});
  }
  addGroup('supporters');
  return {source:'suite',sourceUrl:base,verifiedAt:new Date(now).toLocaleDateString('sv-SE',{timeZone:'Europe/Berlin'}),teams:teamUrls,groups};
}
