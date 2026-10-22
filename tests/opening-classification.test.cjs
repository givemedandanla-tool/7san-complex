const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, row, profile } = require('./helpers.cjs');
const { T } = load(['core', 'ui']);
const reportedOpening = require('./fixtures/reported-opening-0.4.0.json');

function classify(rows, layout = profile()) {
  const ui = new T.UI({}, {}, layout, { event() {} });
  const screen = new T.Screen(rows);
  return { ui, screen, opening: ui.isOpening(screen) };
}

test('the reported 0.4.0 failure is an actual opening, not a central preview false positive', () => {
  const { ui, screen, opening } = classify(reportedOpening.rows);
  assert.equal(opening, true);
  assert.equal(ui.isReady(screen), false);
  assert.equal(ui.isInvitation(screen), false);
});

test('an explicit invitation page is never simultaneously classified as the opening scene', () => {
  const { ui, screen, opening } = classify([
    row('邀约对局', 1360, 850), row('友好对局', 1100, 120),
    row('认真胜负', 1440, 220), row('出战角色', 700, 500),
    row('初始手牌', 844, 167, 232, 65)
  ]);
  assert.equal(ui.isInvitation(screen), true);
  assert.equal(opening, false);
});

test('central deck-preview or confirmation labels are not evidence of entering opening cards', () => {
  for (const text of ['出战角色', '重投', '确认重投', '重投骰子', '初始手牌', '请选择要替换的手牌']) {
    const { opening } = classify([row(text, 700, 500)]);
    assert.equal(opening, false, text);
  }
});

test('the actual opening and roll headers, hand prompt and initial pick positions are recognized', () => {
  for (const marker of [
    row('初始手牌', 844, 167, 232, 65),
    row('请选择要替换的手牌', 847, 232, 229, 39),
    row('重投骰子', 844, 167, 232, 65),
    row('请选择出战角色', 138, 1020, 280, 48),
    row('选择出战角色', 138, 1020, 280, 48),
    row('出战角色', 1766, 850, 118, 43)
  ]) assert.equal(classify([marker]).opening, true, marker.text);
});

test('deck chooser/editor and preparation contexts override any opening-like labels', () => {
  const markers = [
    row('初始手牌', 844, 167, 232, 65),
    row('出战角色', 1766, 850, 118, 43)
  ];
  for (const page of ['编辑牌组', '选择牌组', '更改牌组外观', '我方出战牌组'])
    assert.equal(classify([row(page, 400, 400), ...markers]).opening, false, page);
});

test('a saved older profile cannot turn missing opening regions into a whole-screen match', () => {
  const layout = profile();
  for (const key of ['openingHeader', 'openingPrompt', 'rollHeader', 'pickPrompt', 'pickLabel']) delete layout.regions[key];
  assert.equal(classify([row('出战角色', 700, 500)], layout).opening, false);
  assert.equal(classify([row('初始手牌', 844, 167, 232, 65)], layout).opening, true);
});
