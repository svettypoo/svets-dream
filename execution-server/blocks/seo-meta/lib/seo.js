// SEO metadata helpers for Next.js App Router
// Usage: export const metadata = buildMetadata({ title: 'Page', description: '...' })

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || '{{APP_NAME}}';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://example.com';
const DEFAULT_IMAGE = `${APP_URL}/og-default.png`;

export function buildMetadata({
  title,
  description,
  image,
  path = '',
  type = 'website',
  noIndex = false,
}) {
  const fullTitle = title ? `${title} | ${APP_NAME}` : APP_NAME;
  const url = `${APP_URL}${path}`;
  const ogImage = image || DEFAULT_IMAGE;

  return {
    title: fullTitle,
    description,
    metadataBase: new URL(APP_URL),
    alternates: { canonical: url },
    openGraph: {
      title: fullTitle,
      description,
      url,
      siteName: APP_NAME,
      images: [{ url: ogImage, width: 1200, height: 630, alt: fullTitle }],
      type,
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [ogImage],
    },
    robots: noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true, 'max-snippet': -1, 'max-image-preview': 'large' },
  };
}

// JSON-LD structured data generators
export function articleSchema({ title, description, datePublished, dateModified, authorName, image, url }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    datePublished,
    dateModified: dateModified || datePublished,
    author: { '@type': 'Person', name: authorName },
    image: image || DEFAULT_IMAGE,
    url,
    publisher: { '@type': 'Organization', name: APP_NAME, url: APP_URL },
  };
}

export function productSchema({ name, description, price, currency = 'USD', image, url }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description,
    image,
    url,
    offers: {
      '@type': 'Offer',
      price,
      priceCurrency: currency,
      availability: 'https://schema.org/InStock',
    },
  };
}

export function faqSchema(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  };
}

export function breadcrumbSchema(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(({ name, url }, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name,
      item: url,
    })),
  };
}
