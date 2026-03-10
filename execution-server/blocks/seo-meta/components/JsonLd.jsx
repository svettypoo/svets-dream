// Inject JSON-LD structured data into page <head>
// Usage: <JsonLd data={articleSchema({ title, ... })} />
export default function JsonLd({ data }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
