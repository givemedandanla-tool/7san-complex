const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, row, profile } = require('./helpers.cjs');

for (const diagnosticImages of [true, false]) {
  test(`UI checkpoint retains the exact OCR frame; diagnosticImages=${diagnosticImages}`, () => {
    const { T } = load(['core', 'ui']);
    const files = new Map(), images = [], events = [], mat = {}, state = { captures: 0, disposed: 0, clicks: 0 };
    const rows = [row('邀约对局', 1360, 850), row('友好对局', 1100, 120), row('出战角色', 700, 500)];
    const host = {
      file: { writeTextSync(p, value) { files.set(p, value); return true; }, writeImageSync: (p, image) => images.push([p, image]) },
      RecognitionObject: { ocr: () => ({}) }, click: () => state.clicks++,
      captureGameRegion() {
        state.captures++;
        return { width: 1920, height: 1080, srcMat: mat, findMulti: () => rows, dispose() { state.disposed++; } };
      }
    };
    const ui = new T.UI(host, { diagnosticImages }, profile(), { event: (type, data) => events.push({ type, data }) });
    const screen = ui.read('before-invite-confirm');
    const saved = JSON.parse(files.get('data/before-invite-confirm.json'));
    assert.equal(saved.stage, 'before-invite-confirm');
    assert.equal(saved.page.invitation, true);
    assert.equal(saved.page.opening, false, 'a preview heading must not be recorded as an actual game opening');
    assert.deepEqual(saved.rows, rows);
    assert.equal(screen, ui.lastScreen);
    assert.equal(state.captures, 1); assert.equal(state.disposed, 1); assert.equal(state.clicks, 0);
    assert.equal(events[0].type, 'ui-stage');
    if (diagnosticImages) assert.deepEqual(images, [['data/before-invite-confirm.png', mat]]);
    else assert.equal(images.length, 0);
  });
}
