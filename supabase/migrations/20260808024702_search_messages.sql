-- Ranked full-text search over a user's own messages. (F26)
--
-- `messages.search_vector` and `messages_search_idx` have existed since F02 and
-- nothing has ever queried them. This is what F02 built them for.
--
-- A function rather than a PostgREST query because `ts_rank` and `ts_headline`
-- cannot be expressed through it: one orders the result, the other computes a
-- per-row summary, and neither is a filter.
--
-- `security invoker`, like every function in this schema except
-- `handle_new_user()`. It runs under the caller's session, so the owner policy
-- on `messages` is what limits the scan to their own rows. There is no
-- `user_id` parameter and there must never be one — a parameter would be
-- application code deciding whose data this is, which is exactly the thing RLS
-- is here to make impossible.
--
-- ─── On the snippet, which deliberately contains no HTML ──────────────────────
--
-- `ts_headline` does NOT escape the document it summarises, measured against
-- this project before this function was written:
--
--   ts_headline over 'An <img src=x onerror=alert(2)> tag ... searchable ...'
--     -> 'onerror=alert(2)> tag sits inside <mark>searchable</mark> content'
--
-- Two separate problems in one line. The `img` tag survived intact, so a
-- snippet rendered as HTML would execute whatever a message contained — and
-- message content is model output and user input, both untrusted. And fragment
-- selection cut the tag in half, so even a sanitiser would be handed markup
-- that was never well formed.
--
-- So the delimiters are control characters rather than `<mark>`, and the
-- snippet is plain text by construction. F27 splits on them and emits real
-- React elements, which means no consumer ever holds a string it might pass to
-- `dangerouslySetInnerHTML`. `build-plan.md` §27's "only <mark> is permitted,
-- never arbitrary HTML" stops being a rule someone has to follow and becomes a
-- fact about the data. STX (chr 2) and ETX (chr 3) are chosen because they
-- cannot occur in prose and survive JSON encoding as \u0002 and \u0003 — both
-- verified against this database before choosing them.
--
-- ─── On ordering ─────────────────────────────────────────────────────────────
--
-- `ts_rank` desc leads, then `created_at` desc, then `id` desc. The tiebreakers
-- are what make the order total, and they matter more here than in F19's
-- thread ordering: two timestamps colliding is vanishingly unlikely, whereas
-- two messages sharing a rank is ordinary. Without them the same query can
-- return the same rows in a different order each time.
--
-- The tsquery is parsed once in a CTE rather than five times inline. Same
-- result; it just stops the function reading as though parsing were free.

create function public.search_messages(query text, result_limit int default 30)
returns table (
  message_id uuid,
  conversation_id uuid,
  conversation_title text,
  role message_role,
  snippet text,
  rank real,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with parsed as (
    select websearch_to_tsquery('english', query) as tsq
  )
  select
    m.id,
    m.conversation_id,
    c.title,
    m.role,
    ts_headline(
      'english',
      m.content,
      parsed.tsq,
      'StartSel=' || chr(2) || ', StopSel=' || chr(3) || ', MaxFragments=2'
    ),
    ts_rank(m.search_vector, parsed.tsq),
    m.created_at
  from public.messages m
    join public.conversations c on c.id = m.conversation_id
    cross join parsed
  -- A query of only stopwords parses to an empty tsquery, which @@ would match
  -- nothing against anyway. Stated explicitly so the intent is readable and the
  -- planner can stop before touching the index.
  where parsed.tsq <> ''::tsquery
    and m.search_vector @@ parsed.tsq
  -- No archived_at filter. F22: "Archived conversations remain fully readable
  -- and searchable" — putting something away is not the same as forgetting it.
  order by ts_rank(m.search_vector, parsed.tsq) desc, m.created_at desc, m.id desc
  limit result_limit;
$$;

comment on function public.search_messages(text, int) is
  'Ranked full-text search over the caller''s messages. The snippet is PLAIN TEXT: matches are delimited by chr(2)/chr(3), never <mark>, because ts_headline does not escape the document and message content is untrusted. (F26)';

-- Whether a query contains anything searchable at all. (F26)
--
-- "the and of" parses to an empty tsquery, so it finds nothing — but so does a
-- real word that happens to be absent, and those are different facts to report.
-- One says "try different words", the other says "there is nothing here".
--
-- A separate function rather than another output column, because the case it
-- describes is precisely the one where there are no rows to carry a column on.
-- Called only when the result set is empty, so the common path costs nothing.
create function public.search_has_terms(query text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select websearch_to_tsquery('english', query) <> ''::tsquery;
$$;
