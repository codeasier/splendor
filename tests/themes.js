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

  const cards = [].concat.apply([], D.buildDecks(D.mulberry32(430)));
  const originals = JSON.stringify(cards);
  const whiteFirst = cards.find(function (card) { return card.id === 'L1-01'; });
  assert.equal(T.cardName('pokemon', whiteFirst), '皮卡丘·初遇');
  assert.equal(T.cardName('cyberpunk', whiteFirst), '雨夜集市·信标');
  assert.equal(T.cardName('ai', whiteFirst), 'GPT·提示');
  assert.equal(T.nobleTitle('ai', D.NOBLE_POOL[2]), 'Grok·导师');
  for (const id of ['pokemon', 'cyberpunk', 'ai']) {
    const names = cards.map(function (card) { return T.cardName(id, card); });
    assert.equal(new Set(names).size, 90, id + ' needs 90 distinct card names');
    const nobleNames = D.NOBLE_POOL.map(function (noble) { return T.nobleTitle(id, noble); });
    assert.equal(new Set(names.concat(nobleNames)).size, 100, 'development and noble cards must not share a name');
    cards.forEach(function (card) {
      const name = T.cardName(id, card);
      assert.notEqual(name, card.name, id + ' still displays the royal card name');
      assert.equal(T.cardName(id, JSON.parse(JSON.stringify(card))), name, 'remote snapshots must resolve identically');
      assert.equal(T.cardName(id, { id: card.id }), name, 'names must use stable identity, not payload art order');
      assert.equal(T.text(id, '玩家 · 预留「' + card.name + '」'), '玩家 · 预留「' + name + '」');
      assert.equal(T.text(id, '购入「' + card.name + '」 +1 声望'), '购入「' + name + '」 +1 声望');
    });
    D.NOBLE_POOL.forEach(function (noble) {
      const title = T.nobleTitle(id, noble);
      assert.notEqual(title, noble.title);
      assert.equal(T.text(id, '获得贵族「' + noble.title + '」 +3 声望'), '获得贵族「' + title + '」 +3 声望');
    });
    assert.equal(T.cardName(id, { id: 'future-card', name: '自定义卡' }), '自定义卡');
    assert.equal(T.nobleTitle(id, { id: 'future-noble', title: '自定义角色' }), '自定义角色');
    assert.equal(T.text(id, '玩家昵称「' + whiteFirst.name + '」'), '玩家昵称「' + whiteFirst.name + '」');
  }
  assert.equal(JSON.stringify(cards), originals, 'theme names must never mutate canonical card data');
  ['royal', 'future-theme', undefined].forEach(function (id) {
    cards.forEach(function (card) { assert.equal(T.cardName(id, card), card.name); });
    D.NOBLE_POOL.forEach(function (noble) { assert.equal(T.nobleTitle(id, noble), noble.title); });
  });
  console.log('PASS 90 distinct themed card names, ten noble titles, legacy log rendering and canonical data isolation');

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
    // 开局先手随机后，房主不一定先动；onTapCard 要求轮到自己才开详情。
    // 本节验主题化卡名，与先后手无关，把回合钉到本机席位。
    page.state.current = page.mySeat;
    page.refresh('');
    const target = page.state.board[0][0];
    const targetName = T.cardName(id, target);
    page.data.rows.forEach(function (row) {
      row.cards.forEach(function (view) {
        const source = cards.find(function (card) { return card.id === view.id; });
        assert.equal(view.name, T.cardName(id, source));
      });
    });
    page.data.nobles.forEach(function (view) {
      assert.equal(view.title, T.nobleTitle(id, page.state.nobles.find(function (noble) { return noble.id === view.id; })));
      assert.equal(view.photoClass, 'noble-photo-' + (Number(view.id.slice(1)) - 1), 'noble portraits must follow identity, not shuffled position');
    });
    tap(page, 'onTapCard', { lv: 0, index: 0 });
    assert.equal(page.data.detail.card.name, targetName);
    assert(page.data.pick.title.indexOf(targetName) === 0);
    assert(page.applyPlayerAction({ type: 'reserveBoard', lv: 0, index: 0 }));
    assert.equal(page.data.reservedCards[0].name, targetName);
    assert.equal(page.ui.showcase.card.name, targetName);
    assert(page.ui.showcase.title.indexOf(targetName) >= 0);
    assert(page.data.lastMove.text.indexOf(targetName) >= 0);
    assert(page.data.logText.indexOf(targetName) >= 0);
    assert(page.data.hintText.indexOf(targetName) >= 0);
    assert.equal(page.state.lastAction.card.name, target.name, 'wire snapshots retain canonical names');
    tap(page, 'onTapPlayer', { index: 0 });
    assert.equal(page.data.playerDetail.reservedCards[0].name, targetName);
    page.ui.showPlayerDetail = false;
    page.state.current = 0;
    D.GEMS.forEach(function (gem) {
      page.state.players[0].tokens[gem] = target.cost[gem];
      page.state.bank[gem] -= target.cost[gem];
    });
    page.ui.detail = { kind: 'reserved', index: 0 };
    page.refresh('');
    assert(page.data.pick.title.indexOf(targetName) === 0);
    assert(page.applyPlayerAction({ type: 'buyReserved', index: 0 }));
    assert.equal(page.state.players[0].cards[0].name, target.name);
    assert(page.data.logText.indexOf(targetName) >= 0);
    page.state.lastAction = { id: 'remote-' + id, seat: 1, type: 'reserveBoard', lv: 0, index: 0, card: target };
    page.replayRemoteAction(page.state);
    assert.equal(page.ui.showcase.remote, true);
    assert(page.ui.showcase.title.indexOf(targetName) >= 0);
    const visitor = page.state.nobles.shift();
    page.state.players[0].nobles.push(visitor);
    page.state.players[0].points += visitor.points;
    tap(page, 'onTapPlayer', { index: 0 });
    assert.equal(page.data.playerDetail.nobles[0].title, T.nobleTitle(id, visitor));
    page.state.pendingNoble = { seat: 0, options: page.state.nobles.map(function (noble) { return noble.id; }) };
    page.refresh('');
    page.data.nobleChoice.options.forEach(function (view) {
      assert.equal(view.title, T.nobleTitle(id, page.state.nobles.find(function (noble) { return noble.id === view.id; })));
    });
    page.onRestart();
    assert.equal(page.data.screen, 'room');
    assert.equal(page.data.themeId, id);
    page.onRoomStart();
    assert.equal(page.state.themeId, id);
    page.onLeaveRoom();
    assert.equal(page.data.themeId, 'royal');
  }
  console.log('PASS themed market/detail/reserve/purchase/replay/noble views, selection, restart and exit');

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
