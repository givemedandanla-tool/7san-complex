const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ROOT, load } = require('./helpers.cjs');
const { T } = load(['core']);

test('result adapter captures both outcomes and upstream owns cleanup', async () => {
  for (const expected of ['win', 'lose']) {
    let disposed = 0;
    class Host { dispose() { disposed++; } }
    class Player {
      constructor(host) { this.host = host; }
      reportResult() {}
      async run() { try { this.reportResult({ result: expected }); } finally { this.host.dispose(); } }
    }
    assert.equal(await T.runPlayer({ Host, Player, options: {} }), expected);
    assert.equal(disposed, 1);
  }
});

test('a resolved player promise without a result is not declared victory', async () => {
  class Host { dispose() {} }
  class Player { reportResult() {} async run() {} }
  await assert.rejects(T.runPlayer({ Host, Player, options: {} }), e => e.code === 'RESULT_UNKNOWN');
});

test('player exceptions keep their identity and are not converted into normal defeat', async () => {
  const original = new Error('capture failed');
  class Host { dispose() {} }
  class Player { reportResult() {} async run() { throw original; } }
  await assert.rejects(T.runPlayer({ Host, Player, options: {} }), e => e === original);
});

test('scoped file binding isolates banks, templates and output; traversal is rejected', () => {
  const calls = [], file = {};
  for (const key of ['readTextSync', 'readImageMatSync', 'writeTextSync', 'createDirectory', 'isExists'])
    file[key] = (...args) => calls.push([key, ...args]);
  const scoped = T.scopedFile(file, 'engines/raiden');
  scoped.readTextSync('hand-bank.json'); scoped.writeTextSync('logs/run.log', 'entry', false);
  assert.deepEqual(calls, [['readTextSync', 'engines/raiden/hand-bank.json'], ['writeTextSync', 'engines/raiden/logs/run.log', 'entry', false]]);
  for (const p of ['../manifest.json', '/manifest.json', 'C:\\secret', 'assets/../../x'])
    assert.throws(() => scoped.readTextSync(p), e => e.code === 'PATH');
});

test('all four real generated factories load their own banks and leave host globals untouched', () => {
  const sentinel = { marker: 'host' };
  const context = vm.createContext({ TCG: sentinel, log: { info() {}, warn() {}, error() {} } });
  for (const [id, expected] of [
    ['raiden', ['雷电将军', '柯莱', '刻晴']], ['iansan', ['伊安珊', '嘉明', '早柚']],
    ['moonbloom', ['菈乌玛', '哥伦比娅', '奈芙尔']], ['mozailu', ['莫娜', '早柚', '迪卢克']]
  ]) {
    const prefix = path.join(ROOT, 'dist/InvitationFallback/engines', id);
    const factory = vm.runInContext(fs.readFileSync(path.join(prefix, 'engine.js'), 'utf8'), context);
    const file = { readTextSync: p => fs.readFileSync(path.join(prefix, p), 'utf8') };
    const runtime = factory({ file, settings: { maxMinutes: '15', mulligan: '全部保留' } });
    assert.deepEqual(Array.from(runtime.describe().team), expected);
    const session = runtime.session();
    assert.equal(typeof session.Host, 'function'); assert.equal(typeof session.Player, 'function');
    assert.equal(session.options.maxMinutes, 15);
    const other = factory({ file, settings: { maxMinutes: '20', mulligan: '优先装备与启动牌' } });
    assert.equal(other.session().options.maxMinutes, 20);
    assert.equal(runtime.session().options.maxMinutes, 15);
  }
  assert.equal(context.TCG, sentinel);
  for (const name of ['TCGPlayer', 'TCGBetterGI', 'TCGHandRecognition', 'TCGMoonCatalog', 'TCGMoonUI']) assert.equal(context[name], undefined);
});

test('configuration refuses unknown/repeated strategies and unsupported per-game time', () => {
  assert.throws(() => T.config({ targetName: '迪卢克', strategyOrder: '假的策略' }), e => e.code === 'CONFIG');
  assert.throws(() => T.config({ targetName: '迪卢克', strategyOrder: '雷柯刻,raiden' }), e => e.code === 'CONFIG');
  assert.throws(() => T.config({ targetName: '迪卢克', maxMinutes: '11' }), e => e.code === 'CONFIG');
  assert.equal(T.config({ targetName: '迪卢克' }).queue[1].id, 'iansan');
});
