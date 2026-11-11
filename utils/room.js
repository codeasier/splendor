'use strict';

/**
 * 房间 / 席位 / 玩家资料适配层
 * ------------------------------------------------------------------
 * 本轮云服务开通被取消（平台返回 useLocalImplementation），因此这里提供
 * 「本地适配器」。它与未来的云端实现共用同一份接口契约：
 *
 *   createRoom({ playerCount, seats, profile })  -> room
 *   joinRoom(code, profile)                      -> { ok, room, error }
 *   getRoom()                                   -> room | null
 *   updateSeat(index, patch)                    -> room
 *   getProfile()                               -> profile
 *   saveProfile(patch)                          -> profile
 *   shareMessage(room, profile)                 -> { title, path, desc }
 *   clear()                                     -> void
 *
 * 云端版只需保持这些签名，把 storage 换成 cloud.database / cloud.storage，
 * 在 joinRoom 后订阅牌局快照，并在 createRoom 时用 cloud.auth 会话 uid
 * 替换本地 uid；页面层与规则引擎不用改一行。
 *
 * ⚠️ 边界：本地实现无法跨设备同步。分享卡片只能把「房间号」带给好友，
 * 好友需要同一台设备才能读到房间；真正的多人联机必须启用云端实现。
 * 页面已把这一边界如实展示给用户，不伪装为已联机。
 *
 * room = {
 *   code, playerCount, hostUid, createdAt, status: 'lobby'|'playing'|'ended',
 *   seats: [{ index, uid, name, nickname, avatar, isAI, type, joined }]
 * }
 * profile = { uid, nickname, avatar, isWechat }
 */

const ROOM_KEY = 'splendor.room.v1';
const PROFILE_KEY = 'splendor.profile.v1';
/* 断线重连会话：房间号 + 席位 + 所在界面。小程序被杀、切后台回来、
 * 网络断开重试时都靠它回到原座位，不用再扫一次分享卡片。 */
const SESSION_KEY = 'splendor.session.v1';

/* 进程内共享存储：必须是模块级单例，否则每次 backend() 都新建对象，
 * Node 测试下 saveProfile() 写入的数据在下一次 getProfile() 中读不到。 */
const memStore = {};

/* 可注入的存储：小程序用 wx.*，H5 预览用 localStorage，Node 测试用内存 */
function backend() {
  if (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function' &&
      typeof wx.setStorageSync === 'function') return wx;
  if (typeof localStorage !== 'undefined' && localStorage &&
      typeof localStorage.getItem === 'function' && typeof localStorage.setItem === 'function' &&
      typeof localStorage.removeItem === 'function') {
    return {
      getStorageSync: function (k) { return localStorage.getItem(k); },
      setStorageSync: function (k, v) { localStorage.setItem(k, v); },
      removeStorageSync: function (k) { localStorage.removeItem(k); }
    };
  }
  return {
    getStorageSync: function (k) { return Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : ''; },
    setStorageSync: function (k, v) { memStore[k] = v; },
    removeStorageSync: function (k) { delete memStore[k]; }
  };
}

function readJSON(store, key) {
  try {
    const raw = store.getStorageSync(key);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) { return null; }
}

function writeJSON(store, key, value) {
  try { store.setStorageSync(key, JSON.stringify(value)); } catch (e) { /* 存储不可用时降级为内存态 */ }
}

function uid() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function roomCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

const PRESET_AVATARS = [
  { key: 'a0', name: '琥珀商贾', hue: '#c98a4b' },
  { key: 'a1', name: '翡翠伯爵', hue: '#4f9a72' },
  { key: 'a2', name: '蓝玉学者', hue: '#5b7fc4' },
  { key: 'a3', name: '红玉骑士', hue: '#b34f55' },
  { key: 'a4', name: '白玉夫人', hue: '#c9c2b4' },
  { key: 'a5', name: '黑曜工匠', hue: '#4a4550' },
  { key: 'a6', name: '鎏金船长', hue: '#c9a54b' },
  { key: 'a7', name: '紫晶使节', hue: '#8a6bb0' }
];

