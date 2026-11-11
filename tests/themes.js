'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const T = require('../utils/theme.js');
const R = require('../utils/room.js');
const E = require('../utils/game-engine.js');
const D = require('../utils/game-data.js');
const AI = require('../utils/ai.js');
const ROOT = path.resolve(__dirname, '..');

function mockCloud() {
  const store = { splendor_rooms: [], splendor_games: [] };
  const mock = { database: { from: from }, store: store, failCreate: false, failAfterWrite: false, roomWrites: 0 };
  function from(table) {
    const filters = [];
    let patch;
    let insert;
    store[table] = store[table] || [];
    function rows() { return store[table].filter(function (r) { return filters.every(function (f) { return r[f[0]] === f[1]; }); }); }
    function execute() {
      if (insert) {
        if (table === 'splendor_rooms') {
          mock.roomWrites += 1;
          const columns = ['code', 'host_uid', 'player_count', 'turn_limit', 'seats', 'status', 'version', 'updated_at'];
          Object.keys(insert).forEach(function (k) { assert(columns.indexOf(k) >= 0, 'unexpected deployed-schema column: ' + k); });
          if (mock.failCreate) { mock.failCreate = false; return { error: { message: 'simulated network failure' } }; }
        }
        const old = store[table].find(function (r) { return r.code === insert.code; });
        if (old) Object.assign(old, JSON.parse(JSON.stringify(insert)));
        else store[table].push(JSON.parse(JSON.stringify(insert)));
        if (table === 'splendor_rooms' && mock.failAfterWrite) {
          mock.failAfterWrite = false;
          return { error: { message: 'connection lost after accepted write' } };
        }
        return { data: [insert], error: null };
      }
      const affected = rows();
      if (patch) affected.forEach(function (r) { Object.assign(r, JSON.parse(JSON.stringify(patch))); });
      return { data: JSON.parse(JSON.stringify(affected)), error: null, count: affected.length };
    }
    const q = {
      eq: function (k, v) { filters.push([k, v]); return q; },
      select: function () { return q; },
      update: function (value) { patch = value; return q; },
      upsert: function (value) { insert = value; return q; },
      maybeSingle: function () { return Promise.resolve({ data: rows()[0] ? JSON.parse(JSON.stringify(rows()[0])) : null, error: null }); },
      then: function (resolve, reject) { return Promise.resolve().then(execute).then(resolve, reject); }
    };
    ['in', 'gte', 'order', 'limit', 'delete'].forEach(function (method) { q[method] = function () { return q; }; });
    return q;
  }
  return mock;
}

function pageRuntime() {
  let page;
  const entry = path.join(ROOT, 'pages/index/index.js');
  vm.runInNewContext(fs.readFileSync(entry, 'utf8'), {
    require: function (target) { return require(path.resolve(path.dirname(entry), target)); },
    Page: function (config) { page = config; },
    wx: { getWindowInfo: function () { return { windowWidth: 844, windowHeight: 390 }; } },
    setTimeout: function () { return 1; }, clearTimeout: function () {},
    setInterval: function () { return 1; }, clearInterval: function () {}, console: console
  }, { filename: entry });
  page.setData = function (data) { Object.assign(page.data, data); };
  page.onLoad();
  return page;
}

function tap(page, name, data) { return page[name]({ currentTarget: { dataset: data || {} } }); }
async function flush() { await new Promise(function (resolve) { setImmediate(resolve); }); }

