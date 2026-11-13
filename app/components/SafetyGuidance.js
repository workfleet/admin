import { Phone } from 'lucide-react';
import { RIGHT_NOW, FIRST_AID_CARDS, GUIDANCE_NOTE } from '../../lib/safetyGuidance';

// "What to do right now" and the first-aid cards, above the report buttons
// on the staff page. The steps are always open - someone reading this may
// be standing next to an injured colleague. The cards are closed until
// tapped, so the page is not a wall of text. officePhone from
// company_settings; the line is left off without one.

const linkButton = { textDecoration: 'none', display: 'inline-flex', alignItems: 'center' };

export default function SafetyGuidance({ officePhone }) {
  return (
    <>
      <div className="card" style={{ borderLeft: '4px solid var(--wf-overdue)' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>Right now</h2>
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
          {RIGHT_NOW.map((step) => (
            <li key={step.title} style={{ marginBottom: 6 }}>
              <strong>{step.title}.</strong> {step.text}
            </li>
          ))}
        </ol>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <a href="tel:999" className="btn-primary" style={linkButton} title="Call 999">
            <Phone size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />Call 999
          </a>
          <a href="tel:111" className="btn-secondary" style={linkButton} title="Call NHS 111">
            <Phone size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />NHS 111
          </a>
          {officePhone && (
            <a href={`tel:${officePhone.replace(/\s+/g, '')}`} className="btn-secondary" style={linkButton} title="Call the office">
              <Phone size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />Office {officePhone}
            </a>
          )}
        </div>
      </div>

      <div className="card">
        <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>First aid</h2>
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 8px' }}>Tap one to see what to do. {GUIDANCE_NOTE}</p>
        {FIRST_AID_CARDS.map((card) => (
          <details key={card.key} style={{ borderTop: '1px solid var(--hairline)', padding: '8px 0' }}>
            <summary style={{ fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>{card.title}</summary>
            <ol style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: 14 }}>
              {card.steps.map((s) => <li key={s} style={{ marginBottom: 4 }}>{s}</li>)}
            </ol>
          </details>
        ))}
      </div>
    </>
  );
}
