const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, row, profile } = require('./helpers.cjs');

function localPage(rows, probes, deck = '刻晴队') {
  const { T } = load(['core', 'ui']);
  const state = { requests: [], disposed: 0 };
  const h = {
    RecognitionObject: { ocr: (...rect) => rect },
    captureGameRegion: () => ({ width: 1920, height: 1080,
      findMulti: () => rows,
      find(rect) { state.requests.push(rect); return { text: probes[rect.join(',')] || '' }; },
      dispose() { state.disposed++; }
    })
  };
  const ui = new T.UI(h, { queue: [{ id: 'raiden', deck }] }, profile(), { event() {} });
  return { ui, screen: ui.read(), state };
}

test('a known local badge plus the visible start control establishes readiness without a full-screen heading', () => {
  const { ui, screen, state } = localPage([row('开始挑战', 1450, 900)], { '1305,793,206,46': '刻睛队' });
  assert.equal(ui.isReady(screen), true);
  assert.equal(ui.deckRows(screen, '刻晴队', 'deckBadge').length, 1);
  assert.equal(ui.isOpening(screen), false);
  assert.equal(state.disposed, 1);
});

test('unrelated local text or a deck name without a start control cannot establish readiness', () => {
  for (const [rows, badge] of [[[], '刻晴队'], [[row('开始挑战', 1450, 900)], '提示']]) {
    const { ui, screen } = localPage(rows, { '1305,793,206,46': badge });
    assert.equal(ui.isReady(screen), false);
  }
});

test('all four weekly name ROIs are read; the fourth slot remains selectable with source OCR corrections', () => {
  const { ui, screen, state } = localPage([row('选择', 1100, 1000)], {
    '135,762,230,46': '甲队', '598,762,230,46': '乙队',
    '1061,762,230,46': '丙队', '1524,762,230,46': '刻睛队'
  });
  assert.equal(ui.isDeckChooser(screen), true);
  const found = ui.deckRows(screen, '刻晴队', 'deckNames');
  assert.equal(found.length, 1);
  assert.equal(found[0].x, 1524);
  for (let i = 0; i < 4; i++)
    assert(state.requests.some(rect => rect.join(',') === `${135 + 463 * i},762,230,46`));
});

test('local badge verification takes precedence over a contradictory whole-screen name', () => {
  const { ui, screen } = localPage([row('我方出战牌组', 1240, 700), row('刻晴队', 1340, 810)], {
    '1305,793,206,46': '其他队'
  });
  assert.equal(ui.isReady(screen), true);
  assert.equal(ui.deckRows(screen, '刻晴队', 'deckBadge').length, 0);
});

test('local probes cannot turn an actual initial hand into a deck preparation page', () => {
  const { ui, screen, state } = localPage([row('初始手牌', 844, 167, 232, 65)], {
    '1305,793,206,46': '刻晴队', '1200,650,690,270': '我方出战牌组'
  });
  assert.equal(ui.isOpening(screen), true);
  assert.equal(ui.isReady(screen), false);
  assert.equal(state.requests.length, 0, 'only the full-frame OCR is needed at the opening');
});
