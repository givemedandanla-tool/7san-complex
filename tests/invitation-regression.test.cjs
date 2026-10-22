const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, load, row, profile } = require('./helpers.cjs');
const reportedDialogue = require('./fixtures/invitation-dialogue-0.4.2.json');

// A stateful OCR/template simulator, using the real UI, original-flow driver and
// generated original navigation. Invitation details deliberately have no deck badge.
function invitationGame(options = {}) {
  const state = {
    page: 'world', deck: options.initialDeck || '旧牌组', pendingDeck: null, clock: 0,
    trace: [], captured: 0, disposed: 0, mats: 0, releasedMats: 0,
    results: [...(options.results || ['win', 'win'])], engineCalls: [], starts: 0,
    purchases: 0, selectedDifficulty: '友好对局', files: new Map(),
    scroll: options.initialScroll || 0, pendingScroll: null, mouse: null, dragging: false,
    decks: options.decks || ['雷柯刻', '伊嘉早', '月綻放', '莫早迪'], nextPageAt: null
  };
  class VirtualDate extends Date { static now() { return state.clock; } }
  const { T } = load(['core', 'ui', 'original-flow'], { Date: VirtualDate });
  const cfg = T.config({
    challengeNumber: '1', letterNumber: '1',
    strategyOrder: '雷柯刻', deckPages: '1', diagnosticImages: false,
    ...(options.settings || {})
  });
  const record = (kind, data) => state.trace.push({ kind, data, page: state.page });
  function gallery() { return state.decks.slice(Math.floor(state.scroll / 463), Math.floor(state.scroll / 463) + 4); }
  function npcRows() {
    return [row('当前牌组：', 1640, 38, 111, 30), row(state.deck, 1752, 38, 99, 29),
      row('进行「七圣召唤」的对局吧。', 1200, 440, 500, 40),
      ...(options.noAdjust ? [] : [row('先调整一下卡组…', 1200, 515, 400, 40)]), row('暂时有别的事…', 1200, 590, 400, 40)];
  }
  function readyRows() {
    if (options.localOnly) return [row('迪卢克'), row('开始挑战', 1450, 900)];
    return [row('迪卢克'), row('友好对局', 1400, 220), row('我方出战牌组', 1240, 700),
      row(state.deck, 1340, 810), row('开始挑战', 1450, 900)];
  }
  function rows() {
    switch (state.page) {
      case 'arrival': return reportedDialogue.arrival;
      case 'partial-npc': return [row('自动', 90, 38, 69, 23), row('迪希雅', 908, 856, 107, 36)];
      case 'npc-intro': return reportedDialogue.dialogue;
      case 'npc-menu': return npcRows();
      case 'npc-accept': return [...reportedDialogue.accepted.filter(r => !r.text.includes('牌组')), ...npcRows().slice(0, 2)];
      case 'deck-notice': return [row('出战牌组', 700, 500)];
      case 'invitation': return [row('迪卢克'), row('友好对局', 1100, 120),
        row('🔒认真胜负', 1440, 220), row('邀约对局', 1360, 850)];
      case 'confirm': return [row('是否邀请迪卢克进行对局', 600, 480), row('确认', 1100, 730)];
      case 'ready': return readyRows();
      case 'chooser': return [row('编辑牌组', 700, 990), row('选择', 1100, 1000),
        ...(options.invitationDialogueEntry ? options.hideDeckNames ? [] : gallery()
          .map((text, i) => row(text, 135 + 463 * i - (options.realisticScroll ? state.scroll % 463 : 0), 762, 230, 46))
          .filter(r => r.x + r.width / 2 >= 0) :
          options.localOnly ? [] : [row('雷柯刻', 135, 762), row('伊嘉早', 598, 762)])];
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
    sleep: async milliseconds => {
      state.clock += milliseconds;
      if (state.pendingScroll && state.clock >= state.pendingScroll.at) {
        state.scroll = state.pendingScroll.scroll; state.pendingScroll = null; record('scroll-visible', state.scroll);
      }
      if (state.nextPageAt && state.clock >= state.nextPageAt.at) {
        state.page = state.nextPageAt.page; state.nextPageAt = null;
        if (state.page === 'partial-npc') state.nextPageAt = { at: state.clock + 900, page: 'npc-intro' };
        if (state.page === 'npc-intro') state.nextPageAt = { at: state.clock + 900, page: 'npc-menu' };
      }
    },
    file: {
      readTextSync(p) {
        if (p === 'lib/original-navigation.js') {
          const source = fs.readFileSync(path.join(ROOT, 'dist/InvitationFallback/lib/original-navigation.js'), 'utf8');
          return options.legacyDialoguePolling ? source.replace(/^.*hooks\.dialogueStep\("before-dialogue-(space|f)"\).*\n/gm, '') : source;
        }
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
      state.clock += options.ocrFrameMs || 0;
      state.captured++;
      const capturedRows = rows();
      return {
        width: 1920, height: 1080,
        findMulti: () => capturedRows,
        find(ro) {
          if (ro.type === 'ocr' && options.invitationDialogueEntry) {
            const [x, y, w, h] = ro.args;
            if (['npc-menu', 'npc-accept'].includes(state.page) && x === 1740 && y === 20)
              return row(state.deck, x, y, w, h);
            if (state.page === 'chooser' && y === 762 && !options.hideDeckNames)
              return row(gallery()[(x - 135) / 463] || '', x, y, w, h);
          }
          if (ro.type === 'ocr' && options.localOnly) {
            const [x, y, w, h] = ro.args;
            if (state.page === 'ready' && x === 1305 && y === 793)
              return row(state.deck, x, y, w, h);
            if (state.page === 'ready' && x === 1200 && y === 650)
              return row('我方出战牌组', x, y, w, h);
            if (state.page === 'chooser' && y === 762)
              return row(['雷柯刻', '伊嘉早', '丙组', '丁组'][(x - 135) / 463], x, y, w, h);
          }
          const exists = ro.type === 'ocr' || ro.path.endsWith('tavern.png') ||
            ro.path.endsWith('talkSymbol.png') && ['dialogue', 'post-dialogue', 'npc-intro', 'npc-menu', 'npc-accept'].includes(state.page);
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
      if (state.page === 'invitation' && x === 1443 && y === 875) {
        state.page = options.arrivalTransition ? 'arrival' : 'confirm';
        if (options.arrivalTransition) state.nextPageAt = { at: state.clock + 1400, page: options.partialArrival ? 'partial-npc' : 'npc-intro' };
        return;
      }
      if (state.page === 'confirm' && x === 1175 && y === 754) {
        state.page = options.invitationDialogueEntry ? 'npc-intro' : options.openingImmediately ? 'opening' : options.readyAfterDialogue || options.readyBetweenKeys ? 'dialogue' : 'ready';
        if (options.invitationDialogueEntry) state.nextPageAt = { at: state.clock + 900, page: 'npc-menu' };
        record('invite-confirmed'); return;
      }
      if (state.page === 'npc-menu' && y > 500 && y < 570) { state.page = 'chooser'; record('adjust-deck'); return; }
      if (state.page === 'partial-npc' && x === 1175 && y === 754) {
        state.page = 'npc-accept'; record('unsafe-fixed-confirm'); return;
      }
      if (state.page === 'npc-menu' && y > 420 && y < 500) {
        state.starts++; state.page = 'npc-accept'; record('npc-start', state.deck); return;
      }
      if (state.page === 'ready' && x === 1312 && y === 812) { state.page = 'chooser'; record('deck-chooser'); return; }
      if (state.page === 'chooser' && y < 900) {
        state.pendingDeck = options.invitationDialogueEntry ? gallery()[Math.floor((x + (options.realisticScroll ? state.scroll % 463 : 0)) / 463)] : x < 500 ? '雷柯刻' : '伊嘉早'; return;
      }
      if (state.page === 'chooser' && y >= 900) {
        state.deck = options.wrongSelectedDeck || state.pendingDeck;
        state.page = options.invitationDialogueEntry ? 'deck-notice' : 'ready';
        if (options.invitationDialogueEntry) state.nextPageAt = { at: state.clock + 4000, page: 'npc-menu' };
        record('deck-selected', state.deck); return;
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
      if (['npc-intro', 'npc-menu'].includes(state.page) && ['F', 'VK_SPACE'].includes(key)) {
        record('unsafe-default-start'); state.page = 'npc-accept'; return;
      }
      if (state.page === 'npc-accept' && ['F', 'VK_SPACE'].includes(key)) {
        state.page = 'opening'; record('opening', state.deck); return;
      }
      if (key === 'VK_SPACE' && state.page === 'dialogue' && options.readyBetweenKeys) {
        state.page = 'ready'; record('space-revealed-ready'); return;
      }
      if (key === 'F' && state.page === 'ready' && options.readyBetweenKeys) {
        state.page = 'opening'; record('unprepared-f-start'); return;
      }
      if (key === 'ESCAPE' && state.page === 'chooser') { state.page = options.invitationDialogueEntry ? 'npc-menu' : 'ready'; return; }
      if (key === 'F' && state.page === 'world') { state.page = 'list'; return; }
      if (key === 'F' && state.page === 'dialogue') { state.page = 'ready'; record('dialogue-ready'); return; }
      if (key === 'F' && state.page === 'post-dialogue') { state.page = 'world'; record('post-dialogue-finished'); return; }
      if (key === 'ESCAPE' && state.page === 'shop-return') return;
    },
    keyDown: key => record('down', key), keyUp: key => record('up', key),
    moveMouseTo(x, y) { state.mouse = [x, y]; },
    leftButtonDown() { state.dragging = true; state.dragStart = state.mouse; },
    leftButtonUp() {
      state.dragging = false;
      if (state.page === 'chooser' && options.invitationDialogueEntry) {
        const dx = state.mouse[0] - state.dragStart[0];
        const scroll = Math.max(0, Math.min(Math.max(0, state.decks.length - 4) * 463, state.scroll - dx));
        record('drag', { dx, from: state.scroll, to: scroll });
        state.pendingScroll = { at: state.clock + (options.dragLagMs || 0), scroll };
      }
    }
  };
  const report = { events: [], event(type, data) { this.events.push({ type, data }); } };
  const p = profile(); p.timeoutMs = 1000; p.pollMs = 10;
  if (options.legacyProfile) { delete p.points.deckSearchDrag; p.points.deckDragNext = [1720, 300, 200, 300]; }
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

test('a preparation page appearing between SPACE and F is intercepted before F can start the wrong deck', async () => {
  const legacy = invitationGame({ readyBetweenKeys: true, legacyDialoguePolling: true });
  await assert.rejects(legacy.flow.run(), error => error.code === 'DECK_SELECTION_TOO_LATE');
  assert.equal(legacy.state.engineCalls.length, 0);
  assert.equal(legacy.state.trace.filter(e => e.kind === 'unprepared-f-start').length, 1);
  const game = invitationGame({ readyBetweenKeys: true });
  const result = await game.flow.run();
  assert.equal(result.wins, 2);
  assert.equal(game.state.trace.filter(e => e.kind === 'space-revealed-ready').length, 2);
  assert.equal(game.state.trace.filter(e => e.kind === 'unprepared-f-start').length, 0);
  assert.deepEqual(game.state.engineCalls, ['raiden', 'raiden']);
  const checkpoint = JSON.parse(game.state.files.get('data/before-dialogue-f.json'));
  assert.equal(checkpoint.page.ready, true);
  for (const stage of ['before-invite-start', 'before-invite-confirm', 'dialogue-poll', 'before-dialogue-space'])
    assert(game.state.files.has(`data/${stage}.json`), stage);
});

test('weekly local OCR selects and confirms a deck even when whole-screen OCR omits all deck text', async () => {
  const game = invitationGame({ localOnly: true, readyBetweenKeys: true });
  const result = await game.flow.run();
  assert.equal(result.wins, 2);
  assert.equal(game.state.deck, '雷柯刻');
  assert(game.state.trace.some(e => e.kind === 'deck-selected' && e.data === '雷柯刻'));
  const checkpoint = JSON.parse(game.state.files.get('data/before-dialogue-f.json'));
  assert(!checkpoint.rows.some(r => r.text.includes('牌组')));
  assert.equal(checkpoint.probes.prepare.text, '我方出战牌组');
  assert.equal(game.state.captured, game.state.disposed);
});

test('reported arrival/dialogue route adjusts decks, verifies the left edge despite lag, searches with overlap and falls back after a loss', async () => {
  const decks = Array.from({ length: 20 }, (_, i) => `第${i + 1}组`);
  decks[2] = '雷柯刻'; decks[8] = '月綻放';
  const game = invitationGame({ invitationDialogueEntry: true, arrivalTransition: true, partialArrival: true,
    initialScroll: 14 * 463, dragLagMs: 1600, decks, results: ['lose', 'win', 'win'],
    legacyProfile: true, realisticScroll: true,
    settings: { strategyOrder: '月绽放,雷柯刻', moonbloomDeck: '月綻放', deckPages: '3', maxMinutes: '120' } });
  const result = await game.flow.run();
  assert.equal(result.wins, 2); assert.equal(result.played, 3);
  assert.deepEqual(game.state.engineCalls, ['moonbloom', 'raiden', 'moonbloom']);
  assert.equal(game.state.starts, 3); assert.equal(game.state.purchases, 0);
  assert.equal(game.state.trace.filter(e => e.kind === 'adjust-deck').length, 3);
  assert.equal(game.state.trace.filter(e => e.kind === 'unsafe-default-start').length, 0);
  assert.equal(game.state.trace.filter(e => e.kind === 'unsafe-fixed-confirm').length, 0, 'nonempty partial arrival text is not a recognized confirmation page');
  assert(!game.state.trace.some(e => e.kind === 'click' && e.page === 'npc-menu' && e.data[0] === 1175 && e.data[1] === 754),
    'the old confirmation coordinate must not be sent into the observed invitation dialogue');
  const resets = game.report.events.filter(e => e.type === 'deck-reset' && e.data.unchanged === 2);
  assert.equal(resets.length, 3);
  assert(resets.every(e => e.data.first === decks[0]), 'each attempt must actually reach the first deck');
  const drags = game.state.trace.filter(e => e.kind === 'drag').map(e => e.data.dx);
  assert(drags.includes(1700)); assert(drags.includes(-320));
  assert(drags.every(dx => dx === 1700 || dx === -320));
  const searches = game.report.events.filter(e => e.type === 'deck-search');
  assert(searches.some(e => e.data.step > 0 && e.data.names.includes('月綻放')), 'a target outside the first four is found');
  assert.equal(game.state.captured, game.state.disposed);
  assert.equal(game.state.mats, game.state.releasedMats);
  assert.equal(game.state.dragging, false);
  for (const stage of ['after-invite-arrival', 'invite-deck-list', 'deck-list-left', 'invite-deck-confirmed'])
    assert(game.state.files.has(`data/${stage}.json`), stage);
});

test('the adjustment route also works when a genuine confirmation precedes NPC dialogue', async () => {
  const game = invitationGame({ invitationDialogueEntry: true });
  const result = await game.flow.run();
  assert.equal(result.wins, 2);
  assert.equal(game.state.trace.filter(e => e.kind === 'unsafe-default-start').length, 0);
  assert.equal(game.state.trace.filter(e => e.kind === 'adjust-deck').length, 2);
});

test('slow OCR frames still allow three stable observations before declaring the gallery boundary', async () => {
  const game = invitationGame({ invitationDialogueEntry: true, ocrFrameMs: 4200 });
  const result = await game.flow.run();
  assert.equal(result.wins, 2);
  assert.equal(game.report.events.filter(e => e.type === 'deck-reset' && e.data.unchanged === 2).length, 2);
  assert.equal(game.state.trace.filter(e => e.kind === 'unsafe-default-start').length, 0);
});

test('a wrong current-deck name after selecting stops in dialogue before starting or calling a player', async () => {
  const game = invitationGame({ invitationDialogueEntry: true, wrongSelectedDeck: '其他卡组' });
  await assert.rejects(game.flow.run(), error => error.code === 'UI_TIMEOUT');
  assert.equal(game.state.page, 'npc-menu'); assert.equal(game.state.starts, 0);
  assert.equal(game.state.engineCalls.length, 0);
});

test('a visible start option without the adjustment option cannot fall through to default SPACE/F', async () => {
  const game = invitationGame({ invitationDialogueEntry: true, noAdjust: true });
  await assert.rejects(game.flow.run(), error => error.code === 'UI_TIMEOUT');
  assert.equal(game.state.page, 'npc-menu'); assert.equal(game.state.starts, 0);
  assert.equal(game.state.trace.filter(e => e.kind === 'unsafe-default-start').length, 0);
});

test('missing all named invitation decks returns to the same dialogue and stops without starting or continuing movement', async () => {
  const game = invitationGame({ invitationDialogueEntry: true, decks: ['甲组', '乙组', '丙组', '丁组'],
    settings: { strategyOrder: '月绽放,雷柯刻', deckPages: '1' } });
  await assert.rejects(game.flow.run(), error => error.code === 'EXHAUSTED');
  assert.equal(game.state.page, 'npc-menu'); assert.equal(game.state.starts, 0);
  assert.equal(game.state.engineCalls.length, 0); assert.equal(game.state.purchases, 0);
  assert.equal(game.report.events.filter(e => e.type === 'challenge-start').length, 1);
});

test('unreadable deck names are a technical error, never evidence of a left boundary or a missing strategy', async () => {
  const game = invitationGame({ invitationDialogueEntry: true, hideDeckNames: true });
  await assert.rejects(game.flow.run(), error => error.code === 'DECK_NAMES_UNREADABLE');
  assert.equal(game.state.page, 'chooser'); assert.equal(game.state.starts, 0);
  assert.equal(game.report.events.filter(e => e.type === 'attempt').length, 0);
});

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
