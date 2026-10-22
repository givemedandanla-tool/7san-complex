const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, row, screen, profile } = require('./helpers.cjs');
const { T } = load(['core', 'ui', 'legacy']);

function game() {
  const state = { page: 'ready', deck: '雷柯刻', pending: null, clicks: [], keys: [], captured: 0, disposed: 0 };
  function rows() {
    if (state.page === 'ready') return [row('迪卢克'), row('友好对局', 1400, 220), row('我方出战牌组', 1240, 700), row(state.deck, 1340, 810), row('开始挑战', 1450, 900)];
    if (state.page === 'chooser') return [row('编辑牌组', 700, 990), row('雷柯刻', 135, 762), row('伊嘉早', 598, 762), row('选择', 1100, 1000)];
    if (state.page === 'opening') return [row('请选择要替换的手牌', 800, 232)];
    if (state.page === 'lose' || state.page === 'win') return [row(state.page === 'win' ? '对局胜利' : '对局失败', 800, 200), row('退出挑战', 700, 915)];
    if (state.page === 'world') return [row('迪卢克', 800, 300)];
    if (state.page === 'dialogue') return [row('友好对局', 1250, 450), row('迪卢克', 400, 1000)];
    return [];
  }
  const h = {
    sleep: async () => {},
    file: { readImageMatSync: () => ({ dispose() {} }) },
    RecognitionObject: { ocr: () => ({}), templateMatch: () => ({}) },
    captureGameRegion() {
      state.captured++;
      const rs = rows();
      return { width: 1920, height: 1080,
        findMulti: () => Object.assign({ count: rs.length }, Object.fromEntries(rs.map((r, i) => [i, r]))),
        find: () => ({ isEmpty: () => true }), dispose() { state.disposed++; } };
    },
    click(x, y) {
      state.clicks.push([x, y, state.page]);
      if (state.page === 'ready' && x === 1312 && y === 812) { state.page = 'chooser'; return; }
      if (state.page === 'chooser' && y < 900) { state.pending = x < 500 ? '雷柯刻' : '伊嘉早'; return; }
      if (state.page === 'chooser' && y >= 900) { state.deck = state.pending; state.page = 'ready'; return; }
      if (state.page === 'ready' && y >= 900) { state.page = 'opening'; return; }
      if (['lose', 'win'].includes(state.page) && y >= 900) { state.page = 'world'; return; }
      if (state.page === 'dialogue') { state.page = 'ready'; return; }
    },
    keyPress(key) { state.keys.push(key); if (state.page === 'world' && key === 'F') state.page = 'dialogue'; },
    moveMouseTo() {}, leftButtonDown() {}, leftButtonUp() {}
  };
  const cfg = { deckPages: 1, diagnosticImages: false }, report = { events: [], event(...args) { this.events.push(args); } };
  const p = profile(); p.pollMs = 1;
  return { state, h, ui: new T.UI(h, cfg, p, report), report };
}

test('UI integration: loss -> exit -> same NPC -> same difficulty -> different deck -> victory', async () => {
  const { state, ui } = game();
  const context = { name: '迪卢克', difficulty: '友好对局', verified: false };
  await ui.ensureReady(context);
  const queue = [{ id: 'raiden', title: '雷柯刻', deck: '雷柯刻' }, { id: 'iansan', title: '伊嘉早', deck: '伊嘉早' }];
  const result = await T.runAttempts(queue, 2, {
    prepare: r => ui.selectDeck(r, context), reopen: () => ui.reopen(context), record: async () => {},
    async play(r) {
      await ui.startMatch(r, context);
      assert.equal(state.page, 'opening');
      state.page = r.id === 'raiden' ? 'lose' : 'win';
      return ui.waitResult(20);
    }
  });
  assert.equal(result.outcome, 'win'); assert.equal(result.played, 2);
  assert.equal(state.deck, '伊嘉早'); assert.equal(context.name, '迪卢克'); assert.equal(context.difficulty, '友好对局');
  assert.deepEqual(state.keys, ['F']);
  assert.equal(state.captured, state.disposed);
  assert.equal(state.clicks.filter(c => c[2] === 'ready' && c[1] >= 900).length, 2);
});

