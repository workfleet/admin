'use client';

import { PageSkeleton } from '../../components/Skeleton';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import BackButton from '../../components/BackButton';
import NightHealthForm from '../../components/NightHealthForm';
import NightHealthSent from '../../components/NightHealthSent';
import { COLUMNS, emptyAnswers, formProblems, rowFromForm } from '../../../lib/nightHealth';

// The night worker health questionnaire (0143). Confidential: the table
// lets this person read their own and admins read everyone's, nobody else.

export default function NightHealthQuestionnaire() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [mine, setMine] = useState([]);
  const [filling, setFilling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState([]);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState({
    roleAndSite: '', shiftPattern: '', answers: emptyAnswers(), details: '',
    wantsAssessment: null, signedName: '', confirmed: false,
  });

  useEffect(() => { load(); }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }
    setUserId(session.user.id);
    const [{ data, error }, { data: profile }] = await Promise.all([
      supabase.from('night_health_questionnaires').select(COLUMNS)
        .eq('profile_id', session.user.id).order('submitted_at', { ascending: false }),
      supabase.from('profiles').select('full_name').eq('id', session.user.id).maybeSingle(),
    ]);
    if (error) setUnavailable(true);
    setMine(data || []);
    setFilling(!error && (data || []).length === 0);
    setForm((f) => ({ ...f, signedName: f.signedName || profile?.full_name || '' }));
    setLoading(false);
  };

  const change = (patch) => { setForm((f) => ({ ...f, ...patch })); setProblems([]); setSaveError(''); };

  const submit = async (e) => {
    e.preventDefault();
    const found = formProblems(form);
    if (found.length > 0) { setProblems(found); return; }
    setSaving(true);
    const { data, error } = await supabase.from('night_health_questionnaires')
      .insert(rowFromForm(userId, form)).select(COLUMNS).single();
    setSaving(false);
    if (error || !data) {
      setSaveError(error && /fetch|network/i.test(error.message || '')
        ? "Couldn't send it - there's no signal. Your answers are still here; try again when you're back in range."
        : "Couldn't send it. Try again in a moment, or ring the office.");
      return;
    }
    setMine((prev) => [data, ...prev]);
    setFilling(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) return <PageSkeleton className="container" rows={3} />;

  return (
    <div className="container">
      <BackButton />
      <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--muted)', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Lock size={13} /> Confidential · Night workers
      </p>
      <h1 style={{ marginTop: 0 }}>Night worker health questionnaire</h1>

      {unavailable && (
        <div className="card">
          <p style={{ margin: 0, fontSize: 14 }}>This isn't ready yet. Ask the office for the paper form in the meantime.</p>
        </div>
      )}

      {mine.length > 0 && !filling && <NightHealthSent rows={mine} onFillAgain={() => setFilling(true)} />}

      {filling && (
        <NightHealthForm
          form={form}
          onChange={change}
          problems={problems}
          saveError={saveError}
          saving={saving}
          onSubmit={submit}
          onCancel={mine.length > 0 ? () => setFilling(false) : null}
        />
      )}
    </div>
  );
}
