import './globals.css'

export const metadata = {
  title: "Svet's Dream",
  description: 'AI Agent Corporate Structure Manager',
  icons: {
    icon: '/favicon.svg',
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
