// Synthetic data only; no Sentry project, network or personal library.
const test = require('node:test');
const assert = require('node:assert/strict');
require('./profile_hub_test_loader.cjs');
const { sanitizeSentryEvent } = require('../frontend-mobile-preview/src/services/sentryPrivacy.ts');

test('automatic error reports exclude private event fields and respect opt-out', () => {
  const event = {
    event_id: 'fixture-id', release: '5.7.0', timestamp: 1,
    user: { email: 'private@example.invalid' },
    request: { url: 'https://example.invalid/private-profile?token=secret', cookies: 'secret' },
    message: 'private-title', extra: { library: 'private-content' },
    breadcrumbs: [{ message: 'private-url' }],
    exception: { values: [{ type: 'TypeError', value: 'private-title', stacktrace: { frames: [
      { filename: 'C:/private/folder/file.js', function: 'privateContent', lineno: 12, colno: 3 },
    ] } }] },
  };
  assert.equal(sanitizeSentryEvent(event, false), null);
  const clean = sanitizeSentryEvent(event, true);
  const serialized = JSON.stringify(clean);
  assert.doesNotMatch(serialized, /private|secret|example\.invalid|file\.js/);
  assert.equal(clean.exception.values[0].type, 'TypeError');
  assert.equal(clean.exception.values[0].stacktrace.frames[0].lineno, 12);
  assert.equal(clean.user.ip_address, null);
  assert.equal(clean.release, '5.7.0');
});

test('feedback contains the message and optional email but not the page or other context', () => {
  const clean = sanitizeSentryEvent({
    type: 'feedback', event_id: 'fixture-id',
    request: { url: 'https://example.invalid/private' },
    contexts: { feedback: { message: 'My suggestion', contact_email: 'reply@example.invalid',
      url: 'https://example.invalid/private', replay_id: 'private-replay' } },
    extra: { private: 'private-value' },
  }, false);
  assert.equal(clean.contexts.feedback.message, 'My suggestion');
  assert.equal(clean.contexts.feedback.contact_email, 'reply@example.invalid');
  assert.equal(clean.contexts.feedback.url, undefined);
  assert.equal(clean.contexts.feedback.replay_id, undefined);
  assert.equal(clean.request, undefined);
  assert.equal(clean.extra, undefined);
  assert.equal(clean.user.ip_address, null);
});