/* 回合计时：0 表示不限时。存进房间行，开局时随快照下发。
   10 / 30 秒是快棋档；按秒数升序排列，设置行跟时钟读法一致。 */
const TURN_LIMITS = [
  { value: 10, label: '10 秒' },
  { value: 30, label: '30 秒' },
  { value: 60, label: '60 秒' },
  { value: 90, label: '90 秒' },
  { value: 120, label: '120 秒' },
  { value: 0, label: '不限时' }
];

function normTurnLimit(v) {
  const n = Number(v) || 0;
  for (let i = 0; i < TURN_LIMITS.length; i++) if (TURN_LIMITS[i].value === n) return n;
  return 0;
}

function defaultProfile() {
  return {
    uid: uid(),
    nickname: '珠宝商',
    avatar: 'a0',
    // 本机文件路径，只给自己看
    avatarUrl: '',
    // 压到 120px 的 data URI，随资料上云，别人的设备靠它显示
    avatarData: '',
    isWechat: false,
    // 是否被用户主动改过：false 时入席要引导取昵称，否则同一房间会撞成一片「珠宝商」
    customized: false,
    // 账号建立时间：个人中心展示「入会时间」，战绩统计按它算平均值
    createdAt: Date.now()
  };
}

function getProfile() {
  const store = backend();
  const p = readJSON(store, PROFILE_KEY);
  if (!p || !p.uid) {
    const fresh = defaultProfile();
    writeJSON(store, PROFILE_KEY, fresh);
    return fresh;
  }
  // 老版本存档没有 createdAt：补一次，避免个人中心显示空值
  if (!p.createdAt) {
    p.createdAt = Date.now();
    writeJSON(store, PROFILE_KEY, p);
  }
  return p;
}

function saveProfile(patch) {
  const store = backend();
  const current = getProfile();
  // 编辑昵称 / 头像不能切换账号。身份切换只由登录层在验明微信用户后执行。
  const next = Object.assign({}, current, patch || {}, { uid: current.uid });
  next.customized = true;
  writeJSON(store, PROFILE_KEY, next);
  return next;
}

/** 登录层切换已验证账号；写入失败必须上抛，不能显示一个没有落盘的绑定。 */
function replaceProfile(profile) {
  if (!profile || typeof profile.uid !== 'string' || !profile.uid) throw new Error('缺少账号 ID');
  backend().setStorageSync(PROFILE_KEY, JSON.stringify(profile));
  return profile;
}

/* ---------- 断线重连会话 ---------- */

/** 记录「我还在哪个房间的哪一席」，供冷启动 / 切回前台时重连 */
function saveSession(session) {
  if (!session || !session.code) return null;
  const next = {
    code: String(session.code).toUpperCase(),
    uid: getProfile().uid,
    seat: session.seat === undefined ? 0 : session.seat,
    screen: session.screen || 'room',
    at: session.at || Date.now()
  };
  writeJSON(backend(), SESSION_KEY, next);
  return next;
}

function getSession() {
  const s = readJSON(backend(), SESSION_KEY);
  if (!s || !s.code) return null;
  if (s.uid && s.uid !== getProfile().uid) return null;
  if (requireWechatLogin && !s.uid) return null;
  return s;
}

function clearSession() { backend().removeStorageSync(SESSION_KEY); }

function avatarName(avatar) {  for (let i = 0; i < PRESET_AVATARS.length; i++) {
    if (PRESET_AVATARS[i].key === avatar) return PRESET_AVATARS[i].name;
  }
  return '微信头像';
}

/**
 * 生成席位：0 号恒为房主，其余按 bots 数组决定真人空席或机器人。
 * ready 语义：房主创建房间即视为已就绪；机器人恒定就绪；真人入席后需自己点准备。
 */