async function main() {
  assert.deepStrictEqual(T.list().map(function (t) { return t.id; }), ['royal', 'pokemon', 'cyberpunk', 'ai']);
  assert.equal(T.resolve('future-theme').fallback, true);
  assert.equal(T.resolve('future-theme').id, 'royal');
  assert.equal(T.resolve('royal').fallback, false);
  assert.equal(T.resolve('x" onclick="bad').id, 'royal');
  assert.equal(T.forView('home', { themeId: 'ai' }, { themeId: 'pokemon' }).id, 'royal');
  assert.equal(T.forView('game', { themeId: 'ai' }, { themeId: 'pokemon' }).id, 'ai');
  const first = T.list('ai');
  first[0].name = 'changed';
  assert.equal(T.list()[0].name, '皇家商会');
  console.log('PASS theme registry, isolated UI, safe fallback and snapshot precedence');

  const baseline = E.createGame({ playerCount: 2, rand: D.mulberry32(430) });
  for (const id of ['pokemon', 'cyberpunk', 'ai']) {
    const themed = E.createGame({ playerCount: 2, rand: D.mulberry32(430) });
    themed.themeId = id;
    const control = JSON.parse(JSON.stringify(baseline));
    for (let turn = 0; turn < 20; turn++) {
      const action = AI.chooseAction(control);
      assert.deepStrictEqual(E.performAction(themed, action), E.performAction(control, action));
      const comparison = Object.assign({}, themed);
      delete comparison.themeId;
      assert.deepStrictEqual(comparison, control, id + ' changed rule state');
    }
  }
  console.log('PASS three skins preserve identical seeded rules and action results');

  const cloud = mockCloud();
  R.attachCloud(cloud);
  const host = R.saveProfile({ nickname: 'Theme host' });
  for (const id of ['pokemon', 'cyberpunk', 'ai']) {
    const seats = R.makeSeats(3, { 2: true }, host);
    const room = R.createRoom({ profile: host, playerCount: 3, seats: seats, themeId: id });
    assert.equal(room.themeId, id);
    assert.equal(seats[0].roomThemeId, undefined, 'seat input must not be mutated');
    assert((await R.cloudCreateRoom(room, null)).ok);
    const guest = Object.assign({}, R.defaultProfile(), { uid: 'guest-' + id });
    const joined = await R.cloudJoinRoom(room.code, guest);
    assert(joined.ok, joined.error);
    assert.equal(joined.room.themeId, id);
    const ready = await R.cloudSetSeat(room.code, 1, { ready: true });
    assert(ready.ok);
    assert.equal(T.fromSeats(ready.seats), id);
    const state = E.createGame({ playerCount: 3, seats: ready.seats });
    state.themeId = 'royal'; // frozen theme comes from room, never a stale UI value
    assert((await R.cloudStartGame(room.code, state, ready.version, ready.seats)).ok);
    const rejoined = await R.cloudJoinRoom(room.code, guest);
    assert.equal(rejoined.room.themeId, id);
    assert.equal(rejoined.state.themeId, id);
    const roomVersion = (await R.cloudPullRoom(room.code)).version;
    assert((await R.cloudResetRoom(room.code, ready.seats, roomVersion)).ok);
    assert.equal((await R.cloudPullRoom(room.code)).room.themeId, id);
  }
  const legacy = R.createRoom({ profile: host });
  assert((await R.cloudCreateRoom(legacy, null)).ok);
  const legacyRow = cloud.store.splendor_rooms.find(function (r) { return r.code === legacy.code; });
  delete legacyRow.seats[0].roomThemeId;
  assert.equal((await R.cloudPullRoom(legacy.code)).room.themeId, 'royal');
  legacyRow.seats[0].roomThemeId = 'future-theme';
  assert.equal(T.resolve((await R.cloudPullRoom(legacy.code)).room.themeId).fallback, true);
  console.log('PASS strict deployed-schema transport, joining, ready, start, reconnect, reset and legacy rooms');

  R.attachCloud(null);
  const page = pageRuntime();
  tap(page, 'onOpenHomeDialog', { kind: 'create' });
  tap(page, 'onSelectRoomTheme', { id: 'pokemon' });
  assert.equal(page.data.home.themes.find(function (t) { return t.active; }).id, 'pokemon');
  assert.equal(page.data.themeId, 'royal', 'building a draft must not recolor the lobby');
  page.onCloseHomeDialog();
  assert.equal(page.ui.roomThemeId, 'royal', 'cancel restores creation draft');
  for (const id of ['pokemon', 'cyberpunk', 'ai']) {
    tap(page, 'onOpenHomeDialog', { kind: 'create' });
    tap(page, 'onSelectRoomTheme', { id: id });
    page.onCreateRoom();
    assert.equal(page.data.themeId, id);
    assert.equal(page.data.roomScreen.themeName, T.resolve(id).name);
    tap(page, 'onSelectRoomTheme', { id: 'royal' });
    assert.equal(page.data.themeId, id, 'created room theme is immutable');
    tap(page, 'onRoomCount', { n: 2 });
    assert.equal(T.fromSeats(page.room.seats), id, 'changing seat count preserves room metadata');
    tap(page, 'onRoomToggleBot', { index: 1 });
    page.onRoomStart();
    assert.equal(page.data.screen, 'game');
    assert.equal(page.state.themeId, id);
    page.onRestart();
    assert.equal(page.data.screen, 'room');
    assert.equal(page.data.themeId, id);
    page.onRoomStart();
    assert.equal(page.state.themeId, id);
    page.onLeaveRoom();
    assert.equal(page.data.themeId, 'royal');
  }
  console.log('PASS page selection, cancel, immutable room, seat changes, restart and exit');

  const failingCloud = mockCloud();
  R.attachCloud(failingCloud);
  failingCloud.failCreate = true;
  const retryPage = pageRuntime();
  tap(retryPage, 'onOpenHomeDialog', { kind: 'create' });
  tap(retryPage, 'onSelectRoomTheme', { id: 'cyberpunk' });
  retryPage.onCreateRoom();
  await flush();
  const originalCode = retryPage.room.code;
  assert(retryPage.ui.roomCreateFailed);
  assert.equal(retryPage.data.roomScreen.canStart, false);
  assert.equal(retryPage.data.themeId, 'cyberpunk');
  retryPage.onRetryCreateRoom();
  await flush();
  assert.equal(retryPage.room.code, originalCode, 'retry must reuse the same room code');
  assert.equal(retryPage.ui.roomCreateFailed, false);
  assert.equal((await R.cloudPullRoom(originalCode)).room.themeId, 'cyberpunk');
  retryPage.onUnload();
  const acceptedCloud = mockCloud();
  R.attachCloud(acceptedCloud);
  acceptedCloud.failAfterWrite = true;
  const recoveringPage = pageRuntime();
  tap(recoveringPage, 'onOpenHomeDialog', { kind: 'create' });
  tap(recoveringPage, 'onSelectRoomTheme', { id: 'ai' });
  recoveringPage.onCreateRoom();
  await flush();
  const acceptedRow = acceptedCloud.store.splendor_rooms[0];
  acceptedRow.seats[1] = Object.assign({}, acceptedRow.seats[1], { uid: 'early-guest', joined: true, ready: true });
  acceptedRow.version = 2;
  await recoveringPage.onRetryCreateRoom();
  assert.equal(acceptedCloud.roomWrites, 1, 'uncertain accepted creation must not be upserted again');
  assert.equal(recoveringPage.room.seats[1].uid, 'early-guest');
  assert.equal(recoveringPage._roomVersion, 2);
  assert.equal(recoveringPage.data.themeId, 'ai');
  recoveringPage.onUnload();
  R.attachCloud(null);
  console.log('PASS failed/uncertain creation preserves the same room, theme, version and joined members');
  console.log('ALL THEME CHECKS PASSED');
}

main().catch(function (error) { console.error(error.stack); process.exitCode = 1; });
