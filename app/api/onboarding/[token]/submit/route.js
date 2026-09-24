import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { buildContractText } from '../../../../../lib/staffContract';
import { companyFromSettings } from '../../../../../lib/companyBranding';
import ContractPdfDocument from '../../../../../lib/contractPdfDocument';

// @react-pdf/renderer needs real Node APIs (fs, fontkit) - not the edge runtime.
export const runtime = 'nodejs';

// Files the signed contract into the shared document library (0048) aimed at
// the one person who signed it (0049), which is what puts it in their
// Documents tab and nobody else's. Admin sees it there too, alongside
// everything else they've been sent.
//
// Everything in here is best-effort: the submission is already saved and the
// contract text on it is the record of what was agreed. A PDF that failed to
// render is a missing convenience, not a lost contract, so it must not fail
// the onboarding the new starter has just sat through.
async function fileSignedContract({ submission, invite, profileId }) {
  const { data: settings } = await supabaseAdmin
    .from('company_settings')
    .select('*')
    .limit(1)
    .maybeSingle();

  const buffer = await renderToBuffer(
    <ContractPdfDocument submission={submission} company={companyFromSettings(settings)} />
  );

  const safeName = submission.full_name.replace(/[^a-zA-Z0-9.\-_ ]/g, '').trim().replace(/\s+/g, '-') || 'worker';
  const fileName = `Worker-Contract-${safeName}.pdf`;
  const storagePath = `contract/${Date.now()}-${fileName}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from('company-documents')
    .upload(storagePath, buffer, { contentType: 'application/pdf' });
  if (uploadError) throw uploadError;

  const { data: document, error: documentError } = await supabaseAdmin
    .from('company_documents')
    .insert({
      title: `Worker Contract - ${submission.full_name}`,
      category: 'contract',
      storage_path: storagePath,
      file_name: fileName,
      file_size: buffer.length,
      // Whoever created the invite is who sent them the contract. Null on
      // invites made before created_by was recorded, which the library
      // renders the same way as any other document without an uploader.
      uploaded_by: invite.created_by || null,
    })
    .select('id')
    .single();
  if (documentError) throw documentError;

  // Without this row the document is visible to every member of staff -
  // that's the 0049 default. Someone else's contract is the last thing that
  // should be shared, so a failure here takes the document back out again
  // rather than leaving it readable by the whole team.
  const { error: recipientError } = await supabaseAdmin
    .from('company_document_recipients')
    .insert({ document_id: document.id, profile_id: profileId });

  if (recipientError) {
    await supabaseAdmin.from('company_documents').delete().eq('id', document.id);
    await supabaseAdmin.storage.from('company-documents').remove([storagePath]);
    throw recipientError;
  }

  return document.id;
}

export async function POST(request, { params }) {
  const { token } = params;

  const { data: invite, error: inviteError } = await supabaseAdmin
    .from('staff_invites')
    .select('id, status, expires_at, email, created_by, job_title, hourly_rate, pay_frequency, start_date, reports_to')
    .eq('token', token)
    .maybeSingle();

  if (inviteError || !invite) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (invite.status === 'submitted') {
    return NextResponse.json({ error: 'already_submitted' }, { status: 409 });
  }
  if (new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: 'expired' }, { status: 410 });
  }

  const formData = await request.formData();
  const fullName = formData.get('full_name')?.toString().trim();
  const address = formData.get('address')?.toString().trim() || null;
  const email = (invite.email || formData.get('email')?.toString().trim() || '').trim();
  const password = formData.get('password')?.toString() || '';
  const signedName = formData.get('signed_name')?.toString().trim();
  const policiesAgreed = formData.get('policies_agreed')?.toString() === 'true';
  const idFile = formData.get('id_document');

  if (!fullName || !signedName || !policiesAgreed || !email || password.length < 8) {
    return NextResponse.json({ error: 'missing_required_fields' }, { status: 400 });
  }

  // Built here from the terms on the invite, not taken from the browser.
  // The page renders the same text from the same function, but what gets
  // stored as the signed agreement has to be the server's copy - otherwise
  // the contract on file is whatever was posted to this route.
  const contractText = buildContractText({ full_name: fullName, address }, invite);

  // Create the new starter's login account as part of this same submission,
  // rather than relying on the separate open self-signup on the login page.
  const { data: created, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    // Marks an account the office made (0106); a self-signup cannot set
    // app_metadata. The trigger reads it too late - see below.
    app_metadata: { created_by_office: true },
  });

  if (createUserError) {
    const reason = createUserError.message?.toLowerCase().includes('already')
      ? 'email_taken'
      : 'account_creation_failed';
    return NextResponse.json({ error: reason }, { status: 400 });
  }

  // createUser inserts the auth user before it writes app_metadata, so
  // handle_new_user() never sees created_by_office and makes the profile
  // inactive. Switch it on here. Not fatal: the account exists and the
  // office can reactivate it from the staff page if this fails.
  const { error: activateError } = await supabaseAdmin
    .from('profiles')
    .update({ active: true })
    .eq('id', created.user.id);
  if (activateError) console.error('Could not activate new starter', created.user.id, activateError);

  let idDocumentPath = null;
  if (idFile && typeof idFile === 'object' && idFile.size > 0) {
    idDocumentPath = `${invite.id}/${Date.now()}-${idFile.name}`;
    const arrayBuffer = await idFile.arrayBuffer();
    const { error: uploadError } = await supabaseAdmin.storage
      .from('staff-documents')
      .upload(idDocumentPath, Buffer.from(arrayBuffer), { contentType: idFile.type });

    if (uploadError) {
      return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
    }
  }

  const signedIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;

  const { data: submission, error: insertError } = await supabaseAdmin
    .from('staff_onboarding_submissions')
    .insert({
      invite_id: invite.id,
      profile_id: created.user.id,
      full_name: fullName,
      date_of_birth: formData.get('date_of_birth')?.toString() || null,
      address,
      phone: formData.get('phone')?.toString().trim() || null,
      email,
      ni_number: formData.get('ni_number')?.toString().trim() || null,
      emergency_contact_name: formData.get('emergency_contact_name')?.toString().trim() || null,
      emergency_contact_phone: formData.get('emergency_contact_phone')?.toString().trim() || null,
      id_document_path: idDocumentPath,
      contract_text: contractText,
      policies_agreed: policiesAgreed,
      signed_name: signedName,
      signed_ip: signedIp,
    })
    .select('id, full_name, contract_text, signed_name, signed_at, signed_ip, policies_agreed')
    .single();

  if (insertError) {
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 });
  }

  try {
    const documentId = await fileSignedContract({ submission, invite, profileId: created.user.id });
    await supabaseAdmin
      .from('staff_onboarding_submissions')
      .update({ contract_document_id: documentId })
      .eq('id', submission.id);
  } catch (error) {
    console.error('Could not file the signed contract as a document', error);
  }

  // The submission above is the record of what they signed and stays as it
  // is. Their living details (staff_details, 0092) start out as a copy of
  // it, and from here on are kept current from My Profile and the office.
  // Not fatal if it fails: the submission is in and the office can fill the
  // card in by hand.
  await supabaseAdmin.from('staff_details').upsert({
    profile_id: created.user.id,
    phone: formData.get('phone')?.toString().trim() || null,
    address,
    date_of_birth: formData.get('date_of_birth')?.toString() || null,
    ni_number: formData.get('ni_number')?.toString().replace(/\s+/g, '').toUpperCase() || null,
    emergency_contact_name: formData.get('emergency_contact_name')?.toString().trim() || null,
    emergency_contact_phone: formData.get('emergency_contact_phone')?.toString().trim() || null,
    // The office set a start date when it made the invite; the day they
    // signed is not necessarily the day they start.
    start_date: invite.start_date || null,
    updated_by: created.user.id,
  }, { onConflict: 'profile_id' });

  await supabaseAdmin.from('staff_invites').update({ status: 'submitted' }).eq('id', invite.id);

  return NextResponse.json({ ok: true });
}
