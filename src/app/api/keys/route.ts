import { NextResponse } from 'next/server'

import { createKeySchema, deleteKeySchema } from '@/lib/schemas'

import { getUser } from '@/server/auth'
import { deleteProviderKey } from '@/server/data/provider-keys'
import { InvalidKeyError, ProbeUnavailableError, storeProviderKey } from '@/server/keys'

// This route reaches the vault, and node:crypto does not exist on Edge. On
// Render every route is Node already, so this documents the requirement rather
// than guarding anything — but it stays, so the constraint survives a move to a
// host that does offer Edge.
export const runtime = 'nodejs'

/**
 * Adds or replaces one provider key.
 *
 * Replace is the same write as add: `unique (user_id, provider)` means a user
 * has at most one key per provider, so a second submission overwrites the first.
 *
 * The response body carries `provider`, `lastFour`, `label`, and `createdAt`,
 * and nothing else. That shape is pinned by a test — it is the boundary the
 * whole feature exists to hold, and the easiest thing in the codebase to widen
 * by accident with a `select('*')` somewhere below.
 */
export async function POST(request: Request) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown

  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_input' },
      { status: 400 },
    )
  }

  const parsed = createKeySchema.safeParse(body)
  if (!parsed.success) {
    // The zod detail is deliberately dropped rather than returned. On this route
    // it would echo the submitted API key straight back to the client, which is
    // the exact disclosure the feature is built to prevent. It is not logged
    // either, for the same reason.
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_input' },
      { status: 400 },
    )
  }

  const { provider, apiKey, label } = parsed.data

  try {
    const stored = await storeProviderKey(user.id, provider, apiKey, label ?? null)

    return NextResponse.json(
      {
        provider: stored.provider,
        lastFour: stored.last_four,
        label: stored.label,
        createdAt: stored.created_at,
      },
      { status: 201 },
    )
  } catch (error) {
    // Both refusals are expected outcomes rather than bugs, and they carry
    // different advice: one means fix your key, the other means try again.
    if (error instanceof InvalidKeyError) {
      return NextResponse.json(
        { error: error.message, code: 'invalid_key' },
        { status: 400 },
      )
    }

    if (error instanceof ProbeUnavailableError) {
      return NextResponse.json(
        { error: `${error.message}. Nothing was saved.`, code: 'probe_unavailable' },
        { status: 503 },
      )
    }

    // The error is logged without the body, which holds the key.
    console.error('[api/keys] store failed', { provider })
    return NextResponse.json(
      { error: 'Could not save that key', code: 'internal_error' },
      { status: 500 },
    )
  }
}

/**
 * Removes one provider key.
 *
 * 404 rather than 403 when the caller has no key for that provider — RLS makes
 * another user's row invisible rather than forbidden, so the handler genuinely
 * cannot tell "not yours" from "not there".
 */
export async function DELETE(request: Request) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)

  const parsed = deleteKeySchema.safeParse({ provider: searchParams.get('provider') })
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_input' },
      { status: 400 },
    )
  }

  try {
    const removed = await deleteProviderKey(parsed.data.provider)

    if (!removed) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // No body. There is nothing left to describe.
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('[api/keys] delete failed', {
      provider: parsed.data.provider,
      error,
    })
    return NextResponse.json(
      { error: 'Could not remove that key', code: 'internal_error' },
      { status: 500 },
    )
  }
}
