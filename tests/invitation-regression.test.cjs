const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, load, row, profile } = require('./helpers.cjs');

// A stateful OCR/template simulator, using the real UI, original-flow driver and
// generated original navigation. Invitation details deliberately have no deck badge.
function invitationGame(options = {}) {
  const state = {
    page: 'world', deck: '旧牌组', pendingDeck: null, clock: 0,
    trace: [], captured: 0, disposed: 0, mats: 0, releasedMats: 0,
    results: [...(options.results || ['win', 'win'])], engineCalls: [], starts: 0,
    purchases: 0, selectedDifficulty: '友好对局', files: new Map()
  };
  class VirtualDate extends Date { static now() { return state.clock; } }
  const { T } = load(['core', 'ui', 'original-flow'], { Date: VirtualDate });
  const cfg = T.config({
    challengeNumber: '1', letterNumber: '1',
    strategyOrder: '雷柯刻', deckPages: '1', diagnosticImages: false,
    ...(options.settings || {})
  });
  const record = (kind, data) => state.trace.push({ kind, data, page: state.page });
  function readyRows() {
    return [row('迪卢克'), row('友好对局', 1400, 220), row('我方出战牌组', 1240, 700),
      row(state.deck, 1340, 810), row('开始挑战', 1450, 900)];
  }
  function rows() {
    switch (state.page) {
      case 'invitation': return [row('迪卢克'), row('友好对局', 1100, 120),
        row('🔒认真胜负', 1440, 220), row('邀约对局', 1360, 850)];
      case 'confirm': return [row('是否邀请迪卢克进行对局', 600, 480), row('确认', 1100, 730)];
      case 'ready': return readyRows();
      case 'chooser': return [row('编辑牌组', 700, 990), row('雷柯刻', 135, 762),
        row('伊嘉早', 598, 762), row('选择', 1100, 1000)];
      case 'opening': return [row('请选择要替换的手牌', 800, 232)];
      case 'win': case 'lose': return [row(state.page === 'win' ? '对局胜利' : '对局失败', 800, 200), row('退出挑战', 700, 915)];
      case 'post-dialogue': return options.postReadyOverlay ? readyRows() : [row('迪卢克', 400, 1000)];
      case 'dialogue': return [row('迪卢克', 400, 1000)];
      case 'shop': return [row('邀请函'), row('购买'), row('1', 900, 600)];
      case 'purchase-result': return [row('获得邀请函')];
      default: return [];
    }
  }
  const h = {
    sleep: async milliseconds => { state.clock += milliseconds; },
    file: {
      readTextSync(p) {
        if (p === 'lib/original-navigation.js')
          return fs.readFileSync(path.join(ROOT, 'dist/InvitationFallback/lib/original-navigation.js'), 'utf8');
        if (!state.files.has(p)) throw new Error('Unexpected file read: ' + p);
        return state.files.get(p);
      },
      readImageMatSync(p) { state.mats++; return { path: p, dispose() { state.releasedMats++; } }; },
      isExists: p => state.files.has(p),
      writeTextSync(p, contents) { state.files.set(p, contents); return true; },
      createDirectory() {}
    },
    genshin: {
      returnMainUi: async () => { record('main-ui'); state.page = 'world'; },
      setBigMapZoomLevel: async () => {}
    },
    RecognitionObject: {
      ocr: (...args) => ({ type: 'ocr', args }),
      templateMatch: mat => ({ type: 'template', path: mat.path })
    },
    captureGameRegion() {
      state.captured++;
      const capturedRows = rows();
      return {
        width: 1920, height: 1080,
        findMulti: () => capturedRows,
        find(ro) {
          const exists = ro.type === 'ocr' || ro.path.endsWith('tavern.png') ||
            ro.path.endsWith('talkSymbol.png') && ['dialogue', 'post-dialogue'].includes(state.page);
          return { isExist: () => exists, isEmpty: () => !exists,
            click() { record('tavern-icon'); } };
        },
        dispose() { state.disposed++; }
      };
    },
    click(x, y) {
      record('click', [x, y]);
      if (['world', 'list'].includes(state.page) && x === 1355 && y === 650) { state.page = 'shop'; return; }
      if (state.page === 'shop' && x === 1185 && y === 755) { state.purchases++; state.page = 'purchase-result'; return; }
      if (state.page === 'purchase-result') { state.page = 'shop-return'; return; }
      if (state.page === 'shop-return' && x === 1355 && y === 800) { state.page = 'world'; return; }
      if (state.page === 'list' && x === 446 && y === 413) { state.page = 'invitation'; return; }
      if (state.page === 'invitation' && x === 1435 && y === 224) {
        record('locked-tab-click'); return; // The game's locked tab leaves friendly selected.
      }
      if (state.page === 'invitation' && x === 1443 && y === 875) { state.page = 'confirm'; return; }
      if (state.page === 'confirm' && x === 1175 && y === 754) {
        state.page = options.openingImmediately ? 'opening' : options.readyAfterDialogue ? 'dialogue' : 'ready'; record('invite-confirmed'); return;
      }
      if (state.page === 'ready' && x === 1312 && y === 812) { state.page = 'chooser'; record('deck-chooser'); return; }
      if (state.page === 'chooser' && y < 900) { state.pendingDeck = x < 500 ? '雷柯刻' : '伊嘉早'; return; }
      if (state.page === 'chooser' && y >= 900) {
        state.deck = state.pendingDeck; state.page = 'ready'; record('deck-selected', state.deck); return;
      }
      if (['ready', 'post-dialogue'].includes(state.page) && y >= 900) {
        state.starts++; state.page = 'opening'; record('opening', state.deck); return;
      }
      if (['lose', 'win'].includes(state.page) && y >= 900) {
        state.page = 'post-dialogue'; record('result-exited'); return;
      }
    },
    keyPress(key) {
      record('key', key);
      if (key === 'ESCAPE' && state.page === 'chooser') { state.page = 'ready'; return; }
      if (key === 'F' && state.page === 'world') { state.page = 'list'; return; }
      if (key === 'F' && state.page === 'dialogue') { state.page = 'ready'; record('dialogue-ready'); return; }
      if (key === 'F' && state.page === 'post-dialogue') { state.page = 'world'; record('post-dialogue-finished'); return; }
      if (key === 'ESCAPE' && state.page === 'shop-return') return;
    },
    keyDown: key => record('down', key), keyUp: key => record('up', key),
    moveMouseTo() {}, leftButtonDown() {}, leftButtonUp() {}
  };
  const report = { events: [], event(type, data) { this.events.push({ type, data }); } };
  const p = profile(); p.timeoutMs = 1000; p.pollMs = 10;
  const ui = new T.UI(h, cfg, p, report);
  const engines = { async run(recipe) {
    assert.equal(state.page, 'opening', 'the original integration must reach a fresh opening before invoking a player');
    assert.equal(state.deck, recipe.deck, 'player and selected game deck must agree');
    state.engineCalls.push(recipe.id); record('player', recipe.id);
    const outcome = state.results.shift();
    assert(['win', 'lose'].includes(outcome), 'simulator has a declared match outcome');
    state.page = outcome;
    return outcome;
  } };
  const logger = { info() {}, warn() {}, error() {} };
  return { T, state, ui, cfg, report, flow: new T.OriginalFlow(ui, cfg, engines, report, logger) };
}