function makeSeats(playerCount, bots, profile) {
  const seats = [];
  for (let i = 0; i < playerCount; i++) {
    const isAI = i > 0 ? !!bots[i] : false;
    seats.push({
      index: i,
      uid: i === 0 ? profile.uid : '',
      name: i === 0 ? profile.nickname : (isAI ? '机器人 ' + i : '等待加入'),
      nickname: i === 0 ? profile.nickname : '',
      avatar: i === 0 ? profile.avatar : (isAI ? PRESET_AVATARS[i % PRESET_AVATARS.length].key : ''),
      // 席位里不放头像图片：房间行每 1.2s 轮询一次，塞 data URI 会把同步流量放大十几倍。
      // 头像由 uid 单独查资料表补齐（见 utils/user.js 的 fetchProfiles）。
      avatarUrl: '',
      isAI: isAI,
      type: i === 0 ? 'self' : (isAI ? 'bot' : 'remote'),
      joined: i === 0 || isAI,
      ready: i === 0 || isAI
    });
  }
  return seats;
}

function createRoom(config) {
  const cfg = config || {};
  const store = backend();
  const profile = cfg.profile || getProfile();
  const playerCount = cfg.playerCount || 2;
  const room = {
    code: roomCode(),
    playerCount: playerCount,
    hostUid: profile.uid,
    createdAt: Date.now(),
    // 大厅态：等人入席 / 等准备；开局后由页面写入 playing
    status: cfg.status || 'lobby',
    // 回合计时（秒）：0 = 不限时。开局时随快照下发给所有设备
    turnLimit: normTurnLimit(cfg.turnLimit),
    backend: hasCloud() ? 'cloud' : 'local',
    seats: cfg.seats || makeSeats(playerCount, cfg.bots || {}, profile)
  };
  writeJSON(store, ROOM_KEY, room);
  return room;
}

function getRoom() { return readJSON(backend(), ROOM_KEY); }

function updateSeat(index, patch) {
  const room = getRoom();
  if (!room || !room.seats[index]) return room;
  room.seats[index] = Object.assign({}, room.seats[index], patch || {});
  writeJSON(backend(), ROOM_KEY, room);
  return room;
}

function joinRoom(code, profile) {
  const store = backend();
  const p = profile || getProfile();
  const normalized = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(normalized)) {
    return { ok: false, error: '房间号为 6 位字母数字' };
  }
  const room = readJSON(store, ROOM_KEY);
  if (!room || room.code !== normalized) {
    return { ok: false, error: '本机未找到该房间。跨设备加入需要开启云端房间同步。' };
  }
  let placed = false;
  for (let i = 1; i < room.seats.length && !placed; i++) {
    const s = room.seats[i];
    if (!s.joined && !s.isAI) {
      room.seats[i] = Object.assign({}, s, {
        uid: p.uid, name: p.nickname, nickname: p.nickname,
        avatar: p.avatar, avatarUrl: '',
        type: 'remote', joined: true
      });
      placed = true;
    }
  }
  if (!placed) return { ok: false, error: '房间没有空余真人席位' };
  writeJSON(store, ROOM_KEY, room);
  return { ok: true, room: room };
}

/** 微信分享卡片：带房间号，好友点击后由 app.onLaunch/onLoad 的 query 带入 */
function shareMessage(room, profile) {
  const p = profile || getProfile();
  const code = room ? room.code : '';
  return {
    title: '璀璨宝石 · ' + (room ? room.playerCount : 2) + ' 人牌局，等你入席',
    path: '/pages/index/index?room=' + code,
    desc: p.nickname + ' 邀请你加入房间 ' + code,
    imageUrl: ''
  };
}

function clear() { backend().removeStorageSync(ROOM_KEY); }

