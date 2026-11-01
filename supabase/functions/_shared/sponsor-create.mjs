export class SponsorExistsError extends Error {
  constructor(sponsor) {
    super(`Der Werbepartner „${sponsor.name}“ ist bereits vorhanden. Bitte bearbeite den bestehenden Eintrag.`);
    this.name = 'SponsorExistsError';
    this.existingSponsor = { id: sponsor.id, name: sponsor.name };
  }
}

// Keep the database's unique constraints authoritative, including concurrent saves.
// A failed insert must never overwrite an existing partner or its approved logo.
export async function createSponsor(db, payload) {
  const { data, error } = await db.from('social_sponsors').insert(payload).select().single();
  if (!error) return data;
  if (error.code !== '23505') throw error;

  for (const field of ['name', 'slug']) {
    const existing = await db.from('social_sponsors').select('id,name').eq(field, payload[field]).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) throw new SponsorExistsError(existing.data);
  }
  throw error;
}
