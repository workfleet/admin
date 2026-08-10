import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';

export async function POST(request, { params }) {
  const { token } = params;

  const { data: invite, error: inviteError } = await supabaseAdmin
    .from('staff_invites')
    .select('id, status, expires_at')
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
  const signedName = formData.get('signed_name')?.toString().trim();
  const contractText = formData.get('contract_text')?.toString();
  const idFile = formData.get('id_document');

  if (!fullName || !signedName || !contractText) {
    return NextResponse.json({ error: 'missing_required_fields' }, { status: 400 });
  }

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

  const { error: insertError } = await supabaseAdmin.from('staff_onboarding_submissions').insert({
    invite_id: invite.id,
    full_name: fullName,
    date_of_birth: formData.get('date_of_birth')?.toString() || null,
    address: formData.get('address')?.toString().trim() || null,
    phone: formData.get('phone')?.toString().trim() || null,
    email: formData.get('email')?.toString().trim() || null,
    ni_number: formData.get('ni_number')?.toString().trim() || null,
    emergency_contact_name: formData.get('emergency_contact_name')?.toString().trim() || null,
    emergency_contact_phone: formData.get('emergency_contact_phone')?.toString().trim() || null,
    id_document_path: idDocumentPath,
    contract_text: contractText,
    signed_name: signedName,
    signed_ip: signedIp,
  });

  if (insertError) {
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 });
  }

  await supabaseAdmin.from('staff_invites').update({ status: 'submitted' }).eq('id', invite.id);

  return NextResponse.json({ ok: true });
}
