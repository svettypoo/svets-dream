import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// GET /api/export?table=users&columns=name,email,created_at&status=active
// Returns: CSV file download
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const table = searchParams.get('table');
  const colParam = searchParams.get('columns');
  if (!table) return new Response('table required', { status: 400 });

  // Allowlist tables — add more as needed
  const ALLOWED_TABLES = ['users', 'profiles', 'orders', 'bookings', 'submissions', 'waitlist', 'contacts', 'blog_posts', 'tasks', 'form_submissions', 'comments'];
  if (!ALLOWED_TABLES.includes(table)) {
    return new Response('Table not allowed for export', { status: 403 });
  }

  const columns = colParam ? colParam.split(',').join(', ') : '*';

  // Build filter from remaining params
  let query = supabase.from(table).select(columns).order('created_at', { ascending: false }).limit(10000);
  for (const [key, value] of searchParams.entries()) {
    if (['table', 'columns'].includes(key)) continue;
    query = query.eq(key, value);
  }

  const { data, error } = await query;
  if (error) return new Response(`Export error: ${error.message}`, { status: 500 });
  if (!data || data.length === 0) return new Response('No data', { status: 404 });

  // Build CSV
  const headers = Object.keys(data[0]);
  const rows = [
    headers.join(','),
    ...data.map(row =>
      headers.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"` : str;
      }).join(',')
    )
  ].join('\n');

  return new Response(rows, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${table}-export.csv"`,
    },
  });
}