/* ==================================================================
 * 云端 RoomAdapter
 * ------------------------------------------------------------------
 * 与本文件上半部分的同步接口共用同一份契约：页面层不需要区分本地 / 云端，
 * 只调用 createRoom / getRoom / joinRoom 等同步方法拿到「本机镜像」，
 * 再把异步的 cloud* 方法用于跨设备同步。
 *
 * 数据模型（云数据库 PostgreSQL，表由 management 通道创建）：
 *   splendor_rooms(code PK, host_uid, player_count, seats jsonb, status, version, …)
 *   splendor_games(code PK → rooms, state jsonb, version, …)
 *
 * 房间是共享空间，房间号即邀请凭证；只存用户主动填写的昵称与头像 key，
 * 不存 openid / 手机号 / 任何敏感个人信息。写入用 version 做乐观锁 CAS，
 * 同一回合被两个客户端同时提交时，后提交者收到 conflict 并重新拉取快照。
 *
 * ⚠️ H5 预览与 Node 测试不注入 client：所有 cloud* 方法返回 offline，
 * 不发起任何网络请求，因此不会污染回归结果。
 * ================================================================== */

const ROOM_TABLE = 'splendor_rooms';
const GAME_TABLE = 'splendor_games';

let cloudClient = null;
let requireWechatLogin = false;
// 仅为本次进程内验明的身份，不从 storage 恢复；持久化 uid 不是登录凭证。
let authenticatedUid = '';
// 云能力的三态：'preview' 未加载云模块（浏览器预览 / Node 测试）、
// 'ready' 客户端可用、'failed' 加载过云模块但初始化失败。
// 界面必须按此如实说明，不能把「初始化失败」和「预览环境」都说成「离线」。
let cloudMode = 'preview';
let cloudFailure = '';

/** 由 utils/cloud.js 在小程序启动时注入；H5 预览不注入 */
function attachCloud(client, options) {
  cloudClient = client && client.database ? client : null;
  requireWechatLogin = !!(options && options.requireWechatLogin);
  authenticatedUid = '';
  cloudMode = cloudClient ? 'ready' : 'failed';
  cloudFailure = cloudClient ? '' : (cloudFailure || '云客户端不可用');
  return !!cloudClient;
}

/** 云模块存在但初始化抛错：记录原因，界面据此提示「云服务未就绪」而非「离线」。 */
function attachCloudFailure(reason) {
  cloudClient = null;
  authenticatedUid = '';
  cloudMode = 'failed';
  cloudFailure = String(reason || '云服务初始化失败').slice(0, 120);
  return cloudMode;
}

function hasCloud() { return !!cloudClient && (!requireWechatLogin || !!authenticatedUid); }
function getCloud() { return cloudClient; }
function cloudStatus() {
  return {
    mode: cloudMode === 'ready' && requireWechatLogin && !authenticatedUid ? 'login-required' : cloudMode,
    reason: cloudFailure
  };
}
function requiresWechatLogin() { return requireWechatLogin; }
function setAuthenticatedUid(value) { authenticatedUid = value || ''; }
function getAuthenticatedUid() { return authenticatedUid; }

function offline(reason) {
  return { ok: false, offline: true, error: reason || (cloudClient && requireWechatLogin
    ? '请先完成微信登录' : '云端未连接，当前为本机房间') };
}
function errMsg(error) {
  if (!error) return '云端请求失败';
  return error.message || error.code || '云端请求失败';
}
function nowIso() { return new Date().toISOString(); }

/** 建房：先写房间，再写初始牌局快照（大厅阶段允许 state 为空），版本从 1 起 */
async function cloudCreateRoom(room, state) {
  if (!hasCloud()) return offline();
  try {
    const db = cloudClient.database;
    const a = await db.from(ROOM_TABLE).upsert({
      code: room.code,
      host_uid: room.hostUid,
      player_count: room.playerCount,
      turn_limit: normTurnLimit(room.turnLimit),
      seats: room.seats,
      status: room.status || 'lobby',
      version: 1,
      updated_at: nowIso()
    });
    if (a.error) return { ok: false, error: errMsg(a.error) };
    if (state) {
      const b = await db.from(GAME_TABLE).upsert({
        code: room.code, state: state, version: 1, updated_at: nowIso()
      });
      if (b.error) return { ok: false, error: errMsg(b.error) };
    }
    return { ok: true, version: 1 };
  } catch (e) {
    return { ok: false, error: (e && e.message) || '网络异常，请重试' };
  }
}

