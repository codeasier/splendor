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

/* 进程内共享存储：必须是模块级单例，否则每次 backend() 都新建对象，
 * Node 测试下 saveProfile() 写入的数据在下一次 getProfile() 中读不到。 */
const memStore = {};

/* 可注入的存储：小程序用 wx.*，H5 预览用 localStorage，Node 测试用内存 */
function backend() {
  if (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function' &&
      typeof wx.setStorageSync === 'function') return wx;
  if (typeof localStorage !== 'undefined' && localStorage) {
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

function defaultProfile() {
  return {
    uid: uid(),
    nickname: '珠宝商',
    avatar: 'a0',
    avatarUrl: '',
    isWechat: false
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
  return p;
}

function saveProfile(patch) {
  const store = backend();
  const next = Object.assign({}, getProfile(), patch || {});
  if (!next.uid) next.uid = uid();
  writeJSON(store, PROFILE_KEY, next);
  return next;
}

function avatarName(avatar) {
  for (let i = 0; i < PRESET_AVATARS.length; i++) {
    if (PRESET_AVATARS[i].key === avatar) return PRESET_AVATARS[i].name;
  }
  return '微信头像';
}

/** 生成席位：0 号恒为本机玩家，其余按 bots 数组决定真人空席或机器人 */
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
      avatarUrl: i === 0 ? (profile.avatarUrl || '') : '',
      isAI: isAI,
      type: i === 0 ? 'self' : (isAI ? 'bot' : 'remote'),
      joined: i === 0 || isAI
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
    status: 'playing',
    backend: 'local',
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
        avatar: p.avatar, avatarUrl: p.avatarUrl || '',
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

module.exports = {
  PRESET_AVATARS: PRESET_AVATARS,
  avatarName: avatarName,
  defaultProfile: defaultProfile,
  getProfile: getProfile,
  saveProfile: saveProfile,
  makeSeats: makeSeats,
  createRoom: createRoom,
  getRoom: getRoom,
  updateSeat: updateSeat,
  joinRoom: joinRoom,
  shareMessage: shareMessage,
  roomCode: roomCode,
  clear: clear
};
