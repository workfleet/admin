import { Resend } from 'resend';

// Server-only: needs RESEND_API_KEY, never exposed client-side. The
// constructor throws if handed an empty key, so stay null until a real
// key is configured - callers check for that before sending.
export const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Sandbox sender that works without a verified domain. Swap to a
// crewconnect.ltd address once the domain is verified in Resend.
export const EMAIL_FROM = 'CrewConnect Cleaning <onboarding@resend.dev>';
