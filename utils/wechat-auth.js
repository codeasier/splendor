'use strict';

/** 微信 code 仅经现有 SDK 交给云端换票；AppSecret / session_key 不进入应用。 */
const R = require('./room.js');

let state = { phase: 'idle', uid: '', appId: '', error: '' };
let pending = null;
let watchedClient = null;
let unsubscribe = null;
let generation = 0;

function environment() {
  const api = typeof wx !== 'undefined' ? wx : null;
  if (!api || typeof api.login !== 'function') {
    return { error: '浏览器预览不支持微信登录，请在微信小程序中打开', phase: 'preview' };
  }
  let appId = '';
  try { appId = api.getAccountInfoSync().miniProgram.appId; } catch (e) { /* 未配置 */ }
  if (typeof appId !== 'string' || !/^wx[0-9a-f]{16}$/i.test(appId)) {
    return { error: '尚未配置正式微信 AppID，请先完成小程序与云端绑定', phase: 'unconfigured' };
  }
  const client = R.getCloud();
  if (!client || !client.auth || typeof client.auth.signInWithWechat !== 'function') {
    return { error: '云服务未就绪，暂时无法微信登录', phase: 'unavailable', appId: appId };
  }
  return { api: api, client: client, appId: appId };
}

function status() {
  const env = environment();
  const authenticated = !env.error && state.uid && state.appId === env.appId &&
    R.getAuthenticatedUid() === state.uid && watchedClient === env.client;
  return {
    phase: env.error ? env.phase : (authenticated ? 'authenticated' : state.phase),
    authenticated: !!authenticated,
    uid: authenticated ? state.uid : '',
    canLogin: !env.error && !pending,
    busy: !!pending,
    error: env.error || state.error || '',
    appId: env.appId || ''
  };
}

function fail(message) {
  R.setAuthenticatedUid('');
  state = { phase: 'failed', uid: '', appId: '', error: message || '微信登录失败，请重试' };
  return { ok: false, error: state.error };
}

function watch(client) {
  if (watchedClient === client) return;
  if (unsubscribe) unsubscribe();
  watchedClient = client;
  unsubscribe = null;
  if (typeof client.auth.onAuthStateChange !== 'function') return;
  unsubscribe = client.auth.onAuthStateChange(function (event, session) {
    if (event === 'SIGNED_OUT' || (state.uid && session && session.user && session.user.id !== state.uid)) {
      generation += 1;
      fail('微信登录已失效，请重新登录');
    }
  });
}

function loginCode(api) {
  return new Promise(function (resolve, reject) {
    let done = false;
    let timer = null;
    function finish(error, code) {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (error) reject(new Error(error));
      else resolve(code);
    }
    timer = setTimeout(function () { finish('微信登录超时，请重试'); }, 12000);
    try {
      api.login({
        timeout: 10000,
        success: function (res) {
          if (!res || typeof res.code !== 'string' || !res.code.trim()) finish('微信未返回登录凭证，请重试');
          else finish(null, res.code);
        },
        fail: function () { finish('无法获取微信登录凭证，请重试'); }
      });
    } catch (e) { finish('无法发起微信登录，请重试'); }
  });
}

/** 每次冷启动重新取得 wx.login code；同进程并发登录合流，凭证不自行重发。 */
function signIn(options) {
  if (pending) return pending;
  const env = environment();
  if (env.error) {
    R.setAuthenticatedUid('');
    state = { phase: env.phase, uid: '', appId: env.appId || '', error: env.error };
    return Promise.resolve({ ok: false, error: env.error });
  }
  if (!(options && options.force) && status().authenticated) {
    return Promise.resolve({ ok: true, uid: state.uid, appId: state.appId });
  }
  R.setAuthenticatedUid('');
  state = { phase: 'signing-in', uid: '', appId: env.appId, error: '' };
  watch(env.client);
  const attempt = ++generation;
  pending = (async function () {
    try {
      const code = await loginCode(env.api);
      const result = await env.client.auth.signInWithWechat(code, env.appId);
      if (!result || result.error) throw new Error((result && result.error && result.error.message) || '微信登录失败，请重试');
      const session = result.data;
      const user = session && session.user;
      // 本 SDK 的微信登录契约：sub 为 wx:<openid>。不接收客户端自报的 openid，
      // 也不把其它登录方式 / 匿名会话当成已绑定微信。
      if (!session || !session.accessToken || !user || user.isAnonymous !== false ||
          typeof user.id !== 'string' || !/^wx:[A-Za-z0-9_-]{1,29}$/.test(user.id)) {
        throw new Error('云端未返回有效的微信身份，请检查微信登录配置');
      }
      if (attempt !== generation || R.getCloud() !== env.client || environment().appId !== env.appId) {
        throw new Error('登录环境已变化，请重新登录');
      }
      state = { phase: 'verified', uid: user.id, appId: env.appId, error: '' };
      // 此时尚未开放业务请求：用户层完成账号数据切换后才设置 authenticatedUid。
      return { ok: true, uid: user.id, appId: env.appId };
    } catch (e) {
      return fail((e && e.message) || '微信登录失败，请重试');
    } finally { pending = null; }
  })();
  return pending;
}

function activate(principal) {
  const env = environment();
  if (env.error || !principal || state.uid !== principal.uid || state.appId !== principal.appId ||
      env.appId !== principal.appId || watchedClient !== env.client) return false;
  R.setAuthenticatedUid(principal.uid);
  return true;
}

module.exports = { signIn: signIn, status: status, fail: fail, activate: activate };
