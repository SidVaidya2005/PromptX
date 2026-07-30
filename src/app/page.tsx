import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * TEMPORARY — the Phase 0 token proof page.
 *
 * Renders every value in context/DESIGN.md so the @theme block can be checked
 * against the spec by eye and by colour picker. It occupies `/` deliberately:
 * feature 04 replaces this route with the real landing page, so the removal
 * cannot be forgotten the way a separate /design route could be.
 *
 * A Server Component. Nothing here ships JavaScript.
 */

const SURFACES = [
  { name: 'canvas', hex: '#2b2622', className: 'bg-canvas' },
  { name: 'canvas-soft', hex: '#383330', className: 'bg-canvas-soft' },
  { name: 'hairline', hex: '#3f3a36', className: 'bg-hairline' },
] as const

const TEXT_COLOURS = [
  { name: 'ink', hex: '#f7f5f0', className: 'text-ink' },
  { name: 'body-strong', hex: '#dad2c1', className: 'text-body-strong' },
  { name: 'body', hex: '#c9c0ad', className: 'text-body' },
  { name: 'mute', hex: '#aea69c', className: 'text-mute' },
] as const

const BRAND_COLOURS = [
  { name: 'primary', hex: '#f7f5f0', className: 'bg-primary' },
  { name: 'on-primary', hex: '#2b2622', className: 'bg-on-primary' },
] as const

const STATE_COLOURS = [
  { name: 'danger', hex: '#d8735e', className: 'bg-danger' },
  { name: 'warn', hex: '#d6a962', className: 'bg-warn' },
  { name: 'success', hex: '#8fae7e', className: 'bg-success' },
] as const

const TYPE_STEPS = [
  {
    token: 'text-display-xl',
    spec: '64 / 400 / 70.4 / -1.6',
    className: 'text-display-xl',
  },
  {
    token: 'text-display-lg',
    spec: '48 / 400 / 52.8 / -1.2',
    className: 'text-display-lg',
  },
  {
    token: 'text-display-md',
    spec: '32 / 500 / 40 / -0.8',
    className: 'text-display-md',
  },
  {
    token: 'text-display-sm',
    spec: '24 / 500 / 32 / -0.4',
    className: 'text-display-sm',
  },
  {
    token: 'font-serif text-display-serif',
    spec: '48 / 400 / 52 / -0.5 — Instrument Serif italic',
    className: 'font-serif text-display-serif',
  },
  { token: 'text-body-lg', spec: '18 / 400 / 28', className: 'text-body-lg' },
  { token: 'text-body-md', spec: '16 / 400 / 24', className: 'text-body-md' },
  {
    token: 'text-body-md-strong',
    spec: '16 / 500 / 24',
    className: 'text-body-md-strong',
  },
  { token: 'text-body-sm', spec: '14 / 400 / 20', className: 'text-body-sm' },
  {
    token: 'text-body-sm-strong',
    spec: '14 / 500 / 20',
    className: 'text-body-sm-strong',
  },
  { token: 'text-caption', spec: '12 / 400 / 16', className: 'text-caption' },
  {
    token: 'font-mono text-code',
    spec: '13 / 400 / 18 — DM Mono',
    className: 'font-mono text-code',
  },
  {
    token: 'font-mono text-code-md',
    spec: '14 / 400 / 20 — DM Mono',
    className: 'font-mono text-code-md',
  },
  { token: 'text-button-md', spec: '14 / 500 / 20', className: 'text-button-md' },
] as const

const RADII = [
  { token: 'rounded-none', value: '0px', className: 'rounded-none' },
  { token: 'rounded-xxs', value: '1px', className: 'rounded-xxs' },
  { token: 'rounded-xs', value: '2px', className: 'rounded-xs' },
  { token: 'rounded-sm', value: '3px', className: 'rounded-sm' },
  { token: 'rounded-md', value: '4px', className: 'rounded-md' },
  { token: 'rounded-lg', value: '6px', className: 'rounded-lg' },
  { token: 'rounded-pill', value: '9999px', className: 'rounded-pill' },
] as const

const SPACING = [
  { token: 'xxs', value: '2px', className: 'w-xxs' },
  { token: 'xs', value: '4px', className: 'w-xs' },
  { token: 'sm', value: '8px', className: 'w-sm' },
  { token: 'md', value: '10px', className: 'w-md' },
  { token: 'lg', value: '16px', className: 'w-lg' },
  { token: 'xl', value: '24px', className: 'w-xl' },
  { token: '2xl', value: '32px', className: 'w-2xl' },
  { token: '3xl', value: '48px', className: 'w-3xl' },
  { token: '4xl', value: '64px', className: 'w-4xl' },
  { token: '5xl', value: '96px', className: 'w-5xl' },
] as const

