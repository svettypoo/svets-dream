'use client';
import { useEffect, useState } from 'react';
import { createBrowserClient } from '@/lib/supabase-browser';
import OnboardingWizard from '@/components/OnboardingWizard';
import { useRouter } from 'next/navigation';

export default function OnboardingPage() {
  const [user, setUser] = useState(null);
  const supabase = createBrowserClient();
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/login'); return; }
      setUser(data.user);
    });
  }, []);

  if (!user) return null;

  return <OnboardingWizard userId={user.id} />;
}
