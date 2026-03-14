const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''

const REPOS = [
  { repo: 'svettypoo/birthdayboard', module: 'birthdayboard', label: 'BirthdayBoard', color: '#0ea5e9' },
  { repo: 'svettypoo/meet-app', module: 'meet', label: 'Meet', color: '#8b5cf6' },
  { repo: 'svettypoo/concierge-app', module: 'concierge', label: 'Concierge', color: '#06b6d4' },
  { repo: 'svettypoo/connect-ops-now', module: 'connect-ops', label: 'Connect Ops', color: '#f59e0b' },
  { repo: 'svettypoo/svets-dream', module: 'dream', label: 'Dream', color: '#3b82f6' },
]

function guessType(msg) {
  const lower = msg.toLowerCase()
  if (lower.startsWith('fix') || lower.includes('bugfix') || lower.includes('hotfix')) return lower.includes('hotfix') ? 'hotfix' : 'fix'
  if (lower.startsWith('add') || lower.includes('feature') || lower.includes('new ')) return 'feature'
  if (lower.startsWith('refactor') || lower.includes('cleanup') || lower.includes('clean up')) return 'refactor'
  if (lower.includes('deploy') || lower.includes('release') || lower.includes('bump')) return 'deploy'
  return 'feature'
}

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const moduleFilter = searchParams.get('module') || ''
  const perRepo = parseInt(searchParams.get('limit') || '15', 10)

  const headers = { Accept: 'application/vnd.github+json' }
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`

  const repos = moduleFilter
    ? REPOS.filter(r => r.module === moduleFilter)
    : REPOS

  const results = await Promise.all(
    repos.map(async ({ repo, module, label, color }) => {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${repo}/commits?per_page=${perRepo}`,
          { headers, next: { revalidate: 60 } }
        )
        if (!res.ok) return []
        const commits = await res.json()
        return commits.map(c => ({
          id: c.sha,
          commit: c.sha.slice(0, 7),
          message: c.commit.message.split('\n')[0],
          fullMessage: c.commit.message,
          timestamp: new Date(c.commit.committer.date).getTime(),
          author: c.commit.author.name,
          module,
          moduleLabel: label,
          moduleColor: color,
          type: guessType(c.commit.message.split('\n')[0]),
          canRevert: true,
          url: c.html_url,
        }))
      } catch (e) {
        console.error(`changelog fetch error for ${repo}:`, e)
        return []
      }
    })
  )

  const all = results.flat().sort((a, b) => b.timestamp - a.timestamp)
  return Response.json({ ok: true, items: all })
}
