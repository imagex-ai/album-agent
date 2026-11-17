import type { UpdateCheckResponse } from './realApi';

const LAST_NOTIFIED_KEY = 'imagex_update_notified_version';
// A brief haptic signal, independent of the operating system's sound setting.
const UPDATE_VIBRATION_MS = 120;
let sessionNotifiedVersion: string | null = null;

export function updateNeedsAttention(info: UpdateCheckResponse | null, dismissed: string | null): boolean {
  return !!info?.update_available && !!info.latest_version && info.latest_version !== dismissed;
}

export function claimUpdateNotification(version: string, dismissed: string | null): boolean {
  if (!version || version === dismissed || version === sessionNotifiedVersion) return false;
  try {
    if (localStorage.getItem(LAST_NOTIFIED_KEY) === version) {
      sessionNotifiedVersion = version;
      return false;
    }
    localStorage.setItem(LAST_NOTIFIED_KEY, version);
  } catch (_) {
    // Storage may be unavailable; the in-memory guard still prevents repeats.
  }
  sessionNotifiedVersion = version;
  return true;
}

export function vibrateForUpdate(): void {
  try {
    if (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
      && typeof navigator.vibrate === 'function') navigator.vibrate(UPDATE_VIBRATION_MS);
  } catch (_) {
    // Haptics are optional and can be blocked by the browser or OS.
  }
}
