'use client';

const POLICY_SECTIONS = [
  {
    title: 'Health & Safety',
    body: 'All staff are COSHH trained and must follow safe handling procedures for cleaning chemicals and equipment at all times. Report any accidents, near-misses, or unsafe conditions to admin immediately using the Request form on your Home tab.',
  },
  {
    title: 'Eco-Friendly Products',
    body: 'CrewConnect Cleaning uses eco-friendly, non-toxic products wherever possible. Always use the products provided in your kit — do not substitute with personal or client-supplied products unless agreed with admin.',
  },
  {
    title: 'On-Site Conduct',
    body: 'Be punctual, courteous, and professional at every job. Wear your uniform/ID where provided. Respect client property and privacy — do not use client belongings, WiFi, or facilities without permission.',
  },
  {
    title: 'ID & Right to Work',
    body: 'All staff are DBS-checked and must have valid right-to-work documentation on file before starting any job. Contact admin if your documents are due to expire.',
  },
  {
    title: 'Reporting Problems',
    body: 'If you notice damage, maintenance issues, or anything that needs following up at a property, note it in the job report or raise it via the Request form. Kit running low? Request a top-up before it runs out.',
  },
];

export default function CleanerPolicies() {
  return (
    <div className="container">
      <h1>Policies</h1>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: -8, marginBottom: 16 }}>
        A quick reference for how we work at CrewConnect Cleaning.
      </p>
      {POLICY_SECTIONS.map((section) => (
        <div key={section.title} className="card" style={{ marginBottom: 12 }}>
          <h2>{section.title}</h2>
          <p style={{ fontSize: 14, margin: '6px 0 0', lineHeight: 1.5 }}>{section.body}</p>
        </div>
      ))}
    </div>
  );
}
