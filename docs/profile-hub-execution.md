# Profile Hub — confirmed execution, Stage 5

Authorized by the user on 01/11/2026 after approval of the multi-profile review
proposal. This extends the existing Hub and review; it adds no sidebar entry and
does not replace players, selection sessions or Smart Shorts.

## Confirmation and API

- `POST /api/profile-hub/executions`: UUID `request_id`, literal `confirmed: true`,
  and nonempty `profiles`. Each profile carries its key, HTTPS source URL/name,
  independent video/gallery destinations, explicit video mode when applicable,
  and selected typed media references (`id`, `kind`, original/collection URL,
  title and optional metadata).
- `GET /api/profile-hub/executions/{request_id}`: immutable root operations,
  resolved units, individual outcomes/progress, acknowledged retry IDs and whether
  any work remains active. It never starts/resumes extraction.
- `POST /api/profile-hub/executions/{request_id}/retry`: UUID `retry_id`, optional
  failed root/unit IDs. Omitting IDs means all currently failed/interrupted work.
  Successful units cannot be retried through this endpoint.

Malformed requests return 422; unsupported source/destination returns 400;
unknown batch returns 404; nonce conflicts, invalid retry scope and active
ownership conflicts return 409. Responses never describe an unverified save as
successful. Browser copy maps errors to localized correction/recovery actions.

The repository commits the immutable payload digest and root work before
dispatch. A repeated request ID with the same payload returns existing status;
a different payload conflicts. Retry IDs bind their exact target list, so a lost
acknowledgement can be looked up or resent without another attempt. Returned
status includes the latest 64 retry IDs; the journal retains all acknowledgements.

Maximum request: 1,000 profiles, 10,000 selected references per profile and 20,000
total. A selected collection counts as one reference before expansion; its real
expanded size is not invented in the review.

## Ownership, persistence and interruption

`profile_hub_execution.py` owns contracts, SQLite journal and coordination, with
an injected media port. Importing it does not start the application or storage.
The server binds existing services through `ProfileHubExecutionPort` only at
normal application startup. State lives in ignored runtime directory
`data/profile-hub-execution/`, separate from existing library data.

SQLite transactions serialize confirmation and retries across server processes.
An owner heartbeat and 300-second lease prevent an active batch being taken over.
After expired ownership, unfinished work is shown interrupted; explicit retry is
required. Status lookup and application restoration never automatically resume
media work. Per-artifact OS file locks and scoped ownership claims protect output
reconciliation across concurrent/restarted batches. Verified existing artifacts
are reused rather than downloaded/saved again.

The client stores only the latest opaque batch UUID, not selected media or
destinations, in localStorage using existing deferredStorage. While the session
is live it retains the exact confirmation body after timeout/unknown response.
Cold restoration fetches the journal by UUID; it cannot invent or resend a lost
body. Storage failure is visible. Current profile sessions/selections remain
in-memory and survive navigation, not application restart. Only the latest batch
is restored by the Hub; existing queue entries retain their batch/unit identity.

The Hub polls while active, using bounded exponential backoff on failures and an
explicit status action after repeated failure. Aborted/stale responses cannot
replace a newer review. Effects and rendering perform no confirmation POST.

## Sources and media

`ExecutionSources` is an adapter registry. The implemented adapter supports
recognized Eporner profiles, video routes, playlists and galleries; this is not
universal source support. Collection pagination follows discovered links with
the same collection identity, at most 100 pages and 20,000 records. Unavailable
pages, context changes, changed/contradictory counts or incomplete originals fail
the root instead of silently processing an incomplete collection as complete.

Shared parsers serve both existing previews and confirmed collection discovery.
They exclude recommendation sections. Collection requests and new media
validation reuse the directory's public-DNS-pinned HTTPS transport. The existing
extractor/video workers retain ownership of their established source handling.

