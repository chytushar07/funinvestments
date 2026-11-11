import test from 'node:test';
import assert from 'node:assert/strict';
import { mintKey, verifyKey, resolveSpace } from '../engine/keys.js';

const me = { secret: 'test-secret-1', legacyKey: 'fi_owner_key_0001' };

test('minted keys are unique, well-formed and verify', async () => {
  const a = await mintKey(me.secret), b = await mintKey(me.secret);
  assert.notEqual(a, b);
  assert.match(a, /^fiv_[0-9a-f]{24}_[0-9a-f]{20}$/);
  assert.equal(await verifyKey(me.secret, a), true);
});

test('keys cannot be forged or tampered with, and another secret rejects them', async () => {
  const k = await mintKey(me.secret);
  const [pre, id, sig] = k.split('_');
  const flipped = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0');
  for (const bad of [`${pre}_${id}_${flipped}`, `${pre}_${'0'.repeat(24)}_${sig}`, `${pre}_${id}`, `${k}x`, '', null, undefined, 'fi_demo_7f3a9c21', `${pre}_${id.toUpperCase()}_${sig}`]) {
    assert.equal(await verifyKey(me.secret, bad), false, String(bad));
  }
  assert.equal(await verifyKey('another-secret', k), false);
});

test('each key opens only its own space; the original owner key opens the original space', async () => {
  const a = await mintKey(me.secret), b = await mintKey(me.secret);
  assert.equal(await resolveSpace(a, me), a);
  assert.equal(await resolveSpace(b, me), b);
  assert.notEqual(await resolveSpace(a, me), await resolveSpace(b, me), 'two visitors never share a space');
  assert.equal(await resolveSpace(me.legacyKey, me), 'main');
  assert.equal(await resolveSpace('', me), null);
  assert.equal(await resolveSpace('fi_somebody_else', me), null, 'an invented key opens nothing');
  assert.equal(await resolveSpace(a, { secret: me.secret, legacyKey: undefined }), a);
});
