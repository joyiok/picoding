import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectForegroundPage } from '../sandbox/browser.js';

test('foreground selection follows a manually selected native browser tab', async () => {
  const previous = { name: 'previous', focused: false, visible: false };
  const selected = { name: 'manually selected', focused: true, visible: true };
  assert.equal(await selectForegroundPage([previous, selected], async page => page, previous), selected);
  selected.focused = false; // The address bar may own keyboard focus.
  assert.equal(await selectForegroundPage([previous, selected], async page => page, previous), selected);
  selected.visible = false;
  assert.equal(await selectForegroundPage([previous, selected], async page => page, previous), previous);
  assert.equal(await selectForegroundPage([], async () => ({ focused: false, visible: false }), previous), undefined);
});
