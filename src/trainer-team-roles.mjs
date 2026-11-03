// Shared rule for employee management, compensation and public team pages.
// Slot keys remain stable when their visible function changes.
export function trainerOnlyTeam(team){
 const path=String(team?.slug||team?.path||team?.website_path||'').replace(/\/$/,'').split('/').at(-1);
 const age=Number(path.match(/^u(\d+)(?:-|$)/)?.[1]);return age>0&&age<=11;
}
export function trainerSlotLabels(team){return trainerOnlyTeam(team)?{trainer:'Trainer 1',co1:'Trainer 2',co2:'Trainer 3',betreuer:'Betreuer'}:{trainer:'Trainer',co1:'Co-Trainer 1',co2:'Co-Trainer 2',betreuer:'Betreuer'};}
export function trainerAssignmentRole(team,assignment){
 if(trainerOnlyTeam(team)&&assignment.slot!=='betreuer'&&/^(trainer|co[12]|extra-[1-9][0-9]?)$/.test(assignment.slot||''))return 'Trainer';
 return assignment.websiteRole||trainerSlotLabels(team)[assignment.slot]||'Weitere Aufgabe';
}
export function trainerPublicRole(team,role){return trainerOnlyTeam(team)&&/(?:trainer|coach)/i.test(role)?'Trainer':role;}
