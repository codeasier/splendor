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

check('云端 SDK 内置：无需「构建 npm」也能加载', function () {
  // 体验版如果没有 miniprogram_npm，require('@tencent-ai/...') 会直接抛错，
  // 云端静默降级成本机房间 —— 这是「好友点分享卡进不来」的根因，必须锁死。
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.resolve(__dirname, '..');

  assert.ok(
    fs.existsSync(path.join(ROOT, 'utils/vendor/workbuddy-cloud-sdk.js')),
    '必须存在内置 SDK 产物 utils/vendor/workbuddy-cloud-sdk.js'
  );
  const sdk = require('../utils/vendor/workbuddy-cloud-sdk.js');
  assert.equal(
    typeof sdk.createMiniProgramWorkBuddyCloud,
    'function',
    '内置 SDK 应导出 createMiniProgramWorkBuddyCloud'
  );

  // 运行时文件不得直接 require npm 包名，否则又依赖构建步骤
  const runtimeFiles = ['app.js', 'utils/cloud.js', 'utils/room.js'];
  runtimeFiles.forEach(function (f) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(
      src.indexOf("require('@tencent-ai/workbuddy-cloud-sdk") === -1
      && src.indexOf('require("@tencent-ai/workbuddy-cloud-sdk') === -1,
      f + ' 不应直接 require npm 包名（小程序运行时不认 node_modules）'
    );
  });

  // Node 环境无全局 wx，cloud.js 必须安全加载并保持未注入
  const cloudMod = require('../utils/cloud.js');
  assert.equal(cloudMod.cloud, null, '无 wx 时不应初始化云端客户端');
  assert.ok(cloudMod.publicConfig.endpoint.indexOf('https://') === 0, 'publicConfig 应带 endpoint');
});

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
  assert.equal(R.defaultProfile().customized, false, '默认资料应标记「未自定义」，入席时才会引导取昵称');
  const p = R.saveProfile({ nickname: '测试商人', avatar: 'a3' });
  assert.equal(R.getProfile().nickname, '测试商人');
  assert.equal(R.getProfile().customized, true, '保存资料后应标记「已自定义」');
  const room = R.createRoom({ playerCount: 3, profile: p });
  assert.equal(room.code.length, 6);
  assert.equal(room.seats.length, 3);
  assert.equal(room.backend, 'local');
  assert.equal(room.status, 'lobby', '新建房间应处于大厅态，等玩家准备');
  assert.equal(room.seats[0].ready, true, '房主视为已准备');
  assert.equal(room.seats[1].ready, false, '真人空席未准备');
  const botSeats = R.makeSeats(3, { 2: true }, p);
  assert.equal(botSeats[2].ready, true, '机器人席位恒定就绪');
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

  /* ---- A. 大厅 → 好友入席 → 准备 → 房主开局 ---- */
  const lobbyRoom = R.createRoom({ playerCount: 3, seats: seats, profile: host }); // 默认 lobby
  assert.equal(lobbyRoom.backend, 'cloud', '云端模式下房间应标记 cloud');
  assert.equal(lobbyRoom.status, 'lobby', '新建房间应处于大厅态');

  const created = await R.cloudCreateRoom(lobbyRoom, null);
  assert.ok(created.ok, '建房应成功：' + (created.error || ''));
  assert.equal(created.version, 1);
  assert.equal(mock._store.splendor_rooms.length, 1);
  assert.equal(mock._store.splendor_games.length, 0, '大厅阶段不写牌局快照');

  const pulledRoom = await R.cloudPullRoom(lobbyRoom.code);
  assert.ok(pulledRoom.ok);
  assert.equal(pulledRoom.room.status, 'lobby');
  assert.equal(pulledRoom.room.seats[0].ready, true, '房主席位应带就绪标记');
  assert.equal(pulledRoom.room.seats[1].ready, false, '真人空席未准备');

  const guest = R.defaultProfile();
  guest.nickname = '好友';
  guest.uid = 'guest-uid-1';
  const joined = await R.cloudJoinRoom(lobbyRoom.code, guest);
  assert.ok(joined.ok, '大厅态好友应可入席：' + (joined.error || ''));
  assert.equal(joined.seat, 1, '应落到第一个空余真人席位');
  assert.equal(joined.status, 'lobby');
  assert.equal(joined.state, null, '大厅阶段没有牌局快照');
  assert.equal(joined.room.seats[1].nickname, '好友');
  assert.equal(joined.room.seats[1].ready, false, '新入席默认未准备');
  assert.equal(joined.room.seats[2].isAI, true, '机器人席位不应被占用');

  const again = await R.cloudJoinRoom(lobbyRoom.code, guest);
  assert.ok(again.ok);
  assert.equal(again.seat, 1, '同一身份重复进入应复用原席位');

  // 房主把机器人席也置为就绪（机器人恒定 ready），再让好友准备
  const ready = await R.cloudSetSeat(lobbyRoom.code, 1, { ready: true });
  assert.ok(ready.ok, '准备状态应能写入云端：' + (ready.error || ''));
  assert.equal(ready.version, again.room.version + 1, '准备应推进房间版本');
  assert.equal(ready.seats[1].ready, true);

  const hostState = E.createGame({ playerCount: 3, seats: ready.seats });
  const started = await R.cloudStartGame(lobbyRoom.code, hostState, ready.version, ready.seats);
  assert.ok(started.ok, '房主开局应成功：' + (started.error || ''));
  assert.equal(started.gameVersion, 1, '新一局快照版本从 1 起');
  const roomRow = mock._store.splendor_rooms.filter(function (r) { return r.code === lobbyRoom.code; })[0];
  assert.equal(roomRow.status, 'playing', '开局后房间应切到 playing');
  const lobbyGame = await R.cloudPullGame(lobbyRoom.code);
  assert.ok(lobbyGame.ok, '开局后牌局快照应可读');
  assert.equal(lobbyGame.state.players.length, 3, '3 人牌局快照');

  // 开局后不再接受新玩家，避免快照席位与实际人数不一致
  const late = R.defaultProfile();
  late.uid = 'late-guest';
  const lateJoin = await R.cloudJoinRoom(lobbyRoom.code, late);
  assert.equal(lateJoin.ok, false, '开局后不应接受新玩家');
  assert.ok(lateJoin.error.indexOf('已经开始') >= 0, '应给出「牌局已开始」提示');

  // 一局结束回大厅：房主重置准备状态，快照写成 lobby 标记
  const resetSeats = ready.seats.map(function (s, i) {
    return Object.assign({}, s, { index: i, ready: i === 0 || !!s.isAI });
  });
  const reset = await R.cloudResetRoom(lobbyRoom.code, resetSeats, started.version);
  assert.ok(reset.ok, '回大厅应成功：' + (reset.error || ''));
  const afterReset = await R.cloudPullGame(lobbyRoom.code);
  assert.equal(afterReset.state.lobby, true, '重置后快照应带 lobby 标记，其他设备据此回大厅');

  /* ---- B. 进行中牌局的快照 / 乐观锁 ---- */
  const playingRoom = R.createRoom({ playerCount: 3, seats: seats, profile: host, status: 'playing' });
  const createdPlaying = await R.cloudCreateRoom(playingRoom, state);
  assert.ok(createdPlaying.ok, '建房应成功：' + (createdPlaying.error || ''));
  assert.equal(mock._store.splendor_games.length, 2, '进行中的房间应写快照');

  const pulled = await R.cloudPullGame(playingRoom.code);
  assert.ok(pulled.ok, '快照应能读回');
  assert.equal(pulled.version, 1);
  assert.deepEqual(pulled.state, state, '写入的牌局状态应能原样读回');

  const pushed = await R.cloudPushState(playingRoom.code, state, 1);
  assert.ok(pushed.ok, '当前版本提交应成功');
  assert.equal(pushed.version, 2);
  const stale = await R.cloudPushState(playingRoom.code, state, 1);
  assert.equal(stale.ok, false);
  assert.equal(stale.conflict, true, '旧版本提交应被乐观锁挡住');

  const missing = await R.cloudJoinRoom('ZZZZZZ', guest);
  assert.equal(missing.ok, false);
  assert.ok(missing.error.indexOf('未找到') >= 0, '不存在的房间应给出明确提示');
  assert.equal((await R.cloudJoinRoom('BAD', guest)).ok, false, '非法房间号应被拒');

  // 还原为本地模式，避免影响同一进程内的其他测试
  R.attachCloud(null);
  assert.equal(R.hasCloud(), false);
  assert.equal((await R.cloudPullGame(playingRoom.code)).offline, true);
  R.clear();

  console.log('PASS  云端 RoomAdapter：离线降级 / 大厅入席 / 准备 / 开局 / 快照 / 乐观锁');
  console.log('ALL MULTIPLAYER CHECKS PASSED');
}

cloudChecks().catch(function (err) {
  console.error('FAIL  云端 RoomAdapter：', (err && err.stack) || err);
  process.exit(1);
});
