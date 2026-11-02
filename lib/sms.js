// Text messages to staff about their rota, sent through Twilio. Push only
// reaches people who turned alerts on in Chrome, and most staff are on
// Samsung Internet, where it never arrives; a text reaches anyone with a
// phone number on file.
//
// Nothing here runs unless all three TWILIO_ variables are set, so the app
// behaves exactly as before until somebody signs up and adds them.
// TWILIO_FROM is the sender: a Twilio number, or a name of up to 11
// letters ("CrewConnect"), which UK networks show in place of a number.

export function smsConfigured() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}

// A UK mobile in the +447... form Twilio wants, or null. Numbers are typed
// by hand on My Profile and the staff page, so "07700 900123",
// "+44 (0)7700 900123" and "447700900123" all have to come out the same.
// Landlines are refused: a text to one is charged and never read.
export function normaliseUkMobile(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\(0\)/g, '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('44')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return /^7\d{9}$/.test(digits) ? `+44${digits}` : null;
}

// Characters outside the basic text-message alphabet make the whole message
// go as Unicode, which is a third of the length per text and so charged up
// to three times. Addresses pasted from emails bring curly quotes and dashes.
const PLAIN = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', ' ': ' ' };
function plain(text) {
  return String(text).replace(/[‘’“”–—… ]/g, (c) => PLAIN[c]);
}

const MAX_LINES = 4;

// One text for everything that changed on someone's rota in the last
// minute or two. Lines are written by the notify route as each change
// happens ("New shift: Axis Court, Mon 3 Nov, 09:00"). Door codes and job
// notes never go in a text - only where and when.
export function composeShiftText(lines, firstName) {
  const hi = firstName ? `Hi ${firstName}, ` : '';
  let body;
  if (lines.length === 1) {
    body = hi ? `${hi}${lines[0].charAt(0).toLowerCase()}${lines[0].slice(1)}` : lines[0];
  } else {
    const shown = lines.slice(0, MAX_LINES).map((l) => `- ${l}`);
    const more = lines.length - MAX_LINES;
    body = `${hi}${lines.length} changes to your rota:\n${shown.join('\n')}`
      + (more > 0 ? `\n- and ${more} more` : '');
  }
  return plain(`CrewConnect: ${body}\nSee the app for details.`);
}

// Sends one text. Resolves to { ok, id } or { ok: false, error } - never
// throws, so one bad number cannot stop the rest of a batch.
export async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM, Body: body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.message || `HTTP ${res.status}` };
    return { ok: true, id: data.sid || null };
  } catch (e) {
    return { ok: false, error: e?.message || 'network error' };
  }
}
