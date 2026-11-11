'use strict';

/** 微信登录边界：真实 wx/SDK 契约的最小替身，无网络与正式凭据。 */
const assert = require('assert');

function database() {
  const tables = { splendor_players: [], splendor_records: [], splendor_presence: [], splendor_invites: [] };
  const meta = { reads: 0, writes: 0, profileError: false, deferProfile: null };
  function from(table) {
    const filters = [];
    let write = null;
    let count = false;
    const q = {};
    function rows() {
      return (tables[table] || []).filter(function (row) {
        return filters.every(function (f) { return f(row); });
      });
    }
    q.select = function (columns, options) { count = !!(options && options.count); return q; };
    q.eq = function (key, value) { filters.push(function (r) { return r[key] === value; }); return q; };
    q.in = function (key, values) { filters.push(function (r) { return values.indexOf(r[key]) >= 0; }); return q; };
    q.gte = function (key, value) { filters.push(function (r) { return r[key] >= value; }); return q; };
    q.upsert = function (row) { write = row; return q; };
    q.maybeSingle = function () {
      meta.reads += 1;
      const result = { data: rows()[0] || null, error: meta.profileError ? { message: 'unavailable' } : null };
      return meta.deferProfile ? meta.deferProfile(result) : Promise.resolve(result);
    };
    q.then = function (resolve, reject) {
      try {
        if (write) {
          meta.writes += 1;
          const list = tables[table] || (tables[table] = []);
          const key = write.id ? 'id' : 'uid';
          const at = list.findIndex(function (r) { return r[key] === write[key]; });
          if (at < 0) list.push(Object.assign({}, write));
          else list[at] = Object.assign({}, list[at], write);
          resolve({ data: [write], error: null });
        } else {
          meta.reads += 1;
          resolve({ data: count ? null : rows(), count: rows().length, error: null });
        }
      } catch (e) { reject(e); }
    };
    return q;
  }
  return { from: from, tables: tables, meta: meta };
}

function setup(options) {
  const opt = options || {};
  ['room', 'wechat-auth', 'user', 'friend'].forEach(function (name) {
    delete require.cache[require.resolve('../utils/' + name + '.js')];
  });
  const storage = opt.storage || new Map();
  const db = opt.database || database();
  const control = { uid: opt.uid || 'wx:player-a', loginCalls: 0, exchanges: [], events: null, loginFailure: false };
  const api = {
    getWindowInfo: function () { return { windowWidth: 1080, windowHeight: 560 }; },
    getStorageSync: function (key) { return storage.get(key) || ''; },
    setStorageSync: function (key, value) { storage.set(key, value); },
    removeStorageSync: function (key) { storage.delete(key); },
    getAccountInfoSync: function () { return { miniProgram: { appId: opt.appId || 'wx1234567890abcdef' } }; },
    login: function (args) {
      control.loginCalls += 1;
      if (control.loginFailure) args.fail({ errMsg: 'login:fail' });
      else args.success({ code: opt.emptyCode ? '' : 'one-use-code-' + control.loginCalls });
    }
  };
  global.wx = api;
  const R = require('../utils/room.js');
  const client = {
    database: db,
    auth: {
      signInWithWechat: async function (code, appId) {
        control.exchanges.push({ code: code, appId: appId });
        if (opt.exchange) return opt.exchange(code, appId);
        return { data: { accessToken: 'test-session', user: { id: control.uid, isAnonymous: false } }, error: null };
      },
      onAuthStateChange: function (cb) { control.events = cb; cb('INITIAL_SESSION', null); return function () {}; }
    }
  };
  R.attachCloud(client, { requireWechatLogin: true });
  return { R: R, U: require('../utils/user.js'), W: require('../utils/wechat-auth.js'), client: client,
    control: control, storage: storage, db: db, api: api };
}

async function check(label, fn) {
  await fn();
  console.log('PASS  ' + label);
}

