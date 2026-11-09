'use strict';

/**
 * 用户系统 —— 身份 / 资料云端持久化 / 战绩。
 *
 * 为什么单独一层而不塞进 room.js：
 *   room.js 是「房间与席位」适配层，页面在牌桌阶段高频调用它；
 *   账号与战绩属于跨房间的生命周期数据，混进去会让房间层同时承担两件事。
 *   这里通过 R.storageBackend() 复用同一套存储后端（wx / localStorage / Node 内存），
 *   并通过 R.getCloud() 复用已注入的云客户端，不重复初始化 SDK。
 *
 * 身份现状（务必知情）：
 *   当前项目仍是 touristappid，没有正式 AppID 与后端，wx.login 换不到 openid。
 *   因此身份是「本机账号」——uid 在首次启动时生成并落本机 storage，
 *   清缓存 / 换设备会变成新账号。这不是缺陷被隐藏：个人中心会如实显示
 *   「本机账号 · 未绑定微信」，并给出账号 ID 供对照。
 *   接上正式 AppID 后，只需在 ensureIdentity() 里用 openid 覆盖 uid，
 *   战绩与资料表都按 uid 关联，上层界面无需改动。
 *
 * 数据表：
 *   splendor_players(uid pk, nickname, avatar, avatar_url, stats jsonb, updated_at)
 *   splendor_records(id pk, uid, mode, player_count, rank, score, win, room_code, played_at)
 */

const R = require('./room.js');

const IDENTITY_KEY = 'splendor.identity.v1';
const RECORDS_KEY = 'splendor.records.v1';
const PLAYER_TABLE = 'splendor_players';
const RECORD_TABLE = 'splendor_records';
const MAX_RECORDS = 60;

/* 对局模式：当前只开放标准模式；其余仅作展示，不伪装成可选 */
const MODES = [
  { key: 'standard', name: '标准模式', desc: '基础规则 · 先达 15 声望获胜', available: true },
  { key: 'draft', name: '轮抽模式', desc: '牌库轮抽组牌 · 筹备中', available: false },
  { key: 'team', name: '双人协作', desc: '两人一队共享声望 · 筹备中', available: false }
];

/* 称号按累计对局数递进；胜率不参与，避免前期一局定终身 */
const RANKS = [
  { min: 0, title: '行会新人' },
  { min: 1, title: '珠宝学徒' },
  { min: 5, title: '商行管事' },
  { min: 12, title: '宝石鉴赏家' },
  { min: 25, title: '行会执事' },
  { min: 50, title: '皇家珠宝商' }
];

function store() { return R.storageBackend(); }

function readJSON(key) {
  try {
    const raw = store().getStorageSync(key);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) { return null; }
}

function writeJSON(key, value) {
  try { store().setStorageSync(key, JSON.stringify(value)); } catch (e) { /* 存储不可用则退化为内存态 */ }
}

function nowIso(ts) { return new Date(ts || Date.now()).toISOString(); }

function pad(n) { return n < 10 ? '0' + n : String(n); }

function shortId(uid) {
  const s = String(uid || '');
  if (s.length <= 10) return s;
  return s.slice(0, 5) + '…' + s.slice(-4);
}

/* ---------- 身份 ---------- */

/**
 * 身份卡：{ uid, mode, since, version }
 * mode 目前恒为 'guest'；接上正式 AppID 后由 wx.login 换成 'wechat'。
 */
function ensureIdentity() {
  let id = readJSON(IDENTITY_KEY);
  const profile = R.getProfile();
  if (id && id.uid && id.uid === profile.uid) return id;
  id = {
    uid: profile.uid,
    mode: 'guest',
    since: (profile && profile.createdAt) || Date.now(),
    version: 1
  };
  writeJSON(IDENTITY_KEY, id);
  return id;
}

function getIdentity() {
  const id = ensureIdentity();
  return {
    uid: id.uid,
    mode: id.mode,
    since: id.since,
    shortId: shortId(id.uid),
    // 界面文案集中在这里，避免 WXML 里拼字符串
    label: id.mode === 'wechat' ? '微信账号' : '本机账号',
    detail: id.mode === 'wechat'
      ? '已绑定微信身份，换设备登录可继续使用同一战绩'
      : '未绑定微信 · 清缓存或换设备会变成新账号',
    sinceText: formatDate(id.since || Date.now(), true)
  };
}

/* ---------- 模式 ---------- */

function listModes(activeKey) {
  const active = activeKey || 'standard';
  return MODES.map(function (m) {
    return {
      key: m.key,
      name: m.name,
      desc: m.desc,
      available: !!m.available,
      active: m.key === active,
      tag: m.available ? '已开放' : '筹备中'
    };
  });
}

