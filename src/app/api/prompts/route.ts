import { NextResponse } from 'next/server'

import { createPromptSchema } from '@/lib/schemas'

import { getUser } from '@/server/auth'
import { createPrompt, listPrompts } from '@/server/data/prompts'

export const runtime = 'nodejs'

/**
 * The caller's whole library, for the composer's prompt picker. (F25)
 *
 * The same rows `listPrompts()` gives the `/prompts` page, bodies included,
 * because the body is the thing an insertion needs — a lighter index would mean
 * a second round trip at the moment of the click, which is the one moment
 * latency is visible.
 *
 * Unpaginated, and that is the same bet `listPrompts()` already makes: a
 * personal library is tens of rows. If that stops being true it is the data
 * function that changes, and this route follows it.
 *
 * Read once per page session on the client. Nothing here enforces that — the
 * cache is `use-prompt-library.ts`'s job, and this route stays a plain read.
 */
export async function GET() {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // No user id is passed and none is needed: the cookie-bound client sees
    // only the caller's rows, because the owner-read policy is what filters
    // them. (F03)
    const prompts = await listPrompts()

    return NextResponse.json(prompts)
  } catch (error) {
    console.error('[api/prompts] list failed', error)
    return NextResponse.json(
      { error: 'Could not load your prompts', code: 'internal_error' },
      { status: 500 },
    )
  }
}

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
 * F24 wrote here that there would be no `GET`, on the reasoning that a JSON read
 * endpoint would be a second path to the same rows with nothing calling it. The
 * reasoning was right and the prediction was wrong: F25's composer picker is a
 * caller, and the alternative it named — reusing the `/prompts` page's server
 * read — turned out to mean shipping every prompt *body* in the RSC payload of
 * every chat load for a panel most loads never open. The `GET` below is that
 * caller's endpoint, added when the condition the comment set was actually met.
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
