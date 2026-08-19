'use client';

import Link from 'next/link';
import { COMPANY } from '../../lib/companyBranding';

// PLACEHOLDER — a starting point, not legal advice. Review with a
// solicitor before relying on this, and fill in the bracketed
// retention periods and ICO registration number to match your actual
// policy. Written to reflect what this app specifically collects
// (see supabase/schema.sql + migrations) rather than generic
// boilerplate - update it if the data collected changes.
const SECTIONS = [
  {
    title: 'Who we are',
    body: `${COMPANY.name} (${COMPANY.address}) operates this system to manage cleaning jobs, staff, and client relationships. This notice covers the personal data processed through the app itself - the client portal, the staff/cleaner app, and the admin system.`,
  },
  {
    title: 'What we collect from clients',
    body: 'Contact name, email, phone, billing address, property addresses, and any access notes (e.g. alarm or key safe codes) you choose to add for your property. Also: messages you send us, service ratings and feedback, and quote/contract details.',
  },
  {
    title: 'What we collect from staff and cleaners',
    body: 'During onboarding: full name, date of birth, home address, National Insurance number, and a photo ID document. During ongoing work: GPS location and timestamp when you check in/out of a job (used to confirm attendance and, if you raise an emergency alert, to help admin find you), before/after job photos, messages, time-off and kit requests, and hours worked (for payroll).',
  },
  {
    title: 'Why we process this data',
    body: 'To provide the cleaning service and manage the people who deliver it: scheduling jobs, running payroll, meeting our legal obligations as an employer (including right-to-work checks), invoicing clients, responding to messages and requests, and keeping lone workers safe. We rely on performance of a contract (with clients and staff), legal obligation (employment and tax law), and legitimate interests (service quality, safety) as our legal bases - we do not use this data for marketing.',
  },
  {
    title: 'How long we keep it',
    body: 'We keep staff records for the duration of employment, then anonymise personal details (including deleting any ID document on file) 6 years after someone leaves. We keep client records similarly - 6 years after a client relationship ends. This aligns with the standard UK limitation period for contract claims and the retention period required for accounting records. This runs automatically; some operational records (e.g. completed job history) are kept in anonymised form beyond this for legitimate business reporting.',
  },
  {
    title: 'Who we share it with',
    body: 'We use third-party service providers to run this app, who process data on our behalf under their own security commitments: Supabase (database, authentication, and file storage), Vercel (application hosting), and Resend (sending email notifications). We do not sell personal data, and we only share it with these processors to the extent needed to run the service.',
  },
  {
    title: 'How we keep it secure',
    body: 'Access is role-based - staff, clients, and admins can each only see the specific records they are authorised for, enforced at the database level. Sensitive files (like ID documents) are stored privately and are never publicly accessible. All traffic to the app is encrypted in transit.',
  },
  {
    title: 'Your rights',
    body: 'You can ask to see the personal data we hold about you, ask us to correct it, or ask us to delete it (where we are not required to keep it for a legal reason). To make a request, contact us using the details below. If you are unhappy with how we have handled your data, you also have the right to complain to the Information Commissioner\'s Office (ico.org.uk).',
  },
  {
    title: 'Contact us',
    body: `Questions about this notice or your data: ${COMPANY.email} or ${COMPANY.phone}. Data controller registration with the ICO: [REGISTRATION NUMBER, once registered].`,
  },
];

export default function PrivacyNotice() {
  return (
    <div className="container" style={{ maxWidth: 720, margin: '0 auto', padding: '32px 20px' }}>
      <Link href="/" style={{ fontSize: 13.5, color: 'var(--muted)', textDecoration: 'none' }}>← Back to login</Link>
      <h1 style={{ marginTop: 16 }}>Privacy Notice</h1>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 24 }}>
        How {COMPANY.name} collects and uses personal data through this system.
      </p>

      {SECTIONS.map((s) => (
        <div key={s.title} className="card" style={{ marginBottom: 12 }}>
          <h2>{s.title}</h2>
          <p style={{ fontSize: 14, margin: '6px 0 0', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{s.body}</p>
        </div>
      ))}
    </div>
  );
}
