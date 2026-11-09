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

/* ---------- 最小 PostgREST mock：只实现 user.js 用到的 upsert / select ---------- */
function mockCloud() {
  const store = { splendor_players: [], splendor_records: [] };
  function from(table) {
    if (!store[table]) store[table] = [];
    const filters = [];
    let writeRow = null;
    const q = {};
    function rows() {
      let list = store[table].slice();
      filters.forEach(function (f) {
        list = list.filter(function (r) { return String(r[f[0]]) === String(f[1]); });
      });
      return list;
    }
    q.upsert = function (row) { writeRow = row; return q; };
    q.select = function () { return q; };
    q.eq = function (k, v) { filters.push([k, v]); return q; };
    q.maybeSingle = function () {
      const r = rows()[0];
      return Promise.resolve({ data: r || null, error: null });
    };
    q.then = function (resolve, reject) {
      try {
        if (writeRow) {
          const field = writeRow.uid ? 'uid' : 'id';
          const key = String(writeRow[field]);
          const i = store[table].findIndex(function (r) { return String(r[field]) === key; });
          if (i >= 0) store[table][i] = Object.assign({}, store[table][i], writeRow);
          else store[table].push(Object.assign({}, writeRow));
          resolve({ data: [writeRow], error: null });
        } else {
          resolve({ data: rows(), error: null });
        }
      } catch (e) { reject(e); }
    };
    return q;
  }
  return { database: { from: from }, _store: store };
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

  console.log('ALL USER CHECKS PASSED');
}

run().catch(function (e) {
  console.error('FAIL: ' + e.message);
  process.exitCode = 1;
});
