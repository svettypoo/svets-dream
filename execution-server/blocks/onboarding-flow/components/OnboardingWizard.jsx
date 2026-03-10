'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// STEPS: array of { id, title, description, fields: [{ name, type, label, placeholder, required, options }] }
// Override STEPS from config or pass as prop

const DEFAULT_STEPS = [
  {
    id: 'profile',
    title: 'Tell us about yourself',
    description: 'Help us personalize your experience.',
    fields: [
      { name: 'full_name', type: 'text', label: 'Your Name', placeholder: 'Jane Smith', required: true },
      { name: 'company', type: 'text', label: 'Company (optional)', placeholder: 'Acme Inc.' },
    ],
  },
  {
    id: 'goal',
    title: 'What brings you here?',
    description: "We'll tailor your experience based on your goal.",
    fields: [
      { name: 'goal', type: 'radio', label: 'Primary goal', required: true, options: [
        { value: 'personal', label: '🙋 Personal use' },
        { value: 'team', label: '👥 Team collaboration' },
        { value: 'business', label: '🏢 Business growth' },
        { value: 'other', label: '🤔 Something else' },
      ]},
    ],
  },
  {
    id: 'plan',
    title: "You're almost there!",
    description: 'Choose how you want to get started.',
    fields: [
      { name: 'plan', type: 'radio', label: 'Start with', required: true, options: [
        { value: 'free', label: '🆓 Free — get started now' },
        { value: 'pro', label: '⚡ Pro — unlock everything ($29/mo)' },
      ]},
    ],
  },
];

export default function OnboardingWizard({ steps = DEFAULT_STEPS, userId, onComplete }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [saving, setSaving] = useState(false);
  const current = steps[step];

  function set(name, value) { setAnswers(a => ({ ...a, [name]: value })); }

  function valid() {
    return current.fields.filter(f => f.required).every(f => answers[f.name]);
  }

  async function next() {
    if (step < steps.length - 1) { setStep(s => s + 1); return; }
    // Final step — save and complete
    setSaving(true);
    await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, answers }),
    });
    setSaving(false);
    onComplete ? onComplete(answers) : router.push('/dashboard');
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        {/* Progress */}
        <div className="flex gap-1 mb-8">
          {steps.map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? 'bg-blue-500' : 'bg-gray-200'}`} />
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="text-sm text-blue-500 font-semibold mb-1">Step {step + 1} of {steps.length}</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{current.title}</h2>
          <p className="text-gray-500 mb-6">{current.description}</p>

          <div className="space-y-5">
            {current.fields.map(field => (
              <div key={field.name}>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {field.label} {field.required && <span className="text-red-500">*</span>}
                </label>

                {field.type === 'text' && (
                  <input type="text" value={answers[field.name] || ''} onChange={e => set(field.name, e.target.value)}
                    placeholder={field.placeholder}
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                )}

                {field.type === 'radio' && (
                  <div className="space-y-2">
                    {field.options?.map(opt => (
                      <label key={opt.value}
                        className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${answers[field.name] === opt.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                        <input type="radio" name={field.name} value={opt.value}
                          checked={answers[field.name] === opt.value}
                          onChange={() => set(field.name, opt.value)}
                          className="accent-blue-600" />
                        <span className="text-sm font-medium text-gray-700">{opt.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-between mt-8">
            {step > 0 ? (
              <button onClick={() => setStep(s => s - 1)} className="px-4 py-2 text-gray-500 hover:text-gray-700">← Back</button>
            ) : <div />}
            <button onClick={next} disabled={!valid() || saving}
              className="px-6 py-2 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-40">
              {saving ? 'Saving...' : step < steps.length - 1 ? 'Continue →' : "Let's go!"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
