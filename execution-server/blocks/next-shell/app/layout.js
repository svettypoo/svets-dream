import './globals.css'

export const metadata = {
  title: '{{APP_NAME}}',
  description: '{{APP_DESCRIPTION}}',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  )
}
