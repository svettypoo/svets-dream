import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Allowlisted tables — assembler adds app entity tables automatically
const ALLOWED = ['inventory', 'products', 'contacts', 'leads', 'orders', 'tasks', 'projects', 'customers', 'employees', 'assets', 'properties', 'listings', 'events', 'tickets', 'items'];

// GET /api/data?table=inventory&search=laptop&sort=name&dir=asc&limit=25&offset=0
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const table = searchParams.get('table');
  if (!table || !ALLOWED.includes(table)) return Response.json({ error: 'Table not allowed' }, { status: 403 });

  const search = searchParams.get('search') || '';
  const sort = searchParams.get('sort') || 'created_at';
  const dir = searchParams.get('dir') === 'asc';
  const limit = Math.min(parseInt(searchParams.get('limit') || '25'), 200);
  const offset = parseInt(searchParams.get('offset') || '0');

  let query = supabase.from(table).select('*', { count: 'exact' })
    .order(sort, { ascending: dir })
    .range(offset, offset + limit - 1);

  // Text search across common text columns
  if (search) {
    // Supabase OR filter across multiple columns
    query = query.or(`name.ilike.%${search}%,title.ilike.%${search}%,description.ilike.%${search}%,email.ilike.%${search}%`);
  }

  // Apply any extra filter params (e.g. status=active)
  for (const [key, value] of searchParams.entries()) {
    if (['table', 'search', 'sort', 'dir', 'limit', 'offset'].includes(key)) continue;
    if (value) query = query.eq(key, value);
  }

  const { data, count, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ rows: data, total: count });
}

// POST /api/data — insert row
export async function POST(req) {
  const { table, row } = await req.json();
  if (!table || !ALLOWED.includes(table)) return Response.json({ error: 'Table not allowed' }, { status: 403 });
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ row: data }, { status: 201 });
}

// PATCH /api/data — update cell/row
export async function PATCH(req) {
  const { table, id, patch } = await req.json();
  if (!table || !ALLOWED.includes(table)) return Response.json({ error: 'Table not allowed' }, { status: 403 });
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from(table).update(patch).eq('id', id).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ row: data });
}

// DELETE /api/data?table=inventory&id=xxx
export async function DELETE(req) {
  const { searchParams } = new URL(req.url);
  const table = searchParams.get('table');
  const id = searchParams.get('id');
  if (!table || !ALLOWED.includes(table)) return Response.json({ error: 'Table not allowed' }, { status: 403 });
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });
  await supabase.from(table).delete().eq('id', id);
  return Response.json({ success: true });
}
