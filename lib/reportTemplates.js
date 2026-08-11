// Shared between the Reports page (template picker + section labels) and
// the report-generation API route (prompt instructions). Plain data/JS so
// it can be imported from both a 'use client' component and a server route.
export const REPORT_TEMPLATES = {
  standard: {
    label: 'Standard Clean',
    sectionLabels: { summary: 'Work Completed', issues: 'Issues Found', suggestions: 'Suggestions' },
    promptInstructions:
      'Write a standard cleaning report: what was done, any issues noticed, and suggestions going forward. Keep a neutral, professional tone.',
  },
  deep_clean: {
    label: 'Deep Clean',
    sectionLabels: { summary: 'Work Completed', issues: 'Issues & Areas of Concern', suggestions: 'Recommendations & Next Steps' },
    promptInstructions:
      'Write a deep clean report. Be thorough about what areas were covered and to what standard. Pay particular attention to any wear, damage, or maintenance concerns noticed while cleaning areas that are not part of a routine clean (e.g. behind appliances, inside cabinets, carpets, grout). Recommendations should focus on longer-term upkeep, not just the next visit.',
  },
  move_out: {
    label: 'Move-Out / End of Tenancy',
    sectionLabels: { summary: 'Condition Summary', issues: 'Damage & Wear Noted', suggestions: 'Recommendations' },
    promptInstructions:
      'Write a move-out / end of tenancy condition report. This may be used to support a deposit discussion between landlord and tenant, so be factual, specific, and neutral - describe what you observed without assigning blame or making assumptions about cause. Clearly distinguish normal wear-and-tear from anything that looks like damage. Recommendations should be about what (if anything) needs fixing or further assessment before the property is re-let.',
  },
  maintenance: {
    label: 'Maintenance Check',
    sectionLabels: { summary: 'Areas Inspected', issues: 'Issues Found', suggestions: 'Priority Actions' },
    promptInstructions:
      'Write a brief maintenance-focused report. This is not primarily about cleaning - keep the "areas inspected" section short, and focus most of the detail on any issues found and what should be prioritized. If nothing is wrong, say so briefly rather than padding it out.',
  },
};

export const DEFAULT_TEMPLATE = 'standard';
