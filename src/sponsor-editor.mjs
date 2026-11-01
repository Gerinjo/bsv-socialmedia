export function sponsorToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { timeZone:'Europe/Berlin', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(now);
  const value = kind => parts.find(part => part.type === kind).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function sponsorContractDefaults(now = new Date()) {
  return {contractStartDate:sponsorToday(now),contractEndDate:'',automaticRenewal:true,active:true};
}

export function sponsorEditorMetadata(sponsor) {
  return {name:sponsor.name || '',sortOrder:String(sponsor.sort_order ?? 100),websiteUrl:sponsor.website_url || '',
    instagramHandle:sponsor.instagram_handle || '',sourceUrl:sponsor.logo_source_url || '',
    contractStartDate:sponsor.contract_start_date || '',contractEndDate:sponsor.contract_end_date || '',
    automaticRenewal:Boolean(sponsor.automatic_renewal),active:sponsor.active !== false};
}

export function createSponsorEditState(sponsor) {
  const asset = () => ({prepared:null,file:null,discard:false,pending:false,error:'',preview:null,variants:null,revision:0});
  const values = sponsorEditorMetadata(sponsor);
  return {sponsor:{...sponsor},values,baseline:JSON.stringify(values),digital:asset(),magazine:asset(),busy:false,mode:'preserve'};
}

export function sponsorEditIsDirty(state) {
  return state.baseline !== JSON.stringify(state.values) || ['digital','magazine'].some(channel => state[channel].prepared || state[channel].file || state[channel].pending || state[channel].discard);
}

export function sponsorEditHasImage(state, channel) {
  const draft = state[channel];
  if (draft.discard) return false;
  if (draft.prepared || draft.preview) return true;
  return channel === 'digital'
    ? Boolean(state.sponsor.logo_original_path || state.sponsor.logo_transparent_path || state.sponsor.logo_white_path || state.sponsor.logo_original_url || state.sponsor.logo_transparent_url || state.sponsor.logo_white_url)
    : Boolean(state.sponsor.magazine_ad_path || state.sponsor.magazine_ad_url);
}

// A single UI action saves all pending changes. Each successful step updates
// the draft immediately, so retrying a later failure never uploads saved files
// again or discards the remaining edits.
export async function persistSponsorEdits(state, {api,approve=false,prepareWhite,onCommit=()=>{}}) {
  const request = async (action, body, commit) => {
    const result = await api('POST',{action,sponsorId:state.sponsor.id,...body});
    if (result.sponsor) state.sponsor = {...state.sponsor,...result.sponsor};
    commit?.(result);
    onCommit();
    return result;
  };
  if (state.baseline !== JSON.stringify(state.values)) {
    const submitted = {...state.values};
    await request('save_sponsor', submitted, () => { state.baseline = JSON.stringify(submitted); });
  }
  for (const channel of ['digital','magazine']) {
    const draft = state[channel];
    if (draft.discard) {
      await request(channel === 'digital' ? 'discard_sponsor_logo' : 'discard_sponsor_magazine_ad', {}, () => {
        if (channel === 'digital') Object.assign(state.sponsor,{logo_original_path:null,logo_transparent_path:null,logo_white_path:null,logo_original_url:null,logo_transparent_url:null,logo_white_url:null,logo_status:'missing'});
        else Object.assign(state.sponsor,{magazine_ad_path:null,magazine_ad_original_path:null,magazine_ad_url:null,magazine_ad_original_url:null,magazine_ad_status:'missing'});
        Object.assign(draft,{discard:false,prepared:null,file:null,preview:null,variants:null});
      });
    } else if (draft.prepared) {
      const prepared = draft.prepared;
      await request(channel === 'digital' ? 'save_sponsor_logo' : 'save_sponsor_magazine_ad', prepared, () => {
        draft.preview = channel === 'digital' ? prepared.transparentDataUrl : prepared.imageDataUrl;
        if (channel === 'digital') draft.variants = prepared;
        state.sponsor[channel === 'digital' ? 'logo_status' : 'magazine_ad_status'] = 'needs_review';
        Object.assign(draft,{prepared:null,file:null});
      });
    }
  }
  if (approve) {
    if (sponsorEditHasImage(state,'digital') && state.sponsor.logo_status !== 'approved') {
      if (!state.sponsor.logo_white_path && state.sponsor.logo_transparent_url && prepareWhite) {
        const whiteDataUrl = await prepareWhite(state.sponsor);
        await request('save_sponsor_white_logo',{whiteDataUrl});
      }
      await request('approve_sponsor_logo',{},()=>{state.sponsor.logo_status='approved';});
    }
    if (sponsorEditHasImage(state,'magazine') && state.sponsor.magazine_ad_status !== 'approved') {
      await request('approve_sponsor_magazine_ad',{},()=>{state.sponsor.magazine_ad_status='approved';});
    }
  }
  return state.sponsor;
}
