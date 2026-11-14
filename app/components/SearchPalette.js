'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Building2, MapPin, User, LayoutGrid } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { withoutTestAccounts } from '../../lib/testAccounts';

// Find anything in the office app by typing part of its name: a client, a
// site's address, a member of staff, or a page. Opens with Ctrl+K (Cmd+K on
// a Mac), from the sidebar, from the search icon on a phone, or from the
// box on the dashboard - anything can call openSearch().
//
// Most of the clicking around the office is looking one thing up; this
// turns that into a few key presses.

const OPEN_EVENT = 'wf:open-search';
const MIN_CHARS = 2;
const PER_GROUP = 5;
const EMPTY = { clients: [], sites: [], staff: [] };

export function openSearch() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

// ilike treats % and _ as wildcards; a search for "50%" means the text.
function escapeLike(text) {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// pages: the menu items this person can open ({ href, label }).
// canSeeStaff: staff pages are admin-only, so supervisors don't get them.
export default function SearchPalette({ pages = [], canSeeStaff = false }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(EMPTY);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const latest = useRef(0);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults(EMPTY);
    setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // Ask the database once typing pauses, and only keep the answer to the
  // latest question - a slow reply to "sw" must not overwrite "swansea".
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CHARS) {
      latest.current += 1;
      setResults(EMPTY);
      setSearching(false);
      return undefined;
    }
    const ticket = ++latest.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      const like = `%${escapeLike(q)}%`;
      const [clients, sites, staff] = await Promise.all([
        supabase.from('clients').select('id, name').ilike('name', like).order('name').limit(PER_GROUP),
        supabase.from('properties').select('id, address, client_id, clients(name)').ilike('address', like).limit(PER_GROUP),
        canSeeStaff
          ? supabase.from('profiles').select('id, full_name, role, active').ilike('full_name', like).neq('role', 'client').order('full_name').limit(PER_GROUP + 1)
          : Promise.resolve({ data: [] }),
      ]);
      if (ticket !== latest.current) return;
      setResults({
        clients: clients.data || [],
        sites: sites.data || [],
        staff: withoutTestAccounts(staff.data || []).slice(0, PER_GROUP),
      });
      setSearching(false);
      setActive(0);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, canSeeStaff]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const pageHits = q ? pages.filter((p) => p.label.toLowerCase().includes(q)).slice(0, 4) : [];

  const groups = [
    { name: 'Pages', items: pageHits.map((p) => ({ key: `p-${p.href}`, href: p.href, label: p.label, Icon: LayoutGrid })) },
    { name: 'Clients', items: results.clients.map((c) => ({ key: `c-${c.id}`, href: `/admin/clients/${c.id}`, label: c.name, Icon: Building2 })) },
    {
      name: 'Sites',
      items: results.sites.map((s) => ({
        key: `s-${s.id}`, href: `/admin/clients/${s.client_id}`, label: s.address, sub: s.clients?.name, Icon: MapPin,
      })),
    },
    {
      name: 'Staff',
      items: results.staff.map((p) => ({
        key: `u-${p.id}`,
        href: `/admin/cleaners/${p.id}`,
        label: p.full_name || 'Unnamed',
        sub: p.active === false ? 'Deactivated' : p.role === 'cleaner' ? null : p.role,
        Icon: User,
      })),
    },
  ].filter((g) => g.items.length > 0);
  const flat = groups.flatMap((g) => g.items);

  const close = () => setOpen(false);
  const go = (item) => {
    if (!item) return;
    close();
    router.push(item.href);
  };

  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(flat[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  let index = -1;
  return (
    <div className="search-overlay" onMouseDown={close}>
      <div className="search-panel" role="dialog" aria-modal="true" aria-label="Search" onMouseDown={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <Search size={18} aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onInputKey}
            placeholder="Find a client, site, cleaner or page"
            aria-label="Search"
            aria-controls="search-results"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="search-esc" onClick={close} aria-label="Close search">Esc</button>
        </div>
        <div className="search-results" id="search-results" role="listbox">
          {groups.map((g) => (
            <div key={g.name} className="search-group">
              <div className="search-group-label">{g.name}</div>
              {g.items.map((item) => {
                index += 1;
                const i = index;
                const { Icon } = item;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    className={`search-item${i === active ? ' is-active' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(item)}
                  >
                    <Icon size={16} aria-hidden />
                    <span className="search-item-label">{item.label}</span>
                    {item.sub && <span className="search-item-sub">{item.sub}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          {q.length < MIN_CHARS && pageHits.length === 0 && (
            <p className="search-hint">Type part of a client&apos;s name, a site&apos;s address{canSeeStaff ? ' or a cleaner’s name' : ''}.</p>
          )}
          {q.length >= MIN_CHARS && searching && flat.length === 0 && <p className="search-hint">Searching…</p>}
          {q.length >= MIN_CHARS && !searching && flat.length === 0 && (
            <p className="search-hint">Nothing matches &ldquo;{query.trim()}&rdquo;.</p>
          )}
        </div>
        <div className="search-foot">
          <span><kbd className="search-kbd">↑</kbd> <kbd className="search-kbd">↓</kbd> to move</span>
          <span><kbd className="search-kbd">Enter</kbd> to open</span>
        </div>
      </div>
    </div>
  );
}
