'use client';

import BackButton from '../../components/BackButton';

const HELP_SECTIONS = [
  {
    title: 'Creating a Job & Assigning a Cleaner',
    body: 'Go to Rota, then "+ New Job" (or click an empty slot) to schedule a clean — pick the client\'s property, date/time and duration. Assign a cleaner from the dropdown on the job card. If they already have an overlapping job, or approved time off that day, you\'ll be asked to confirm before it lets you continue.',
  },
  {
    title: 'Adding a Client & Their Property',
    body: 'Go to Clients → "+ New Client" to add a client and their first property. Further properties, contact details and call logs can be added from the client\'s own page.',
  },
  {
    title: 'Onboarding a New Cleaner',
    body: 'Go to Onboarding → "+ New Invite", enter their name and share the generated link with them. They\'ll use it to set a password and fill in their details, ID and contract — once submitted, they\'ll appear in Cleaners.',
  },
  {
    title: 'Managing Cleaners',
    body: 'The Cleaners page lists everyone with app access. Deactivate a cleaner who\'s left — they won\'t be able to log in until reactivated, but their job history is kept.',
  },
  {
    title: 'Approving or Declining Time Off',
    body: 'Go to Requests → Time Off. Review pending requests and Approve or Decline, with an optional note. If approving would leave the cleaner with a job already scheduled during that period, you\'ll see a warning first so you can reassign it.',
  },
  {
    title: 'Handling Kit Top-up & Issue Requests',
    body: 'Open requests also show on your Dashboard To-Do list — tick one off there, or use Mark Resolved on the Requests page with a note explaining what was done. The cleaner will see your note.',
  },
  {
    title: 'Messaging Clients',
    body: 'Go to Messages to see and reply to every client conversation in one place. Clients can also message you directly from their portal, and you\'ll see it there.',
  },
  {
    title: 'Running Reports',
    body: 'Reports pulls together job history and summaries you can use for reviews or client updates.',
  },
  {
    title: 'Payroll — Hours Worked',
    body: 'Your Dashboard has a Payroll section that totals completed job hours per cleaner for This Week, Last Week, This Month or Last Month — use it when running payroll.',
  },
];

export default function AdminHelp() {
  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Help</h1>
          <p className="page-subtitle">A quick reference for running CrewConnect Cleaning day-to-day.</p>
        </div>
      </div>

      {HELP_SECTIONS.map((s) => (
        <div key={s.title} className="card" style={{ marginBottom: 12 }}>
          <h2>{s.title}</h2>
          <p style={{ fontSize: 14, margin: '6px 0 0', lineHeight: 1.5 }}>{s.body}</p>
        </div>
      ))}
    </div>
  );
}
