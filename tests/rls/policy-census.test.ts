import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A roll-call of every RLS policy this project declares, against the list of
 * policies its tests actually exercise.
 *
 * `tests/rls/matrix.test.ts` proves that each policy below behaves — that a
 * stranger cannot read, write, change or delete a row. What no behavioural test
 * can do is notice a policy **nobody wrote a test for**: an absence is invisible
 * to a suite made of assertions about things that exist. That is the gap this
 * file closes, and it is the same shape as `tests/security/key-exposure.test.ts`,
 * which greps the route tree rather than calling the routes.
 *
 * **What this reads, and the limitation that comes with it.** It parses
 * `supabase/migrations/`, not the live catalog. `pg_policies` lives in
 * `pg_catalog`, which PostgREST does not expose, so reaching it from a test
 * would mean adding a `security definer` function — and `constraints.md` records
 * `handle_new_user()` as the one sanctioned one in this codebase. A privileged
 * function that exists only to let a test read the catalog is a poor trade for
 * what it buys, because `architecture.md` already states that the schema lives
 * in migrations and that nothing is altered through the dashboard.
 *
 * So the honest description is: this catches a policy added by migration and
 * never tested, which is the realistic case. It cannot see a policy created by
 * hand in the dashboard. At F35 the two were compared directly through the
 * Supabase MCP and agreed exactly — 32 declared, 32 live, no drops — so this
 * list started life true rather than merely consistent with itself.
 */

const MIGRATIONS = fileURLToPath(new URL('../../supabase/migrations', import.meta.url))

type Policy = {
  table: string
  command: 'select' | 'insert' | 'update' | 'delete'
  role: string
  name: string
}

/**
 * Every policy the tests account for.
 *
 * Adding a policy to a migration without adding it here fails this suite, which
 * is the entire point — the failure names the policy, so the next step is
 * obvious rather than mysterious.
 */
const COVERED: Policy[] = [
  // profiles — no insert policy (the security definer trigger creates the row)
  // and no delete policy (deleting orphans the user against a surviving
  // auth.users row that will never fire the trigger again). Both narrowings are
  // deliberate; do not "restore consistency" by adding them. (F03)
  { table: 'public.profiles', command: 'select', role: 'authenticated', name: 'owner reads' },
  { table: 'public.profiles', command: 'update', role: 'authenticated', name: 'owner updates' },

  { table: 'public.provider_keys', command: 'select', role: 'authenticated', name: 'owner reads' },
  { table: 'public.provider_keys', command: 'insert', role: 'authenticated', name: 'owner writes' },
  { table: 'public.provider_keys', command: 'update', role: 'authenticated', name: 'owner updates' },
  { table: 'public.provider_keys', command: 'delete', role: 'authenticated', name: 'owner deletes' },

  { table: 'public.conversations', command: 'select', role: 'authenticated', name: 'owner reads' },
  { table: 'public.conversations', command: 'insert', role: 'authenticated', name: 'owner writes' },
  { table: 'public.conversations', command: 'update', role: 'authenticated', name: 'owner updates' },
  { table: 'public.conversations', command: 'delete', role: 'authenticated', name: 'owner deletes' },
  {
    table: 'public.conversations',
    command: 'select',
    role: 'anon',
    name: 'anon reads shared conversations',
  },

  { table: 'public.messages', command: 'select', role: 'authenticated', name: 'owner reads' },
  { table: 'public.messages', command: 'insert', role: 'authenticated', name: 'owner writes' },
  { table: 'public.messages', command: 'update', role: 'authenticated', name: 'owner updates' },
  { table: 'public.messages', command: 'delete', role: 'authenticated', name: 'owner deletes' },
  {
    table: 'public.messages',
    command: 'select',
    role: 'anon',
    name: 'anon reads shared messages',
  },

  { table: 'public.attachments', command: 'select', role: 'authenticated', name: 'owner reads' },
  { table: 'public.attachments', command: 'insert', role: 'authenticated', name: 'owner writes' },
  { table: 'public.attachments', command: 'update', role: 'authenticated', name: 'owner updates' },
  { table: 'public.attachments', command: 'delete', role: 'authenticated', name: 'owner deletes' },
  {
    table: 'public.attachments',
    command: 'select',
    role: 'anon',
    name: 'anon reads shared attachments',
  },

  { table: 'public.prompts', command: 'select', role: 'authenticated', name: 'owner reads' },
  { table: 'public.prompts', command: 'insert', role: 'authenticated', name: 'owner writes' },
  { table: 'public.prompts', command: 'update', role: 'authenticated', name: 'owner updates' },
  { table: 'public.prompts', command: 'delete', role: 'authenticated', name: 'owner deletes' },

  // shared_key_usage has no delete policy — dropping the row is precisely how a
  // user would reset their own daily allowance. (F03)
  {
    table: 'public.shared_key_usage',
    command: 'select',
    role: 'authenticated',
    name: 'owner reads',
  },
  {
    table: 'public.shared_key_usage',
    command: 'insert',
    role: 'authenticated',
    name: 'owner writes',
  },
  {
    table: 'public.shared_key_usage',
    command: 'update',
    role: 'authenticated',
    name: 'owner updates',
  },

  {
    table: 'storage.objects',
    command: 'select',
    role: 'authenticated',
    name: 'owner reads attachment objects',
  },
  {
    table: 'storage.objects',
    command: 'insert',
    role: 'authenticated',
    name: 'owner writes attachment objects',
  },
  {
    table: 'storage.objects',
    command: 'update',
    role: 'authenticated',
    name: 'owner updates attachment objects',
  },
  {
    table: 'storage.objects',
    command: 'delete',
    role: 'authenticated',
    name: 'owner deletes attachment objects',
  },
]

