import { SettingsNav } from '@/components/settings/SettingsNav'

/**
 * The settings section frame, inside the three-column shell.
 *
 * Stays a Server Component; only the nav's active-item state needs the client.
 * The measure matches the thread's 720px so a settings page and a conversation
 * read at the same width rather than the section feeling like a different app.
 */

const SECTIONS = [
  { href: '/settings/keys', label: 'Keys' },
  { href: '/settings/account', label: 'Account' },
] as const

export default function SettingsLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-180 px-lg py-xl tablet:px-xl">
        <h1 className="text-display-md text-ink">Settings</h1>

        <div className="mt-lg">
          <SettingsNav items={SECTIONS} />
        </div>

        <div className="mt-xl">{children}</div>
      </div>
    </div>
  )
}