for (const readyAfterDialogue of [false, true]) {
  test(`locked serious tab preserves friendly invitation; named deck is selected only after actual readiness (${readyAfterDialogue ? 'after dialogue' : 'after confirmation'})`, async () => {
    const game = invitationGame({ readyAfterDialogue });
    const result = await game.flow.run();
    assert.equal(result.wins, 2);
    assert.equal(game.state.selectedDifficulty, '友好对局');
    assert.deepEqual(game.state.engineCalls, ['raiden', 'raiden']);
    assert.equal(game.state.purchases, 0, 'one available letter/already invited character covers the original first round');
    const confirmation = game.state.trace.findIndex(e => e.kind === 'invite-confirmed');
    const deckSelected = game.state.trace.findIndex(e => e.kind === 'deck-selected');
    const opening = game.state.trace.findIndex(e => e.kind === 'opening');
    const player = game.state.trace.findIndex(e => e.kind === 'player');
    assert(confirmation >= 0 && deckSelected > confirmation, 'no premature preparation requirement on the invitation page');
    assert(opening > deckSelected && player > opening, 'deck selection precedes the first opening and the player');
    if (readyAfterDialogue) assert(game.state.trace.findIndex(e => e.kind === 'dialogue-ready') < deckSelected);
    assert.equal(game.state.captured, game.state.disposed);
    assert.equal(game.state.mats, game.state.releasedMats);
  });
}

