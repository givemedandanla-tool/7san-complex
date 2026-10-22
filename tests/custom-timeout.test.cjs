const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ROOT } = require('./helpers.cjs');

for (const id of ['raiden', 'iansan', 'moonbloom', 'mozailu']) {
  test(`${id}: actual player accepts 120 minutes, survives 20 minutes and throws at its real deadline`, async () => {
    const started = 1_000_000;
    let clock = started, disposed = 0, phases = 0, entered = 0;
    const stops = [], waits = [];
    class VirtualDate extends Date { static now() { return clock; } }
    const context = vm.createContext({
      Date: VirtualDate,
      log: { info() {}, warn() {}, error() {} },
      sleep: async milliseconds => { waits.push(milliseconds); clock += milliseconds; }
    });
    const directory = path.join(ROOT, 'dist/InvitationFallback/engines', id);
    const factory = vm.runInContext(fs.readFileSync(path.join(directory, 'engine.js'), 'utf8'), context);
    const file = { readTextSync: p => fs.readFileSync(path.join(directory, p), 'utf8') };
    const runtime = factory({ file, settings: { maxMinutes: '120', mulligan: '全部保留' } });
    const session = runtime.session();
    assert.equal(session.options.maxMinutes, 120, 'the original menu whitelist must not reject or clamp a manual value');
    const host = {
      phase() { phases++; return { phase: 'unknown', turn: 'none' }; },
      trace() {},
      reportStop(message, code) { stops.push({ message, code }); },
      dispose() { disposed++; }
    };
    const player = new session.Player(host, session.options);
    assert.equal(player.deadline, started + 120 * 60000);
    assert.equal(host.matchDeadline, player.deadline);
    clock = started + 20 * 60000;
    assert.doesNotThrow(() => player.checkStalled('等待牌局恢复'), '120-minute entry must not retain the former 20-minute ceiling');

    // Skip image-dependent entry only; exercise the unmodified upstream timer loop,
    // timeout exception, stop reporting and finally disposal with a virtual clock.
    player.enter = async () => { entered++; return true; };
    clock = player.deadline - 500;
    await assert.rejects(player.run(), error => /^达到单局时间/.test(error.message));
    assert.equal(clock, player.deadline);
    assert.equal(entered, 1);
    assert.equal(phases, 1);
    assert.deepEqual(waits, [500]);
    assert.equal(stops.length, 1);
    assert.match(stops[0].message, /^达到单局时间/);
    assert.equal(disposed, 1, 'the original finally still owns host cleanup after timeout');
  });
}
