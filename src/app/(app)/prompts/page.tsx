import { listPrompts } from '@/server/data/prompts'

import { PromptLibrary } from '@/components/prompts/PromptLibrary'

/**
 * The prompt library. (F24)
 *
 * A Server Component that reads the whole library once and hands it to one
 * client leaf, which owns the search box and the tag filter. That is the F24
 * decision in one line: filtering a personal library of tens of rows is not
 * worth a round trip per keystroke, and F25 wants this same array in client
 * state anyway. F27's message search is a ranked query over thousands of rows
 * and goes in the URL instead — different scale, different mechanism.
 *
 * The measure matches the thread's and the settings section's 720px, so the
 * library does not read like a different application. The grid inside it is
 * allowed to be wider than the prose, which is what the padding here is doing.
 */
export default async function PromptsPage() {
  const prompts = await listPrompts()

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-260 px-lg py-xl tablet:px-xl">
        <h1 className="text-display-md text-ink">Prompts</h1>

        <p className="mt-sm max-w-180 text-body-md text-body">
          Instructions you reuse, saved once. They belong to no conversation — pick one
          from the composer whenever you need it.
        </p>

        <div className="mt-xl">
          <PromptLibrary prompts={prompts} />
        </div>
      </div>
    </div>
  )
}
