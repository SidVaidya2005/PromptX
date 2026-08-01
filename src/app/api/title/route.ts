import { NextResponse } from 'next/server'

import { titleRequestSchema } from '@/lib/schemas'

import { getUser } from '@/server/auth'
import { generateConversationTitle } from '@/server/titles'

export const runtime = 'nodejs'

/**
 * Names a conversation from its first exchange.
 *
 * Called by the client once the first response has finished streaming, so that
 * generating a title never delays a token of the answer it is named after.
 *
 * The response is `{ title }`, null whenever no title was written — refused,
 * already titled, or the model failed. Deliberately a 200 rather than a 4xx or
 * 5xx: feature 10 specifies that failure is silent, so there is no user-facing
 * error for a status code to carry, and the client's only branch is whether to
 * refresh. Detail goes to the server log.
 *
 * Ownership is not checked here. `generateConversationTitle` reads the
 * conversation through the cookie-bound client, so RLS returns nothing for a
 * conversation belonging to someone else and it refuses on the same path as one
 * that does not exist.
 */
export async function POST(request: Request) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = titleRequestSchema.safeParse(await request.json())
  if (!parsed.success) {
    console.error('[api/title] invalid request', parsed.error)
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_input' },
      { status: 400 },
    )
  }

  const title = await generateConversationTitle(parsed.data.conversationId)

  return NextResponse.json({ title })
}
