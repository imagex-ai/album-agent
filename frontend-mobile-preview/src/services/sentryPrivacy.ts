export interface SentryPrivacyEvent {
  event_id?: string;
  timestamp?: number;
  type?: string;
  level?: string;
  release?: string;
  user?: { ip_address?: string | null };
  contexts?: { feedback?: Record<string, unknown> };
  exception?: { values?: Array<{ type?: string; value?: string; stacktrace?: {
    frames?: Array<{ lineno?: number; colno?: number; filename?: string }>;
  } }> };
}

const SAFE_ERROR_TYPES = new Set(['Error', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'URIError', 'EvalError']);

/** Keep only deliberately provided feedback or a content-free automatic error. */
export function sanitizeSentryEvent(event: SentryPrivacyEvent, monitoringEnabled: boolean): SentryPrivacyEvent | null {
  if (event.type === 'feedback') {
    const feedback = event.contexts?.feedback as Record<string, unknown> | undefined;
    if (!feedback || typeof feedback.message !== 'string') return null;
    return {
      event_id: event.event_id,
      timestamp: event.timestamp,
      type: 'feedback',
      level: 'info',
      user: { ip_address: null },
      contexts: { feedback: {
        message: feedback.message,
        ...(typeof feedback.contact_email === 'string' ? { contact_email: feedback.contact_email } : {}),
        source: 'user',
      } },
    };
  }
  if (!monitoringEnabled || event.type) return null;
  const values = event.exception?.values;
  if (!values?.length) return null;
  return {
    event_id: event.event_id,
    timestamp: event.timestamp,
    level: 'error',
    user: { ip_address: null },
    ...(event.release && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(event.release) ? { release: event.release } : {}),
    exception: { values: values.map(value => ({
      type: value.type && SAFE_ERROR_TYPES.has(value.type) ? value.type : 'Error',
      // Error messages and file paths may contain private user content.
      value: 'Unexpected error',
      stacktrace: value.stacktrace ? { frames: (value.stacktrace.frames || []).map(frame => ({
        lineno: frame.lineno,
        colno: frame.colno,
        filename: 'application',
      })) } : undefined,
    })) },
  };
}
