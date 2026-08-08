import { NextResponse } from 'next/server'

import { createPromptSchema } from '@/lib/schemas'

import { getUser } from '@/server/auth'
import { createPrompt } from '@/server/data/prompts'

export const runtime = 'nodejs'

/**
 * Saves a new prompt to the caller's library. (F24)
 *
 * Authenticate → validate → delegate → respond, and no business logic in
 * between. The normalisation `build-plan.md` §24 asks for — lowercase,
 * deduplicated tags — happens inside `createPromptSchema`, which is why the row
 * this returns is built from `parsed.data` rather than from what arrived on the
 * wire. The client renders the response, so echoing the submitted values back
 * would show a user tags the database does not hold.
 *
 * There is no `GET` here. The library is read by the `/prompts` Server
 * Component through `listPrompts()`, so a JSON read endpoint would be a second
 * path to the same rows with nothing calling it — and the first thing F25 does
 * is reuse the page's read rather than fetch its own.
 */
export async function POST(request: Request) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = createPromptSchema.safeParse(await request.json())
  if (!parsed.success) {
    console.error('[api/prompts] invalid create', parsed.error)
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_input' },
      { status: 400 },
    )
  }

  try {
    const prompt = await createPrompt(user.id, parsed.data)

    return NextResponse.json(prompt, { status: 201 })
  } catch (error) {
    console.error('[api/prompts] create failed', error)
    return NextResponse.json(
      { error: 'Could not save the prompt', code: 'internal_error' },
      { status: 500 },
    )
  }
}
