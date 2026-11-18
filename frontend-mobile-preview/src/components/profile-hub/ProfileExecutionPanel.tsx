import React, { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, Folder, Layers, Loader2, RefreshCw } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useProfileHubExecutionStore } from '../../store/useProfileHubExecutionStore';
import { executionErrorText, profileHubExecutionCopy } from '../../services/profileHubExecutionCopy';
import { profileHubReviewCopy, reviewText } from '../../services/profileHubReviewCopy';
import { failedExecutionState, retryTargets } from '../../services/profileHubExecutionModel';

export function ProfileExecutionPanel({ eligible }: { eligible: boolean }) {
  const state = useProfileHubExecutionStore();
  const language = useAppStore(value => value.settings.language);
  const copy = profileHubExecutionCopy[language];
  const reviewCopy = profileHubReviewCopy[language];
  const [limit, setLimit] = useState(12);
  const units = useMemo(() => new Map(state.batch?.units.map(unit => [unit.id, unit]) ?? []), [state.batch]);
  const number = (value: number) => new Intl.NumberFormat(language).format(value);
  const modeLabel = (mode: string) => mode === 'web_stream' ? copy.modeStream : mode === 'download' ? copy.modeDownload : copy.modeGallery;
  const error = state.error && <p role="alert" className="phr-error">{executionErrorText(state.error, copy)}</p>;
  const refresh = <button type="button" className="pd-button phr-back" onClick={() => void state.refresh()} disabled={state.busy || state.checking} aria-busy={state.checking}><RefreshCw size={15} className={state.checking ? 'animate-spin' : undefined} aria-hidden="true" />{copy.refresh}</button>;
  if (!state.batch) return <section className="phr-execution" aria-label={state.uncertain ? copy.uncertain : state.draft ? copy.confirming : copy.confirm}>
    {!state.draft && state.lastId && <><h3>{copy.tracking}</h3><p className="phr-mode-help">{copy.recoverHint}</p>{refresh}<button type="button" className="pd-button phr-back" disabled={state.busy || state.checking} onClick={() => state.newReview()}>{copy.newReview}</button></>}
    {state.draft && <><h3>{state.uncertain ? copy.uncertain : copy.confirming}</h3><p className="phr-mode-help">{state.uncertain ? copy.uncertainHint : copy.snapshotHint}</p>
      {state.draft.profiles.map(profile => <div className="phr-operation" key={profile.profile_key}><strong>{profile.profile_name || reviewCopy.unnamed}</strong>
        {profile.video_folder && <p>{modeLabel(profile.video_mode!)} · {profile.video_folder}</p>}{profile.gallery_folder && <p>{copy.modeGallery} · {profile.gallery_folder}</p>}</div>)}
      {refresh}</>}
    {error}
    <button type="button" className="pd-button pd-primary phr-primary phr-confirm" disabled={state.busy || Boolean(state.lastId && !state.draft) || (!state.draft && !eligible)} aria-busy={state.busy} aria-describedby="phr-confirm-hint"
      onClick={() => void state.confirm()}>{state.busy ? <Loader2 size={16} className="animate-spin" /> : <Folder size={16} />}{state.uncertain ? copy.resend : copy.confirm}</button>
    <p id="phr-confirm-hint" className="phr-mode-help">{copy.confirmHint}</p>
    {!state.storageAvailable && <p role="status" className="phr-mode-help">{copy.recoveryHint}</p>}
  </section>;
  const batch = state.batch;
  const failed = retryTargets(batch);
  const succeeded = batch.operations.filter(operation => operation.status === 'succeeded').length;
  const profileCount = new Set(batch.operations.map(operation => operation.profile_key)).size;
  const itemCount = batch.operations.reduce((sum, operation) => sum + operation.items.length, 0);
  return <section className="phr-execution" aria-labelledby="phr-execution-title">
    <h3 id="phr-execution-title"><Layers size={17} />{copy.confirmed}</h3>
    <p className="phr-mode-help">{copy.snapshotHint}</p>
    <dl className="phr-execution-totals"><div><dt>{copy.confirmedProfiles}</dt><dd>{number(profileCount)}</dd></div><div><dt>{copy.selectedItems}</dt><dd>{number(itemCount)}</dd></div>
      <div><dt>{copy.saved}</dt><dd>{number(succeeded)} / {number(batch.operations.length)}</dd></div><div><dt>{copy.failures}</dt><dd>{number(failed.length)}</dd></div></dl>
    <div className="phr-execution-list">{batch.operations.slice(0, limit).map(operation => {
      const members = operation.unit_ids.map(id => units.get(id)).filter(unit => Boolean(unit));
      const done = members.filter(unit => unit!.status === 'succeeded').length;
      const failedMembers = members.filter(unit => failedExecutionState(unit!.status));
      const retryIds = retryTargets(batch, operation.id);
      const working = operation.status === 'running' || operation.status === 'resolving';
      const Icon = operation.status === 'succeeded' ? CheckCircle2 : failedExecutionState(operation.status) ? AlertCircle : working ? Loader2 : Clock3;
      return <article className="phr-operation" key={operation.id}>
        <strong>{operation.profile_name || reviewCopy.unnamed}</strong><p>{reviewCopy[operation.kind]} · {operation.items[0]?.title || reviewCopy.untitled}</p>
        {operation.items.length > 1 && <small>{reviewText(copy.groupItems, { count: number(operation.items.length) })}</small>}
        <p className="phr-operation-destination">{modeLabel(operation.mode)} · {operation.destination}</p>
        <span className="phr-operation-status" role="status"><Icon size={14} className={working ? 'animate-spin' : undefined} aria-hidden="true" />{copy[operation.status]}</span>
        {operation.resolved && <small>{reviewText(copy.processed, { done: number(done), total: number(members.length) })}</small>}
        {operation.error && <p className="phr-error">{executionErrorText(operation.error, copy, operation.error_details, language)}</p>}
        {members.filter(unit => unit!.status === 'running' && (unit!.progress.total_bytes || 0) > 0).map(unit => <progress key={unit!.id} value={Math.min(unit!.progress.downloaded_bytes || 0, unit!.progress.total_bytes!)} max={unit!.progress.total_bytes} aria-label={`${copy.running}: ${unit!.title || reviewCopy.untitled}`} />)}
        {failedMembers.length > 0 && <details><summary>{copy.failures}: {number(failedMembers.length)}</summary>{failedMembers.slice(0, 8).map(unit => <div className="phr-failed-unit" key={unit!.id}><strong>{unit!.title || reviewCopy.untitled}</strong><p>{executionErrorText(unit!.error || '', copy)}</p><a href={unit!.source_url} target="_blank" rel="noopener noreferrer">{copy.source}</a></div>)}
          {failedMembers.length > 8 && <small>{number(failedMembers.length)} · {copy.retryHint}</small>}</details>}
        {retryIds.length > 0 && <button type="button" className="pd-button phr-more" disabled={state.busy} onClick={() => void state.retry(operation.id)}><RefreshCw size={14} />{copy.retryOperation}</button>}
      </article>;
    })}</div>
    {batch.operations.length > limit && <button type="button" className="pd-button phr-more" onClick={() => setLimit(value => value + 12)}>{copy.showMore}</button>}
    {error}{refresh}
    {failed.length > 0 && <><button type="button" className="pd-button pd-primary phr-primary phr-confirm" disabled={state.busy} aria-busy={state.busy} onClick={() => void state.retry()}><RefreshCw size={15} />{copy.retry} ({number(failed.length)})</button><p className="phr-mode-help">{copy.retryHint}</p></>}
    <button type="button" className="pd-button phr-back" disabled={state.busy || batch.active} onClick={() => state.newReview()} aria-describedby="phr-new-review-hint">{copy.newReview}</button>
    <p id="phr-new-review-hint" className="phr-mode-help">{copy.newReviewHint} {copy.preserved}</p>
    {!state.storageAvailable && <p role="status" className="phr-mode-help">{copy.recoveryHint}</p>}
  </section>;
}
