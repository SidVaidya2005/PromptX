import 'server-only'

import { createServerSupabaseClient } from '@/server/supabase'

import type { Prompt } from '@/types/domain'

/**
 * The columns a prompt is written with. Never `user_id` on an update — the row
 * cannot change hands, and offering the column would be offering the mistake.
 */
type PromptInput = {
  title: string
  body: string
  tags: string[]
}

/**
 * Every prompt the caller owns, most recently edited first.
 *
 * No `.eq('user_id', …)`, for the reason every module in this folder records:
 * the owner-read policy is `(select auth.uid()) = user_id`, so the cookie-bound
 * client can only ever see the caller's rows. A filter would be harmless and
 * would also make it look as though the filter is the isolation. It is not.
 *
 * The whole library comes back in one read, `body` included. That is deliberate
 * and it is what F24 chose over a `?q=` round trip: the grid, the title search
 * and the tag filter all work from this one array in the browser. A personal
 * library is tens of rows — if that ever stops being true, this is the function
 * that has to change, not the components above it.
 *
 * Ordered on `updated_at` rather than `created_at`, which is the ordering the
 * *sidebar* deliberately refuses for conversations. The rule is the same one
 * read correctly: order on activity, and for a prompt, editing it is the
 * activity there is.
 */
export async function listPrompts(): Promise<Prompt[]> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('prompts')
    .select('*')
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('[data/prompts] listPrompts failed', error)
    throw new Error('Failed to load prompts')
  }

  return data
}

/**
 * Saves a new prompt and returns the row.
 *
 * `userId` is passed rather than derived, because the insert policy checks
 * `(select auth.uid()) = user_id` against a column this statement has to supply
 * — RLS refuses the row rather than filling it in.
 *
 * Bounds, trimming, lowercasing and deduplication are `createPromptSchema`'s at
 * the route. What arrives here is already normalised.
 */
export async function createPrompt(userId: string, input: PromptInput): Promise<Prompt> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('prompts')
    .insert({
      user_id: userId,
      title: input.title,
      body: input.body,
      tags: input.tags,
    })
    .select('*')
    .single()

  if (error) {
    console.error('[data/prompts] createPrompt failed', error)
    throw new Error('Failed to save the prompt')
  }

  return data
}

/**
 * Rewrites a prompt, returning null when it does not exist or is not owned.
 *
 * All three columns move together, because that is what the dialog submits —
 * there is no partial update to express, and one that existed would be a second
 * spelling of "save this prompt" with nothing sending it.
 *
 * **`updated_at` is written here, and that is not an oversight of the rule four
 * conversation writes follow.** F02 gave the column a default and no trigger, so
 * nothing sets it but this statement. Conversations leave it alone because the
 * sidebar orders on *activity* and renaming one is not activity; the prompt grid
 * orders on it because editing a prompt is the only activity a prompt has.
 *
 * Returns the row rather than a boolean, unlike the conversation writes: the
 * dialog closes onto a grid that has just changed, and the RLS no-op distinction
 * those functions make is preserved either way — null still means "matched
 * nothing", which the route turns into a 404.
 */
export async function updatePrompt(
  id: string,
  input: PromptInput,
): Promise<Prompt | null> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('prompts')
    .update({
      title: input.title,
      body: input.body,
      tags: input.tags,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) {
    console.error('[data/prompts] updatePrompt failed', error)
    throw new Error('Failed to save the prompt')
  }

  return data
}

/**
 * Deletes a prompt. Returns whether a row actually went.
 *
 * The distinction matters for the reason `deleteConversation()` records: RLS
 * makes someone else's row invisible rather than forbidden, so a delete that
 * matches nothing reports no error and is indistinguishable from success unless
 * the row comes back. `.select()` after `.delete()` is one round trip where a
 * read-then-delete would be two.
 *
 * Nothing cascades from a prompt. `project-overview.md` is explicit that the
 * library has no relationship to any conversation, and F24 adds no column that
 * would give it one — so deleting one cannot strand anything.
 */
export async function deletePrompt(id: string): Promise<boolean> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('prompts')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[data/prompts] deletePrompt failed', error)
    throw new Error('Failed to delete the prompt')
  }

  return data !== null
}