async function run() {
  await check('游客 AppID / 无 wx / 空 code 均不能伪造微信身份', async function () {
    const guest = setup({ appId: 'touristappid' });
    const uid = guest.R.getProfile().uid;
    assert.equal((await guest.U.loginWithWechat()).ok, false);
    assert.equal(guest.control.loginCalls, 0);
    assert.equal(guest.R.hasCloud(), false);
    assert.equal(guest.R.getProfile().uid, uid);
    assert.equal(guest.U.wechatLoginStatus().phase, 'unconfigured');
    delete global.wx;
    assert.equal((await guest.W.signIn()).ok, false);
    assert.equal(guest.W.status().phase, 'preview');
    const empty = setup({ emptyCode: true });
    assert.equal((await empty.U.loginWithWechat()).ok, false);
    assert.equal(empty.control.exchanges.length, 0);
    assert.equal(empty.db.meta.writes, 0);
    const denied = setup();
    denied.control.loginFailure = true;
    assert.equal((await denied.U.loginWithWechat()).ok, false);
    assert.equal(denied.control.exchanges.length, 0);
    assert.equal(denied.R.hasCloud(), false);
  });

  await check('并发登录仅换票一次，服务端 uid 绑定资料、战绩和云端门禁', async function () {
    const h = setup();
    const p = h.R.saveProfile({ nickname: '老商人', avatar: 'a3', uid: 'client-chosen-id' });
    assert.notEqual(p.uid, 'client-chosen-id', '资料编辑不能自选业务身份');
    h.U.addRecord({ id: 'old-game', score: 15, win: true });
    assert.equal(h.db.meta.writes, 0, '未登录不应写游客战绩或资料到云端');
    const a = h.U.loginWithWechat();
    const b = h.U.loginWithWechat();
    assert.strictEqual(a, b, '账号切换本身也须单飞');
    const logged = await a;
    assert.equal(logged.ok, true);
    assert.equal(h.control.exchanges.length, 1);
    assert.deepEqual(h.control.exchanges[0], { code: 'one-use-code-1', appId: 'wx1234567890abcdef' });
    assert.equal(h.R.getProfile().uid, 'wx:player-a');
    assert.equal(h.R.getProfile().nickname, '老商人');
    assert.equal(h.U.getIdentity().authenticated, true);
    assert.equal(h.U.getIdentity().label, '微信账号');
    assert.equal(h.R.hasCloud(), true);
    assert.equal(h.U.getRecords()[0].uid, 'wx:player-a');
    assert.notEqual(h.U.getRecords()[0].id, 'old-game', '不能用原云端战绩 id 改写所属用户');
    await h.U.syncAll(h.R.getProfile());
    assert.equal(h.db.tables.splendor_records.length, 1);
    assert.equal(h.db.tables.splendor_records[0].uid, 'wx:player-a');
    await h.U.loginWithWechat();
    assert.equal(h.control.loginCalls, 1, '已验证的同进程登录不重复取 code');
    h.U.stopHeartbeat();
  });

  await check('换设备仍关联同一微信用户，先恢复云端资料再同步', async function () {
    const db = database();
    db.tables.splendor_players.push({ uid: 'wx:player-a', nickname: '云端伯爵', avatar: 'a5', avatar_url: 'data:image/jpeg;base64,AAA' });
    db.tables.splendor_records.push({ id: 'cloud-game', uid: 'wx:player-a', score: 17, rank: 1, win: true, player_count: 3, played_at: new Date().toISOString() });
    const h = setup({ database: db });
    assert.equal((await h.U.loginWithWechat()).ok, true);
    assert.equal(h.R.getProfile().nickname, '云端伯爵');
    assert.equal(h.R.getProfile().avatarData, 'data:image/jpeg;base64,AAA');
    await h.U.syncAll(h.R.getProfile());
    assert.equal(h.U.getRecords()[0].id, 'cloud-game');
    assert.equal(db.tables.splendor_players[0].nickname, '云端伯爵', '默认资料不能覆盖云端资料');
  });

  await check('切换微信账号不串战绩、不继承旧房间，切回原账号可恢复', async function () {
    const h = setup();
    await h.U.loginWithWechat();
    h.R.saveProfile({ nickname: '甲' });
    h.U.addRecord({ id: 'a-game', score: 16, win: true });
    h.R.saveSession({ code: 'ABC123', seat: 0 });
    h.control.uid = 'wx:player-b';
    assert.equal((await h.U.loginWithWechat({ force: true })).ok, true);
    assert.equal(h.U.getRecords().length, 0, '另一个微信账号不能继承前一微信账号战绩');
    assert.equal(h.R.getSession(), null);
    h.U.addRecord({ id: 'b-game', score: 7 });
    h.control.uid = 'wx:player-a';
    await h.U.loginWithWechat({ force: true });
    assert.equal(h.R.getProfile().nickname, '甲');
    assert.equal(h.U.getRecords().length, 1);
    assert.equal(h.U.getRecords()[0].id, 'a-game');
  });

  await check('旧缓存、微信头像和失效会话都不构成认证凭证', async function () {
    const h = setup();
    h.R.saveProfile({ isWechat: true });
    assert.equal(h.U.getIdentity().authenticated, false);
    await h.U.loginWithWechat();
    h.control.events('SIGNED_OUT', null);
    assert.equal(h.R.hasCloud(), false);
    assert.equal(h.U.getIdentity().authenticated, false);
    assert.equal((await h.U.syncProfile()).offline, true);
    // 模拟冷启动：保留账号缓存，但不得据此放开云端业务。
    const cold = setup({ storage: h.storage, database: h.db });
    assert.equal(cold.R.getProfile().uid, 'wx:player-a');
    assert.equal(cold.U.getIdentity().mode, 'wechat');
    assert.equal(cold.U.getIdentity().authenticated, false);
    assert.equal(cold.R.hasCloud(), false);
    assert.equal((await cold.U.loginWithWechat()).ok, true);
    assert.equal(cold.control.loginCalls, 1);
  });

  await check('网络失败 / 非微信会话 / 云资料失败不会切换账号或误报成功', async function () {
    for (const bad of [
      { exchange: async function () { throw new Error('network down'); } },
      { exchange: async function () { return { error: { message: 'wechat disabled' } }; } },
      { exchange: async function () { return { data: { accessToken: 'test', user: { id: 'other-user', isAnonymous: false } } }; } },
      { exchange: async function () { return { data: { accessToken: 'test', user: { id: 'wx:anonymous', isAnonymous: true } } }; } }
    ]) {
      const h = setup(bad);
      const uid = h.R.getProfile().uid;
      assert.equal((await h.U.loginWithWechat()).ok, false);
      assert.equal(h.R.getProfile().uid, uid);
      assert.equal(h.R.hasCloud(), false);
      assert.equal(h.control.exchanges.length, 1, '未知换票结果不自动重发一次性 code');
    }
    const h = setup();
    h.db.meta.profileError = true;
    const uid = h.R.getProfile().uid;
    assert.equal((await h.U.loginWithWechat()).ok, false);
    assert.equal(h.R.getProfile().uid, uid);
    assert.equal(h.R.hasCloud(), false);
    h.db.meta.profileError = false;
    assert.equal((await h.U.loginWithWechat()).ok, true, '重试应能恢复');
    assert.equal(h.control.exchanges[1].code, 'one-use-code-2', '重试重新取 code');
  });

  await check('账号切换期间会话失效，迟到的回调不得开放云端或覆盖 active profile', async function () {
    const h = setup();
    let release;
    h.db.meta.deferProfile = function (result) { return new Promise(function (resolve) { release = function () { resolve(result); }; }); };
    const uid = h.R.getProfile().uid;
    const task = h.U.loginWithWechat();
    while (!release) await Promise.resolve();
    h.control.events('SIGNED_OUT', null);
    release();
    assert.equal((await task).ok, false);
    assert.equal(h.R.getProfile().uid, uid);
    assert.equal(h.R.hasCloud(), false);
  });

  await check('登录等待期间新增的本机资料与战绩纳入绑定，不用过期快照覆盖', async function () {
    const h = setup();
    let release;
    h.db.meta.deferProfile = function (result) { return new Promise(function (resolve) { release = function () { resolve(result); }; }); };
    const task = h.U.loginWithWechat();
    while (!release) await Promise.resolve();
    h.R.saveProfile({ nickname: '刚修改的昵称' });
    h.U.addRecord({ id: 'during-login', score: 18 });
    release();
    assert.equal((await task).ok, true);
    assert.equal(h.R.getProfile().nickname, '刚修改的昵称');
    assert.equal(h.U.getRecords().length, 1);
    assert.equal(h.U.getRecords()[0].score, 18);
  });

  await check('账号切换落盘失败可恢复，备份与分区防止战绩丢失或串号', async function () {
    for (const key of ['splendor.profile.v1', 'splendor.identity.v1']) {
      const h = setup();
      h.U.ensureIdentity();
      h.U.addRecord({ id: 'keep-game', score: 9 });
      h.R.saveSession({ code: 'ABC123', seat: 0 });
      const write = h.api.setStorageSync;
      h.api.setStorageSync = function (k, value) {
        if (k === key) throw new Error('storage full');
        write(k, value);
      };
      assert.equal((await h.U.loginWithWechat()).ok, false);
      assert.equal(h.R.hasCloud(), false);
      assert.equal(h.U.getRecords().length, 1);
      assert.equal(h.U.getRecords()[0].score, 9);
      h.api.setStorageSync = write;
      assert.equal((await h.U.loginWithWechat()).ok, true);
      assert.equal(h.U.getRecords().length, 1, '重试不能重复导入');
      assert.equal(h.U.getRecords()[0].score, 9);
      assert.equal(h.R.getSession(), null, '遗留游客会话不能自动被微信账号接管');
    }
  });

  await check('旧账号迟到的战绩响应不会合并到新账号', async function () {
    const h = setup();
    await h.U.loginWithWechat();
    const original = h.db.from;
    let release;
    let delay = true;
    h.db.from = function (table) {
      const query = original(table);
      if (table === 'splendor_records' && delay) {
        delay = false;
        query.then = function (resolve) {
          release = function () { resolve({ data: [{ id: 'old-remote', uid: 'wx:player-a', score: 15 }], error: null }); };
        };
      }
      return query;
    };
    const oldRead = h.U.pullRecords('wx:player-a');
    while (!release) await Promise.resolve();
    h.control.uid = 'wx:player-b';
    await h.U.loginWithWechat({ force: true });
    release();
    assert.equal((await oldRead).stale, true);
    assert.equal(h.U.getRecords().length, 0);
  });

  await check('内置 SDK 与诊断 wx 适配器按真实换票契约传递 code 与 AppID', async function () {
    const h = setup();
    const requests = [];
    h.api.request = function (options) {
      requests.push(options);
      options.success({ statusCode: 200, header: { 'content-type': 'application/json' }, data: {
        access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600, sub: 'wx:sdk-user'
      } });
      return { abort: function () {} };
    };
    const sdk = require('../utils/vendor/workbuddy-cloud-sdk.js');
    const diagnostic = require('../utils/workbuddy-cloud-diagnostics.js');
    const client = sdk.createMiniProgramWorkBuddyCloud({
      endpoint: 'https://example.invalid', publishableKey: 'wbpk_test', wx: diagnostic.createDiagnosticWx(h.api)
    });
    h.R.attachCloud(client, { requireWechatLogin: true });
    const result = await h.W.signIn();
    assert.equal(result.ok, true);
    assert.equal(result.uid, 'wx:sdk-user');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://example.invalid/.cloud/auth/v1/login-wechat');
    const body = typeof requests[0].data === 'string' ? JSON.parse(requests[0].data) : requests[0].data;
    assert.deepEqual(body, { code: 'one-use-code-1', appid: 'wx1234567890abcdef' });
    assert.equal(h.R.hasCloud(), false, 'SDK 已登录但业务账号还未对齐，仍不能写业务数据');
  });

  await check('分享邀请等待微信登录，重复生命周期不重复换票或用游客 uid 入席', async function () {
    const h = setup();
    let page;
    global.Page = function (config) { page = config; };
    delete require.cache[require.resolve('../pages/index/index.js')];
    require('../pages/index/index.js');
    page.setData = function (patch) { Object.assign(page.data, patch); };
    const joins = [];
    h.R.cloudJoinRoom = async function (code, profile) {
      joins.push({ code: code, uid: profile.uid, ready: h.R.hasCloud() });
      return { ok: false, error: '云端未找到该房间' };
    };
    page.onLoad({ room: 'ABC123' });
    page.onShow();
    assert.equal(joins.length, 0);
    await page._identityTask;
    assert.equal(h.control.exchanges.length, 1);
    assert.deepEqual(joins, [{ code: 'ABC123', uid: 'wx:player-a', ready: true }]);
    page.onUnload();
    delete global.Page;
  });

  await check('尚无正式 AppID 时人机局切回前台仍可恢复 AI，登录不会伪装成功', async function () {
    const h = setup({ appId: 'touristappid' });
    let page;
    global.Page = function (config) { page = config; };
    delete require.cache[require.resolve('../pages/index/index.js')];
    require('../pages/index/index.js');
    page.setData = function (patch) { Object.assign(page.data, patch); };
    page.onLoad();
    await page._identityTask;
    page.onStartSolo();
    page.state.current = 1;
    page.onHide();
    page.onShow();
    assert.ok(page._aiTimer, '未配置微信登录不能阻断离线 AI 恢复');
    assert.equal(h.R.hasCloud(), false);
    page.onUnload();
    delete global.Page;
  });

  delete global.wx;
  console.log('ALL WECHAT LOGIN CHECKS PASSED');
}

run().catch(function (error) { console.error(error); process.exit(1); });