export default function TokenProofPage() {
  return (
    <main className="mx-auto flex max-w-224 flex-col gap-4xl px-xl py-3xl">
      <header className="flex flex-col gap-sm">
        <h1 className="text-display-md text-ink">PromptX design tokens</h1>
        <p className="text-body-md text-body">
          Every value below is declared in{' '}
          <code className="font-mono text-code">@theme</code> from{' '}
          <code className="font-mono text-code">context/DESIGN.md</code>. This page is
          temporary and is replaced by the landing page in feature 04.
        </p>
      </header>

      <Section title="Surfaces">
        <div className="flex flex-col gap-sm">
          {SURFACES.map((surface) => (
            <div key={surface.name} className="flex items-center gap-lg">
              <div
                className={`${surface.className} size-16 shrink-0 rounded-md border border-hairline`}
              />
              <Swatch name={surface.name} hex={surface.hex} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Text">
        <div className="flex flex-col gap-sm">
          {TEXT_COLOURS.map((colour) => (
            <div key={colour.name} className="flex items-baseline gap-lg">
              <span className={`${colour.className} w-40 shrink-0 text-body-md`}>
                The quick brown fox
              </span>
              <Swatch name={colour.name} hex={colour.hex} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Brand">
        <p className="text-body-sm text-mute">
          There is no chromatic accent. The off-white carries every emphasis.
        </p>
        <div className="flex flex-col gap-sm">
          {BRAND_COLOURS.map((colour) => (
            <div key={colour.name} className="flex items-center gap-lg">
              <div
                className={`${colour.className} size-16 shrink-0 rounded-md border border-hairline`}
              />
              <Swatch name={colour.name} hex={colour.hex} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="State">
        <p className="text-body-sm text-mute">
          State-only. Never a call to action, never decoration.
        </p>
        <div className="flex flex-col gap-sm">
          {STATE_COLOURS.map((colour) => (
            <div key={colour.name} className="flex items-center gap-lg">
              <div
                className={`${colour.className} size-16 shrink-0 rounded-md border border-hairline`}
              />
              <Swatch name={colour.name} hex={colour.hex} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type scale">
        <div className="flex flex-col gap-xl">
          {TYPE_STEPS.map((step) => (
            <div key={step.token} className="flex flex-col gap-xs">
              <span className="font-mono text-code text-mute">
                {step.token} — {step.spec}
              </span>
              <span className={`${step.className} text-ink`}>
                Sphinx of black quartz, judge my vow
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Radius">
        <div className="flex flex-wrap gap-xl">
          {RADII.map((radius) => (
            <div key={radius.token} className="flex flex-col items-center gap-sm">
              <div
                className={`${radius.className} size-16 border border-hairline bg-canvas-soft`}
              />
              <span className="font-mono text-code text-mute">{radius.value}</span>
              <span className="text-caption text-mute">{radius.token}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Spacing">
        <div className="flex flex-col gap-sm">
          {SPACING.map((space) => (
            <div key={space.token} className="flex items-center gap-lg">
              <span className="w-12 shrink-0 font-mono text-code text-mute">
                {space.token}
              </span>
              <div className={`${space.className} h-4 bg-primary`} />
              <span className="font-mono text-code text-mute">{space.value}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Breakpoints">
        <p className="text-body-sm text-mute">
          Exactly two, and Tailwind&apos;s defaults are cleared from the theme. Resize to
          confirm the label changes at 768px and again at 1024px, and nowhere else.
        </p>
        <div className="rounded-md border border-hairline bg-canvas-soft p-xl text-body-md-strong text-ink">
          <span className="tablet:hidden">mobile — under 768px (unprefixed)</span>
          <span className="hidden tablet:inline desktop:hidden">
            tablet: — 768px to 1023px
          </span>
          <span className="hidden desktop:inline">desktop: — 1024px and up</span>
        </div>
      </Section>

      <Section title="Primitives">
        <p className="text-body-sm text-mute">
          shadcn/ui components retuned to the tokens. Tab through them to confirm the
          focus ring.
        </p>
        <div className="flex flex-wrap items-center gap-md">
          <Button variant="primary">Primary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="outline" size="sm">
            Small
          </Button>
        </div>
        <div className="max-w-80">
          <Input placeholder="Text input placeholder" />
        </div>
      </Section>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-lg border-t border-hairline pt-xl">
      <h2 className="text-display-sm text-ink">{title}</h2>
      {children}
    </section>
  )
}

function Swatch({ name, hex }: { name: string; hex: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-body-sm-strong text-ink">{name}</span>
      <span className="font-mono text-code text-mute">{hex}</span>
    </div>
  )
}
