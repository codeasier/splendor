'use strict';

/**
 * 好友体系与联机邀请回归：node tests/friend.js
 *
 * 覆盖：双向边、幂等添加、单向删除、在线状态反查、邀请有效期、离线降级。
 * 用最小 PostgREST mock，不连真实云库（真库冒烟另有手工步骤，见项目档案）。
 */

const assert = require('assert');
const R = require('../utils/room.js');
const U = require('../utils/user.js');
const F = require('../utils/friend.js');

function check(label, fn) {
  return Promise.resolve().then(fn).then(function () {
    console.log('PASS  ' + label);
  });
}

/**
 * 最小 PostgREST mock：支持 insert/upsert/update/delete + select 的
 * eq/in/gte/limit/maybeSingle + count。够跑 friend.js 与 listOnlineUids。
 */
function mockCloud() {
  const store = {
    splendor_friends: [],
    splendor_invites: [],
    splendor_presence: [],
    splendor_players: []
  };
  const meta = { queries: [] };

  function makeQuery(table) {
    const q = {};
    let filters = [];
    let writeRow = null;
    let updatePatch = null;
    let deleting = false;
    let countMode = false;
    let limitN = 0;

    function match(row) {
      for (let i = 0; i < filters.length; i++) {
        const f = filters[i];
        if (f.in) {
          if (f.in.map(String).indexOf(String(row[f.k])) < 0) return false;
        } else if (f.gte) {
          if (String(row[f.k] || '') < String(f.gte)) return false;
        } else if (String(row[f.k]) !== String(f.v)) {
          return false;
        }
      }
      return true;
    }
    function picked() {
      let list = (store[table] || []).filter(match);
      if (limitN) list = list.slice(0, limitN);
      return list;
    }

    q.upsert = function (row) { writeRow = row; return q; };
    q.insert = function (row) { writeRow = row; return q; };
    q.update = function (patch) { updatePatch = patch; return q; };
    q.delete = function () { deleting = true; return q; };
    q.select = function (cols, opts) {
      if (opts && opts.count === 'exact') countMode = true;
      return q;
    };
    q.eq = function (k, v) { filters.push({ k: k, v: v }); return q; };
    q.in = function (k, list) { filters.push({ k: k, in: list }); return q; };
    q.gte = function (k, v) { filters.push({ k: k, gte: v }); return q; };
    q.limit = function (n) { limitN = n; return q; };
    q.maybeSingle = function () {
      return Promise.resolve({ data: picked()[0] || null, error: null });
    };
    q.then = function (resolve, reject) {
      try {
        meta.queries.push({
          table: table,
          op: deleting ? 'delete' : (updatePatch ? 'update' : (writeRow ? 'write' : 'select')),
          filters: filters.map(function (f) {
            if (f.in) return { k: f.k, in: f.in.slice() };
            if (f.gte) return { k: f.k, gte: f.gte };
            return { k: f.k, v: f.v };
          })
        });
        if (!store[table]) store[table] = [];

        if (deleting) {
          const before = store[table].filter(match).length;
          store[table] = store[table].filter(function (r) { return !match(r); });
          resolve({ data: null, error: null, deleted: before });
          return;
        }
        if (updatePatch) {
          const hit = store[table].filter(match);
          hit.forEach(function (r) { Object.assign(r, updatePatch); });
          resolve({ data: hit, error: null });
          return;
        }
        if (writeRow) {
          const key = writeRow.id !== undefined ? 'id' : 'uid';
          const i = store[table].findIndex(function (r) { return String(r[key]) === String(writeRow[key]); });
          if (i >= 0) store[table][i] = Object.assign({}, store[table][i], writeRow);
          else store[table].push(Object.assign({}, writeRow));
          resolve({ data: [writeRow], error: null });
          return;
        }
        if (countMode) {
          resolve({ data: null, error: null, count: picked().length });
          return;
        }
        resolve({ data: picked(), error: null });
      } catch (e) { reject(e); }
    };
    return q;
  }

  return {
    database: { from: makeQuery },
    _store: store,
    _meta: meta
  };
}