Playlists expand to independent video units. Overlap with directly selected
videos is deduplicated by stable identity inside the same profile/destination/
mode. Whole galleries use the existing full-album resolver and require original
validation. Individually selected photos/GIFs with a collection are matched
unambiguously to resolved originals; only that subset is saved. Stale or ambiguous
matches fail visibly. Direct originals are probed for actual media bytes before
save. No neighboring photos are added to an individual selection.

## Destinations and existing workers

Video destinations remain filesystem folders under the existing video library.
Invalid names are rejected instead of silently sanitized into a different
destination; traversal, reserved device names and symlink/junction aliases are
rejected. Gallery destinations remain logical labels and may contain `/`.
Each profile has its own independent configuration.

Video mode is explicitly `web_stream` or `download`. Existing stream registration
and physical-download workers are reused, with identity scoped by source profile,
media URL, destination and mode. An isolated registration lookup prevents their
legacy same-title/source migration from moving another profile's saved item.
Optional worker arguments preserve existing callers. Smart Shorts logic and its
worker calls are unchanged.

Gallery save reuses finalization, folder registration and album persistence. The
current gallery model stores JSON with remote-original references; it does not
promise physical image-file downloads. Physical video files and Web Stream
records are verified against actual file/metadata state. Album persistence must
return success and read back the expected destination and original URLs.
Existing foreign output is never overwritten just because its filename matches.

Root expansion and ready unit execution have separate bounded concurrency (two
each). Execution slots are shared across waiting source profiles: prefer profiles
with fewer active units and rotate ties. A large first profile cannot reserve
every future slot ahead of a later ready profile; running work is not preempted,
and a single profile may still use both idle slots. Cancellation releases any
granted reservation and removes cancelled waiting requests.
Every resolved unit is registered in the existing job queue before its
execution slot. Progress/cancel/pause remain with existing controllers. Queue
retry routes multiprofile jobs back through immutable unit IDs; it cannot fall
through to a generic legacy relaunch with mutable destinations. Failed or
cancelled units do not stop siblings from other profiles.

## Review and tracking

The approved profile/media/destination layout remains. `ProfileExecutionPanel`
extends its summary with the confirmed snapshot, typed operation states,
completion counts, source-specific failures, status lookup and failed-only retry.
It uses existing `--pd-*` tokens, buttons and pt-BR/en-US conventions. Byte
progress is determinate only when a real total is known. Operation rendering
starts at twelve entries with explicit increments.

On a source count mismatch, the failed root may include `error_details` with
`reported_count`, `found_count` and `page_count`. The UI shows those exact counts
in the active locale. Older journal entries without details retain the generic
message. Complete discovered pagination does not waive a mismatch: the source
can advertise more items than it exposes. The root remains failed, with no
partial dispatch, until explicit retry or the user revises selected items.

Running and resolving states use the existing animated spinner utility. Failed,
succeeded and queued states stay static; reduced-motion preference suppresses
rotation through the scoped review CSS override. An active status lookup also
animates its icon without changing button geometry.

Selections and destinations can continue changing for a future batch without
altering the confirmed one. New review is blocked for active/uncertain work and
never clears existing choices. The global bar still opens tracking when current
selection is empty. Real-profile Save actions open review; compatible ZIP keeps
its separate existing confirmation. The obsolete album batch-save endpoint
fails closed before storage import instead of claiming albums were saved.

## Verification limits

Isolated tests use disposable SQLite/library paths and fake source/worker/cloud
operations; selected legacy production functions are loaded through the existing
AST helper, without importing application startup. Node tests cover immutable
requests, duplicate clicks, uncertain outcomes, recovery, partial failure and
SSR/locales. Existing Hub/directory regressions and TypeScript/Vite build run.

No live Eporner extraction, physical media download, personal-library operation,
browser visit or secondary agent was used in this stage. Existing legacy premium
audit findings remain separately documented; static/SSR checks do not establish
pixel fidelity or full accessibility/mobile/theme compliance.
