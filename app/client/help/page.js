'use client';

import { PageSkeleton } from '../../components/Skeleton';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { COMPANY } from '../../../lib/companyBranding';
import BackButton from '../../components/BackButton';

// Written for the portal as it is after November 2026 (dashboard tidy,
// site picker, report a problem, service record, quotes, supplies,
// compliance pack, your cleaner). Keep it in step with the pages.
const SECTIONS = [
  {
    heading: 'Getting started',
    items: [
      {
        q: 'What can I do here?',
        a: "See when your cleaner arrives and leaves, what's booked and every clean so far, with checklists, photos and reports. You can also message us, ask for extra work or supplies, report a problem, accept quotes, and download records and documents.",
      },
      {
        q: 'How do I get notified when something happens?',
        a: "Tap the bell at the top of the portal and allow notifications. Your phone will then tell you when your cleaner arrives or finishes, when we reply, when we send a quote, and when a request is sorted. The same updates show under Recent updates on your dashboard.",
      },
      {
        q: 'We have more than one site. Can I see just one?',
        a: "Yes - use the site picker at the top of the Dashboard, History, Service record, Reports and Settings. The site you choose is remembered as you move between pages. Choose \"All sites\" to see everything again.",
      },
    ],
  },
  {
    heading: 'Your visits',
    items: [
      {
        q: 'Where do I see what is booked?',
        a: "Coming up on your Dashboard shows the next few visits. History lists everything booked from today under Coming up, and every past clean under Past cleans. Tap any visit to open it.",
      },
      {
        q: 'What is on a visit page?',
        a: "Who's cleaning, when they arrived and left and the time on site, the checklist with what was ticked, any photos, and the clean report if we've shared one. Upcoming visits also show your access notes, and you can ask to move the visit.",
      },
      {
        q: 'How do I move a visit to a different time?',
        a: "Open the visit and use \"Request a different time\". Pick a new date and time and send it. The visit keeps its original time until we confirm, and you'll be told either way.",
      },
      {
        q: 'Something wasn\'t right with a clean. What do I do?',
        a: "Open that visit and tap \"Report a problem\". Tell us what was missed or not up to standard and add photos if you can. It reaches the office with the visit and cleaner attached, shows as \"With us\" on the visit, and changes to \"Sorted\" with a note once we've dealt with it.",
      },
      {
        q: 'How does rating a clean work?',
        a: "Once a clean is finished you can rate it from 1 to 5 stars with an optional comment. A low rating is flagged to the office so we can put it right.",
      },
      COMPANY.googleReviewUrl
        ? {
            q: 'Why am I asked to leave a public review?',
            a: "If you rate a clean 4 or 5 stars we show a one-off prompt to also leave a public review. It's entirely optional.",
          }
        : null,
      {
        q: 'What does "DBS checked" next to my cleaner mean?',
        a: "It means we hold an in-date DBS (criminal record) check for them. You'll see your cleaner's first name on each visit, and their photo if they've agreed to it.",
      },
    ].filter(Boolean),
  },
  {
    heading: 'Asking us for things',
    items: [
      {
        q: 'Send a request',
        a: "For anything to do with your cleans - a one-off ask, feedback or a question. It's logged and tracked until it's sorted, and you'll be told when it is.",
      },
      {
        q: 'Ask for extra work',
        a: "Choose a site and tell us what you need - a deep clean, windows, carpets, an extra visit - with a date if it matters. We'll price it and send you a quote to accept under Quotes.",
      },
      {
        q: 'Supplies running low',
        a: "Choose a site and tick what's running low (toilet roll, soap, bin bags and so on). We'll bring more on the next visit.",
      },
      {
        q: 'Pause my cleans',
        a: "Going away or having work done? Pick the dates and we'll pause your visits over that period - no need to cancel. You'll be told once we've confirmed.",
      },
      {
        q: 'How is Messages different from a request?',
        a: "Messages is an ongoing conversation with the office, good for back-and-forth. A request is a single ask that we track through to done. A number on Messages in the menu means we've replied and you haven't read it yet.",
      },
    ],
  },
  {
    heading: 'Quotes',
    items: [
      {
        q: 'How do I accept a quote?',
        a: "Open Quotes from the menu. Quotes waiting for you are at the top - tap Accept or Decline, or download the PDF first. Once you accept, we'll be in touch to book the work in. A quote past its \"valid until\" date can't be accepted; message us for a fresh one.",
      },
    ],
  },
  {
    heading: 'Records and documents',
    items: [
      {
        q: 'What is the Service record?',
        a: "Proof of every visit in a month, for one site or all of them: the date, when your cleaner arrived and left, time on site, who cleaned and how much of the checklist was ticked. Use \"Print or save as PDF\" for a document, or \"Download spreadsheet\" for Excel. Handy for your own records, auditors, landlords or tenders.",
      },
      {
        q: 'What is under Reports?',
        a: "If you have detailed reports, Reports shows each property's month with room-by-room write-ups and photos, as a PDF. Ask us if you'd like them.",
      },
      {
        q: 'What is in Documents?',
        a: "Our insurance, policies and safety documents, kept up to date by us, and anything we've shared with you specifically, such as contracts or site health & safety. Tap a document to download it.",
      },
      {
        q: 'Where do I add door codes or key details?',
        a: "On any upcoming visit, or on the Dashboard with a site picked, use \"Getting in\" to add or change that site's access notes. All sites are also listed under Settings. Your cleaner sees them on the day.",
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

  if (!checked) return <PageSkeleton className="" rows={3} />;

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
          Send us a message from <Link href="/client/messages">Messages</Link>, or reach us directly at{' '}
          <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a> or {COMPANY.phone}.
        </p>
      </div>

      <p style={{ fontSize: 13.5, marginTop: 12 }}>
        <Link href="/privacy">Privacy Notice</Link>
      </p>
    </div>
  );
}
