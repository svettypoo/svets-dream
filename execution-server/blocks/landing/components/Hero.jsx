import Link from 'next/link'

export default function Hero({ headline, subheadline, ctaText = 'Get started free', ctaHref = '/signup', secondaryText, secondaryHref }) {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-brand-900 via-brand-800 to-brand-700 text-white">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-10" style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
      }} />

      <div className="relative max-w-5xl mx-auto px-6 py-24 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-sm mb-6">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          {{APP_TAGLINE}}
        </div>

        <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight mb-6 leading-tight">
          {headline || '{{HEADLINE}}'}
        </h1>

        <p className="text-xl text-brand-200 max-w-2xl mx-auto mb-10 leading-relaxed">
          {subheadline || '{{SUBHEADLINE}}'}
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href={ctaHref}
            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-white text-brand-700 font-semibold text-lg hover:bg-brand-50 transition shadow-lg shadow-brand-900/30"
          >
            {ctaText} →
          </Link>
          {secondaryText && secondaryHref && (
            <Link href={secondaryHref} className="text-brand-200 hover:text-white font-medium underline underline-offset-4">
              {secondaryText}
            </Link>
          )}
        </div>
      </div>
    </section>
  )
}
