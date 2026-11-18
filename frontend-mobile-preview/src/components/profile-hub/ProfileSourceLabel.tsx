import React, { useEffect, useRef, useState } from 'react';
import { Globe } from 'lucide-react';

// Retry once after the service's short failure-cache window to recover from temporary errors.
const SITE_ICON_RETRY_DELAY_MS = 2500;
const SITE_ICON_RETRIES_PER_ACTIVE_PERIOD = 1;

interface ProfileSiteSource {
  hostname: string;
  iconUrl: string | null;
  identity: string;
}

/** Extract only the origin; never include the profile path, query, credentials or fragment. */
export function profileSiteSource(sourceUrl?: string): ProfileSiteSource | null {
  if (!sourceUrl) return null;
  try {
    const parsed = new URL(sourceUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return null;
    const iconUrl = parsed.protocol === 'https:' && !parsed.port
      ? `/api/profile-directory/site-icon?origin=${encodeURIComponent(parsed.origin)}`
      : null;
    return { hostname: parsed.hostname, iconUrl, identity: parsed.origin };
  } catch {
    return null;
  }
}

function SiteIcon({ source, active }: { source: ProfileSiteSource; active: boolean }) {
  const [load, setLoad] = useState({ failed: false, retries: 0 });
  const wasActive = useRef(active);
  useEffect(() => {
    const returning = active && !wasActive.current;
    wasActive.current = active;
    if (returning) setLoad(previous => !previous.failed && previous.retries === 0 ? previous : { failed: false, retries: 0 });
  }, [active]);
  useEffect(() => {
    if (!active || !source.iconUrl || !load.failed || load.retries >= SITE_ICON_RETRIES_PER_ACTIVE_PERIOD) return;
    const timeout = window.setTimeout(() => setLoad(previous => {
      if (!previous.failed || previous.retries >= SITE_ICON_RETRIES_PER_ACTIVE_PERIOD) return previous;
      return { failed: false, retries: previous.retries + 1 };
    }), SITE_ICON_RETRY_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [active, source.iconUrl, load.failed, load.retries]);
  return <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center" role="img" aria-label={source.hostname} title={source.hostname}>
    {active && source.iconUrl && !load.failed
      ? <img className="h-3 w-3 rounded-sm object-contain" src={source.iconUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setLoad(previous => previous.failed ? previous : { ...previous, failed: true })} />
      : <Globe className="h-3 w-3 text-slate-400" aria-hidden="true" />}
  </span>;
}

export function ProfileSourceLabel({ name, nameClassName, sourceUrl, active = true }: {
  name: string;
  nameClassName: string;
  sourceUrl?: string;
  active?: boolean;
}) {
  const source = profileSiteSource(sourceUrl);
  if (!source) return <span className={nameClassName}>{name}</span>;
  return <span className="inline-flex min-w-0 items-center gap-1 pr-3">
    <span className={nameClassName}>{name}</span>
    <SiteIcon key={source.identity} source={source} active={active} />
  </span>;
}
