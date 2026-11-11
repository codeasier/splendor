'use strict';

/**
 * 用户系统回归：node tests/user.js
 * 覆盖身份稳定性、模式可用性、战绩统计与排序、上限、幂等、云端契约。
 */

const assert = require('assert');
const R = require('../utils/room.js');
const U = require('../utils/user.js');

function check(label, fn) {
  fn();
  console.log('PASS  ' + label);
}

async function checkAsync(label, fn) {
  await fn();
  console.log('PASS  ' + label);
}

function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

/* ---------- 最小 PostgREST mock：只实现 user.js 用到的 upsert / select / gte ---------- */
function mockCloud() {
  const store = { splendor_players: [], splendor_records: [], splendor_presence: [] };
  // 记录每次查询用过的过滤条件，用于断言「不是整表拉」
  const meta = { queries: [] };
  function from(table) {
    if (!store[table]) store[table] = [];
    const filters = [];
    let writeRow = null;
    let countMode = false;
    const q = {};
    function rows() {
      let list = store[table].slice();
      filters.forEach(function (f) {
        if (f && f.in) {
          const want = f.in.map(String);
          list = list.filter(function (r) { return want.indexOf(String(r[f.k])) >= 0; });
          return;
        }
        if (f && f.gte) {
          list = list.filter(function (r) { return String(r[f.k]) >= String(f.gte); });
          return;
        }
        list = list.filter(function (r) { return String(r[f[0]]) === String(f[1]); });
      });
      return list;
    }
    q.upsert = function (row) { writeRow = row; return q; };
    q.select = function (cols, opts) {
      // count: 'exact', head: true —— countOnline 用这个拿总数而不拉行
      if (opts && opts.count === 'exact') countMode = true;
      return q;
    };
    q.eq = function (k, v) { filters.push([k, v]); return q; };
    q.in = function (k, list) { filters.push({ k: k, in: list }); return q; };
    q.gte = function (k, v) { filters.push({ k: k, gte: v }); return q; };
    q.maybeSingle = function () {
      const r = rows()[0];
      return Promise.resolve({ data: r || null, error: null });
    };
    q.then = function (resolve, reject) {
      try {
        meta.queries.push({
          table: table,
          filters: filters.map(function (f) {
            if (!f) return f;
            if (f.in) return { k: f.k, in: f.in.slice() };
            if (f.gte) return { k: f.k, gte: f.gte };
            return { k: f[0], v: f[1] };
          })
        });
        if (writeRow) {
          const field = writeRow.id ? 'id' : 'uid';
          const key = String(writeRow[field]);
          const i = store[table].findIndex(function (r) { return String(r[field]) === key; });
          if (i >= 0) store[table][i] = Object.assign({}, store[table][i], writeRow);
          else store[table].push(Object.assign({}, writeRow));
          resolve({ data: [writeRow], error: null });
        } else if (countMode) {
          resolve({ data: null, error: null, count: rows().length });
        } else {
          resolve({ data: rows(), error: null });
        }
      } catch (e) { reject(e); }
    };
    return q;
  }
  return { database: { from: from }, _store: store, _meta: meta };
}

