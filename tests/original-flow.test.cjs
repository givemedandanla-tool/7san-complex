const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ROOT, load } = require('./helpers.cjs');
const factoryCode = fs.readFileSync(path.join(ROOT, 'dist/InvitationFallback/lib/original-navigation.js'), 'utf8');

function host(settings) {
  const trace = [], state = { talk: 0, mats: 0, disposed: 0, capture: 0, released: 0 };
  const readMat = file => { state.mats++; return { file, dispose() { state.disposed++; } }; };
  const recognition = {
    ocr: (...args) => ({ type: 'ocr', args }),
    templateMatch: mat => ({ type: 'template', file: mat.file })
  };
  recognition.TemplateMatch = recognition.templateMatch;
  const h = {
    settings, trace, state,
    file: { ReadImageMatSync: readMat, readImageMatSync: readMat },
    log: { info() {}, warn() {}, error() {} }, RecognitionObject: recognition,
    genshin: { returnMainUi: async () => trace.push(['mainUi']), setBigMapZoomLevel: async x => trace.push(['zoom', x]) },
    sleep: async x => trace.push(['sleep', x]),
    click: (...p) => trace.push(['click', ...p]),
    keyPress: x => trace.push(['press', x]), keyDown: x => trace.push(['down', x]), keyUp: x => trace.push(['up', x]),
    captureGameRegion() {
      state.capture++;
      return { find(ro) {
        let exists = true;
        if (ro.type === 'template' && ro.file.endsWith('talkSymbol.png')) exists = ++state.talk % 2 === 1;
        return { isExist: () => exists, isEmpty: () => !exists, click: () => trace.push(['tavern-icon']) };
      }, dispose() { state.released++; } };
    },
    dispatcher: { runTask: async () => trace.push(['play']) },
    SoloTask: function (name) { this.name = name; }
  };
  return h;
}

for (const [rounds, letters, purchases] of [[1, 1, 0], [3, 0, 3], [3, 2, 1]]) {
  test(`original navigation input and timing trace is preserved (${rounds} rounds, ${letters} letters)`, async () => {
    const settings = { challengeNumber: rounds, letterNumber: letters, autoBuy: true };
    const originalHost = host(settings), adaptedHost = host(settings), locations = [];
    const source = fs.readFileSync(path.join(ROOT, 'vendor/invitation/main.js'), 'utf8');
    await vm.runInNewContext(source, originalHost);
    let bought = 0;
    const navigation = vm.runInNewContext(factoryCode)({ ...adaptedHost, hooks: {
      canPurchase: async () => {}, beforePurchase: async () => bought++, afterPurchase: async () => {},
      beforeInviteStart: async () => {}, beforeInviteConfirm: async () => {}, dialogueStep: async () => false,
      roundFinished: async () => {},
      play: async () => { adaptedHost.trace.push(['play']); return 'win'; },
      challenge: async (choose, play, where) => { locations.push({ ...where }); await choose(); return play(); }
    } });
    await navigation.run(); navigation.dispose();
    assert.deepEqual(adaptedHost.trace, originalHost.trace);
    assert.equal(bought, purchases);
    assert.deepEqual(locations, Array.from({ length: rounds }, (_, i) => [{ round: i + 1, leg: 1 }, { round: i + 1, leg: 2 }]).flat());
    assert.equal(adaptedHost.state.capture, adaptedHost.state.released);
    assert.equal(adaptedHost.state.mats, adaptedHost.state.disposed);
  });
}

function integration(raw, results, missing = []) {
  const { T } = load(['core', 'original-flow']);
  const cfg = T.config(raw), h = host(cfg), calls = [], events = [];
  let lastResult, selections = 0, page = 'ready';
  const originalClick = h.click;
  h.click = (x, y) => { originalClick(x, y); if (x === 446 && y === 413) page = 'ready'; };
  h.file.readTextSync = p => { assert.equal(p, 'lib/original-navigation.js'); return factoryCode; };
  const report = { event: (type, data) => events.push({ type, data }) };
  const ui = {
    h, checkCancelled() {}, pause: ms => h.sleep(ms),
    read: () => ({ page }), isReady: s => s.page === 'ready', isOpening: s => s.page === 'opening',
    result: s => s.page === 'result' ? lastResult : null,
    wait: async check => { const result = await check({ page }); assert(result, 'expected the mock to reach the opening page'); return result; },
    startMatch: async () => { page = 'opening'; },
    verifyOriginalSelection() { selections++; },
    selectDeck: async r => { calls.push('deck:' + r.id); if (missing.includes(r.id)) throw new T.TrialError('DECK_NOT_FOUND', 'missing'); },
    waitResult: async () => lastResult
  };
  const engines = { run: async r => {
    calls.push('play:' + r.id);
    const next = results.shift();
    if (next instanceof Error) throw next;
    lastResult = next; page = 'result';
    return next;
  } };
  return { T, cfg, calls, events, h, ui, flow: new T.OriginalFlow(ui, cfg, engines, report, h.log), selections: () => selections };
}

