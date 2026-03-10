// API key generation + validation for user-facing API access
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function generateKey(prefix = 'sk') {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const random = Array.from({ length: 48 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${prefix}_${random}`;
}

export async function createApiKey(userId, { name, scopes = [], expiresInDays = null }) {
  const key = generateKey();
  const prefix = key.slice(0, 10) + '...'; // safe display prefix
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 86400_000).toISOString()
    : null;

  const { data, error } = await supabase.from('api_keys').insert({
    user_id: userId,
    name: name || 'Default',
    key_hash: await hashKey(key),
    key_prefix: prefix,
    scopes: scopes || [],
    expires_at: expiresAt,
  }).select().single();

  if (error) throw error;
  return { ...data, key }; // return plaintext key ONCE — not stored
}

export async function validateApiKey(rawKey) {
  const hashed = await hashKey(rawKey);
  const { data, error } = await supabase
    .from('api_keys')
    .select('*, profiles(id, email, role)')
    .eq('key_hash', hashed)
    .eq('is_active', true)
    .single();

  if (error || !data) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

  // Update last used
  supabase.from('api_keys').update({ last_used_at: new Date().toISOString(), use_count: (data.use_count || 0) + 1 })
    .eq('id', data.id).then(() => {});

  return data;
}

export async function revokeApiKey(keyId, userId) {
  const { error } = await supabase.from('api_keys')
    .update({ is_active: false })
    .eq('id', keyId)
    .eq('user_id', userId); // security: only revoke own keys
  return !error;
}

async function hashKey(key) {
  const encoder = new TextEncoder();
  const data = encoder.encode(key + (process.env.API_KEY_SALT || 'forge-salt'));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
