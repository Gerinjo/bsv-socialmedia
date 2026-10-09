const technicalEmail = /^cashbook-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}@suite\.bsvnordstern\.invalid$/i;

export function enrichSuiteMembers(members, accounts) {
  const byUser = new Map(accounts.filter(account => account.suiteUserId).map(account => [account.suiteUserId, account]));
  return members.map(member => {
    const account = byUser.get(member.user_id);
    return {...member,
      display_name: account?.name || member.display_name || null,
      username: account?.username || null,
      cashbook_role: account?.role || null,
      is_youth_leader: account?.isYouthLeader === true,
    };
  });
}

export function suiteMemberPresentation(member) {
  const email = String(member.email || '');
  const internal = technicalEmail.test(email);
  const name = String(member.display_name || (internal ? 'Kassenbuchzugang' : email) || 'Unbekannt');
  const login = String(member.username || (internal ? '' : email));
  const role = member.role === 'admin' ? 'Super-Admin'
    : member.role === 'referee-admin' ? 'Schiedsrichteradmin'
    : member.cashbook_role === 'cashier' ? 'Kasse'
    : member.cashbook_role === 'trainer' ? member.is_youth_leader ? 'Jugendleitung' : 'Trainer'
    : member.access_areas?.length === 1 && member.access_areas[0] === 'sponsoring' ? 'Sponsoren-Administrator' : 'Benutzer';
  return {name,email:internal?'':email,login,role,confirmation:login || name};
}