test('all four ordered players can lose/advance; wins continue both original legs and subsequent rounds with reset order', async () => {
  const fixture = integration({ challengeNumber: 2, letterNumber: 2 }, ['lose', 'lose', 'lose', 'win', 'win', 'lose', 'win', 'win']);
  const result = await fixture.flow.run();
  assert.deepEqual(fixture.calls.filter(x => x.startsWith('play:')), [
    'play:raiden', 'play:iansan', 'play:moonbloom', 'play:mozailu', 'play:raiden', 'play:raiden', 'play:iansan', 'play:raiden'
  ]);
  assert.equal(result.played, 8); assert.equal(result.wins, 4); assert.equal(result.losses, 0);
  assert.equal(result.rounds, 2); assert.equal(result.outcome, 'win');
  assert.deepEqual(fixture.events.filter(e => e.type === 'round-finish').map(e => e.data.round), [1, 2]);
  assert.equal(fixture.h.state.mats, fixture.h.state.disposed);
});

test('losses in all strategies are recorded and the original loop still continues to the second leg', async () => {
  const fixture = integration({ strategyOrder: '莫早卢,雷柯刻', challengeNumber: 1 }, ['lose', 'lose', 'lose', 'lose']);
  const result = await fixture.flow.run();
  assert.equal(result.played, 4); assert.equal(result.wins, 0); assert.equal(result.losses, 2);
  assert.equal(result.outcome, 'completed_with_losses');
  assert.deepEqual(fixture.calls.filter(x => x.startsWith('play:')), ['play:mozailu', 'play:raiden', 'play:mozailu', 'play:raiden']);
});

test('a missing deck is skipped within the same open selection without repeating original F/character selection', async () => {
  const fixture = integration({ strategyOrder: '雷柯刻,伊嘉早' }, ['win', 'win'], ['raiden']);
  const result = await fixture.flow.run();
  assert.equal(result.played, 2); assert.equal(fixture.selections(), 2);
  assert.deepEqual(fixture.calls, ['deck:raiden', 'deck:iansan', 'play:iansan', 'deck:raiden', 'deck:iansan', 'play:iansan']);
});

test('a technical error stops original continuation and never selects a fallback; navigation mats are released', async () => {
  const fault = new Error('capture failed');
  const fixture = integration({ strategyOrder: '雷柯刻,伊嘉早', challengeNumber: 2 }, [fault]);
  await assert.rejects(fixture.flow.run(), e => e === fault);
  assert.deepEqual(fixture.calls, ['deck:raiden', 'play:raiden']);
  assert.equal(fixture.events.some(e => e.type === 'round-finish'), false);
  assert.equal(fixture.h.state.mats, fixture.h.state.disposed);
});

test('missing all decks never starts a game or silently skips the requested challenge', async () => {
  const fixture = integration({ strategyOrder: '雷柯刻,伊嘉早' }, [], ['raiden', 'iansan']);
  await assert.rejects(fixture.flow.run(), e => e.code === 'EXHAUSTED' && e.details.played === 0);
  assert.equal(fixture.selections(), 1);
  assert.equal(fixture.calls.some(x => x.startsWith('play:')), false);
});

test('player/result disagreement halts before cleanup and cannot be treated as an ordinary loss', async () => {
  const fixture = integration({ strategyOrder: '雷柯刻,伊嘉早' }, ['win']);
  fixture.ui.waitResult = async () => 'lose';
  await assert.rejects(fixture.flow.run(), e => e.code === 'RESULT_MISMATCH');
  assert.deepEqual(fixture.calls, ['deck:raiden', 'play:raiden']);
  assert.equal(fixture.events.some(e => e.type === 'challenge-finish'), false);
});

test('original settings need no target or difficulty; entered deck names and order are respected', () => {
  const { T } = load(['core']);
  const defaults = T.config({});
  assert.equal(defaults.challengeNumber, 1); assert.equal(defaults.letterNumber, 0); assert.equal(defaults.autoBuy, false);
  assert.equal(defaults.queue.length, 4);
  const cfg = T.config({ challengeNumber: '3', letterNumber: '0', strategyOrder: '莫早卢，月绽放', mozailuDeck: '牌组甲', moonbloomDeck: '牌组乙' });
  assert.deepEqual(Array.from(cfg.queue, x => [x.id, x.deck]), [['mozailu', '牌组甲'], ['moonbloom', '牌组乙']]);
  assert.equal(cfg.challengeNumber, 3); assert.equal(cfg.letterNumber, 0);
  for (const raw of [{ challengeNumber: 0 }, { letterNumber: -1 }, { strategyOrder: '雷柯刻', raidenDeck: '' }])
    assert.throws(() => T.config(raw), e => e.code === 'CONFIG');
});

test('original movement releases a held key when interrupted during its wait', async () => {
  const h = host({ challengeNumber: 1, letterNumber: 1 });
  const stop = new Error('cancelled');
  const navigation = vm.runInNewContext(factoryCode)({ ...h,
    sleep: async ms => { if (ms === 2000 && h.trace.at(-1)?.[0] === 'down') throw stop; },
    hooks: { challenge: async () => {}, roundFinished: async () => {} }
  });
  await assert.rejects(navigation.run(), e => e === stop);
  navigation.dispose();
  const input = h.trace.filter(x => ['down', 'up'].includes(x[0]));
  assert.deepEqual(input, [['down', 'a'], ['up', 'a']]);
  assert.equal(h.state.mats, h.state.disposed);
});
