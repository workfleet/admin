'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { COMPANY } from '../../../lib/companyBranding';
import BackButton from '../../components/BackButton';

const SECTIONS = [
  {
    heading: 'Dashboard',
    items: [
      {
        q: 'What does "Need Something?" do?',
        a: "Use this to send us a free-text message about anything to do with your cleans - a one-off ask, feedback, or a question. It goes straight to the office and we'll get back to you.",
      },
      {
        q: 'What does "Pause My Cleans" do?',
        a: "Ask us to pause all your scheduled cleans over a date range - for a holiday, building work, or anything else. Pick a start and end date and an optional reason. We'll review it and approve or decline - approving doesn't cancel your arrangement, it just pauses visits in that window.",
      },
    ],
  },
  {
    heading: 'A clean',
    items: [
      {
        q: 'How do I request a different time for a clean?',
        a: "Open the clean from your History (or the Dashboard's upcoming list) and use \"Request a different time\" under Reschedule. Pick a new date and time and an optional reason, then send it. We'll approve or decline the request - the clean keeps its original time until we confirm.",
      },
      {
        q: 'How does rating a clean work?',
        a: "Once a clean is marked completed, you can rate it 1-5 stars and leave an optional comment. Ratings help us keep cleaners accountable and improve where needed.",
      },
      COMPANY.googleReviewUrl
        ? {
            q: 'Why am I being asked to leave a public review?',
            a: "If you rate a clean 4 or 5 stars, we'll show a one-off prompt to also leave a public review - entirely optional. Lower ratings never trigger this; instead we flag it internally so we can put things right.",
          }
        : null,
      {
        q: 'What are the Visit Log, Tasks, and Photos on a clean?',
        a: "Visit Log shows when your cleaner checked in and out. Tasks shows what was on the checklist for that clean and what got marked done. Photos are any before/after photos your cleaner took during the visit.",
      },
      {
        q: 'What is the Clean Report?',
        a: "Some cleans get a short write-up from the office - a summary, anything noteworthy found, and any suggestions. We only show you a report if we've specifically chosen to share it, so not every clean will have one.",
      },
    ].filter(Boolean),
  },
  {
    heading: 'Documents',
    items: [
      {
        q: "What's in the Documents section?",
        a: "Health & safety documents, contracts, and policies we've shared with you specifically. Click any document to download a PDF copy.",
      },
    ],
  },
  {
    heading: 'Messages',
    items: [
      {
        q: 'How is Messages different from "Need Something?"',
        a: "Messages is an ongoing conversation thread with the office - good for back-and-forth chat. \"Need Something?\" on the Dashboard is a quick one-off request that gets logged and tracked through to resolution.",
      },
    ],
  },
];

export default function ClientHelp() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const session = await getSessionWithRetry();
      if (!session) { router.push('/'); return; }
      setChecked(true);
    })();
  }, []);

  if (!checked) return <div>Loading...</div>;

  return (
    <div>
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Help</h1>
          <p className="page-subtitle">What each part of the portal does</p>
        </div>
      </div>

      {SECTIONS.map((section) => (
        <div key={section.heading} className="card" style={{ marginBottom: 16 }}>
          <h2>{section.heading}</h2>
          {section.items.map((item) => (
            <details key={item.q} style={{ borderTop: '1px solid var(--hairline)', padding: '10px 0' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14.5 }}>{item.q}</summary>
              <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--muted)', lineHeight: 1.5 }}>{item.a}</p>
            </details>
          ))}
        </div>
      ))}

      <div className="card">
        <h2>Still need help?</h2>
        <p style={{ fontSize: 14, color: 'var(--muted)', margin: 0 }}>
          Send us a message from the Dashboard's "Need Something?" box, or reach us directly at{' '}
          <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a> or {COMPANY.phone}.
        </p>
      </div>

      <p style={{ fontSize: 13.5, marginTop: 12 }}>
        <Link href="/privacy">Privacy Notice</Link>
      </p>
    </div>
  );
}
