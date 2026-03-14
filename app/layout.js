import './globals.css'

export const metadata = {
  title: "Dream — S&T DevOps",
  description: 'Deployment monitoring, screenshots, videos, and change logs for S&T Properties',
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