test('confirmed loss changes strategy without another purchase; post-game dialogue cannot auto-start a match', async () => {
  const game = invitationGame({
    results: ['lose', 'win', 'win'], postReadyOverlay: true,
    settings: { strategyOrder: '雷柯刻,伊嘉早', letterNumber: '1' }
  });
  const result = await game.flow.run();
  assert.equal(result.played, 3); assert.equal(result.wins, 2);
  assert.deepEqual(game.state.engineCalls, ['raiden', 'iansan', 'raiden']);
  assert.equal(game.state.starts, 3, 'only requested matches start; no extra match from post-game readiness-like text');
  assert.equal(game.state.purchases, 0);
  assert.equal(game.state.trace.filter(e => e.kind === 'post-dialogue-finished').length, 3);
  assert.equal(game.report.events.filter(e => e.type === 'purchase-submitted').length, 0);
});

test('zero held letters follows original purchase schedule; a saved obsolete autoBuy=false cannot disable it', async () => {
  const game = invitationGame({
    results: ['lose', 'win', 'win'],
    settings: { strategyOrder: '雷柯刻,伊嘉早', letterNumber: '0', autoBuy: false }
  });
  const result = await game.flow.run();
  assert.equal(result.played, 3);
  assert.equal(game.state.purchases, 1);
  assert.equal(game.report.events.filter(e => e.type === 'purchase-submitted').length, 1);
  assert.equal(game.report.events.filter(e => e.type === 'purchase-confirmed').length, 1);
  assert.equal(JSON.parse(game.state.files.get('data/purchase-pending.json')).pending, false);
});


test('an opening reached without any observed deck selection stops before invoking a mismatched player', async () => {
  const game = invitationGame({ openingImmediately: true });
  await assert.rejects(game.flow.run(), error => error.code === 'DECK_SELECTION_TOO_LATE');
  assert.deepEqual(game.state.engineCalls, []);
  assert.equal(game.state.trace.some(e => e.kind === 'deck-selected'), false);
  assert.equal(game.state.purchases, 0);
  assert.equal(game.state.captured, game.state.disposed);
  assert.equal(game.state.mats, game.state.releasedMats);
});

test('loss followed by unavailable fallback decks stops on preparation rather than walking into the next leg', async () => {
  const game = invitationGame({
    results: ['lose'],
    settings: { strategyOrder: '雷柯刻,月绽放', letterNumber: '1' }
  });
  await assert.rejects(game.flow.run(), error => error.code === 'EXHAUSTED' && error.details.played === 1);
  assert.deepEqual(game.state.engineCalls, ['raiden']);
  assert.equal(game.state.page, 'ready');
  assert.equal(game.state.trace.filter(e => e.kind === 'down' && e.data === 's').length, 1,
    'only the first board approach ran; gotoBoard2 must not start on an open preparation page');
  assert.equal(game.report.events.filter(e => e.type === 'challenge-start').length, 1);
  assert.equal(game.report.events.some(e => e.type === 'round-finish'), false);
  assert.equal(game.state.purchases, 0);
  assert.equal(game.state.captured, game.state.disposed);
  assert.equal(game.state.mats, game.state.releasedMats);
});
