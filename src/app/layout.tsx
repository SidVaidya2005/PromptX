import type { Metadata } from 'next'
import { DM_Mono, Instrument_Serif, Inter } from 'next/font/google'

import './globals.css'

// Each face self-hosts and exposes a hashed family name through its CSS
// variable. globals.css reads those variables in --font-sans / --font-mono /
// --font-serif; naming the font literally there would bypass the self-hosted
// copy entirely. DM Mono and Instrument Serif ship a single weight each.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-dm-mono',
  display: 'swap',
})

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: 'italic',
  variable: '--font-instrument-serif',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'PromptX',
  description:
    'One workspace for every model. Chat with OpenAI, Anthropic, Google, and OpenRouter using your own API keys.',
}

// Deliberately holds no provider. TooltipProvider belongs in the authenticated
// (app) layout, not here — a client component in the root layout would ship on
// the landing page, which has a first-load JS budget precisely because it is
// what a waking free-tier instance serves first.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${dmMono.variable} ${instrumentSerif.variable}`}
    >
      <body className="bg-canvas font-sans text-ink antialiased">{children}</body>
    </html>
  )
}
