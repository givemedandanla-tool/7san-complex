const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const { T } = load(['core']);
const queue = [{ id: 'raiden', deck: '甲' }, { id: 'iansan', deck: '乙' }, { id: 'mozailu', deck: '丙' }];

test('normal loss changes the strategy, reopens exactly once, and stops on victory', async () => {
  const events = [], results = ['lose', 'win'];
  const result = await T.runAttempts(queue, 3, {
    prepare: async r => events.push('prepare:' + r.id),
    play: async r => { events.push('play:' + r.id); return results.shift(); },
    reopen: async () => events.push('reopen:same-opponent'), record: async () => {}
  });
  assert.equal(result.outcome, 'win'); assert.equal(result.played, 2);
  assert.deepEqual(events, ['prepare:raiden', 'play:raiden', 'reopen:same-opponent', 'prepare:iansan', 'play:iansan']);
});

test('unrecognized end does not become a loss and does not trigger another match', async () => {
  let prepared = 0, reopened = 0;
  await assert.rejects(T.runAttempts(queue, 3, {
    prepare: async () => prepared++, play: async () => null,
    reopen: async () => reopened++, record: async () => {}
  }), e => e.code === 'RESULT_UNKNOWN');
  assert.equal(prepared, 1); assert.equal(reopened, 0);
});

test('match cap leaves the last loss intact; it does not enter a fresh challenge', async () => {
  let matches = 0, reopened = 0;
  await assert.rejects(T.runAttempts(queue, 1, {
    prepare: async () => {}, play: async () => { matches++; return 'lose'; },
    reopen: async () => reopened++, record: async () => {}
  }), e => e.code === 'EXHAUSTED' && e.details.played === 1);
  assert.equal(matches, 1); assert.equal(reopened, 0);
});

test('missing named deck is skipped before play, without consuming the match budget', async () => {
  const records = [];
  const result = await T.runAttempts(queue, 1, {
    prepare: async r => { if (r.id === 'raiden') throw new T.TrialError('DECK_NOT_FOUND', 'missing'); },
    play: async r => { assert.equal(r.id, 'iansan'); return 'win'; }, reopen: async () => assert.fail('unexpected reopen'),
    record: async r => records.push(r.outcome)
  });
  assert.equal(result.played, 1); assert.deepEqual(records, ['skipped', 'win']);
});

test('cancellation and technical errors propagate without any fallback action', async () => {
  const stop = new Error('cancelled'); let actions = 0;
  await assert.rejects(T.runAttempts(queue, 3, {
    prepare: async () => {}, play: async () => { throw stop; }, reopen: async () => actions++, record: async () => actions++
  }), e => e === stop);
  assert.equal(actions, 0);
});

test('failed identity verification on reopen prevents the next deck and game', async () => {
  const prepared = [];
  await assert.rejects(T.runAttempts(queue, 3, {
    prepare: async r => prepared.push(r.id), play: async () => 'lose', record: async () => {},
    reopen: async () => { throw new T.TrialError('OPPONENT_UNVERIFIED', 'wrong NPC'); }
  }), e => e.code === 'OPPONENT_UNVERIFIED');
  assert.deepEqual(prepared, ['raiden']);
});

test('all losses produce an explicit incomplete outcome for the outer driver to handle', async () => {
  const outcomes = [];
  await assert.rejects(T.runAttempts(queue.slice(0, 2), 5, {
    prepare: async () => {}, play: async () => 'lose', reopen: async () => {}, record: async r => outcomes.push(r.outcome)
  }), e => e.code === 'EXHAUSTED' && e.details.history.length === 2);
  assert.deepEqual(outcomes, ['lose', 'lose']);
});
