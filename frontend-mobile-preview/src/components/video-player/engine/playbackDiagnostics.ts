import { translations } from '../../../i18n/translations';
import type { Language } from '../../../types';

export type PlaybackDiagnosticCode =
  | 'resolution_timeout' | 'extraction_failed' | 'no_formats' | 'request_failed'
  | 'network_error' | 'startup_timeout' | 'decode_error' | 'unsupported'
  | 'hls_error' | 'unknown';
export type PlaybackDiagnostic = {
  stage: 'resolution' | 'transport' | 'playback';
  code: PlaybackDiagnosticCode;
  httpStatus?: number;
};

const codes = new Set<PlaybackDiagnosticCode>([
  'resolution_timeout', 'extraction_failed', 'no_formats', 'request_failed',
  'network_error', 'startup_timeout', 'decode_error', 'unsupported', 'hls_error', 'unknown',
]);

/** Accept only the small, non-sensitive wire contract; never expose raw errors or URLs. */
export function parsePlaybackDiagnostic(value: unknown): PlaybackDiagnostic | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (input.stage !== 'resolution' && input.stage !== 'transport' && input.stage !== 'playback') return null;
  if (typeof input.code !== 'string' || !codes.has(input.code as PlaybackDiagnosticCode)) return null;
  const result: PlaybackDiagnostic = { stage: input.stage, code: input.code as PlaybackDiagnosticCode };
  const status = input.http_status ?? input.httpStatus;
  if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599) result.httpStatus = status;
  return result;
}

export function fromMediaError(value: unknown): PlaybackDiagnostic | null {
  if (!value || typeof value !== 'object') return null;
  const code = (value as { code?: unknown }).code;
  if (code === 2) return { stage: 'transport', code: 'network_error' };
  if (code === 3) return { stage: 'playback', code: 'decode_error' };
  if (code === 4) return { stage: 'playback', code: 'unsupported' };
  return null; // Aborts are commonly intentional during teardown.
}

export function fromHlsError(value: unknown): PlaybackDiagnostic | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as { type?: unknown; details?: unknown };
  if (data.type === 'networkError') return { stage: 'transport', code: 'network_error' };
  if (data.details === 'manifestIncompatibleCodecsError' || data.details === 'bufferIncompatibleCodecsError') {
    return { stage: 'playback', code: 'unsupported' };
  }
  return { stage: 'playback', code: 'hls_error' };
}

export function playbackDiagnosticMessage(diagnostic: PlaybackDiagnostic | null, language: Language): string {
  const messages = translations[language].player.playbackDiagnostics;
  const code = diagnostic?.code || 'unknown';
  if (code === 'unknown') return messages[diagnostic?.stage || 'playback'];
  const message = messages[code];
  return diagnostic?.httpStatus && code === 'request_failed'
    ? `${message} ${messages.http_status.replace('{status}', String(diagnostic.httpStatus))}`
    : message;
}