/** 拉取房间（席位变化：好友加入 / 房主切换机器人） */
async function cloudPullRoom(code) {
  if (!hasCloud()) return offline();
  try {
    const res = await cloudClient.database.from(ROOM_TABLE)
      .select('*').eq('code', code).maybeSingle();
    if (res.error) return { ok: false, error: errMsg(res.error) };
    if (!res.data) return { ok: false, error: '云端未找到该房间' };
    const row = res.data;
    return {
      ok: true,
      version: row.version,
      room: {
        code: row.code,
        playerCount: row.player_count,
        hostUid: row.host_uid,
        status: row.status,
        turnLimit: normTurnLimit(row.turn_limit),
        backend: 'cloud',
        createdAt: Date.now(),
        seats: row.seats || []
      }
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) || '网络异常，请重试' };
  }
}

/** 拉取牌局快照；页面只在 version 变化时替换本地 state */
async function cloudPullGame(code) {
  if (!hasCloud()) return offline();
  try {
    const res = await cloudClient.database.from(GAME_TABLE)
      .select('state, version').eq('code', code).maybeSingle();
    if (res.error) return { ok: false, error: errMsg(res.error) };
    if (!res.data) return { ok: false, error: '云端牌局不存在' };
    return { ok: true, state: res.data.state, version: res.data.version };
  } catch (e) {
    return { ok: false, error: (e && e.message) || '网络异常，请重试' };
  }
}

/** 提交一步动作；expectedVersion 不匹配说明别人先手，调用方应重新拉取 */
async function cloudPushState(code, state, expectedVersion) {
  if (!hasCloud()) return offline();
  const next = (expectedVersion || 0) + 1;
  try {
    const res = await cloudClient.database.from(GAME_TABLE)
      .update({ state: state, version: next, updated_at: nowIso() })
      .eq('code', code).eq('version', expectedVersion).select('version');
    if (res.error) return { ok: false, error: errMsg(res.error) };
    if (!res.data || !res.data.length) {
      return { ok: false, conflict: true, error: '牌局已被其他玩家更新' };
    }
    return { ok: true, version: next };
  } catch (e) {
    return { ok: false, error: (e && e.message) || '网络异常，请重试' };
  }
}

/** CAS 更新席位（好友加入 / 机器人开关） */
async function cloudUpdateSeats(code, seats, expectedVersion) {
  if (!hasCloud()) return offline();
  const next = (expectedVersion || 0) + 1;
  try {
    const res = await cloudClient.database.from(ROOM_TABLE)
      .update({ seats: seats, version: next, updated_at: nowIso() })
      .eq('code', code).eq('version', expectedVersion).select('version');
    if (res.error) return { ok: false, error: errMsg(res.error) };
    if (!res.data || !res.data.length) {
      return { ok: false, conflict: true, error: '房间席位刚被其他人更新，请重试' };
    }
    return { ok: true, version: next };
  } catch (e) {
    return { ok: false, error: (e && e.message) || '网络异常，请重试' };
  }
}

/** CAS 更新任意房间字段（人数 / 席位 / 状态），用于大厅准备与开局 */
async function cloudUpdateRoom(code, patch, expectedVersion) {
  if (!hasCloud()) return offline();
  const next = (expectedVersion || 0) + 1;
  const row = Object.assign({}, patch || {}, { version: next, updated_at: nowIso() });
  try {
    const res = await cloudClient.database.from(ROOM_TABLE)
      .update(row)
      .eq('code', code).eq('version', expectedVersion).select('version');
    if (res.error) return { ok: false, error: errMsg(res.error) };
    if (!res.data || !res.data.length) {
      return { ok: false, conflict: true, error: '房间刚被其他玩家更新，请重试' };
    }
    return { ok: true, version: next };
  } catch (e) {
    return { ok: false, error: (e && e.message) || '网络异常，请重试' };
  }
}

