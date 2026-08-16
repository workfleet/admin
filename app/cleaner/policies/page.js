'use client';

import { useState } from 'react';
import { POLICY_SECTIONS } from '../../../lib/companyPolicies';

const HELP_SECTIONS = [
  {
    title: 'Checking In & Out of a Job',
    body: 'Tap a job on your Home tab to open it. Tap Check In when you arrive to start the job, then tick off each task as you complete it. When you\'re finished, tap Check Out. Once a job is checked out it moves to your job history and becomes read-only, so double-check everything (especially photos) before you check out.',
  },
  {
    title: 'Taking Job Photos',
    body: 'Photos can only be added while a job is in progress — you\'ll see a reminder if a job has none yet. Once you check out, the job becomes read-only and no more photos can be added, so it\'s best to add them as you go rather than leaving it until the end.',
  },
  {
    title: 'Viewing Your Rota & Hours',
    body: 'The Rota tab shows your upcoming shifts, plus a history of completed jobs with hours worked. Your holiday balance (based on hours you\'ve actually worked) is shown at the top of the page.',
  },
  {
    title: 'Requesting Time Off',
    body: 'From the Rota tab, use the request form to ask for holiday or mark yourself unavailable. Your available balance is shown before you submit — the app won\'t let you request more time off than you\'ve accrued.',
  },
  {
    title: 'Messaging Admin',
    body: 'Use the Messages tab to send the office a message directly — for questions, schedule changes, or anything else. You\'ll see a reply here as soon as admin responds.',
  },
  {
    title: 'Requesting Kit or Reporting an Issue',
    body: 'On your Home tab, use the "Need something?" section to request a kit top-up or report a problem, like faulty equipment. Admin will resolve it and you\'ll see their note once it\'s sorted.',
  },
  {
    title: 'Notifications',
    body: 'Notifications appear on your Home tab for things like new shifts being assigned or a time off request being decided. Dismiss ones you\'ve seen with the X — dismissed notifications aren\'t lost, they move into your Notification History (tap "Notifications" next to My Jobs) where they\'re kept for 30 days.',
  },
];

export default function CleanerHelp() {
  const [section, setSection] = useState('guide');
  const sections = section === 'guide' ? HELP_SECTIONS : POLICY_SECTIONS;

  return (
    <div className="container">
      <h1>Help</h1>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: -8, marginBottom: 16 }}>
        How to use the app, and how we work at CrewConnect Cleaning.
      </p>

      <div className="action-row" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={section === 'guide' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setSection('guide')}
        >
          Using the App
        </button>
        <button
          type="button"
          className={section === 'policies' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setSection('policies')}
        >
          Company Policies
        </button>
      </div>

      {sections.map((s) => (
        <div key={s.title} className="card" style={{ marginBottom: 12 }}>
          <h2>{s.title}</h2>
          <p style={{ fontSize: 14, margin: '6px 0 0', lineHeight: 1.5 }}>{s.body}</p>
        </div>
      ))}
    </div>
  );
}
