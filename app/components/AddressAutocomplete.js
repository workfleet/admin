'use client';

import { useEffect, useRef, useState } from 'react';

// Free-text address input with as-you-type suggestions from OpenStreetMap's
// Nominatim geocoder (no API key/account needed). Restricted to GB and
// asking for address breakdown so results with a house number (which OSM's
// UK coverage has patchily, unlike a Royal Mail-backed lookup) can be
// surfaced above street/area-only matches rather than mixed in randomly.
export default function AddressAutocomplete({ value, onChange, onSelect, placeholder }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleChange = (e) => {
    const text = e.target.value;
    onChange(text);
    setOpen(true);

    clearTimeout(debounceRef.current);
    if (text.trim().length < 3) {
      setSuggestions([]);
      setSearched(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=gb&limit=8&q=${encodeURIComponent(text)}`
        );
        const data = await res.json();
        // Precise (has a house number) results first, then everything else -
        // OSM's UK house-number coverage is patchy, so when both kinds come
        // back for the same search, the useful one shouldn't get buried.
        const sorted = [...(data || [])].sort((a, b) => {
          const aHasNumber = a.address?.house_number ? 1 : 0;
          const bHasNumber = b.address?.house_number ? 1 : 0;
          return bHasNumber - aHasNumber;
        });
        setSuggestions(sorted);
      } catch {
        setSuggestions([]);
      }
      setLoading(false);
      setSearched(true);
    }, 400);
  };

  const handleSelect = (result) => {
    onChange(result.display_name);
    onSelect?.({ address: result.display_name, lat: parseFloat(result.lat), lng: parseFloat(result.lon) });
    setSuggestions([]);
    setSearched(false);
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <input
        value={value}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && (loading || suggestions.length > 0 || searched) && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: -6,
            background: 'white',
            border: '1px solid var(--hairline, #e2e8f0)',
            borderRadius: 10,
            boxShadow: 'var(--shadow-md, 0 8px 20px rgba(0,0,0,0.1))',
            zIndex: 20,
            maxHeight: 220,
            overflowY: 'auto',
          }}
        >
          {loading && <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--muted, #64748b)' }}>Searching...</div>}
          {!loading && suggestions.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--muted, #64748b)' }}>
              No match - try including the house number, or type the full address manually.
            </div>
          )}
          {!loading && suggestions.map((s) => (
            <div
              key={s.place_id}
              onClick={() => handleSelect(s)}
              style={{ padding: '10px 12px', fontSize: 13.5, cursor: 'pointer', borderBottom: '1px solid var(--hairline, #f1f5f9)' }}
              onMouseDown={(e) => e.preventDefault()}
            >
              {s.display_name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