/**
 * 更新单个席位（准备 / 机器人开关）。内部先拉最新版本再 CAS，
 * 冲突时重试一次——准备状态是高频小写入，不能因为别人刚好也在点就失败。
 */
async function cloudSetSeat(code, index, patch, attempt) {
  if (!hasCloud()) return offline();
  const tryNo = attempt || 0;
  const pulled = await cloudPullRoom(code);
  if (!pulled.ok) return pulled;
  const seats = (pulled.room.seats || []).slice();
  if (!seats[index]) return { ok: false, error: '席位不存在' };
  seats[index] = Object.assign({}, seats[index], patch || {}, { index: index });
  const saved = await cloudUpdateSeats(code, seats, pulled.version);
  if (saved.conflict && tryNo < 2) return cloudSetSeat(code, index, patch, tryNo + 1);
  if (!saved.ok) return saved;
  return { ok: true, version: saved.version, seats: seats };
}

/**
 * 房主开局：同一个 CAS 里把房间置为 playing 并落席位，
 * 再把牌局快照写成 version=1（重开一局时版本归零，避免旧版本号干扰乐观锁）。
 */
async function cloudStartGame(code, state, expectedRoomVersion, seats) {
  if (!hasCloud()) return offline();
  const next = (expectedRoomVersion || 0) + 1;
  try {
    const upd = await cloudClient.database.from(ROOM_TABLE)
      .update({ status: 'playing', seats: seats, version: next, updated_at: nowIso() })
      .eq('code', code).eq('version', expectedRoomVersion).select('version');
    if (upd.error) return { ok: false, error: errMsg(upd.error) };
    if (!upd.data || !upd.data.length) {
      return { ok: false, conflict: true, error: '房间状态刚被更新，请重试' };
    }
    const g = await cloudClient.database.from(GAME_TABLE).upsert({
      code: code, state: state, version: 1, updated_at: nowIso()
    });
    if (g.error) return { ok: false, error: errMsg(g.error) };
    return { ok: true, version: next, gameVersion: 1 };
  } catch (e) {
    return { ok: false, error: (e && e.message) || '网络异常，请重试' };
  }
}

/**
 * 一局结束后回到大厅：清空准备状态，等房主再次开始。
 * 同时把牌局快照写成 { lobby: true }，其他设备轮询到该标记就切回大厅，
 * 否则它们会一直停在已结束的牌桌上等不到重开。
 */
async function cloudResetRoom(code, seats, expectedVersion) {
  const res = await cloudUpdateRoom(code, { status: 'lobby', seats: seats }, expectedVersion);
  if (!res.ok || !hasCloud()) return res;
  try {
    await cloudClient.database.from(GAME_TABLE).upsert({
      code: code, state: { lobby: true }, version: 0, updated_at: nowIso()
    });
  } catch (e) { /* 标记失败不影响回大厅，下一轮开始会覆盖快照 */ }
  return res;
}

