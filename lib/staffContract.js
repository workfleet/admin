// CrewConnect's zero-hours worker contract (supplied by admin).
//
// This used to live inside app/onboard/[token]/page.js with the pay rate,
// job title and line manager baked into the string, so every hire signed
// identical terms. They're now per-invite: the office fills them in on the
// invite before sending the link (staff_invites, 0114) and they arrive here
// as `terms`. Anything the office left blank falls back to the standard
// terms below, which are what the hard-coded version always said.
//
// Shared by three callers, which is the point of it being here:
//   * the onboarding page, to show the worker what they are signing;
//   * the submit route, which rebuilds it server-side and stores THAT as
//     the record - never the copy the browser posts, which a submitter
//     could have edited before sending;
//   * the PDF filed into their documents, rendered from the stored text.
//
// The "Signed for and on behalf of the Company" block is omitted: that's
// the company's own countersignature, handled separately. This flow only
// captures the worker's side (signed_name/signed_at/signed_ip do that).

export const CONTRACT_DEFAULTS = {
  jobTitle: 'Cleaning Operative',
  hourlyRate: 13,
  payFrequency: 'weekly',
  reportsTo: 'Nikki Davies',
};

export const PAY_FREQUENCIES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// A Postgres `date` arrives as 'YYYY-MM-DD'. Formatted by hand rather than
// through Date, which would read the string as UTC midnight and name the
// previous day anywhere behind UTC - see lib/localDate.js.
export function formatContractDate(value) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return null;
  const [, year, month, day] = match;
  const name = MONTHS[Number(month) - 1];
  if (!name) return null;
  return `${Number(day)} ${name} ${year}`;
}

export function formatHourlyRate(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value.toFixed(2);
}

// Fills the gaps in whatever the office set, so the page, the submit route
// and the PDF all agree on what "not specified" renders as.
export function contractTerms(invite = {}) {
  return {
    jobTitle: invite.job_title?.trim() || CONTRACT_DEFAULTS.jobTitle,
    hourlyRate: formatHourlyRate(invite.hourly_rate) || formatHourlyRate(CONTRACT_DEFAULTS.hourlyRate),
    payFrequency: invite.pay_frequency?.trim() || CONTRACT_DEFAULTS.payFrequency,
    startDate: formatContractDate(invite.start_date),
    reportsTo: invite.reports_to?.trim() || CONTRACT_DEFAULTS.reportsTo,
  };
}

