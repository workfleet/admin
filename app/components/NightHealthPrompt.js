'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Moon, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { localDateString } from '../../lib/localDate';
import { shouldPrompt, latestByPerson } from '../../lib/nightHealth';

// Asks someone on the night workers list (0143) to fill in the health
// questionnaire: when they never have, and again once the office's next
// review date has come. Also anyone the office has sent it to (0144) who
// hasn't answered since. Reads on its own so the Home tab's load is
// untouched, and shows nothing if the table isn't there yet.
export default function NightHealthPrompt({ userId }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const [{ data: worker, error: workerError }, { data: rows, error: rowsError }, { data: request }] = await Promise.all([
        supabase.from('night_workers').select('profile_id').eq('profile_id', userId).maybeSingle(),
        supabase.from('night_health_questionnaires').select('profile_id, submitted_at, outcome, next_review_due')
          .eq('profile_id', userId).order('submitted_at', { ascending: false }).limit(1),
        // Sent to them by the office (0144). An error here (not run yet)
        // just means no request.
        supabase.from('night_health_requests').select('requested_at').eq('profile_id', userId).maybeSingle(),
      ]);
      if (cancelled || workerError || rowsError) return;
      const latest = latestByPerson(rows)[userId] || null;
      setShow(shouldPrompt(!!worker, latest, localDateString(new Date()), request?.requested_at || null));
    })();
    return () => { cancelled = true; };
  }, [userId]);

  if (!show) return null;
  return (
    <Link
      href="/cleaner/night-health"
      className="card"
      style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit' }}
    >
      <Moon size={22} style={{ color: 'var(--brand-link)', flexShrink: 0 }} />
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>Night worker health questionnaire</span>
        <span style={{ display: 'block', fontSize: 13.5, color: 'var(--muted)' }}>
          A free, confidential health check for night workers. Takes about two minutes.
        </span>
      </span>
      <ChevronRight size={20} style={{ color: 'var(--muted)', flexShrink: 0 }} />
    </Link>
  );
}