async function run() {
  /* ---------- 好友 ID：对称且区分正反边 ---------- */
  await check('好友边 ID：A→B 与 B→A 同 id，反向边另有 id', function () {
    assert.equal(F.friendId('a', 'b'), F.friendId('b', 'a'), '同一对好友的主键必须对称');
    assert.notEqual(F.friendIdRev('a', 'b'), F.friendId('a', 'b'), '反向边必须与正向边区分');
    assert.equal(F.MAX_FRIENDS, 200, '好友上限 200');
    assert.equal(F.INVITE_TTL_MS, 10 * 60 * 1000, '邀请有效期 10 分钟');
  });

  /* ---------- 添加：双向各一行，幂等 ---------- */
  await check('加好友：双向各写一行 / 重复添加不产生重复', async function () {
    const mock = mockCloud();
    R.attachCloud(mock);
    const me = { uid: 'uA', nickname: '甲' };

    const r1 = await F.addFriend(me, 'uB', '乙');
    assert.equal(r1.ok, true, '加好友应成功');

    const a2b = mock._store.splendor_friends.filter(function (x) { return x.uid === 'uA'; });
    const b2a = mock._store.splendor_friends.filter(function (x) { return x.uid === 'uB'; });
    assert.equal(a2b.length, 1, 'A 侧应有一条边');
    assert.equal(b2a.length, 1, 'B 侧应有一条边（双向各一行，对方列表才看得到）');
    assert.equal(b2a[0].friend_uid, 'uA', 'B 侧边指向 A');
    assert.equal(b2a[0].friend_name, '甲', 'B 侧存的昵称是 A 的');

    // 幂等：再点一次「加为好友」不应变成两行
    await F.addFriend(me, 'uB', '乙');
    assert.equal(mock._store.splendor_friends.filter(function (x) { return x.uid === 'uA'; }).length, 1,
      '重复添加必须幂等');
  });

  /* ---------- 不能加自己 ---------- */
  await check('加好友：拒绝加自己 / 拒绝空 ID', async function () {
    const mock = mockCloud();
    R.attachCloud(mock);
    const me = { uid: 'uA', nickname: '甲' };
    const self = await F.addFriend(me, 'uA', '甲');
    assert.equal(self.ok, false, '不能加自己为好友');
    const empty = await F.addFriend(me, '', '');
    assert.equal(empty.ok, false, '空账号 ID 应被拒绝');
  });

  /* ---------- 列表：各看各的 ---------- */
  await check('好友列表：双方各自看到对方', async function () {
    const mock = mockCloud();
    R.attachCloud(mock);
    await F.addFriend({ uid: 'uA', nickname: '甲' }, 'uB', '乙');

    const la = await F.listFriends('uA');
    const lb = await F.listFriends('uB');
    assert.equal(la.ok, true, 'A 列表加载成功');
    assert.equal(la.list.length, 1, 'A 有 1 位好友');
    assert.equal(la.list[0].uid, 'uB', 'A 看到的是 B');
    assert.equal(la.list[0].nickname, '乙', 'A 看到 B 的昵称');
    assert.equal(lb.list[0].uid, 'uA', 'B 看到的是 A');
    assert.equal(lb.list[0].nickname, '甲', 'B 看到 A 的昵称');
  });

  /* ---------- 删除：只删自己那侧 ---------- */
  await check('删好友：只删自己那侧，对方列表不受影响', async function () {
    const mock = mockCloud();
    R.attachCloud(mock);
    await F.addFriend({ uid: 'uA', nickname: '甲' }, 'uB', '乙');

    const del = await F.removeFriend('uA', 'uB');
    assert.equal(del.ok, true, '删除应成功');

    const la = await F.listFriends('uA');
    const lb = await F.listFriends('uB');
    assert.equal(la.list.length, 0, 'A 的列表里已无 B');
    assert.equal(lb.list.length, 1, 'B 的列表仍保留 A —— 单方面删除不该让对方好友凭空消失');
    assert.equal(lb.list[0].uid, 'uA', 'B 仍能看到 A');
  });

  /* ---------- 在线状态：一次 in 查询 + 窗口过滤 ---------- */
  await check('好友在线：按 uid 集合反查，窗口外不算在线', async function () {
    const mock = mockCloud();
    R.attachCloud(mock);
    const now = Date.now();
    mock._store.splendor_presence = [
      { uid: 'uB', last_seen: new Date(now - 5000).toISOString() },
      { uid: 'uC', last_seen: new Date(now - 60 * 60 * 1000).toISOString() }
    ];
    const res = await U.listOnlineUids(['uB', 'uC', 'uD']);
    assert.equal(res.ok, true, '在线反查应成功');
    assert.equal(res.map.uB, true, 'uB 刚心跳过，应在线');
    assert.equal(res.map.uC, undefined, '一小时前的心跳不算在线');
    assert.equal(res.map.uD, undefined, '没有心跳记录的视为离线');

    const q = mock._meta.queries.filter(function (x) { return x.table === 'splendor_presence'; }).pop();
    assert.ok(q && q.filters.some(function (f) { return f.k === 'uid' && f.in; }),
      '必须用 in(uid) 一次查完，不能逐个查');
    assert.ok(q && q.filters.some(function (f) { return f.k === 'last_seen' && f.gte; }),
      '必须带 last_seen 窗口过滤');
  });

  /* ---------- 邀请：有效期 ---------- */
  await check('邀请：写入 pending / 只取 10 分钟内的', async function () {
    const mock = mockCloud();
    R.attachCloud(mock);

    const sent = await F.sendInvite('uA', 'uB', 'ABC234', '甲');
    assert.equal(sent.ok, true, '发邀请应成功');
    const row = mock._store.splendor_invites[0];
    assert.equal(row.status, 'pending', '初始状态 pending');
    assert.equal(row.room_code, 'ABC234', '房间号写对');
    assert.equal(row.from_name, '甲', '带上邀请人昵称，被邀方才知道是谁');

    const list = await F.listInvites('uB');
    assert.equal(list.ok, true, '拉邀请应成功');
    assert.equal(list.list.length, 1, 'B 收到 1 条邀请');
    assert.equal(list.list[0].roomCode, 'ABC234', '带回房间号');

    // 把这条改成 20 分钟前，应被 TTL 过滤掉
    mock._store.splendor_invites[0].created_at = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const stale = await F.listInvites('uB');
    assert.equal(stale.list.length, 0, '超过 10 分钟的邀请不该再弹 —— 否则会莫名加入旧房间');
  });

  /* ---------- 邀请：非法房间号 ---------- */
  await check('邀请：非法房间号直接拒绝', async function () {
    const mock = mockCloud();
    R.attachCloud(mock);
    const bad = await F.sendInvite('uA', 'uB', 'abc', '甲');
    assert.equal(bad.ok, false, '5 位房间号应被拒绝');
    assert.equal(mock._store.splendor_invites.length, 0, '非法请求不应落库');
  });

  /* ---------- 标记已处理 ---------- */
  await check('邀请：标记已处理后不再出现在待办里', async function () {
    const mock = mockCloud();
    R.attachCloud(mock);
    await F.sendInvite('uA', 'uB', 'ABC234', '甲');
    const id = mock._store.splendor_invites[0].id;
    await F.markInvite(id, 'accepted');
    const list = await F.listInvites('uB');
    assert.equal(list.list.length, 0, 'accepted 之后不该再弹窗');
  });

  /* ---------- 按 ID 找人不做模糊搜索 ---------- */
  await check('找玩家：精确匹配 uid，找不到时明确告知', async function () {
    const mock = mockCloud();
    R.attachCloud(mock);
    mock._store.splendor_players = [{ uid: 'uX', nickname: '某甲', avatar: 'a1', avatar_url: '' }];

    const hit = await F.findPlayer('uX');
    assert.equal(hit.ok, true, '能查到');
    assert.equal(hit.player.nickname, '某甲', '带回昵称');

    const miss = await F.findPlayer('uNope');
    assert.equal(miss.ok, false, '查不到时 ok:false');
    assert.equal(miss.notFound, true, '标记 notFound，界面据此给「ID 是否正确」而不是网络错误');
  });

  /* ---------- 离线降级 ---------- */
  await check('离线：所有操作返回 offline，不抛错', async function () {
    R.attachCloud(null);
    const me = { uid: 'uA', nickname: '甲' };
    const add = await F.addFriend(me, 'uB', '乙');
    const list = await F.listFriends('uA');
    const del = await F.removeFriend('uA', 'uB');
    const inv = await F.sendInvite('uA', 'uB', 'ABC234', '甲');
    const lis = await F.listInvites('uA');
    const find = await F.findPlayer('uB');
    [add, list, del, inv, lis, find].forEach(function (r, i) {
      assert.equal(r.ok, false, '离线时第 ' + i + ' 个操作应如实失败');
      assert.equal(r.offline, true, '离线时第 ' + i + ' 个操作应标记 offline');
    });
    assert.deepEqual(list.list, [], '离线时好友列表为空数组而不是 undefined');
    assert.deepEqual(lis.list, [], '离线时邀请列表为空数组');
  });

  console.log('ALL FRIEND CHECKS PASSED');
}

run().catch(function (e) {
  console.error('FAIL: ' + e.message);
  if (e.stack) console.error(e.stack.split('\n').slice(0, 4).join('\n'));
  process.exitCode = 1;
});
