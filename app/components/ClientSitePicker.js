'use client';

import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

// Which of a client's sites the portal is showing. A client with many
// properties (TKR has 22) otherwise sees every visit at every address in
// one list. The choice is remembered on this device and shared by every
// portal page that uses it, so picking a site on the dashboard carries over
// to History and Reports.

const STORAGE_KEY = 'client-portal-site';
const CHANGED = 'client-portal-site-changed';
export const ALL_SITES = 'all';

function readSaved() {
  try { return window.localStorage.getItem(STORAGE_KEY) || ALL_SITES; } catch { return ALL_SITES; }
}

export function useClientSite(clientId) {
  const [sites, setSites] = useState(null);
  const [site, setSiteState] = useState(ALL_SITES);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('properties').select('id, address').eq('client_id', clientId).order('address');
      if (cancelled) return;
      const list = data || [];
      setSites(list);
      // A saved site this client no longer has (removed, or another login on
      // this device) falls back to all sites.
      const saved = readSaved();
      setSiteState(list.some((p) => p.id === saved) ? saved : ALL_SITES);
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  useEffect(() => {
    const onChange = (e) => setSiteState(e.detail || ALL_SITES);
    window.addEventListener(CHANGED, onChange);
    return () => window.removeEventListener(CHANGED, onChange);
  }, []);

  const setSite = (id) => {
    try { window.localStorage.setItem(STORAGE_KEY, id); } catch { /* private window: just this page */ }
    window.dispatchEvent(new CustomEvent(CHANGED, { detail: id }));
  };

  const current = site === ALL_SITES ? null : (sites || []).find((p) => p.id === site) || null;
  return { sites, site: current ? site : ALL_SITES, current, setSite };
}

// True when a job (with property_id) belongs to the chosen site.
export function atSite(job, site) {
  return site === ALL_SITES || job.property_id === site;
}

export default function ClientSitePicker({ sites, site, setSite }) {
  // One site: nothing to choose.
  if (!sites || sites.length < 2) return null;
  return (
    <div className="client-site-picker">
      <MapPin size={16} aria-hidden="true" />
      <label htmlFor="client-site-select" className="sr-only">Site</label>
      <select id="client-site-select" value={site} onChange={(e) => setSite(e.target.value)}>
        <option value={ALL_SITES}>All sites ({sites.length})</option>
        {sites.map((p) => <option key={p.id} value={p.id}>{p.address}</option>)}
      </select>
    </div>
  );
}
