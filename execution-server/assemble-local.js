#!/usr/bin/env node
/**
 * assemble-local.js — deterministic block assembler, NO API calls
 *
 * Usage:
 *   node assemble-local.js --config configs/stayfinder.json
 *   node assemble-local.js --config configs/stayfinder.json --out /tmp/stayfinder
 *
 * What it does:
 *   1. Reads config JSON (blocks, appName, entities, nav, colors, etc.)
 *   2. Copies block files → output directory
 *   3. Substitutes template variables (APP_NAME, PRIMARY_COLOR, etc.)
 *   4. Writes .env.local and supabase-schema.sql
 *   5. Writes block-assessment.json — where blocks fit vs need adjustment
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const args = process.argv.slice(2)
const configFlag = args.indexOf('--config')
const outFlag = args.indexOf('--out')
const dryRun = args.includes('--dry-run')
const noInstall = args.includes('--no-install')

if (configFlag === -1) {
  console.error('Usage: node assemble-local.js --config <path.json> [--out <dir>] [--dry-run] [--no-install]')
  process.exit(1)
}

const configPath = path.resolve(args[configFlag + 1])
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

const BLOCKS_DIR = path.join(__dirname, 'blocks')
const outDir = outFlag !== -1 ? path.resolve(args[outFlag + 1]) : path.join(__dirname, '..', '..', 'workspace', config.appName || 'my-app')

console.log(`\n⚒  Assembling: ${config.appName}`)
console.log(`   Output:     ${outDir}`)
console.log(`   Blocks:     ${config.blocks.join(', ')}\n`)

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!dryRun) fs.mkdirSync(dir, { recursive: true })
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath))
  if (!dryRun) fs.writeFileSync(filePath, content, 'utf8')
  const rel = path.relative(outDir, filePath)
  console.log(`   + ${rel}`)
}

function copyBlock(blockId, srcRel, destRel) {
  const src = path.join(BLOCKS_DIR, blockId, srcRel)
  const dest = path.join(outDir, destRel || srcRel)
  if (!fs.existsSync(src)) { console.warn(`   ⚠ Missing: ${src}`); return }
  const raw = fs.readFileSync(src, 'utf8')
  const processed = applyTemplateVars(raw, config)
  writeFile(dest, processed)
}

function applyTemplateVars(content, cfg) {
  return content
    .replace(/APP_NAME/g, cfg.appName || 'MyApp')
    .replace(/APP_TAGLINE/g, cfg.tagline || 'The best platform for you')
    .replace(/PRIMARY_COLOR/g, cfg.primaryColor || '#6366f1')
    .replace(/BRAND_COLOR/g, cfg.primaryColor || '#6366f1')
}

function log(msg) { console.log(`\n── ${msg} ──`) }
function done(blockId) { console.log(`   ✓ ${blockId} done`) }

// ── Assessment tracker ────────────────────────────────────────────────────────

const assessments = []
function assess(blockId, fit, notes, permanent = null) {
  assessments.push({ blockId, fit, notes, permanent, timestamp: new Date().toISOString() })
}

// ── ASSEMBLERS ────────────────────────────────────────────────────────────────

const ASSEMBLERS = {

  'shadcn-init': () => {
    log('shadcn-init: shadcn/ui component foundation')
    const shadcnSetup = require(path.join(BLOCKS_DIR, 'shadcn-init/setup.js'))
    shadcnSetup(outDir, config)
    assess('shadcn-init', 'perfect', '50+ polished Radix-based components available after init')
  },

  'next-shell': () => {
    log('next-shell: Next.js App Shell')
    copyBlock('next-shell', 'package.json', 'package.json')
    copyBlock('next-shell', 'next.config.js', 'next.config.js')
    copyBlock('next-shell', 'tailwind.config.js', 'tailwind.config.js')
    copyBlock('next-shell', 'app/layout.js', 'app/layout.js')
    copyBlock('next-shell', 'app/globals.css', 'app/globals.css')

    // Patch tailwind config with app's primary color
    if (!dryRun && config.primaryColor) {
      const tcPath = path.join(outDir, 'tailwind.config.js')
      if (fs.existsSync(tcPath)) {
        let tc = fs.readFileSync(tcPath, 'utf8')
        // Inject brand color — replace placeholder or add if not present
        if (!tc.includes('brand:')) {
          tc = tc.replace("extend: {", `extend: {\n        colors: { brand: { 50: '#f0f9ff', 100: '#e0f2fe', 200: '#bae6fd', 300: '#7dd3fc', 400: '#38bdf8', 500: '${config.primaryColor}', 600: '${config.primaryColor}', 700: '${config.primaryColor}', 800: '${config.primaryColor}', 900: '${config.primaryColor}' } },`)
          fs.writeFileSync(tcPath, tc, 'utf8')
        }
      }
    }
    assess('next-shell', 'perfect', 'Foundation block — always fits as-is')
    done('next-shell')
  },

  'supabase': () => {
    log('supabase: DB clients')
    copyBlock('supabase', 'lib/supabase-browser.js', 'lib/supabase-browser.js')
    copyBlock('supabase', 'lib/supabase-server.js', 'lib/supabase-server.js')
    copyBlock('supabase', 'middleware.js', 'middleware.js')
    assess('supabase', 'perfect', 'Infrastructure block — always fits')
    done('supabase')
  },

  'auth-email': () => {
    log('auth-email: Email/password login')
    copyBlock('auth', 'app/login/page.js', 'app/login/page.js')
    copyBlock('auth', 'app/api/auth/route.js', 'app/api/auth/route.js')
    assess('auth-email', 'perfect', 'Standard login/signup — no customization needed')
    done('auth-email')
  },

  'auth-google': () => {
    log('auth-google: Google OAuth')
    copyBlock('auth-google', 'components/GoogleAuthButton.jsx', 'components/GoogleAuthButton.jsx')
    copyBlock('auth-google', 'app/api/auth/callback/route.js', 'app/api/auth/callback/route.js')
    // Patch login page to include Google button
    const loginPath = path.join(outDir, 'app/login/page.js')
    if (!dryRun && fs.existsSync(loginPath)) {
      let lp = fs.readFileSync(loginPath, 'utf8')
      if (!lp.includes('GoogleAuthButton')) {
        lp = `import GoogleAuthButton from '@/components/GoogleAuthButton'\n` + lp
        lp = lp.replace('</form>', `</form>\n        <div className="relative my-4"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div><div className="relative flex justify-center text-xs text-gray-400"><span className="bg-white px-2">or</span></div></div>\n        <GoogleAuthButton />`)
        fs.writeFileSync(loginPath, lp, 'utf8')
        console.log('   ✎ Patched app/login/page.js → added Google button')
      }
    }
    assess('auth-google', 'perfect', 'SSO adds value for any app')
    done('auth-google')
  },

  'dashboard-layout': () => {
    log('dashboard-layout: Sidebar + auth guard')
    // Generate nav from config
    const navItems = config.navItems || [{ label: 'Dashboard', href: '/dashboard', icon: 'LayoutDashboard' }]
    let layoutSrc = fs.readFileSync(path.join(BLOCKS_DIR, 'dashboard/app/dashboard/layout.js'), 'utf8')
    let sidebarSrc = fs.readFileSync(path.join(BLOCKS_DIR, 'dashboard/components/Sidebar.jsx'), 'utf8')

    // Inject nav items into sidebar
    const navCode = JSON.stringify(navItems, null, 2)
    sidebarSrc = sidebarSrc.replace(/const NAV_ITEMS = \[[\s\S]*?\]/, `const NAV_ITEMS = ${navCode}`)

    writeFile(path.join(outDir, 'app/dashboard/layout.js'), applyTemplateVars(layoutSrc, config))
    writeFile(path.join(outDir, 'components/Sidebar.jsx'), applyTemplateVars(sidebarSrc, config))
    assess('dashboard-layout', 'good', `Nav items injected from config: ${navItems.map(n => n.label).join(', ')}`, null)
    done('dashboard-layout')
  },

  'crud-table': () => {
    log('crud-table: Data tables per entity')
    copyBlock('crud', 'components/DataTable.jsx', 'components/DataTable.jsx')
    const entities = config.entities || []
    for (const entity of entities) {
      const name = entity.name
      const label = entity.label || name
      const fields = entity.fields || ['name', 'created_at']
      const columns = fields.map(f => `{ key: '${f}', label: '${f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}' }`)
      const pageContent = `'use client'
import { useState, useEffect } from 'react'
import DataTable from '@/components/DataTable'
import { createBrowserClient } from '@/lib/supabase-browser'

const COLUMNS = [${columns.join(', ')}]

export default function ${label.replace(/\s/g, '')}Page() {
  const supabase = createBrowserClient()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('${name}').select('*').order('created_at', { ascending: false })
    setRows(data || [])
    setLoading(false)
  }

  async function handleDelete(row) {
    if (!confirm(\`Delete this ${label.toLowerCase()}?\`)) return
    await supabase.from('${name}').delete().eq('id', row.id)
    setRows(prev => prev.filter(r => r.id !== row.id))
  }

  return (
    <div className="p-6">
      <DataTable
        title="${label}"
        columns={COLUMNS}
        rows={rows}
        loading={loading}
        onDelete={handleDelete}
      />
    </div>
  )
}
`
      writeFile(path.join(outDir, `app/dashboard/${name}/page.js`), pageContent)
    }
    assess('crud-table', 'good', `Generated ${entities.length} entity tables`, null)
    done('crud-table')
  },

  'crud-api': () => {
    log('crud-api: REST routes per entity')
    const entities = config.entities || []
    for (const entity of entities) {
      const src = fs.readFileSync(path.join(BLOCKS_DIR, 'crud/app/api/template/route.js'), 'utf8')
      const content = src.replace(/TABLE_NAME/g, entity.name)
      writeFile(path.join(outDir, `app/api/${entity.name}/route.js`), content)
    }
    assess('crud-api', 'good', `Generated ${entities.length} API routes`, null)
    done('crud-api')
  },

  'bookings': () => {
    log('bookings: Reservation system')
    copyBlock('bookings', 'components/BookingForm.jsx', 'components/BookingForm.jsx')
    copyBlock('bookings', 'components/DateRangePicker.jsx', 'components/DateRangePicker.jsx')
    copyBlock('bookings', 'app/api/bookings/route.js', 'app/api/bookings/route.js')
    assess('bookings', 'perfect', 'Core booking logic — conflict check, price breakdown, guest count. Fits booking engine exactly.')
    done('bookings')
  },

  'search-filters': () => {
    log('search-filters: Search UI + listing cards')
    copyBlock('search-filters', 'components/SearchFilters.jsx', 'components/SearchFilters.jsx')
    copyBlock('search-filters', 'components/ListingCard.jsx', 'components/ListingCard.jsx')
    copyBlock('search-filters', 'app/search/page.js', 'app/search/page.js')

    // Generate listings API
    const listingsApi = `import { createAdminClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export async function GET(req) {
  const supabase = createAdminClient()
  const { searchParams } = new URL(req.url)
  let query = supabase.from('listings').select('*').eq('is_published', true)
  if (searchParams.get('query')) query = query.ilike('title', \`%\${searchParams.get('query')}%\`)
  if (searchParams.get('location')) query = query.ilike('location', \`%\${searchParams.get('location')}%\`)
  if (searchParams.get('minPrice')) query = query.gte('price_per_night', searchParams.get('minPrice'))
  if (searchParams.get('maxPrice')) query = query.lte('price_per_night', searchParams.get('maxPrice'))
  if (searchParams.get('guests')) query = query.gte('max_guests', searchParams.get('guests'))
  if (searchParams.get('minRating')) query = query.gte('rating', searchParams.get('minRating'))
  query = query.order('created_at', { ascending: false })
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
`
    writeFile(path.join(outDir, 'app/api/listings/route.js'), listingsApi)
    assess('search-filters', 'perfect', 'Listing search with all filters wired to Supabase. Date availability check TODO.')
    done('search-filters')
  },

  'reviews-ratings': () => {
    log('reviews-ratings: Star ratings + reviews')
    copyBlock('reviews-ratings', 'components/ReviewSection.jsx', 'components/ReviewSection.jsx')
    copyBlock('reviews-ratings', 'app/api/reviews/route.js', 'app/api/reviews/route.js')
    assess('reviews-ratings', 'perfect', 'Full review section with breakdown bars and form')
    done('reviews-ratings')
  },

  'image-gallery': () => {
    log('image-gallery: Photo gallery + lightbox')
    copyBlock('image-gallery', 'components/ImageGallery.jsx', 'components/ImageGallery.jsx')
    assess('image-gallery', 'perfect', 'Hero + grid layout matches Airbnb style exactly')
    done('image-gallery')
  },

  'map-view': () => {
    log('map-view: Leaflet property map')
    copyBlock('map-view', 'components/MapView.jsx', 'components/MapView.jsx')
    assess('map-view', 'perfect', 'Price-pin markers on OpenStreetMap tiles — no API key needed')
    done('map-view')
  },

  'user-profiles': () => {
    log('user-profiles: Host/guest profiles')
    copyBlock('user-profiles', 'components/ProfileCard.jsx', 'components/ProfileCard.jsx')
    copyBlock('user-profiles', 'app/api/profiles/route.js', 'app/api/profiles/route.js')
    assess('user-profiles', 'good', 'Profile card has host stats. Need to add: verification badge, response rate, superhost badge.')
    done('user-profiles')
  },

  'chat-realtime': () => {
    log('chat-realtime: Real-time messaging')
    copyBlock('chat-realtime', 'components/ChatWindow.jsx', 'components/ChatWindow.jsx')
    copyBlock('chat-realtime', 'components/ConversationList.jsx', 'components/ConversationList.jsx')
    copyBlock('chat-realtime', 'app/api/messages/route.js', 'app/api/messages/route.js')
    // Generate messages dashboard page
    const msgPage = `'use client'
import { useState } from 'react'
import ConversationList from '@/components/ConversationList'
import ChatWindow from '@/components/ChatWindow'
import { createBrowserClient } from '@/lib/supabase-browser'
import { useEffect } from 'react'

export default function MessagesPage() {
  const supabase = createBrowserClient()
  const [user, setUser] = useState(null)
  const [selected, setSelected] = useState(null)
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUser(data.user)) }, [])
  if (!user) return <div className="p-8 text-gray-400">Loading…</div>
  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">
      <div className="w-80 border-r border-gray-200 overflow-y-auto flex-shrink-0">
        <div className="px-4 py-4 border-b border-gray-100">
          <h1 className="text-lg font-bold text-gray-900">Messages</h1>
        </div>
        <ConversationList currentUserId={user.id} onSelect={setSelected} selectedId={selected?.id} />
      </div>
      <div className="flex-1">
        {selected ? (
          <ChatWindow conversationId={selected.id} currentUserId={user.id} />
        ) : (
          <div className="h-full flex items-center justify-center text-gray-400">
            <div className="text-center"><div className="text-4xl mb-3">💬</div><p>Select a conversation</p></div>
          </div>
        )}
      </div>
    </div>
  )
}
`
    writeFile(path.join(outDir, 'app/dashboard/messages/page.js'), msgPage)
    assess('chat-realtime', 'perfect', 'Supabase realtime subscription + conversation threads. find_conversation RPC TODO.')
    done('chat-realtime')
  },

  'notifications': () => {
    log('notifications: Toast + bell')
    copyBlock('notifications', 'components/Toast.jsx', 'components/Toast.jsx')
    copyBlock('notifications', 'components/NotificationBell.jsx', 'components/NotificationBell.jsx')
    // Patch layout.js
    const layoutPath = path.join(outDir, 'app/layout.js')
    if (!dryRun && fs.existsSync(layoutPath)) {
      let lp = fs.readFileSync(layoutPath, 'utf8')
      if (!lp.includes('ToastProvider')) {
        lp = `import { ToastProvider } from '@/components/Toast'\n` + lp
        lp = lp.replace('<body>', '<body>\n        <ToastProvider>')
        lp = lp.replace('</body>', '</ToastProvider>\n        </body>')
        fs.writeFileSync(layoutPath, lp, 'utf8')
        console.log('   ✎ Patched app/layout.js → wrapped with ToastProvider')
      }
    }
    assess('notifications', 'perfect', 'Toast system works globally after layout patch')
    done('notifications')
  },

  'stripe': () => {
    log('stripe: Payment intents')
    copyBlock('stripe', 'lib/stripe.js', 'lib/stripe.js')
    copyBlock('stripe', 'app/api/stripe/route.js', 'app/api/stripe/route.js')
    assess('stripe', 'partial', 'Stripe payment intents work. For marketplace/host payouts, replace with stripe-connect block.', false)
    done('stripe')
  },

  'stripe-connect': () => {
    log('stripe-connect: Marketplace payments + host payouts')
    copyBlock('stripe-connect', 'lib/stripe-connect.js', 'lib/stripe-connect.js')
    copyBlock('stripe-connect', 'app/api/stripe/connect/route.js', 'app/api/stripe/connect/route.js')
    copyBlock('stripe-connect', 'components/ConnectOnboarding.jsx', 'components/ConnectOnboarding.jsx')
    assess('stripe-connect', 'perfect', 'Express Connect for host onboarding + charge-with-transfer pattern. Exactly right for Airbnb model.')
    done('stripe-connect')
  },

  'sms-telnyx': () => {
    log('sms-telnyx: SMS notifications')
    copyBlock('sms-telnyx', 'lib/telnyx.js', 'lib/telnyx.js')
    copyBlock('sms-telnyx', 'app/api/sms/route.js', 'app/api/sms/route.js')
    copyBlock('sms-telnyx', 'app/api/sms/webhook/route.js', 'app/api/sms/webhook/route.js')
    assess('sms-telnyx', 'perfect', 'SMS booking confirmations + OTP auth. Webhook stores inbound SMS.')
    done('sms-telnyx')
  },

  'email-resend': () => {
    log('email-resend: Transactional email')
    copyBlock('email-resend', 'lib/resend.js', 'lib/resend.js')
    copyBlock('email-resend', 'app/api/email/route.js', 'app/api/email/route.js')
    assess('email-resend', 'perfect', 'Transactional email — booking confirmations, receipts')
    done('email-resend')
  },

  'email-marketing': () => {
    log('email-marketing: Campaign emails')
    copyBlock('email-marketing', 'lib/resend-campaigns.js', 'lib/resend-campaigns.js')
    copyBlock('email-marketing', 'components/CampaignBuilder.jsx', 'components/CampaignBuilder.jsx')
    copyBlock('email-marketing', 'app/api/emails/campaign/route.js', 'app/api/emails/campaign/route.js')
    assess('email-marketing', 'partial', 'Campaign builder fits admin use. For booking engine: only use for host newsletters — not core feature.', false)
    done('email-marketing')
  },

  'file-upload': () => {
    log('file-upload: Supabase Storage')
    copyBlock('file-upload', 'app/api/upload/route.js', 'app/api/upload/route.js')
    assess('file-upload', 'perfect', 'Listing photo uploads → Supabase Storage')
    done('file-upload')
  },

  'tasks': () => {
    log('tasks: Task management')
    copyBlock('tasks', 'components/TaskBoard.jsx', 'components/TaskBoard.jsx')
    copyBlock('tasks', 'app/dashboard/tasks/page.js', 'app/dashboard/tasks/page.js')
    copyBlock('tasks', 'app/api/tasks/route.js', 'app/api/tasks/route.js')
    assess('tasks', 'partial', 'Task board is complete but not core for booking engine. Useful for host management / internal ops.', false)
    done('tasks')
  },

  'about-page': () => {
    log('about-page: About/team page')
    copyBlock('about-page', 'app/about/page.js', 'app/about/page.js')
    assess('about-page', 'good', `APP_NAME, tagline injected. Team members hardcoded — should come from config or CMS.`, true)
    done('about-page')
  },

  'pricing-page': () => {
    log('pricing-page: Pricing tiers')
    copyBlock('pricing-page', 'app/pricing/page.js', 'app/pricing/page.js')
    assess('pricing-page', 'partial', 'Tiers hardcoded — OK for SaaS, not needed for pure booking engine marketplace.', false)
    done('pricing-page')
  },

  'contact-form': () => {
    log('contact-form: Contact page + API')
    copyBlock('contact-form', 'app/contact/page.js', 'app/contact/page.js')
    copyBlock('contact-form', 'app/api/contact/route.js', 'app/api/contact/route.js')
    assess('contact-form', 'perfect', 'Saves to DB + sends notification email. Works for any app.')
    done('contact-form')
  },

  'landing': () => {
    log('landing: Hero page')
    copyBlock('landing', 'components/Hero.jsx', 'components/Hero.jsx')
    // Generate app-specific landing page
    const landingPage = `import Hero from '@/components/Hero'

export default function HomePage() {
  return (
    <main>
      <Hero
        headline="${config.headline || `Welcome to ${config.appName}`}"
        subheadline="${config.subheadline || config.tagline || 'Discover amazing places to stay'}"
        ctaText="${config.ctaText || 'Start exploring'}"
        ctaHref="/search"
        secondaryCta="List your place"
        secondaryHref="/host/signup"
      />
    </main>
  )
}
`
    writeFile(path.join(outDir, 'app/page.js'), landingPage)
    assess('landing', 'good', 'Headline/CTA from config. Added secondary CTA for host signup.')
    done('landing')
  },

  'settings-page': () => {
    log('settings-page: User settings')
    copyBlock('settings-page', 'app/dashboard/settings/page.js', 'app/dashboard/settings/page.js')
    assess('settings-page', 'good', 'Profile/password/notifications tabs. Fits any app. Host-specific settings TODO.')
    done('settings-page')
  },

  'cron': () => {
    log('cron: Scheduled jobs')
    copyBlock('cron', 'app/api/cron/route.js', 'app/api/cron/route.js')
    copyBlock('cron', 'scripts/railway-cron.js', 'scripts/railway-cron.js')
    assess('cron', 'good', 'Cron endpoint + runner. Useful for: send booking reminders, expire old bookings, send review requests.')
    done('cron')
  },
}

// ── Run assembly ──────────────────────────────────────────────────────────────

const ordered = [
  'shadcn-init', 'next-shell', 'supabase', 'auth-email', 'auth-google',
  'dashboard-layout', 'crud-table', 'crud-api',
  'bookings', 'search-filters', 'reviews-ratings',
  'image-gallery', 'map-view', 'user-profiles', 'chat-realtime',
  'notifications', 'stripe', 'stripe-connect',
  'sms-telnyx', 'email-resend', 'email-marketing',
  'file-upload', 'tasks', 'about-page', 'pricing-page', 'contact-form',
  'landing', 'settings-page', 'cron',
]

ensureDir(outDir)

for (const blockId of ordered) {
  if (!config.blocks.includes(blockId)) continue
  if (!ASSEMBLERS[blockId]) { console.warn(`⚠ No assembler for ${blockId}`); continue }
  ASSEMBLERS[blockId]()
}

// ── .env.local ────────────────────────────────────────────────────────────────

log('Writing .env.local')
const envContent = `# ${config.appName} — generated by assemble-local.js
# Fill in your actual values before running

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Anthropic (optional — for AI chat block)
ANTHROPIC_API_KEY=

# Resend (email)
RESEND_API_KEY=
RESEND_FROM=noreply@${config.appName?.toLowerCase().replace(/\s/g, '')}.com

# Stripe
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=

# Telnyx (SMS)
TELNYX_API_KEY=
TELNYX_FROM_NUMBER=+1xxxxxxxxxx

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=${Math.random().toString(36).slice(2)}
`
writeFile(path.join(outDir, '.env.local.example'), envContent)

// ── Supabase schema ───────────────────────────────────────────────────────────

log('Writing supabase-schema.sql')
const entityTables = (config.entities || []).map(e => {
  const fields = (e.fields || ['name']).map(f => {
    if (f === 'id') return null
    if (f.endsWith('_at')) return `  ${f} timestamptz default now()`
    if (f.endsWith('_id')) return `  ${f} uuid references profiles(id)`
    if (f.endsWith('_url')) return `  ${f} text`
    if (f.startsWith('price') || f.startsWith('amount') || f.startsWith('total')) return `  ${f} numeric(10,2)`
    if (f === 'rating') return `  ${f} numeric(3,2)`
    if (['count', 'guests', 'nights', 'quantity'].includes(f)) return `  ${f} int default 0`
    if (['is_published', 'is_active', 'is_verified'].includes(f)) return `  ${f} boolean default false`
    if (f === 'status') return `  ${f} text default 'pending'`
    if (f === 'images') return `  ${f} text[] default '{}'`
    return `  ${f} text`
  }).filter(Boolean)
  return `create table if not exists ${e.name} (\n  id uuid primary key default gen_random_uuid(),\n${fields.join(',\n')},\n  created_at timestamptz default now(),\n  updated_at timestamptz default now()\n);`
}).join('\n\n')

const baseSchema = `-- ${config.appName} schema generated by assemble-local.js
-- Run this in Supabase SQL editor

-- Profiles (extends auth.users)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  avatar_url text,
  bio text,
  phone text,
  role text default 'guest',
  location text,
  languages text[],
  rating numeric(3,2),
  review_count int default 0,
  listing_count int default 0,
  identity_verified boolean default false,
  stripe_account_id text,
  created_at timestamptz default now()
);
create or replace function handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, email, full_name, avatar_url)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url');
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure handle_new_user();

-- OTPs (for phone verification)
create table if not exists otps (
  phone text primary key,
  code text not null,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

-- Contact submissions
create table if not exists contact_submissions (
  id uuid primary key default gen_random_uuid(),
  name text, email text, subject text, message text,
  created_at timestamptz default now()
);

-- Tasks
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text default 'todo',
  priority text default 'medium',
  due_date date,
  assignee text,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- Conversations + messages
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);
create table if not exists conversation_participants (
  conversation_id uuid references conversations(id) on delete cascade,
  user_id uuid references profiles(id),
  primary key (conversation_id, user_id)
);
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  sender_id uuid references profiles(id),
  body text not null,
  created_at timestamptz default now()
);

-- Inbound SMS
create table if not exists inbound_sms (
  id uuid primary key default gen_random_uuid(),
  "from" text, "to" text, body text,
  received_at timestamptz default now()
);

${entityTables}

-- Enable RLS
alter table profiles enable row level security;
alter table tasks enable row level security;
alter table messages enable row level security;
alter table conversations enable row level security;

-- Basic policies
create policy "Users can read all profiles" on profiles for select using (true);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);
create policy "Authenticated can manage tasks" on tasks using (auth.role() = 'authenticated');
create policy "Participants can read messages" on messages for select using (
  exists (select 1 from conversation_participants where conversation_id = messages.conversation_id and user_id = auth.uid())
);
`
writeFile(path.join(outDir, 'supabase-schema.sql'), baseSchema)

// ── Block assessment report ───────────────────────────────────────────────────

log('Writing block-assessment.json')
const report = {
  appName: config.appName,
  assembledAt: new Date().toISOString(),
  blocks: config.blocks,
  summary: {
    perfect: assessments.filter(a => a.fit === 'perfect').length,
    good: assessments.filter(a => a.fit === 'good').length,
    partial: assessments.filter(a => a.fit === 'partial').length,
  },
  assessments,
  recommendations: assessments
    .filter(a => a.fit !== 'perfect')
    .map(a => ({
      block: a.blockId,
      issue: a.notes,
      action: a.permanent ? 'UPDATE BLOCK permanently — improvement applies to all apps' : 'App-specific patch — don\'t change the base block',
    })),
}
writeFile(path.join(outDir, 'block-assessment.json'), JSON.stringify(report, null, 2))

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n✅ Assembly complete!`)
console.log(`   📁 ${outDir}`)
console.log(`   📊 Assessment: ${report.summary.perfect} perfect · ${report.summary.good} good · ${report.summary.partial} partial`)
console.log(`\nNext steps:`)
console.log(`   1. Copy .env.local.example → .env.local and fill in your keys`)
console.log(`   2. Run the supabase-schema.sql in your Supabase project`)
console.log(`   3. cd ${path.basename(outDir)} && npm install && npm run dev`)
console.log(`\nBlocks needing attention:`)
report.recommendations.forEach(r => console.log(`   ⚠  ${r.block}: ${r.issue}`))

if (!dryRun && !noInstall) {
  console.log('\n📦 Running npm install…')
  try {
    execSync('npm install', { cwd: outDir, stdio: 'inherit' })
    console.log('✓ npm install done')
  } catch (err) {
    console.error('npm install failed — run it manually')
  }
}