/**
 * Tables that must carry NO policy at all.
 *
 * `shared_key_budget` is the one deliberate exception to the owner shape: RLS is
 * enabled and no policy is defined for any role, which makes it unreachable
 * through the publishable key by construction rather than by rule. It is a
 * global counter with no owner, so there is no `auth.uid()` to scope to. The
 * Supabase advisor reports `rls_enabled_no_policy` against it permanently, and
 * that notice is correct and must not be "fixed". (F02)
 */
const MUST_HAVE_NO_POLICY = ['public.shared_key_budget', 'shared_key_budget']

const POLICY_PATTERN =
  /create\s+policy\s+"([^"]+)"\s+on\s+([a-z_.]+)\s+for\s+(select|insert|update|delete)\s+to\s+([a-z_,\s]+?)(?:\s+using|\s+with\s+check)/gi

function migrationSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => readFileSync(path.join(MIGRATIONS, file), 'utf8'))
    .join('\n')
}

function declaredPolicies(): Policy[] {
  const sql = migrationSql()
  const found: Policy[] = []

  for (const match of sql.matchAll(POLICY_PATTERN)) {
    const [, name, table, command, roles] = match
    if (!name || !table || !command || !roles) continue

    for (const role of roles.split(',')) {
      found.push({
        table: table.toLowerCase(),
        command: command.toLowerCase() as Policy['command'],
        role: role.trim(),
        name,
      })
    }
  }

  return found
}

function key(policy: Policy): string {
  return `${policy.table} ${policy.command} to ${policy.role} — "${policy.name}"`
}

describe('the policy census', () => {
  it('finds the policies it is meant to be reading', () => {
    // A parser that silently matched nothing would make every assertion below
    // pass against an empty set — the failure mode this whole file exists to
    // prevent, arriving in the file itself.
    expect(declaredPolicies().length).toBeGreaterThanOrEqual(COVERED.length)
  })

  it('accounts for every policy the migrations declare', () => {
    const covered = new Set(COVERED.map(key))
    const untested = declaredPolicies()
      .filter((policy) => !covered.has(key(policy)))
      .map(key)

    expect(untested).toEqual([])
  })

  it('declares no policy this list expects but the migrations do not create', () => {
    // The other direction, so a policy dropped from a migration cannot leave a
    // stale entry here reading as coverage of something that no longer exists.
    const declared = new Set(declaredPolicies().map(key))
    const missing = COVERED.map(key).filter((entry) => !declared.has(entry))

    expect(missing).toEqual([])
  })

  it('leaves shared_key_budget without a policy for any role', () => {
    const offenders = declaredPolicies().filter((policy) =>
      MUST_HAVE_NO_POLICY.includes(policy.table),
    )

    expect(offenders.map(key)).toEqual([])
  })

  it('grants no policy of any kind to anon on provider_keys', () => {
    // The table holding other people's key material. Nothing about a share link
    // should ever reach it.
    const anonKeyPolicies = declaredPolicies().filter(
      (policy) => policy.table.endsWith('provider_keys') && policy.role === 'anon',
    )

    expect(anonKeyPolicies).toEqual([])
  })

  it('scopes every owner policy to a role rather than to PUBLIC', () => {
    // Without `to authenticated` a policy applies to every role including anon,
    // where the owner policies would overlap the share policies on conversations
    // and messages — Postgres then ORs them per row, which the linter reports as
    // multiple_permissive_policies. (F03)
    const sql = migrationSql()
    const roleless = [...sql.matchAll(/create\s+policy\s+"([^"]+)"\s+on\s+([a-z_.]+)\s+for\s+[a-z]+\s+(using|with)/gi)]

    expect(roleless.map((match) => `${match[2]} "${match[1]}"`)).toEqual([])
  })
})
