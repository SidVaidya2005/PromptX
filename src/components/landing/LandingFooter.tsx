import type { ComponentType, SVGProps } from 'react'

import { Globe, Mail } from 'lucide-react'

/**
 * GitHub and LinkedIn are drawn here rather than imported.
 *
 * `lucide-react@1.27` exports 6,014 icons and neither `Github` nor `Linkedin`
 * is among them — Lucide removed its brand glyphs, and there is no generic
 * stand-in for LinkedIn worth showing. Verified against the installed package,
 * not assumed.
 *
 * Both are the official marks, permitted for linking to one's own repository
 * and profile. They are filled with `currentColor` so they inherit the link's
 * text token: no brand blue, no octocat black, nothing chromatic enters the
 * page. That is what keeps the "no chromatic accent" invariant intact while
 * still using a logo.
 */
function GitHubMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

function LinkedInMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  )
}

type FooterLink = {
  href: string
  /** The accessible name. Icon-only links have no visible text to fall back on. */
  label: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
}

/**
 * Module-level, like `STEPS` in HowItWorks — this is presentation copy used in
 * exactly one file. It does not belong in `src/lib/constants.ts`, which holds
 * public configuration and tuning values.
 */
const LINKS: readonly FooterLink[] = [
  {
    href: 'https://github.com/SidVaidya2005/PromptX',
    label: 'Source on GitHub',
    icon: GitHubMark,
  },
  {
    href: 'https://www.linkedin.com/in/siddarth-vaidya-885871239',
    label: 'LinkedIn profile',
    icon: LinkedInMark,
  },
  {
    href: 'mailto:siddarthvaidya2005@gmail.com',
    label: 'Email Siddarth Vaidya',
    icon: Mail,
  },
  {
    href: 'https://siddarthvaidya2005-7iyf.onrender.com/',
    label: 'Portfolio site',
    icon: Globe,
  },
] as const

/**
 * 36px normally, 44px on a coarse pointer — the WCAG floor, keyed to pointer
 * type rather than to a breakpoint, matching `ui/input.tsx`.
 *
 * There is deliberately NO focus style here. `globals.css` gives every
 * `:focus-visible` element a 1px primary ring at 2px offset, and F37 had to
 * strip three components that re-implemented it locally.
 */
const LINK =
  'grid size-9 place-items-center rounded-sm text-mute transition-colors ' +
  'hover:text-ink pointer-coarse:size-11'

export function LandingFooter() {
  return (
    <footer className="border-t border-hairline">
      <div className="mx-auto flex max-w-300 flex-col gap-xs px-xl py-3xl">
        <div className="flex items-center justify-between gap-lg">
          <span className="text-body-sm text-body">PromptX</span>

          {/* -mr-sm pulls the last icon's hit area back so the GLYPH, not its
              padding, lines up with the wordmark against the container edge. */}
          <ul className="-mr-sm flex items-center">
            {LINKS.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <a
                  href={href}
                  // mailto: opens a client rather than a tab, so it takes
                  // neither. The three web links leave the page, so they do.
                  {...(href.startsWith('mailto:')
                    ? {}
                    : { target: '_blank', rel: 'noreferrer noopener' })}
                  aria-label={label}
                  title={label}
                  className={LINK}
                >
                  <Icon className="size-4" />
                </a>
              </li>
            ))}
          </ul>
        </div>

        <span className="text-caption text-mute">
          A personal AI chat workspace. Your conversations and your keys stay in your
          own account.
        </span>
      </div>
    </footer>
  )
}
