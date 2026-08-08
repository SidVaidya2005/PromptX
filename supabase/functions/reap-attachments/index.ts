/**
 * Deletes attachment objects that nothing points at, then their rows. (F28)
 *
 * **This exists because a storage object cannot be deleted with SQL.**
 * `storage.objects` is metadata: removing a row leaves the file in the bucket,
 * permanently orphaned and unreachable. So the hourly sweep cannot be a pg_cron
 * SQL job like the quota one — it goes pg_cron → pg_net → here, and the deletes
 * go through the Storage API.
 *
 * Two passes, and they clean up after different accidents.
 *
 *   1. **Orphan rows** — a draft whose message was never sent. Somebody attached
 *      a file, changed their mind, and closed the tab. The row names its objects,
 *      so both go.
 *
 *   2. **Orphan objects** — files with no row at all. Deleting a conversation
 *      cascades to its messages and from there to their attachment rows, and
 *      that cascade is SQL, so the files survive with nothing left naming them.
 *      Pass 1 can never find these: there is no row to find. Candidates come from
 *      `orphaned_attachment_objects()`, which reads `storage.objects` because
 *      PostgREST does not expose the `storage` schema to a client at all.
 *
 * **Objects first, rows second, always.** A crash in between leaves a row
 * pointing at a file that is gone, which the next run cleans up harmlessly. The
 * reverse leaks the file forever, with nothing left to record that it existed —
 * which is the exact failure this function was written to prevent.
 *
 * The three constants below are duplicated from src/lib/constants.ts because
 * this runs in Deno on Supabase's infrastructure and cannot import from the Next
 * application. ATTACHMENT_ORPHAN_TTL_HOURS is the one that matters; a test pins
 * the two files together.
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const BUCKET = 'attachments'

/** Mirrors ATTACHMENT_ORPHAN_TTL_HOURS in src/lib/constants.ts. */
const ORPHAN_TTL_HOURS = 24

/**
 * Storage `remove()` accepts at most 1,000 paths per call, and an image is three
 * objects — so a row batch is a third of that, and the pass simply runs again
 * next hour if there is more. Counting rows instead of paths is how a batch of
 * "1,000" quietly becomes a request for 3,000 paths that Storage refuses.
 */
const MAX_PATHS_PER_REMOVE = 1000
const ROW_BATCH = Math.floor(MAX_PATHS_PER_REMOVE / 3)

Deno.serve(async (request) => {
  /**
   * The function's own credentials, injected by the platform. Named twice
   * because Supabase's newer projects publish the secret key under the second
   * name; whichever exists is the one with BYPASSRLS.
   */
  const serviceKey =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SB_SECRET_KEY')
  const url = Deno.env.get('SUPABASE_URL')

  if (!serviceKey || !url) {
    console.error('[reap-attachments] the platform injected no service credentials')
    return json({ error: 'misconfigured' }, 500)
  }

  /**
   * Authorisation, and the reason it is not the platform's `verify_jwt`.
   *
   * That flag checks only that a JWT was signed by this project — so **any
   * signed-in user** would satisfy it, and this function deletes things. What it
   * actually needs to know is that the caller holds a service-role key, which is
   * what `reap_attachments_tick()` sends from the Vault.
   *
   * The check is a capability probe rather than a string comparison, because the
   * two key formats (`sb_secret_…` and the legacy `service_role` JWT) are both
   * valid and only one of them is a JWT. `shared_key_budget` has RLS enabled and
   * **no policy for any role**, deliberately, since F02 — so it is readable only
   * by a key that bypasses RLS. A user token or the publishable key gets an empty
   * result, not a row.
   */
  const bearer = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''

  if (!bearer || !(await holdsServiceRole(url, bearer))) {
    return json({ error: 'unauthorized' }, 401)
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const cutoff = new Date(Date.now() - ORPHAN_TTL_HOURS * 3600_000).toISOString()

  try {
    // ─── Pass 1: drafts nobody ever sent ────────────────────────────────────
    const { data: orphans, error: orphanError } = await supabase
      .from('attachments')
      .select('id, storage_path, thumb_path, inline_path')
      .is('message_id', null)
      .lt('created_at', cutoff)
      .limit(ROW_BATCH)

    if (orphanError) throw orphanError

    let rowsDeleted = 0

    if (orphans && orphans.length > 0) {
      // All three paths, never just storage_path. Collecting only the original
      // strands two objects per image — the same leak, at twice the rate.
      const paths = orphans
        .flatMap((row) => [row.storage_path, row.thumb_path, row.inline_path])
        .filter((path): path is string => path !== null)

      const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths)

      // Abort BEFORE any row is deleted. A row is the only record that a file
      // exists, so removing it while the file survives is how an orphan becomes
      // permanent.
      if (removeError) throw removeError

      const { error: deleteError } = await supabase
        .from('attachments')
        .delete()
        .in(
          'id',
          orphans.map((row) => row.id),
        )

      if (deleteError) throw deleteError

      rowsDeleted = orphans.length
    }

    // ─── Pass 2: files whose row was cascaded away ──────────────────────────
    const { data: strays, error: strayError } = await supabase.rpc(
      'orphaned_attachment_objects',
      { p_older_than: `${ORPHAN_TTL_HOURS} hours`, p_limit: MAX_PATHS_PER_REMOVE },
    )

    if (strayError) throw strayError

    let objectsDeleted = 0

    if (strays && strays.length > 0) {
      const names = strays.map((row: { object_name: string }) => row.object_name)
      const { error: removeError } = await supabase.storage.from(BUCKET).remove(names)

      if (removeError) throw removeError

      objectsDeleted = names.length
    }

    // Reported rather than returning a bare 200, because F02 established what a
    // green exit status is worth: this job ran every ten minutes for 866 runs
    // without ever correcting anything. A run that did nothing and a run that
    // did something have to look different from the outside.
    console.log(
      `[reap-attachments] rows=${rowsDeleted} strayObjects=${objectsDeleted} cutoff=${cutoff}`,
    )

    return json({ rowsDeleted, objectsDeleted })
  } catch (error) {
    console.error('[reap-attachments] sweep failed', error)
    return json({ error: 'sweep failed' }, 500)
  }
})

/** True only for a key that bypasses RLS — see the note at the call site. */
async function holdsServiceRole(url: string, token: string): Promise<boolean> {
  try {
    const probe = createClient(url, token, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data, error } = await probe.from('shared_key_budget').select('id').limit(1)

    return !error && Array.isArray(data) && data.length > 0
  } catch {
    return false
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