test('identity mismatch and stale results cause zero game input', async () => {
  const { state, ui } = game();
  await assert.rejects(ui.ensureReady({ name: '琴', difficulty: '友好对局' }), e => e.code === 'OPPONENT_UNVERIFIED');
  state.page = 'lose';
  await assert.rejects(ui.ensureReady({ name: '迪卢克', difficulty: '友好对局' }), e => e.code === 'STALE_RESULT');
  assert.equal(state.clicks.length, 0); assert.equal(state.keys.length, 0);
});

test('a missing deck returns to preparation and remains a skip, never starts a match', async () => {
  const { state, ui } = game();
  const context = { name: '迪卢克', difficulty: '友好对局', verified: true, difficultySelected: true };
  const original = ui.h.keyPress;
  ui.h.keyPress = key => { if (key === 'ESCAPE' && state.page === 'chooser') state.page = 'ready'; original(key); };
  await assert.rejects(ui.selectDeck({ title: '月绽放', deck: '不存在的牌组' }, context), e => e.code === 'DECK_NOT_FOUND');
  assert.equal(state.page, 'ready');
  assert.equal(state.clicks.filter(c => c[2] === 'ready' && c[1] >= 900).length, 0);
});

test('a win cannot be passed to the defeat-reopen path', async () => {
  const { state, ui } = game(); state.page = 'win';
  await assert.rejects(ui.reopen({ name: '迪卢克', difficulty: '友好对局', verified: true }), e => e.code === 'RESULT_UNKNOWN');
  assert.equal(state.clicks.length, 0);
});

test('result classification rejects an ambiguous page', () => {
  assert.equal(T.classifyResult('对局胜利'), 'win');
  assert.equal(T.classifyResult('对局失败'), 'lose');
  assert.equal(T.classifyResult('对局胜利 对局失败'), null);
  assert.equal(T.classifyResult('挑战已结束'), null);
});

test('pending unverified purchase blocks a second submission before any key or click', async () => {
  let actions = 0;
  const h = { file: { isExists: () => true, readTextSync: () => '{"pending":true}' }, click: () => actions++, keyDown: () => actions++ };
  const legacy = new T.Legacy({ h }, { letterNumber: 0, autoBuy: true }, { event() {} });
  await assert.rejects(legacy.buyLetter(), e => e.code === 'PURCHASE_PENDING');
  assert.equal(actions, 0);
});

test('cancellation before UI observation or click prevents all game input', async () => {
  const { state, ui } = game();
  ui.h.cancellationToken = { isCancellationRequested: true };
  assert.throws(() => ui.read(), e => e.code === 'CANCELLED');
  await assert.rejects(ui.tap(row('确认'), 'test'), e => e.code === 'CANCELLED');
  assert.equal(state.clicks.length, 0); assert.equal(state.captured, 0);
});

test('unverified purchase quantity and an unwritable journal cannot submit a purchase', async () => {
  for (const scenario of ['quantity', 'journal']) {
    const clicks = [], h = {
      click: (...p) => clicks.push(p), keyDown() {}, keyUp() {}, keyPress() {},
      file: { isExists: () => false, writeTextSync: () => false }
    };
    const before = screen(T, [row('邀请函'), row('购买'), row(scenario === 'quantity' ? '2' : '1', 900, 600)]);
    const ui = { h, pause: async () => {}, checkCancelled() {}, read: () => before,
      region: () => [850, 550, 220, 140] };
    const legacy = new T.Legacy(ui, { letterNumber: 0, autoBuy: true }, { event() {} });
    await assert.rejects(legacy.buyLetter(), e => e.code === (scenario === 'quantity' ? 'PURCHASE_QUANTITY' : 'PURCHASE_JOURNAL'));
    assert.equal(clicks.some(([x, y]) => x === 1185 && y === 755), false);
  }
});
