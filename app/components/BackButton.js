'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

export default function BackButton() {
  const router = useRouter();
  return (
    <button type="button" onClick={() => router.back()} className="back-button" aria-label="Go back" title="Go back to the previous page">
      <ArrowLeft size={16} /> Back
    </button>
  );
}
