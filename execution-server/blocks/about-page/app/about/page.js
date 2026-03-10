// SMART: replace APP_NAME, APP_TAGLINE, TEAM_MEMBERS, PRIMARY_COLOR with config values

const TEAM = [
  { name: 'Alex Rivera', role: 'CEO & Co-Founder', bio: 'Passionate about building products that make people\'s lives better.', avatar: null },
  { name: 'Sam Chen', role: 'CTO & Co-Founder', bio: 'Engineering leader with 10+ years building scalable systems.', avatar: null },
  { name: 'Jordan Kim', role: 'Head of Design', bio: 'Turning complex problems into intuitive, beautiful experiences.', avatar: null },
]

const VALUES = [
  { icon: '🎯', title: 'Mission-driven', desc: 'Everything we build serves our users first.' },
  { icon: '🤝', title: 'Trust', desc: 'We earn trust through transparency and consistency.' },
  { icon: '⚡', title: 'Speed', desc: 'We ship fast, learn faster, and iterate constantly.' },
  { icon: '🌱', title: 'Growth', desc: 'We invest in our people and our product equally.' },
]

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <section className="bg-gradient-to-br from-brand-600 to-brand-800 text-white py-20 px-4 text-center">
        <h1 className="text-4xl md:text-5xl font-bold mb-4">About APP_NAME</h1>
        <p className="text-xl text-brand-100 max-w-2xl mx-auto">APP_TAGLINE</p>
      </section>

      {/* Mission */}
      <section className="max-w-3xl mx-auto px-4 py-16 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Our Mission</h2>
        <p className="text-lg text-gray-600 leading-relaxed">
          We believe everyone deserves access to great products. We're building APP_NAME to make that a reality — one feature at a time.
        </p>
      </section>

      {/* Values */}
      <section className="bg-gray-50 py-16 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-10">What we stand for</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {VALUES.map(v => (
              <div key={v.title} className="text-center p-6 bg-white rounded-xl shadow-sm border border-gray-100">
                <div className="text-3xl mb-3">{v.icon}</div>
                <h3 className="font-semibold text-gray-900 mb-2">{v.title}</h3>
                <p className="text-sm text-gray-500">{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Team */}
      <section className="max-w-5xl mx-auto px-4 py-16">
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-10">The Team</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {TEAM.map(member => (
            <div key={member.name} className="text-center">
              <div className="w-20 h-20 bg-brand-100 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">
                {member.name[0]}
              </div>
              <h3 className="font-semibold text-gray-900">{member.name}</h3>
              <p className="text-sm text-brand-600 font-medium mb-2">{member.role}</p>
              <p className="text-sm text-gray-500">{member.bio}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-brand-600 text-white py-16 px-4 text-center">
        <h2 className="text-2xl font-bold mb-4">Ready to get started?</h2>
        <p className="text-brand-100 mb-8">Join thousands of users who trust APP_NAME every day.</p>
        <a href="/signup" className="inline-block bg-white text-brand-600 font-bold px-8 py-3 rounded-xl hover:bg-brand-50 transition">
          Get Started Free
        </a>
      </section>
    </div>
  )
}