export function buildContractText(worker = {}, invite = {}) {
  const terms = contractTerms(invite);
  const reportsToClause = terms.reportsTo ? `\n1.7 You report directly to ${terms.reportsTo}.` : '';

  return `ZERO-HOURS
WORKER CONTRACT
${terms.jobTitle}

Prepared by
Jess Kidwell
CrewConnect RPO Ltd t/a CrewConnect Cleaning
07724894091
jess@crewconnect.ltd

This Agreement is made between:

Employer: CrewConnect RPO Ltd t/a CrewConnect Cleaning (the Company)
Company Address: Gorseinon Road, Penllergaer, Swansea
Worker: ${worker.full_name?.trim() || '[Worker Name]'} (the Worker)
Worker Address: ${worker.address?.trim() || '[Worker Address]'}
Start Date: ${terms.startDate || '_____________________'}

1. Employment Status
1.1 The Worker is employed by the Company on a zero-hours basis.
1.2 The Company is under no obligation to provide a minimum number of working hours, and the Worker is under no obligation to accept work offered.
1.3 The Company reserves the right to reduce, reassign, withdraw, or vary work offered depending on business requirements, client requests, conduct, performance, attendance, reliability, or operational requirements.
1.4 The Worker is engaged as a ${terms.jobTitle} and may be required to carry out reasonable additional duties related to cleaning services.
1.5 Periods where no work is offered by the Company shall not be considered a termination of employment.
1.6 Nothing in this Agreement guarantees regular or continuous work.${reportsToClause}

2. Place of Work
2.1 The Worker may be required to work at various client locations as directed by the Company.
2.2 The Worker may also be required to work at different locations depending on business needs.
2.3 Travel between client sites may be required.
2.4 The Worker acknowledges that working hours, client locations, duties, and assigned sites may vary depending on operational and business requirements.

3. Duties
3.1 Duties may include, but are not limited to: vacuuming, mopping, dusting, cleaning toilets and washrooms, emptying bins, cleaning kitchens and communal areas, cleaning floors behind bars and service areas, waste disposal, using cleaning chemicals and equipment safely, following client site instructions, and locking or unlocking premises where authorised.
3.2 The Worker agrees to perform duties with reasonable care, skill, and professionalism.
3.3 The Worker must follow all Company procedures, client instructions, site rules, and reasonable management instructions.
3.4 The Worker must maintain professional standards and act respectfully towards clients, colleagues, and members of the public at all times.

4. Hours of Work
4.1 Working hours will vary depending on business and client requirements.
4.2 The Company will offer shifts as required.
4.3 The Worker is responsible for notifying the Company as soon as possible if unable to attend an agreed shift.
4.4 Repeated failure to attend agreed shifts, persistent lateness, or unreasonable short-notice cancellations may result in reduced work offers, disciplinary action, or termination of employment.
4.5 The Worker may occasionally be asked to provide emergency cover for sickness absence or urgent client requirements.
4.6 The Company reserves the right to remove the Worker from any client premises or assignment immediately following complaints, concerns, performance issues, or requests made by the client.
4.7 The Worker must immediately report lost or missing keys, security concerns, suspicious activity, accidents, injuries, damage, breakages, client complaints, inability to attend agreed shifts, and faulty equipment.

5. Probationary Period
5.1 The first 3 months of employment shall be a probationary period.
5.2 During the probationary period, either party may terminate employment by giving 48 hours' notice.
5.3 Initial shifts may be supervised and/or treated as training or trial shifts during the probationary period.

6. Pay, Timesheets, Travel & Driving Requirements
6.1 The Worker will be paid GBP ${terms.hourlyRate} per hour.
6.2 Pay will be made ${terms.payFrequency} directly into the Worker's nominated bank account.
6.3 Unless otherwise agreed in writing, travel time and mileage are not paid.
6.4 The Worker must accurately record working hours using the Company's timesheet or clock-in procedures.
6.5 Falsification of timesheets, clock-in records, or working records may result in disciplinary action, including dismissal.
6.6 Where the Worker uses their own vehicle for work purposes, they are responsible for ensuring the vehicle is road legal, insured, taxed, roadworthy, and holds a valid MOT certificate where applicable.
6.7 Personal mobile phone use should be limited during working hours except for emergencies or work-related communication.
6.8 Where driving is required as part of the Worker's role, the Worker confirms they hold a valid and appropriate driving licence.
6.9 The Worker must immediately notify the Company of any driving convictions, penalty points, driving disqualifications, loss of licence, motoring investigations, or any circumstance which may affect their ability to drive lawfully or safely for work purposes.
6.10 Failure to disclose relevant driving matters may result in disciplinary action.

7. Holiday Entitlement
7.1 The Worker is entitled to paid annual leave in accordance with the Working Time Regulations 1998.
7.2 Holiday entitlement will accrue based on hours worked.
7.3 Holiday requests must be approved in advance by the Company.
7.4 The Worker must provide a minimum of 2 weeks' notice for any holiday requests.
7.5 Holiday requests are subject to business requirements and are not authorised until confirmed by the Company.
7.6 The Company reserves the right to refuse holiday requests where operational requirements, staffing levels, or client commitments cannot reasonably accommodate the requested leave.

8. Sickness Absence
8.1 The Worker must notify the Company of sickness absence no later than 7am on the morning of their allocated shift.
8.2 The Worker may qualify for Statutory Sick Pay (SSP) in accordance with current legislation.
8.3 No contractual or enhanced company sick pay is provided.
8.4 Statutory Sick Pay will only be payable where the Worker meets the qualifying conditions under current legislation.

9. Pension
9.1 The Company will comply with its duties under applicable workplace pension legislation, including automatic enrolment requirements.
9.2 Where eligible, the Worker may be automatically enrolled into the Company's workplace pension scheme in accordance with current legislation.
9.3 Pension contributions will be deducted from wages where applicable.
9.4 Further details of the workplace pension scheme will be provided separately where required.

10. Training, References & Policies
10.1 The Worker agrees to attend any mandatory training required for their role.
10.2 The Worker must comply with all Company policies and procedures, including health and safety procedures.
10.3 Employment may be subject to satisfactory references and DBS checks where required by the Company or its clients.

11. Uniforms, Equipment & Company Property
11.1 Any uniforms, keys, alarm codes, access fobs, cleaning equipment, chemicals, PPE, company phones, or other Company property issued to the Worker remain the property of the Company at all times.
11.2 The Worker is responsible for taking reasonable care of all Company property issued to them.
11.3 All Company property must be returned immediately upon request or upon termination of employment.
11.4 The Worker agrees to return all items in the same condition as issued, allowing for fair wear and tear.
11.5 Where Company property is lost, stolen, damaged due to negligence, deliberately damaged, or not returned, the Company reserves the right to require reimbursement for the reasonable replacement or repair cost.
11.6 The Worker authorises the Company to make lawful deductions from wages or final salary payments for unreturned or damaged Company property, provided such deductions comply with the Employment Rights Act 1996.
11.7 Failure to return Company property may result in further action being taken by the Company where appropriate.
11.8 Keys, alarm codes, access fobs, and security information are strictly confidential and must not be shared, copied, duplicated, lent, retained, or permitted to be used by any other person after employment ends or at any time without authorisation.

12. Confidentiality, Data Protection, Photographs & Monitoring
12.1 During employment and after termination, the Worker must not disclose confidential information relating to the Company, its clients, staff, or business operations.
12.2 The Worker must not take photographs or videos inside client premises without prior written permission from the Company or client, unless required as part of authorised work duties.
12.3 Confidentiality obligations continue after employment has ended.
12.4 The Worker may have access to confidential or sensitive information relating to clients, staff, or business operations and agrees to comply with all confidentiality and data protection obligations.
12.5 Personal belongings are brought onto Company or client premises at the Worker's own risk.
12.6 The Worker acknowledges that photographs may be taken of completed work, equipment, client areas, or cleaning standards for legitimate business purposes including training, quality control, audits, internal monitoring, client reporting, and performance management.
12.7 Such photographs will not intentionally focus on the Worker personally unless required for identification, training, security, or evidential purposes.
12.8 The Worker consents to the Company using work-related photographs for internal business purposes, training, quality assurance, and promotional materials where appropriate.

13. Social Media
13.1 The Worker must not post confidential information, client details, photographs, videos, or comments likely to damage the reputation of the Company or its clients on social media platforms.

14. Client Non-Solicitation
14.1 The Worker shall not, during employment or for a period of 6 months after termination of employment, directly or indirectly solicit, approach, or provide cleaning services to any client of the Company that they worked with, had contact with, or became aware of through their employment, except with prior written permission from the Company.

15. Damage, Breakages & Reporting
15.1 Any accidental damage, breakages, lost keys, or incidents occurring at client premises must be reported to the Company immediately.
15.2 The Worker must not attempt to conceal damage, breakages, incidents, complaints, or security issues.

16. Health & Safety
16.1 The Worker must comply with all health and safety instructions and use cleaning chemicals and equipment correctly.
16.2 Any accidents, hazards, or incidents must be reported immediately.
16.3 The Worker may be required to work alone and must follow all lone-working procedures and safety instructions.
16.4 The Worker acknowledges that client premises may operate CCTV or security monitoring systems.
16.5 The Worker must follow COSHH, PPE, manual handling, and site safety instructions where applicable.

17. Drugs, Alcohol, Smoking & Vaping
17.1 Workers must not attend work under the influence of alcohol or illegal drugs.
17.2 Smoking and vaping are prohibited inside or directly outside client premises, Company premises, entrances, exits, and Company vehicles.
17.3 Workers must present themselves in a clean and professional manner and avoid creating smoke or vape-related disturbances near client properties.

18. Appearance, Conduct & Secondary Employment
18.1 The Worker must maintain a clean, professional, and presentable appearance while representing the Company.
18.2 The Worker must behave professionally and respectfully towards clients, staff members, and members of the public at all times.
18.3 The Worker must notify the Company of any secondary employment or self-employment which may create a conflict of interest, affect availability, or involve providing similar services to Company clients.
18.4 Persistent lateness or repeated failure to arrive on time for agreed shifts may result in disciplinary action, reduced work offers, or termination of employment.

19. Right to Search, Suspension & Investigations
19.1 The Company reserves the right to suspend the Worker on full pay while investigating allegations of misconduct, breaches of policy, or client complaints.
19.2 Where the Company reasonably believes theft, unauthorised possession of property, serious misconduct, or breaches of Company policy may have occurred, the Company reserves the right to request a search of the Worker's bags, personal belongings, lockers, or any Company property in their possession.
19.3 Any search will be conducted respectfully, reasonably, and where possible in the presence of a witness.
19.4 Refusal to comply with a reasonable search request may result in disciplinary action.

20. Gross Misconduct
20.1 Examples of gross misconduct include, but are not limited to: theft or attempted theft; dishonesty; falsification of records; misuse of keys, alarm codes, access fobs, or client property; serious breach of confidentiality; working under the influence of alcohol or illegal drugs; aggressive, abusive, or threatening behaviour; deliberate damage to Company or client property; serious negligence; unauthorised absence; sleeping during working hours; serious breach of health and safety procedures; failure to disclose relevant driving matters; and serious misuse of Company or client property.
20.2 Gross misconduct may result in summary dismissal without notice.

21. Termination
21.1 Following successful completion of the probationary period, either party may terminate employment by giving one week's notice after one month of service.
21.2 The Company may terminate employment without notice in cases of gross misconduct.
21.3 Upon termination, the Worker must immediately return all Company and client property in their possession.

22. Data Protection
22.1 The Company will process personal data in accordance with applicable UK data protection legislation.
22.2 Worker information may be used for employment administration, payroll, pension, legal compliance, client requirements, training, quality control, and business operations.

23. Entire Agreement
23.1 This Agreement constitutes the entire agreement between the parties and supersedes any previous arrangements.

By typing your full name below and clicking "Sign & Submit", you confirm that the details you've provided are accurate and that this constitutes your signature as the Worker named above, agreeing to the terms of this Agreement.`;
}

// One line summarising the terms, for the invite list and the email - the
// office should be able to see at a glance what they're about to send
// without opening the contract.
export function termsSummary(invite = {}) {
  const terms = contractTerms(invite);
  const parts = [terms.jobTitle, `£${terms.hourlyRate}/hr ${terms.payFrequency}`];
  if (terms.startDate) parts.push(`starts ${terms.startDate}`);
  return parts.join(' · ');
}
