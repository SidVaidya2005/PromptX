<!-- TEMPLATE (setup-context) — created with its two sections EMPTY; do NOT fill at
     initialization. The agent appends to the Feature Log after each completed
     feature and compacts at phase checkpoints, deleting this banner before the
     first entry. KEEP the > **Role:** blockquote AND the "How this file is
     maintained" section — both are permanent documentation, not scaffolding. -->

# Build Journal

> **Role:** Two records in one file — the constraints that still bind, and the dated log of how the build got here.
> **Read Standing Constraints** before any decision that might conflict with past work; **append to the Feature Log** after every completed feature.
> **Relates to:** logs the features in `build-plan.md`; receives decisions displaced from `progress-tracker.md`.

## How this file is maintained

This file holds two records with different lifetimes. Keep them separate — the
whole point is that Standing Constraints stays short and findable while the
Feature Log absorbs the churn.

**Standing Constraints — permanent, topical, deduped.**

- Grouped by **topic** (auth, data, payments…), never by date. Add a `###` topic heading when a new one is needed.
- Holds only what still binds: decisions that constrain future work, and notes explaining why something non-obvious is the way it is.
- **Receives decisions displaced from `progress-tracker.md`** — when Key Decisions would exceed 10 bullets, its oldest entry is filed here under its topic.
- Cite the feature each bullet came from, e.g. `(F02)`.
- **Never pruned by age.** Remove a constraint only when it is verifiably dead — reversed by a later decision, or the thing it describes no longer exists.

**Feature Log — chronological, compacted.**

- **Append a dated entry after every completed feature**, under the current phase: decisions made, gotchas hit, verification results.
- **Compact at every phase checkpoint, never continuously.** When a phase closes:
  1. **Promote** anything from that phase that still binds into Standing Constraints, filed under its topic.
  2. **Collapse** the phase's per-feature entries into a handful of summary bullets.
  3. **Drop every `Verified:` line** — it has done its job once the next feature passes.
- Only the current phase keeps full per-feature detail. Earlier phases stay compacted, newest first.

Compaction is recoverable: this file is committed, so `git` history holds every
detail ever removed. Compact confidently.

## Standing Constraints

<!-- Filed by topic, newest bullet first within each topic:

### {{TOPIC}}
- {{CONSTRAINT}} ({{FEATURE_REF}})

-->

_None yet._

## Feature Log

<!-- Newest phase first. Entry format — repeat per completed feature:

### Phase {{N}} — {{PHASE_NAME}}

#### Feature {{NN}} — {{FEATURE_NAME}}  *(YYYY-MM-DD)*
- Decision: …
- Gotcha: …
- Verified: …

At that phase's checkpoint, the whole phase collapses to:

### Phase {{N}} — {{PHASE_NAME}} *(compacted)*
- {{SUMMARY_BULLET}} (F{{NN}}–F{{NN}})

-->

_Nothing yet — build not started._