function modeByKey(key) {
  for (let i = 0; i < MODES.length; i++) {
    if (MODES[i].key === key) return MODES[i];
  }
  return MODES[0];
}

/* ---------- 战绩 ---------- */

function getRecords() {
  const list = readJSON(RECORDS_KEY);
  if (!Array.isArray(list)) return [];
  return list.filter(function (r) { return r && r.id; });
}

function saveRecords(list) {
  writeJSON(RECORDS_KEY, (list || []).slice(0, MAX_RECORDS));
}

/**
 * 落一条战绩：本地先写（离线可看），云端异步补写（失败不影响本局结算）。
 * 调用方负责幂等——同一局只能调一次，否则结算弹层每次重绘都会多记一条。
 */
function addRecord(input, profile) {
  const src = input || {};
  const rec = {
    id: src.id || ('r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    uid: (profile && profile.uid) || '',
    mode: src.mode === 'room' ? 'room' : 'solo',
    modeLabel: src.modeLabel || '标准模式',
    playerCount: Math.min(4, Math.max(2, Number(src.playerCount) || 2)),
    rank: Math.max(1, Number(src.rank) || 1),
    score: Math.max(0, Number(src.score) || 0),
    win: !!src.win,
    tie: !!src.tie,
    turns: Math.max(0, Number(src.turns) || 0),
    at: Number(src.at) || Date.now(),
    roomCode: src.roomCode || '',
    opponents: (src.opponents || []).slice(0, 3)
  };
  const list = getRecords();
  list.push(rec);
  // 统一按时间倒序：连胜统计与「最近对局」都依赖顺序，不能只看写入先后
  list.sort(function (a, b) { return b.at - a.at; });
  saveRecords(list);
  pushRecord(rec);
  return rec;
}

function clearRecords() {
  try { store().removeStorageSync(RECORDS_KEY); } catch (e) { /* ignore */ }
}

/** 汇总统计：界面顶部三格与战绩页总览都用它 */
function statsOf(list) {
  const rows = list || getRecords();
  const total = rows.length;
  let wins = 0;
  let best = 0;
  let sum = 0;
  let streak = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.win) wins += 1;
    if (r.score > best) best = r.score;
    sum += r.score;
    // 连胜只从最近一局往回数，遇到非胜即止
    if (i === streak && r.win) streak += 1;
  }
  return {
    total: total,
    wins: wins,
    losses: total - wins,
    winRate: total ? Math.round((wins / total) * 100) : 0,
    best: best,
    avgScore: total ? Math.round(sum / total) : 0,
    streak: streak,
    rankTitle: rankTitle(total)
  };
}

function rankTitle(total) {
  let title = RANKS[0].title;
  for (let i = 0; i < RANKS.length; i++) {
    if (total >= RANKS[i].min) title = RANKS[i].title;
  }
  return title;
}

function formatDate(ts, withYear) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const md = pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  return (withYear ? d.getFullYear() + '-' : '') + md + ' ' + hm;
}

/** 把一条战绩转成界面字段（时间 / 名次 / 结果标签） */
function recordVM(rec) {
  const r = rec || {};
  const modeText = (r.mode === 'room' ? '联机' : '人机') + ' · ' + (r.playerCount || 2) + ' 人';
  const result = r.tie ? '平' : (r.win ? '胜' : '负');
  return {
    id: r.id,
    dateText: formatDate(r.at),
    modeText: modeText,
    rankText: '第 ' + (r.rank || 1) + ' 名',
    scoreText: (r.score || 0) + ' 声望',
    resultText: result,
    resultClass: r.tie ? 'is-tie' : (r.win ? 'is-win' : 'is-lose'),
    opponentsText: (r.opponents || []).join(' · '),
    turnsText: r.turns ? r.turns + ' 回合' : ''
  };
}

function recordList(limit) {
  const rows = getRecords();
  const n = limit || rows.length;
  return rows.slice(0, n).map(recordVM);
}

/* ---------- 头像持久化 ---------- */

/**
 * chooseAvatar 返回的是临时路径，重启后会失效。
 * 复制到 USER_DATA_PATH 下才能真正「记住头像」；H5 预览与 Node 直接原样返回。
 */
