'use strict';

/**
 * 多人模式专项回归：node tests/multiplayer.js
 * 覆盖 2/3/4 人牌局、席位身份注入、连续机器人回合、房间与资料适配层。
 */

const assert = require('assert');
const E = require('../utils/game-engine.js');
const R = require('../utils/room.js');
const AI = require('../utils/ai.js');
const GEMS = ['white', 'blue', 'green', 'red', 'black', 'gold'];

function check(label, fn) {
  fn();
  console.log('PASS  ' + label);
}

function refundIfNeeded(s) {
  let guard = 0;
  while (s.pendingDiscard > 0 && guard < 12) {
    const p = s.players[s.current];
    const g = GEMS.filter(function (k) { return p.tokens[k] > 0; })[0];
    if (!g) break;
    E.performAction(s, { type: 'discard', gems: [g] });
    guard += 1;
  }
}

check('2 / 3 / 4 人牌局的银行、贵族与市场', function () {
  [2, 3, 4].forEach(function (n) {
    const s = E.createGame(n);
    assert.equal(s.players.length, n, n + ' 人局席位数');
    const perGem = n === 2 ? 4 : n === 3 ? 5 : 7;
    assert.equal(s.bank.white, perGem, n + ' 人局每色筹码');
    assert.equal(s.bank.gold, 5);
    assert.equal(s.nobles.length, n === 2 ? 3 : n === 3 ? 4 : 5);
    assert.equal(s.board.length, 3);
    for (let lv = 0; lv < 3; lv++) assert.equal(s.board[lv].length, 4);
  });
});

check('席位身份注入：本机 / 机器人 / 好友空席', function () {
  const profile = R.defaultProfile();
  const seats = R.makeSeats(4, { 1: true, 2: false, 3: true }, profile);
  const s = E.createGame({ playerCount: 4, seats: seats });
  assert.equal(s.players[0].type, 'self');
  assert.equal(s.players[0].nickname, profile.nickname);
  assert.equal(s.players[1].isAI, true);
  assert.equal(s.players[2].isAI, false);
  assert.equal(s.players[2].type, 'remote');
  assert.equal(s.players[2].joined, false);
  assert.equal(s.players[3].isAI, true);
});

check('连续机器人回合能推进一轮并回到真人', function () {
  const seats = R.makeSeats(4, { 1: true, 2: true, 3: true }, R.defaultProfile());
  const s = E.createGame({ playerCount: 4, seats: seats });
  let r = E.performAction(s, { type: 'pass' });
  assert.ok(r.ok && r.ended, '本机 pass 应结束回合');
  let guard = 0;
  while (!s.gameOver && guard < 40) {
    if (s.current === 0) break;
    assert.ok(s.players[s.current].isAI, '该席位应由机器人托管');
    r = E.performAction(s, AI.chooseAction(s));
    if (!r.ok) r = E.performAction(s, { type: 'pass' });
    refundIfNeeded(s);
    guard += 1;
  }
  assert.equal(s.current, 0, '一轮后应回到本机玩家');
  assert.ok(s.turnCount >= 4, '应完成至少 4 个回合');
});

check('房间与资料适配层：创建 / 分享 / 校验', function () {
  const p = R.saveProfile({ nickname: '测试商人', avatar: 'a3' });
  assert.equal(R.getProfile().nickname, '测试商人');
  const room = R.createRoom({ playerCount: 3, profile: p });
  assert.equal(room.code.length, 6);
  assert.equal(room.seats.length, 3);
  assert.equal(room.backend, 'local');
  const share = R.shareMessage(room, p);
  assert.ok(share.path.indexOf('room=' + room.code) > 0, '分享路径应带房间号');
  assert.ok(share.title.indexOf('3 人') > 0);
  assert.equal(R.joinRoom('BAD', p).ok, false, '非法房间号应被拒');
  R.clear();
});

check('好友加入空余真人席位', function () {
  const p = R.saveProfile({ nickname: '房主' });
  const seats = R.makeSeats(3, { 1: false, 2: true }, p);
  const room = R.createRoom({ playerCount: 3, seats: seats, profile: p });
  const guest = R.defaultProfile();
  guest.nickname = '好友';
  const joined = R.joinRoom(room.code, guest);
  assert.ok(joined.ok, '应能加入空余真人席位');
  assert.equal(joined.room.seats[1].nickname, '好友');
  assert.equal(joined.room.seats[1].type, 'remote');
  assert.equal(joined.room.seats[1].joined, true);
  assert.equal(joined.room.seats[2].isAI, true, '机器人席位不应被覆盖');
  R.clear();
});

check('跨设备加入在本机适配器下应如实报错', function () {
  const p = R.defaultProfile();
  assert.equal(R.joinRoom('ABC123', p).ok, false);
  const err = R.joinRoom('ABC123', p).error;
  assert.ok(err.indexOf('云端') >= 0, '错误文案应说明需要云端同步');
});

/* ------------------------------------------------------------------
 * 云端 RoomAdapter 契约回归（用最小 PostgREST mock，不发起真实请求）
 * 覆盖：未注入时离线降级、建房 / 快照读写、version 乐观锁、好友入席。
 * ------------------------------------------------------------------ */

