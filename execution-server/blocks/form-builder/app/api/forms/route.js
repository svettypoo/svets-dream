import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET /api/forms — list forms; GET /api/forms?id=xxx — get single form with submissions
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (id) {
    const [{ data: form }, { data: submissions, count }] = await Promise.all([
      supabase.from('forms').select('*').eq('id', id).single(),
      supabase.from('form_submissions').select('*', { count: 'exact' }).eq('form_id', id).order('created_at', { ascending: false }),
    ]);
    if (!form) return Response.json({ error: 'Form not found' }, { status: 404 });
    return Response.json({ form, submissions, total: count });
  }

  const { data, error } = await supabase
    .from('forms')
    .select('id, title, description, status, created_at')
    .order('created_at', { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ forms: data });
}

// POST /api/forms — create form
export async function POST(req) {
  const body = await req.json();
  const { title, description, fields, success_message, submit_label } = body;
  if (!title || !fields) return Response.json({ error: 'title and fields required' }, { status: 400 });

  const { data, error } = await supabase.from('forms').insert({
    title, description,
    schema: { fields, success_message, submit_label },
    status: 'active',
  }).select().single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ form: data }, { status: 201 });
}

// POST /api/forms/submit — record a form submission
// Called by FormRenderer via onSubmit
export async function PUT(req) {
  const { formId, values } = await req.json();
  if (!formId) return Response.json({ error: 'formId required' }, { status: 400 });

  const { data: form } = await supabase.from('forms').select('id, schema').eq('id', formId).single();
  if (!form) return Response.json({ error: 'Form not found' }, { status: 404 });

  const { error } = await supabase.from('form_submissions').insert({
    form_id: formId,
    data: values,
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}

// PATCH /api/forms — update form
export async function PATCH(req) {
  const { id, ...updates } = await req.json();
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });
  updates.updated_at = new Date().toISOString();
  if (updates.fields) { updates.schema = { ...(updates.schema || {}), fields: updates.fields }; delete updates.fields; }
  const { data, error } = await supabase.from('forms').update(updates).eq('id', id).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ form: data });
}