function persistAvatar(tempPath, uid) {
  if (!tempPath) return '';
  if (typeof wx === 'undefined' || !wx.getFileSystemManager || !wx.env || !wx.env.USER_DATA_PATH) {
    return tempPath;
  }
  if (String(tempPath).indexOf(wx.env.USER_DATA_PATH) === 0) return tempPath;
  try {
    const fs = wx.getFileSystemManager();
    const dest = wx.env.USER_DATA_PATH + '/avatar-' + (uid || 'me') + '.jpg';
    try { fs.unlinkSync(dest); } catch (e) { /* 首次不存在 */ }
    fs.saveFileSync(tempPath, dest);
    return dest;
  } catch (e) {
    return tempPath;
  }
}

/* ---------- 云端：资料与战绩 ---------- */
function db() {
  const cloud = R.getCloud ? R.getCloud() : null;
  return cloud && cloud.database ? cloud.database : null;
}

function errText(e) {
  if (!e) return '未知错误';
  if (typeof e === 'string') return e;
  return e.message || e.error_description || String(e);
}

/** 资料上云：用 uid 做 upsert，重复保存不会产生重复账号 */
async function syncProfile(profile) {
  const database = db();
  if (!database) return { ok: false, offline: true };
  const p = profile || R.getProfile();
  if (!p || !p.uid) return { ok: false, error: '缺少账号 ID' };
  try {
    const res = await database.from(PLAYER_TABLE).upsert({
      uid: p.uid,
      nickname: p.nickname || '珠宝商',
      avatar: p.avatar || 'a0',
      avatar_url: p.avatarUrl || '',
      stats: statsOf(getRecords()),
      updated_at: nowIso()
    });
    if (res && res.error) return { ok: false, error: errText(res.error) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/** 战绩上云：失败静默，本地记录才是可读的那一份 */
async function pushRecord(rec) {
  const database = db();
  if (!database || !rec || !rec.id) return { ok: false, offline: true };
  try {
    const res = await database.from(RECORD_TABLE).upsert({
      id: rec.id,
      uid: rec.uid || '',
      mode: rec.mode,
      player_count: rec.playerCount,
      rank: rec.rank,
      score: rec.score,
      win: !!rec.win,
      room_code: rec.roomCode || '',
      played_at: nowIso(rec.at)
    });
    if (res && res.error) return { ok: false, error: errText(res.error) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

function rowToRecord(row) {
  return {
    id: row.id,
    uid: row.uid,
    mode: row.mode === 'room' ? 'room' : 'solo',
    modeLabel: '标准模式',
    playerCount: Number(row.player_count) || 2,
    rank: Number(row.rank) || 1,
    score: Number(row.score) || 0,
    win: !!row.win,
    tie: false,
    turns: 0,
    at: row.played_at ? new Date(row.played_at).getTime() : Date.now(),
    roomCode: row.room_code || '',
    opponents: []
  };
}

/** 拉云端战绩：按 id 去重后与本地合并，云端只补本地没有的条目 */
async function pullRecords(uid) {
  const database = db();
  if (!database || !uid) return { ok: false, offline: true, records: [] };
  try {
    const res = await database.from(RECORD_TABLE).select('*').eq('uid', uid);
    if (!res || res.error) return { ok: false, error: errText(res && res.error), records: [] };
    const rows = (res.data || []).map(rowToRecord);
    const local = getRecords();
    const seen = {};
    local.forEach(function (r) { seen[r.id] = true; });
    let added = 0;
    rows.forEach(function (r) {
      if (!seen[r.id]) { local.push(r); seen[r.id] = true; added += 1; }
    });
    local.sort(function (a, b) { return b.at - a.at; });
    saveRecords(local);
    return { ok: true, records: local, added: added };
  } catch (e) {
    return { ok: false, error: errText(e), records: [] };
  }
}

/** 登录态就绪后的同步入口：资料 + 战绩一次补齐 */
async function syncAll(profile) {
  const p = profile || R.getProfile();
  const identity = getIdentity();
  const pulled = await pullRecords(identity.uid);
  const pushed = await syncProfile(p);
  return { profile: pushed, records: pulled };
}

module.exports = {
  MODES: MODES,
  PLAYER_TABLE: PLAYER_TABLE,
  RECORD_TABLE: RECORD_TABLE,
  MAX_RECORDS: MAX_RECORDS,

  ensureIdentity: ensureIdentity,
  getIdentity: getIdentity,
  shortId: shortId,

  listModes: listModes,
  modeByKey: modeByKey,

  getRecords: getRecords,
  addRecord: addRecord,
  clearRecords: clearRecords,
  statsOf: statsOf,
  rankTitle: rankTitle,
  recordList: recordList,
  formatDate: formatDate,
  persistAvatar: persistAvatar,

  syncProfile: syncProfile,
  pushRecord: pushRecord,
  pullRecords: pullRecords,
  syncAll: syncAll
};
