// Tracks AI API costs per user, enforces daily limits, logs transactions
import { createServiceClient } from './supabase-server'
import crypto from 'crypto'

const MODELS = {
  'claude-opus-4-6': { input: 5.0, output: 25.0 },     // per 1M tokens
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
}

export function calcCost(model, inputTokens, outputTokens) {
  const pricing = MODELS[model] || MODELS['claude-opus-4-6']
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
}

// Encrypt card data with AES-256-GCM
export function encryptCard(data, secret) {
  const key = crypto.scryptSync(secret, 'svets-dream-salt', 32)
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted.toString('hex')
}

export function decryptCard(ciphertext, secret) {
  const [ivHex, tagHex, encHex] = ciphertext.split(':')
  const key = crypto.scryptSync(secret, 'svets-dream-salt', 32)
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const encrypted = Buffer.from(encHex, 'hex')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return JSON.parse(decrypted.toString('utf8'))
}

// Get today's spend for a user (UTC day)
export async function getTodaySpend(userId) {
  const supabase = createServiceClient()
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const { data } = await supabase
    .from('api_transactions')
    .select('cost_usd')
    .eq('user_id', userId)
    .gte('created_at', today.toISOString())

  return (data || []).reduce((s, r) => s + (r.cost_usd || 0), 0)
}

// Check if user is under their daily budget; throws if over limit
export async function checkBudget(userId) {
  const supabase = createServiceClient()
  const { data: settings } = await supabase
    .from('user_billing')
    .select('daily_budget_usd')
    .eq('user_id', userId)
    .single()

  const budget = settings?.daily_budget_usd ?? 10
  if (budget <= 0) return // no limit

  const spent = await getTodaySpend(userId)
  if (spent >= budget) {
    throw new Error(`Daily budget of $${budget.toFixed(2)} reached ($${spent.toFixed(4)} spent). Reset at midnight UTC.`)
  }
}

// Record an API transaction
export async function recordTransaction({ userId, model, inputTokens, outputTokens, agentName, reason }) {
  const supabase = createServiceClient()
  const costUsd = calcCost(model, inputTokens, outputTokens)

  await supabase.from('api_transactions').insert({
    user_id: userId,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: costUsd,
    agent_name: agentName || null,
    reason: reason || null,
  })

  return costUsd
}

// Get user billing settings
export async function getBillingSettings(userId) {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('user_billing')
    .select('daily_budget_usd, card_last4, card_brand, card_exp')
    .eq('user_id', userId)
    .single()
  return data || { daily_budget_usd: 10 }
}