async function run() {
  check('身份：uid 与本机资料一致且跨次读取稳定', function () {
    const p = R.getProfile();
    const a = U.getIdentity();
    const b = U.getIdentity();
    assert.equal(a.uid, p.uid, '身份 uid 必须来自本机资料');
    assert.equal(a.uid, b.uid, '重复读取不能换账号');
    assert.equal(a.mode, 'guest', '未绑定微信时是游客身份');
    assert.equal(a.label, '本机账号');
    assert.ok(a.shortId.length > 0, '界面需要短 ID');
    assert.ok(a.sinceText.length > 0, '需要展示加入时间');
  });

  check('模式：只开放标准模式，未知 key 回落标准', function () {
    const modes = U.listModes('standard');
    assert.equal(modes.length, 3, '三个模式位：标准 / 轮抽 / 双人协作');
    assert.equal(modes[0].key, 'standard');
    assert.equal(modes[0].available, true);
    assert.equal(modes[0].active, true);
    assert.equal(modes[1].available, false, '轮抽模式应为筹备中');
    assert.equal(modes[2].available, false, '双人协作应为筹备中');
    assert.equal(modes[1].tag, '筹备中');
    assert.equal(U.modeByKey('draft').name, '轮抽模式');
    assert.equal(U.modeByKey('__nope__').key, 'standard', '未知模式必须回落标准模式');
  });

  check('战绩：统计 / 排序 / 连胜 / 称号', function () {
    U.clearRecords();
    assert.equal(U.statsOf().total, 0, '清空后应无记录');
    assert.equal(U.statsOf().winRate, 0, '无记录时胜率不能是 NaN');
    assert.equal(U.rankTitle(0), '行会新人');

    const t = Date.now();
    U.addRecord({ id: 'r-a', mode: 'solo', playerCount: 2, rank: 1, score: 15, win: true, at: t - 3000, turns: 28 });
    U.addRecord({ id: 'r-b', mode: 'room', playerCount: 4, rank: 2, score: 9, win: false, at: t - 2000, turns: 40 });
    U.addRecord({ id: 'r-c', mode: 'solo', playerCount: 3, rank: 1, score: 15, win: true, at: t - 1000, turns: 33 });

    const stats = U.statsOf();
    assert.equal(stats.total, 3);
    assert.equal(stats.wins, 2);
    assert.equal(stats.losses, 1);
    assert.equal(stats.winRate, 67, '2/3 应为 67%');
    assert.equal(stats.best, 15);
    assert.equal(stats.avgScore, 13, '(15+9+15)/3 取整为 13');
    assert.equal(stats.streak, 1, '最近一局胜、上一局负 → 连胜 1');
    assert.equal(stats.rankTitle, '珠宝学徒', '3 场应升到珠宝学徒');

    const list = U.recordList(2);
    assert.equal(list.length, 2);
    assert.equal(list[0].id, 'r-c', '最近对局排在最前');
    assert.equal(list[0].resultText, '胜');
    assert.equal(list[0].modeText, '人机 · 3 人');
    assert.equal(list[1].resultText, '负');
    assert.equal(list[1].modeText, '联机 · 4 人');
    assert.equal(list[0].rankText, '第 1 名');
  });

  check('战绩：本地最多保留 60 条，超出丢最旧', function () {
    U.clearRecords();
    const base = Date.now() - 100000;
    for (let i = 0; i < 70; i++) {
      U.addRecord({ id: 'cap-' + i, mode: 'solo', playerCount: 2, rank: 1, score: 10, win: true, at: base + i * 1000 });
    }
    const rows = U.getRecords();
    assert.equal(rows.length, U.MAX_RECORDS, '应被截断到上限 ' + U.MAX_RECORDS);
    assert.equal(rows[0].id, 'cap-69', '保留最新一条');
    assert.ok(rows[rows.length - 1].id !== 'cap-0', '最旧的应被丢弃');
  });

  await checkAsync('云端：资料 upsert / 战绩写入 / 拉取合并去重', async function () {
    U.clearRecords();
    const mock = mockCloud();
    assert.equal(R.hasCloud(), false, '未注入时云端方法应离线降级');
    const offline = await U.syncProfile(R.getProfile());
    assert.equal(offline.offline, true);
    assert.equal(mock._store.splendor_players.length, 0, '离线不应写 mock');

    R.attachCloud(mock);
    const p = R.saveProfile({ nickname: '战绩商人', avatar: 'a4' });
    U.addRecord({ id: 'cloud-1', mode: 'room', playerCount: 3, rank: 1, score: 15, win: true, at: Date.now() });
    await tick();

    const synced = await U.syncProfile(p);
    assert.ok(synced.ok, '资料应写入云端：' + (synced.error || ''));
    const player = mock._store.splendor_players[0];
    assert.equal(player.uid, p.uid);
    assert.equal(player.nickname, '战绩商人');
    assert.equal(player.stats.total, 1, '云端 stats 应反映本地战绩');
    assert.ok(player.updated_at, '应带更新时间');

    assert.equal(mock._store.splendor_records.length, 1, 'addRecord 应异步补写云端战绩');
    assert.equal(mock._store.splendor_records[0].id, 'cloud-1');
    assert.equal(mock._store.splendor_records[0].player_count, 3);
    assert.equal(mock._store.splendor_records[0].win, true);

    // 云端另有一条本机没有的记录 → 拉取后合并，且不重复
    mock._store.splendor_records.push({
      id: 'cloud-2', uid: p.uid, mode: 'solo', player_count: 2,
      rank: 2, score: 8, win: false, room_code: '',
      played_at: new Date(Date.now() - 5000).toISOString()
    });
    const pulled = await U.pullRecords(p.uid);
    assert.ok(pulled.ok);
    assert.equal(pulled.added, 1, '只补本地缺少的那一条');
    assert.equal(U.getRecords().length, 2);
    const again = await U.pullRecords(p.uid);
    assert.equal(again.added, 0, '重复拉取不应产生副本');
  });

  check('头像持久化：无文件系统时原样返回', function () {
    assert.equal(U.persistAvatar('http://tmp/avatar.jpg'), 'http://tmp/avatar.jpg');
    assert.equal(U.persistAvatar(''), '');
  });

  await checkAsync('头像：无 wx 时压不出 data URI，但本机路径照旧', async function () {
    const av = await U.prepareAvatar('http://tmp/a.jpg', 'u-test');
    assert.equal(av.avatarUrl, 'http://tmp/a.jpg', '本机路径原样保留');
    assert.equal(av.avatarData, '', '没有 wx.compressImage 时不给 data URI，上层回落到预设头像');
  });

  await checkAsync('联机头像：按 uid 取回别人的缩略图并缓存', async function () {
    const mock = mockCloud();
    mock._store.splendor_players.push(
      { uid: 'p-a', nickname: '甲', avatar: 'a2', avatar_url: 'data:image/jpeg;base64,AAA' },
      { uid: 'p-b', nickname: '乙', avatar: 'a3', avatar_url: 'data:image/jpeg;base64,BBB' },
      { uid: 'p-c', nickname: '丙', avatar: 'a5', avatar_url: '' }
    );
    R.attachCloud(mock);
    const res = await U.fetchProfiles(['p-a', 'p-b', 'p-c', 'p-a']);
    assert.ok(res.ok, '取资料应成功：' + (res.error || ''));
    assert.equal(res.map['p-a'].avatarUrl, 'data:image/jpeg;base64,AAA', '拿得到别人的头像缩略图');
    assert.equal(res.map['p-b'].nickname, '乙', '昵称一起回来');
    assert.equal(res.map['p-c'].avatarUrl, '', '没设头像的返回空串，由预设头像兜底');
    // 只查在场 uid：整表 select('*') 会把所有人的头像一起拉下来
    const pq = mock._meta.queries.filter(function (q) { return q.table === 'splendor_players'; }).pop();
    const inF = pq && pq.filters.filter(function (f) { return f.in; })[0];
    assert.ok(inF && inF.k === 'uid', '资料查询要按 uid 过滤');
    assert.equal(inF.in.length, 3, '只查未命中缓存的 uid：' + JSON.stringify(inF.in));
    assert.equal(inF.in.indexOf('p-a'), 0, '去重后按传入顺序查询');

    // 第二次命中本地缓存，不再打云端
    let calls = 0;
    const wrap = mock.database.from;
    mock.database.from = function (t) { calls += 1; return wrap(t); };
    const cached = await U.fetchProfiles(['p-a', 'p-b', 'p-c']);
    assert.equal(calls, 0, '同一 uid 集合应命中缓存，不再请求资料表');
    assert.equal(cached.map['p-a'].avatarUrl, 'data:image/jpeg;base64,AAA');

    // 资料上云写的是缩略图，而不是本机文件路径
    const p = R.saveProfile({ nickname: '甲', avatar: 'a2', avatarUrl: 'wxfile://local/avatar.jpg', avatarData: 'data:image/jpeg;base64,CCC' });
    await U.syncProfile(p);
    const row = mock._store.splendor_players.filter(function (r) { return r.uid === p.uid; })[0];
    assert.equal(row.avatar_url, 'data:image/jpeg;base64,CCC', '云端只存 data URI：本机路径对别人无意义');
    assert.equal(row.avatar_url.indexOf('wxfile'), -1, '不能把本机文件路径写进云端');
  });

  /* ---------- 在线心跳：写自己的 last_seen，按窗口统计人数 ---------- */
  await checkAsync('在线心跳：upsert 自身 / 窗口外不计入 / 离线时优雅降级', async function () {
    const mock = mockCloud();
    R.attachCloud(mock);
    const me = R.getProfile();

    // 首次上报：应写入自己一行
    const first = await U.heartbeat(me);
    assert.equal(first.ok, true, '有心跳应成功');
    const mine = mock._store.splendor_presence.filter(function (r) { return r.uid === me.uid; })[0];
    assert.ok(mine, '心跳应写入 splendor_presence');
    assert.ok(mine.last_seen, '必须带 last_seen 时间戳');

    // 重复上报不产生第二行（uid 是主键，走 upsert）
    await U.heartbeat(me);
    const mineRows = mock._store.splendor_presence.filter(function (r) { return r.uid === me.uid; });
    assert.equal(mineRows.length, 1, '同一 uid 只能有一行心跳');

    // 造两个「窗口内」和一个「窗口外」
    mock._store.splendor_presence.push({ uid: 'fresh-1', nickname: '甲', last_seen: new Date(Date.now() - 10 * 1000).toISOString() });
    mock._store.splendor_presence.push({ uid: 'fresh-2', nickname: '乙', last_seen: new Date(Date.now() - 60 * 1000).toISOString() });
    mock._store.splendor_presence.push({ uid: 'stale', nickname: '丙', last_seen: new Date(Date.now() - 30 * 60 * 1000).toISOString() });

    const online = await U.countOnline();
    assert.equal(online.ok, true, '在线统计应成功');
    assert.equal(online.count, 3, '只统计近 2 分钟：自己 + 10s + 60s，30 分钟前的不算');

    // 必须带 last_seen >= 过滤条件，不能整表拉回来在本地筛
    const q = mock._meta.queries.filter(function (x) { return x.table === 'splendor_presence'; }).pop();
    assert.ok(q && q.filters.some(function (f) { return f && f.k === 'last_seen' && f.gte; }),
      'countOnline 必须用 gte(last_seen) 过滤，而不是拉全表');

    // 没有云客户端时不能抛错，返回 offline + 0
    R.attachCloud(null);
    const off = await U.countOnline();
    assert.equal(off.ok, false, '离线时应如实返回 ok:false');
    assert.equal(off.count, 0, '离线时计数为 0，界面据此显示「—」');
    const offBeat = await U.heartbeat(R.getProfile());
    assert.equal(offBeat.ok, false, '离线时心跳静默失败，不抛错');
  });

  /* ---------- 心跳定时器：无 setInterval 的环境不能打断调用方 ---------- */
  check('心跳定时器：缺少 setInterval 时安全降级', function () {
    const realSet = global.setInterval;
    const realClear = global.clearInterval;
    try {
      delete global.setInterval;
      delete global.clearInterval;
      // 预览沙箱没有这两个函数；startHeartbeat 直接调会抛 ReferenceError，
      // 把 onShow 整个打断 —— 在线人数是锦上添花，不该拖垮大厅。
      let threw = null;
      try { U.startHeartbeat(R.getProfile()); } catch (e) { threw = e; }
      assert.equal(threw, null, 'startHeartbeat 不能在缺 setInterval 时抛错');
      let threw2 = null;
      try { U.stopHeartbeat(); } catch (e) { threw2 = e; }
      assert.equal(threw2, null, 'stopHeartbeat 不能抛错');
    } finally {
      global.setInterval = realSet;
      global.clearInterval = realClear;
    }
  });

  console.log('ALL USER CHECKS PASSED');
}

run().catch(function (e) {
  console.error('FAIL: ' + e.message);
  process.exitCode = 1;
});