/** 好友通过分享卡片带房间号入席，返回本机的席位号与最新牌局快照 */
async function cloudJoinRoom(code, profile) {
  if (!hasCloud()) return offline(cloudClient && requireWechatLogin ? '请先完成微信登录后加入房间' : cloudMode === 'failed'
    ? '云服务未就绪，暂时无法跨设备加入房间'
    : '跨设备加入需要云端房间；当前为浏览器预览 / 本机房间');
  const normalized = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(normalized)) {
    return { ok: false, error: '房间号为 6 位字母数字' };
  }
  const p = profile || getProfile();
  if (requireWechatLogin && p.uid !== authenticatedUid) return { ok: false, error: '账号已切换，请重新加入房间' };
  try {
    const pulled = await cloudPullRoom(normalized);
    if (!pulled.ok) return { ok: false, error: pulled.error === '云端未找到该房间'
      ? '云端未找到该房间，请确认房间号' : pulled.error };

    const seats = (pulled.room.seats || []).slice();
    const status = pulled.room.status || 'lobby';
    if (status === 'ended') {
      return { ok: false, error: '房间已结束，请让房主重新建房' };
    }
    let slot = -1;
    // 房主重连：0 号席恒为房主，按 uid 认回，否则房主被杀进程后回不来
    if (seats[0] && seats[0].uid === p.uid) slot = 0;
    // 同一设备重复进入时复用原席位，不占用新位置
    if (slot !== 0) {
      for (let i = 1; i < seats.length; i += 1) {
        if (seats[i] && seats[i].uid === p.uid && !seats[i].isAI) { slot = i; break; }
      }
    }
    const mine = slot >= 0;
    if (slot < 0) {
      // 开局后不再接受新玩家入席，避免牌局快照里的席位与实际人数不一致
      if (status === 'playing') {
        return { ok: false, error: '牌局已经开始，等房主结束后再加入' };
      }
      for (let i = 1; i < seats.length; i += 1) {
        if (seats[i] && !seats[i].joined && !seats[i].isAI) { slot = i; break; }
      }
    }
    if (slot < 0) return { ok: false, error: '房间没有空余真人席位' };

    let roomVersion = pulled.version;
    if (!mine) {
      seats[slot] = Object.assign({}, seats[slot], {
        index: slot,
        uid: p.uid,
        name: p.nickname,
        nickname: p.nickname,
        avatar: p.avatar,
        avatarUrl: p.avatarUrl || '',
        type: 'remote',
        joined: true,
        ready: false
      });
      const saved = await cloudUpdateSeats(normalized, seats, pulled.version);
      if (!saved.ok) return saved;
      roomVersion = saved.version;
    }

    let state = null;
    let gameVersion = 0;
    if (status === 'playing') {
      const game = await cloudPullGame(normalized);
      if (!game.ok) return { ok: false, error: game.error };
      state = game.state;
      gameVersion = game.version;
    }

    return {
      ok: true,
      seat: slot,
      status: status,
      room: Object.assign({}, pulled.room, { seats: seats, status: status, version: roomVersion }),
      state: state,
      version: gameVersion
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) || '网络异常，请重试' };
  }
}

module.exports = {
  PRESET_AVATARS: PRESET_AVATARS,
  TURN_LIMITS: TURN_LIMITS,
  normTurnLimit: normTurnLimit,
  avatarName: avatarName,
  defaultProfile: defaultProfile,
  getProfile: getProfile,
  saveProfile: saveProfile,
  replaceProfile: replaceProfile,
  // 供 utils/user.js 复用同一套存储后端（wx / localStorage / Node 内存）
  storageBackend: backend,
  makeSeats: makeSeats,
  createRoom: createRoom,
  getRoom: getRoom,
  updateSeat: updateSeat,
  joinRoom: joinRoom,
  shareMessage: shareMessage,
  roomCode: roomCode,
  clear: clear,
  saveSession: saveSession,
  getSession: getSession,
  clearSession: clearSession,

  attachCloud: attachCloud,
  attachCloudFailure: attachCloudFailure,
  cloudStatus: cloudStatus,
  hasCloud: hasCloud,
  getCloud: getCloud,
  requiresWechatLogin: requiresWechatLogin,
  setAuthenticatedUid: setAuthenticatedUid,
  getAuthenticatedUid: getAuthenticatedUid,
  ROOM_TABLE: ROOM_TABLE,
  GAME_TABLE: GAME_TABLE,
  cloudCreateRoom: cloudCreateRoom,
  cloudPullRoom: cloudPullRoom,
  cloudPullGame: cloudPullGame,
  cloudPushState: cloudPushState,
  cloudUpdateSeats: cloudUpdateSeats,
  cloudUpdateRoom: cloudUpdateRoom,
  cloudSetSeat: cloudSetSeat,
  cloudStartGame: cloudStartGame,
  cloudResetRoom: cloudResetRoom,
  cloudJoinRoom: cloudJoinRoom
};
