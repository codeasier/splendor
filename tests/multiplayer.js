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
  assert.equal(R.cloudStatus().mode, 'preview', '从未初始化云模块时应标记为预览环境');

  // 初始化失败必须与「预览环境」区分：两者都不可跨设备，但原因不同，
  // 界面不能把 SDK 初始化失败说成「设备离线」。
  R.attachCloudFailure('云 SDK 缺少 createMiniProgramWorkBuddyCloud');
  const failedStatus = R.cloudStatus();
  assert.equal(failedStatus.mode, 'failed', '初始化失败应记录为 failed');
  assert.ok(failedStatus.reason.indexOf('createMiniProgramWorkBuddyCloud') >= 0, '应保留失败原因');
  const failedJoin = await R.cloudJoinRoom('ABC123', R.defaultProfile());
  assert.equal(failedJoin.offline, true);
  assert.ok(failedJoin.error.indexOf('云服务未就绪') >= 0, '失败态应提示云服务未就绪而非离线');

  const before = await R.cloudCreateRoom({}, {});
  assert.equal(before.ok, false);
  assert.equal(before.offline, true, '未注入时云端方法应返回 offline');
  assert.equal(mock._store.splendor_rooms.length, 0, '离线降级不应发起写入');

  R.attachCloud(mock);
  assert.equal(R.hasCloud(), true);
  assert.equal(R.cloudStatus().mode, 'ready');
  assert.equal(R.cloudStatus().reason, '', '就绪状态不应残留失败原因');

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

  /* ---- 断线重连：原 uid 在牌局进行中重进 ---- */
  const rejoin = await R.cloudJoinRoom(lobbyRoom.code, guest);
  assert.ok(rejoin.ok, '开局后原玩家重连应成功：' + (rejoin.error || ''));
  assert.equal(rejoin.seat, 1, '重连必须复用原席位');
  assert.equal(rejoin.status, 'playing', '重连应回到进行中的牌局');
  assert.ok(rejoin.state && rejoin.state.players.length === 3, '重连应带回牌局快照');
  assert.equal(rejoin.version, 1, '快照版本随重连返回');
  assert.deepEqual(rejoin.state.players[1].name, lobbyGame.state.players[1].name, '席位身份与快照一致');

  const hostRejoin = await R.cloudJoinRoom(lobbyRoom.code, host);
  assert.ok(hostRejoin.ok, '房主被杀进程后应能重连：' + (hostRejoin.error || ''));
  assert.equal(hostRejoin.seat, 0, '房主重连回到 0 号席');
  assert.equal(hostRejoin.status, 'playing', '房主重连回到进行中的牌局');
  assert.ok(hostRejoin.state && hostRejoin.state.players.length === 3, '房主重连也拿到快照');

  /* ---- 本地会话：记住房间号 / 席位 / 界面 ---- */
  const savedSession = R.saveSession({ code: lobbyRoom.code.toLowerCase(), seat: 1, screen: 'game' });
  assert.equal(savedSession.code, lobbyRoom.code, '会话房间号统一大写');
  assert.equal(savedSession.seat, 1);
  assert.equal(savedSession.screen, 'game');
  const restoredSession = R.getSession();
  assert.ok(restoredSession && restoredSession.code === lobbyRoom.code, '会话可读回');
  assert.ok(restoredSession.at > 0, '会话带时间戳用于过期判断');
  assert.equal(R.saveSession(null), null, '空会话不应写入');
  R.clearSession();
  assert.equal(R.getSession(), null, '清空后不再有会话');

  // 一局结束回大厅：房主重置准备状态，快照写成 lobby 标记
  const resetSeats = ready.seats.map(function (s, i) {
    return Object.assign({}, s, { index: i, ready: i === 0 || !!s.isAI });
  });
  const reset = await R.cloudResetRoom(lobbyRoom.code, resetSeats, started.version);
  assert.ok(reset.ok, '回大厅应成功：' + (reset.error || ''));
  const afterReset = await R.cloudPullGame(lobbyRoom.code);
  assert.equal(afterReset.state.lobby, true, '重置后快照应带 lobby 标记，其他设备据此回大厅');

  // 房主离开 = 解散：置 ended 后重连与新入席都应被拒，避免对着僵尸房间空转
  const ended = await R.cloudUpdateRoom(lobbyRoom.code, { status: 'ended' }, reset.version);
  assert.ok(ended.ok, '解散房间应写入成功');
  const afterEnd = await R.cloudJoinRoom(lobbyRoom.code, guest);
  assert.equal(afterEnd.ok, false, '已解散房间不应接受入席');
  assert.ok(afterEnd.error.indexOf('已结束') >= 0, '应明确提示房间已结束');

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

  /* ---- C. 房主踢人：仅大厅态 / 只清目标席 / 允许重新加入 ---- */
  const kickHost = R.saveProfile({ nickname: '踢人房主', avatar: 'a0' });
  const kickSeats = R.makeSeats(3, { 1: false, 2: true }, kickHost);
  const kickRoom = R.createRoom({ playerCount: 3, seats: kickSeats, profile: kickHost });
  assert.ok((await R.cloudCreateRoom(kickRoom, null)).ok, '踢人专项房间应建成');
  const kickGuest = R.defaultProfile();
  kickGuest.uid = 'kick-guest-uid';
  kickGuest.nickname = '被移出的玩家';
  const kickJoined = await R.cloudJoinRoom(kickRoom.code, kickGuest);
  assert.ok(kickJoined.ok, '好友入席应成功：' + (kickJoined.error || ''));
  assert.equal(kickJoined.seat, 1, '好友坐到 1 号席');

  // 空席构造必须保留云端 JSONB 的附加字段（0 号席 roomThemeId 承载房间主题）
  const kept = R.vacantSeat({ index: 1, uid: 'x', roomThemeId: 'royal', custom: 7 }, 1);
  assert.equal(kept.roomThemeId, 'royal', 'vacantSeat 不得抹掉主题字段');
  assert.equal(kept.custom, 7, 'vacantSeat 不得抹掉席位附加字段');
  assert.equal(kept.uid, '', 'vacantSeat 应清空 uid');
  assert.equal(kept.joined, false, 'vacantSeat 应回到未入席');

  // ① 非房主不得踢
  const notHost = await R.cloudKickSeat(kickRoom.code, 1, 'impostor', kickGuest.uid);
  assert.equal(notHost.ok, false, '非房主应被拒绝');
  assert.ok(notHost.error.indexOf('只有房主') >= 0, '拒绝原因应明确');

  // ② 房主席 / 机器人席 / 越界席都不可踢
  assert.equal((await R.cloudKickSeat(kickRoom.code, 0, kickHost.uid, kickHost.uid)).ok, false,
    '0 号房主席不可移出');
  assert.equal((await R.cloudKickSeat(kickRoom.code, 2, kickHost.uid, '')).ok, false,
    '机器人席不可移出');
  assert.equal((await R.cloudKickSeat(kickRoom.code, 99, kickHost.uid, '')).ok, false,
    '越界席位不可移出');

  // ③ expectedUid 不匹配：CAS 竞态下不能踢错人
  const wrongUid = await R.cloudKickSeat(kickRoom.code, 1, kickHost.uid, 'another-uid');
  assert.equal(wrongUid.ok, false, 'uid 不匹配应拒绝');
  assert.equal(wrongUid.conflict, true, '应标成冲突以便上层刷新');

  // ④ 房主踢：只清目标席，其余席位与房间状态不变
  const beforeKick = await R.cloudPullRoom(kickRoom.code);
  const kicked = await R.cloudKickSeat(kickRoom.code, 1, kickHost.uid, kickGuest.uid);
  assert.ok(kicked.ok, '房主移出应成功：' + (kicked.error || ''));
  assert.equal(kicked.version, beforeKick.version + 1, 'CAS 版本 +1');
  assert.equal(kicked.kickedUid, kickGuest.uid, '返回被移出者的 uid');
  const afterKick = await R.cloudPullRoom(kickRoom.code);
  const s1 = afterKick.room.seats[1];
  assert.equal(s1.uid, '', '目标席 uid 清空');
  assert.equal(s1.joined, false, '目标席回到未入席');
  assert.equal(s1.ready, false, '目标席准备状态清空');
  assert.equal(s1.isAI, false, '目标席仍是真人空席，不自动补机器人');
  assert.equal(s1.name, '等待加入', '目标席文案回到等待加入');
  assert.equal(afterKick.room.seats[0].uid, kickHost.uid, '房主席位不受影响');
  assert.equal(afterKick.room.seats[2].isAI, true, '机器人席位不受影响');
  assert.equal(afterKick.room.status, 'lobby', '房间仍在大厅态');

  // ⑤ 本轮产品决策：允许被踢者凭同一房间号重新加入
  const kickRejoin = await R.cloudJoinRoom(kickRoom.code, kickGuest);
  assert.ok(kickRejoin.ok, '被移出者应能重新加入：' + (kickRejoin.error || ''));
  assert.equal(kickRejoin.seat, 1, '重新坐回释放的空席');

  // ⑥ 对局中禁止踢人：避免牌局快照 players 与 seats 错位
  const gv = (await R.cloudPullRoom(kickRoom.code)).version;
  assert.ok((await R.cloudUpdateRoom(kickRoom.code, { status: 'playing' }, gv)).ok,
    '切到进行中应成功');
  const inGame = await R.cloudKickSeat(kickRoom.code, 1, kickHost.uid, kickGuest.uid);
  assert.equal(inGame.ok, false, '对局中应拒绝移出');
  assert.ok(inGame.error.indexOf('牌局进行中') >= 0, '拒绝原因应说明阶段');
  assert.equal((await R.cloudPullRoom(kickRoom.code)).room.seats[1].uid, kickGuest.uid,
    '被拒后席位不应被改动');

  // 还原为本地模式，避免影响同一进程内的其他测试
  R.attachCloud(null);
  assert.equal(R.hasCloud(), false);
  assert.equal((await R.cloudPullGame(playingRoom.code)).offline, true);
  assert.equal((await R.cloudKickSeat(kickRoom.code, 1, kickHost.uid, kickGuest.uid)).offline, true,
    '无云时踢人应返回 offline');
  R.clear();

  console.log('PASS  云端 RoomAdapter：离线降级 / 大厅入席 / 准备 / 开局 / 快照 / 乐观锁 / 断线重连 / 解散 / 房主踢人');

  /* ---------- 席位超时回收（第七十一轮） ----------
   * 玩家切后台被杀进程时发不出任何事件，只能靠心跳停止推断掉线。
   * 这三条不变量必须成立，否则要么误踢活人，要么死人永远占位。 */
  const now = 1000000;
  const W = R.HEARTBEAT_STALE_MS;

  // 1. 窗口内活跃 → 不回收；超窗口 → 回收
  assert.equal(R.isSeatStale({ uid: 'a', isAI: false, lastSeen: now - 1000 }, now), false,
    '1s 前有心跳不应判掉线');
  assert.equal(R.isSeatStale({ uid: 'a', isAI: false, lastSeen: now - W - 1 }, now), true,
    '超过窗口应判掉线');
  assert.equal(R.isSeatStale({ uid: 'a', isAI: false, lastSeen: now - W + 1000 }, now), false,
    '刚好卡在窗口边缘不应误踢（留 1s 余量）');

  // 2. 空席 / 机器人 / 无 lastSeen 都不该被当成掉线
  assert.equal(R.isSeatStale({ uid: '', isAI: false }, now), false, '空席不算掉线');
  assert.equal(R.isSeatStale({ uid: 'bot', isAI: true }, now), false, '机器人不算掉线');
  assert.equal(R.isSeatStale({ uid: 'a', isAI: false }, now), false,
    '无 lastSeen 的老数据不应被误踢（宁可留着）');

  // 3. 普通玩家掉线：只清他的席位，别人不动
  const rp_s1 = [
    { uid: 'host', isAI: false, lastSeen: now },
    { uid: 'gone', isAI: false, lastSeen: now - W - 5000 },
    { uid: 'alive', isAI: false, lastSeen: now }
  ];
  const rp_r1 = R.reapStaleSeats(rp_s1, now);
  assert.equal(rp_r1.changed, true, '有掉线席位时 changed 应为 true');
  assert.deepEqual(rp_r1.dropped, ['gone'], '只回收超时的那个');
  assert.equal(rp_r1.seats[0].uid, 'host', '房主未掉线时保持原位');
  assert.equal(rp_r1.seats[1].uid, '', '掉线席位应清空');
  assert.equal(rp_r1.seats[2].uid, 'alive', '在线玩家不受影响');
  assert.equal(rp_r1.newHostUid, '', '房主没掉线就不该顺延');

  // 4. 房主掉线 → 顺延给下一个在线的真人
  const rp_s2 = [
    { uid: 'host', isAI: false, lastSeen: now - W - 5000 },
    { uid: 'p1', isAI: false, lastSeen: now },
    { uid: 'p2', isAI: false, lastSeen: now }
  ];
  const rp_r2 = R.reapStaleSeats(rp_s2, now);
  assert.equal(rp_r2.newHostUid, 'p1', '房主掉线应由第一个在线真人接任');
  assert.equal(rp_r2.seats[0].uid, 'p1', '接班者搬到 0 号位');
  assert.equal(rp_r2.seats[0].type, 'self', '接班者类型应转为房主');
  assert.equal(rp_r2.seats[1].uid, '', '接班者原位置应空出');
  assert.equal(rp_r2.seats[2].uid, 'p2', '其他人不动');

  // 5. 房主掉线但其他人也都不在线 → 不顺延，保留空房主位
  const rp_s3 = [
    { uid: 'host', isAI: false, lastSeen: now - W - 5000 },
    { uid: 'p1', isAI: false, lastSeen: now - W - 5000 }
  ];
  const rp_r3 = R.reapStaleSeats(rp_s3, now);
  assert.equal(rp_r3.newHostUid, '', '没有在线真人时不顺延');
  assert.equal(rp_r3.seats[0].uid, '', '房主位保持空');

  // 6. 全员在线 → changed=false，避免无谓的云端写入
  const rp_s4 = [
    { uid: 'host', isAI: false, lastSeen: now },
    { uid: 'p1', isAI: false, lastSeen: now }
  ];
  assert.equal(R.reapStaleSeats(rp_s4, now).changed, false, '没人掉线时不应产生写入');

  // 7. 活跃时间戳：只刷新在线的人，离线者保留原值供后续判定
  const stamp = R.stampSeatActivity(
    [{ uid: 'a', isAI: false, lastSeen: 1 }, { uid: 'b', isAI: false }],
    { a: true }, 777
  );
  assert.equal(stamp.changed, true, '有在线者刷新时间应 changed=true');
  assert.equal(stamp.seats[0].lastSeen, 777, '在线者时间被刷新');
  assert.equal(stamp.seats[1].lastSeen, undefined, '离线者不写入时间（保留原状）');
  assert.equal(R.stampSeatActivity(rp_s4, {}, now).changed, false, '没人在线时不应产生写入');

  // 8. 不放宽：窗口必须显著大于心跳间隔，否则活人会在两次心跳间被误踢
  assert.equal(W, 30000, '回收窗口应为 30s');

  R.clear();

  console.log('PASS  席位超时回收：窗口判定 / 空席与机器人豁免 / 房主顺延 / 无变化不写入');

  /* ---------- 观战模式（方案 A：只读旁战） ----------
   * 三条不变量：
   *   1. 观战者绝不写任何表（写一次就会污染回合与 CAS 版本号）
   *   2. 不占席位（否则会挤掉真人、影响开局人数判断）
   *   3. 房主没开观战开关就一律拒绝（手牌隐私不能默认放开） */
  const spectateCloud = mockCloudClient();
  R.attachCloud(spectateCloud);
  const spHost = R.saveProfile({ nickname: 'SpHost' });

  // 1. 默认不开启观战 → 拒绝
  const spRoom = R.createRoom({ profile: spHost, playerCount: 3, seats: R.makeSeats(3, { 2: true }, spHost) });
  assert.equal(spRoom.allowSpectate, false, 'createRoom 默认不开启观战');
  await R.cloudCreateRoom(spRoom, null);
  const sp_denied = await R.cloudSpectateRoom(spRoom.code);
  assert.equal(sp_denied.ok, false, '未开启观战时观战应被拒绝');
  assert(/未开启观战/.test(sp_denied.error), '拒绝原因应明确');

  // 2. 开启后可以观战，且不占席位
  const spRoom2 = R.createRoom({
    profile: spHost, playerCount: 3,
    seats: R.makeSeats(3, { 2: true }, spHost), allowSpectate: true
  });
  await R.cloudCreateRoom(spRoom2, null);
  const sp_beforeSeats = JSON.stringify(spRoom2.seats);
  const sp_okSp = await R.cloudSpectateRoom(spRoom2.code);
  assert.equal(sp_okSp.ok, true, '开启观战后应允许观战：' + sp_okSp.error);
  assert.equal(sp_okSp.spectating, true, '应标记为观战');
  // 打开后重新拉房间，座位必须一模一样（观战没有写 seats）
  const sp_afterPull = await R.cloudPullRoom(spRoom2.code);
  assert.equal(JSON.stringify(sp_afterPull.room.seats), sp_beforeSeats, '观战不得修改席位表');
  // 观战者不在席位里出现
  const sp_uidsInSeats = sp_afterPull.room.seats.map(function (s) { return s && s.uid; }).filter(Boolean);
  assert(sp_uidsInSeats.indexOf('spectator-uid') < 0, '观战者不应出现在席位表');

  // 3. 牌局开始后，玩家入席被拒但观战仍可进入
  await R.cloudUpdateRoom(spRoom2.code, { status: 'playing' }, (await R.cloudPullRoom(spRoom2.code)).version);
  const sp_lateJoin = await R.cloudJoinRoom(spRoom2.code, Object.assign({}, R.defaultProfile(), { uid: 'late-player' }));
  assert.equal(sp_lateJoin.ok, false, '开局后玩家不应能入席');
  assert(/已经开始/.test(sp_lateJoin.error), '应提示牌局已开始');
  const sp_stillSp = await R.cloudSpectateRoom(spRoom2.code);
  assert.equal(sp_stillSp.ok, true, '开局后观战仍应允许（这是观战的核心价值）');

  // 4. 房间结束后观战也应拒绝
  await R.cloudUpdateRoom(spRoom2.code, { status: 'ended' }, (await R.cloudPullRoom(spRoom2.code)).version);
  const sp_endedSp = await R.cloudSpectateRoom(spRoom2.code);
  assert.equal(sp_endedSp.ok, false, '房间已结束不应允许观战');

  // 5. 房间号格式校验
  const sp_badCode = await R.cloudSpectateRoom('AB');
  assert.equal(sp_badCode.ok, false, '房间号不足 6 位应拒绝');

  // 6. 无云环境优雅降级（不抛错）
  R.attachCloud(null);
  const sp_offlineSp = await R.cloudSpectateRoom(spRoom2.code);
  assert.equal(sp_offlineSp.ok, false, '无云时应返回失败而不是抛错');
  assert.equal(sp_offlineSp.offline, true, '应标记为离线');

  R.clear();

  console.log('PASS  观战模式：默认关闭 / 开启后只读拉取 / 不占席位 / 开局后仍可进 / 结束与降级');
  console.log('ALL MULTIPLAYER CHECKS PASSED');
}

cloudChecks().catch(function (err) {
  console.error('FAIL  云端 RoomAdapter：', (err && err.stack) || err);
  process.exit(1);
});