function mockCloudClient() {
  const store = { splendor_rooms: [], splendor_games: [] };
  function from(table) {
    const filters = [];
    let patch = null;
    let writeRow = null;
    const q = {};
    function rows() {
      let list = (store[table] || []).slice();
      filters.forEach(function (f) {
        list = list.filter(function (r) { return String(r[f[0]]) === String(f[1]); });
      });
      return list;
    }
    function execute() {
      if (writeRow) {
        const i = store[table].findIndex(function (r) { return r.code === writeRow.code; });
        if (i >= 0) store[table][i] = Object.assign({}, store[table][i], writeRow);
        else store[table].push(Object.assign({}, writeRow));
        return { data: [writeRow], error: null };
      }
      if (patch) {
        const affected = rows();
        affected.forEach(function (r) { Object.assign(r, patch); });
        return {
          data: affected.map(function (r) { return { version: r.version }; }),
          error: null
        };
      }
      return { data: rows(), error: null };
    }
    q.select = function () { return q; };
    q.eq = function (k, v) { filters.push([k, v]); return q; };
    q.maybeSingle = function () {
      const r = rows()[0];
      return Promise.resolve({ data: r ? Object.assign({}, r) : null, error: null });
    };
    q.upsert = function (row) { writeRow = row; return q; };
    q.update = function (p) { patch = p; return q; };
    // builder 本身是 thenable，支持 await q / await q.select()
    q.then = function (resolve, reject) {
      try { resolve(execute()); } catch (e) { reject(e); }
    };
    return q;
  }
  return { database: { from: from }, _store: store };
}

async function cloudChecks() {
  const mock = mockCloudClient();
  assert.equal(R.hasCloud(), false, '未注入 client 时应为本地模式');

  const before = await R.cloudCreateRoom({}, {});
  assert.equal(before.ok, false);
  assert.equal(before.offline, true, '未注入时云端方法应返回 offline');
  assert.equal(mock._store.splendor_rooms.length, 0, '离线降级不应发起写入');

  R.attachCloud(mock);
  assert.equal(R.hasCloud(), true);

  const host = R.saveProfile({ nickname: '房主', avatar: 'a0' });
  const seats = R.makeSeats(3, { 1: false, 2: true }, host);
  const state = E.createGame({ playerCount: 3, seats: seats });
  const room = R.createRoom({ playerCount: 3, seats: seats, profile: host });
  assert.equal(room.backend, 'cloud', '云端模式下房间应标记 cloud');

  const created = await R.cloudCreateRoom(room, state);
  assert.ok(created.ok, '建房应成功：' + (created.error || ''));
  assert.equal(created.version, 1);
  assert.equal(mock._store.splendor_rooms.length, 1);
  assert.equal(mock._store.splendor_games.length, 1);

  const pulled = await R.cloudPullGame(room.code);
  assert.ok(pulled.ok, '快照应能读回');
  assert.equal(pulled.version, 1);
  assert.deepEqual(pulled.state, state, '写入的牌局状态应能原样读回');

  const pushed = await R.cloudPushState(room.code, state, 1);
  assert.ok(pushed.ok, '当前版本提交应成功');
  assert.equal(pushed.version, 2);
  const stale = await R.cloudPushState(room.code, state, 1);
  assert.equal(stale.ok, false);
  assert.equal(stale.conflict, true, '旧版本提交应被乐观锁挡住');

  const guest = R.defaultProfile();
  guest.nickname = '好友';
  guest.uid = 'guest-uid-1';
  const joined = await R.cloudJoinRoom(room.code, guest);
  assert.ok(joined.ok, '好友入席应成功：' + (joined.error || ''));
  assert.equal(joined.seat, 1, '应落到第一个空余真人席位');
  assert.equal(joined.room.seats[1].nickname, '好友');
  assert.equal(joined.room.seats[2].isAI, true, '机器人席位不应被占用');
  assert.equal(joined.version, 2, '应返回当前牌局版本');

  const again = await R.cloudJoinRoom(room.code, guest);
  assert.ok(again.ok);
  assert.equal(again.seat, 1, '同一身份重复进入应复用原席位');

  const missing = await R.cloudJoinRoom('ZZZZZZ', guest);
  assert.equal(missing.ok, false);
  assert.ok(missing.error.indexOf('未找到') >= 0, '不存在的房间应给出明确提示');
  assert.equal((await R.cloudJoinRoom('BAD', guest)).ok, false, '非法房间号应被拒');

  // 还原为本地模式，避免影响同一进程内的其他测试
  R.attachCloud(null);
  assert.equal(R.hasCloud(), false);
  assert.equal((await R.cloudPullGame(room.code)).offline, true);
  R.clear();

  console.log('PASS  云端 RoomAdapter：离线降级 / 建房 / 快照 / 乐观锁 / 好友入席');
  console.log('ALL MULTIPLAYER CHECKS PASSED');
}

cloudChecks().catch(function (err) {
  console.error('FAIL  云端 RoomAdapter：', (err && err.stack) || err);
  process.exit(1);
});
