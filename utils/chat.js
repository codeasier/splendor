'use strict';

/**
 * 局内快捷聊天：斗地主式预设短语 + 互动表情。
 *
 * 为什么不开放自由输入
 * ------------------------------------------------------------------
 * 审核合规要求「用户可发布违规信息」必须接入内容安全检测（msgSecCheck），
 * 而本项目没有云函数 / 自建服务端，前端拿不到可用的调用通道。所有可发送
 * 的内容都从下面两张白名单出，客户端伪造 id 也只会拿到预设文案，从根上
 * 规避 UGC 风险。（平台规则以微信官方最新审核规范为准）
 *
 * 为什么单独建表、不走 splendor_games.state
 * ------------------------------------------------------------------
 * 对局快照走 version CAS，玩家动作和聊天消息会互相抢写，冲突后一方要重拉
 * 整局状态；聊天是易失数据，允许偶发丢失，绝不该拖累对局一致性。所以独立
 * 表 + 独立轮询 + 独立单飞锁，云端不可用时整体降级为纯本地气泡。
 *
 * 所有外部 IO 都吞掉异常：聊天是锦上添花，不能因为它让牌桌进不去。
 * 表情用系统 emoji 字体渲染，不引图片、不动 art.wxss 与包体积。
 */

const CHAT_TABLE = 'splendor_chat';
const BUBBLE_TTL_MS = 2800;   // 气泡停留时长
const FLY_TTL_MS = 1600;      // 大表情飞入动画时长（旧版全屏效果，保留兼容）
const PROJECTILE_TTL_MS = 1500; // 定向表情飞行 + 命中动画时长
const WINDOW_MS = 60000;      // 云端只拉最近 60 秒，避免历史消息反复弹出
const MAX_LOCAL = 24;         // 本机消息队列上限

/* 常用短语：语气偏娱乐，不含挑衅 / 诱导分享 / 博彩暗示 */
const QUICK_TEXTS = [
  { id: 't1', text: '快点吧，等到花儿都谢了' },
  { id: 't2', text: '你的牌打得也太好了' },
  { id: 't3', text: '这波稳了，别急' },
  { id: 't4', text: '哎呀，手气不错' },
  { id: 't5', text: '承让承让' },
  { id: 't6', text: '再来一局，我还没打够' },
  { id: 't7', text: '别催，容我想想' },
  { id: 't8', text: '好牌！佩服' }
];

/* 互动表情：icon 由系统字体画，tone 决定动画类型。
 * aim='throw' 是投掷类（西红柿 / 鸡蛋 / 砖 / 炸弹），要飞到目标头像上砸开；
 * aim='gift' 是递送类（茶 / 花 / 鼓掌…），飘到目标头像外圈亮一下。
 * 两类都必须选一名目标玩家，不允许「对着空气发」。 */
const QUICK_EMOJIS = [
  { id: 'e1', icon: '🍵', label: '递茶', tone: 'tea', aim: 'gift' },
  { id: 'e2', icon: '🌹', label: '送花', tone: 'rose', aim: 'gift' },
  { id: 'e3', icon: '💣', label: '炸弹', tone: 'boom', aim: 'throw' },
  { id: 'e4', icon: '🧱', label: '拍砖', tone: 'brick', aim: 'throw' },
  { id: 'e5', icon: '👏', label: '鼓掌', tone: 'clap', aim: 'gift' },
  { id: 'e6', icon: '😂', label: '大笑', tone: 'laugh', aim: 'gift' },
  { id: 'e7', icon: '😭', label: '哭哭', tone: 'cry', aim: 'gift' },
  { id: 'e8', icon: '🥚', label: '扔鸡蛋', tone: 'egg', aim: 'throw' },
  { id: 'e9', icon: '🍅', label: '扔西红柿', tone: 'tomato', aim: 'throw' }
];

/* tone → aim 的唯一映射。云端消息只存 tone（白名单字段），
 * 播放端据此还原动画类型，不信任客户端自报的 aim。 */
const THROW_TONES = ['boom', 'brick', 'egg', 'tomato'];
function aimFor(tone) {
  return THROW_TONES.indexOf(tone) >= 0 ? 'throw' : 'gift';
}

/* 人机局里机器人的回应池，确定性轮转，测试可复现 */
const BOT_REPLIES = ['e1', 'e5', 'e6', 'e2'];

function makeId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/** 唯一的发送白名单校验入口：非法 kind / id 一律拒绝，不拼任何用户字符串 */
function findPreset(kind, id) {
  const src = kind === 'emoji' ? QUICK_EMOJIS : (kind === 'text' ? QUICK_TEXTS : null);
  if (!src) return null;
  for (let i = 0; i < src.length; i++) if (src[i].id === id) return src[i];
  return null;
}

/**
 * targetSeat 是「这条表情投给谁」的全局席位号；-1 表示无目标（快捷语、
 * 或旧版机器人回应）。只有 emoji 才需要目标，且由页面在发送前校验合法性。
 */
function makeMessage(roomCode, seat, uid, name, kind, preset, at, targetSeat) {
  const ts = typeof at === 'number' ? at : Date.now();
  const tone = kind === 'emoji' ? preset.tone : '';
  const ts2 = (typeof targetSeat === 'number' && isFinite(targetSeat))
    ? Math.floor(targetSeat) : -1;
  return {
    id: makeId(),
    roomCode: roomCode || '',
    seat: Number(seat) || 0,
    uid: uid || '',
    name: String(name || '').slice(0, 12),
    kind: kind,
    text: kind === 'text' ? preset.text : '',
    icon: kind === 'emoji' ? preset.icon : '',
    label: kind === 'emoji' ? preset.label : '',
    tone: tone,
    aim: kind === 'emoji' ? aimFor(tone) : '',
    targetSeat: ts2,
    at: ts,
    iso: new Date(ts).toISOString()
  };
}

/** 本机队列裁剪：丢掉窗口外的，再截到上限，防止一局下来无限增长 */
function trim(messages, now) {
  const t = typeof now === 'number' ? now : Date.now();
  const out = (messages || []).filter(function (m) { return m && t - m.at <= WINDOW_MS; });
  return out.length > MAX_LOCAL ? out.slice(-MAX_LOCAL) : out;
}

/** 合并远端消息：按 id 去重，返回新数组 + 新增条数 */
function merge(messages, incoming, now) {
  const known = {};
  const out = (messages || []).slice();
  for (let i = 0; i < out.length; i++) known[out[i].id] = true;
  let added = 0;
  for (let j = 0; j < (incoming || []).length; j++) {
    const m = incoming[j];
    if (!m || !m.id || known[m.id]) continue;
    known[m.id] = true;
    out.push(m);
    added += 1;
  }
  return { list: trim(out, now), added: added };
}

/** 云端写一行；无云 / 表不存在 / 网络失败都静默降级，不打断牌桌 */
async function send(cloud, msg) {
  try {
    const database = cloud && cloud.database;
    if (!database || !msg || !msg.roomCode) return { ok: false, error: 'no-cloud' };
    const res = await database.from(CHAT_TABLE).upsert({
      id: msg.id, room_code: msg.roomCode, seat: msg.seat,
      from_uid: msg.uid, from_name: msg.name,
      kind: msg.kind, text: msg.text, icon: msg.icon, label: msg.label,
      tone: msg.tone || '', target_seat: (typeof msg.targetSeat === 'number' ? msg.targetSeat : -1),
      created_at: msg.iso
    });
    if (res && res.error) return { ok: false, error: String(res.error.message || res.error) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/** 云端拉窗口内消息；任何异常都返回空数组 */
async function list(cloud, roomCode, now) {
  try {
    const database = cloud && cloud.database;
    if (!database || !roomCode) return [];
    const t = typeof now === 'number' ? now : Date.now();
    const since = new Date(Math.max(0, t - WINDOW_MS)).toISOString();
    const res = await database.from(CHAT_TABLE).select('*')
      .eq('room_code', roomCode).gte('created_at', since).limit(MAX_LOCAL);
    if (!res || res.error || !Array.isArray(res.data)) return [];
    return res.data.map(function (row) {
      return {
        id: row.id, roomCode: row.room_code, seat: Number(row.seat) || 0,
        uid: row.from_uid || '', name: row.from_name || '', kind: row.kind,
        text: row.text || '', icon: row.icon || '', label: row.label || '',
        tone: row.tone || '',
        aim: row.kind === 'emoji' ? aimFor(row.tone || '') : '',
        targetSeat: (typeof row.target_seat === 'number' ? row.target_seat : -1),
        at: Date.parse(row.created_at) || t
      };
    });
  } catch (e) {
    return [];
  }
}

/**
 * 聊天气泡视图模型。
 * 同一席位只显示最新一条：连点表情时不能把自己刷成一屏气泡。
 * 最多 3 条，且全部 pointer-events:none，绝不拦截牌桌操作。
 */
function chatVM(messages, mySeat, now, panelOpen, tab, opts) {
  const o = opts || {};
  const t = typeof now === 'number' ? now : Date.now();
  const sorted = (messages || []).slice().sort(function (a, b) { return a.at - b.at; });
  const seen = {};
  const bubbles = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const m = sorted[i];
    if (!m || t - m.at > BUBBLE_TTL_MS) continue;
    if (seen[m.seat]) continue;
    seen[m.seat] = true;
    bubbles.unshift({
      id: m.id,
      seat: m.seat,
      seatLabel: (m.seat + 1) + ' 号位',
      name: m.name || ((m.seat + 1) + ' 号位'),
      mine: m.seat === mySeat,
      text: m.kind === 'emoji' ? (m.label || '') : m.text,
      icon: m.kind === 'emoji' ? m.icon : '',
      isEmoji: m.kind === 'emoji',
      tone: m.tone || '',
      targetLabel: (typeof m.targetSeat === 'number' && m.targetSeat >= 0)
        ? ('→ ' + (m.targetSeat + 1) + ' 号位') : ''
    });
    if (bubbles.length >= 3) break;
  }
  const isEmoji = tab === 'emoji';
  // 表情必须两步：先挑表情，再挑目标玩家。isPick / isTarget 是互斥布尔，
  // WXML 用它们做 wx:if，不能用字符串比较（H5 预览编译器不支持）。
  const pending = (isEmoji && o.pendingEmoji) ? o.pendingEmoji : null;
  const isTarget = !!pending;
  return {
    open: !!panelOpen,
    tab: isEmoji ? 'emoji' : 'text',
    isText: !isEmoji,
    isEmoji: isEmoji,
    isPick: !isTarget,
    isTarget: isTarget,
    pending: pending,
    texts: QUICK_TEXTS,
    emojis: QUICK_EMOJIS,
    targets: o.targets || [],
    bubbles: bubbles,
    flyList: [],
    projectiles: o.projectiles || []
  };
}

module.exports = {
  CHAT_TABLE: CHAT_TABLE,
  BUBBLE_TTL_MS: BUBBLE_TTL_MS,
  FLY_TTL_MS: FLY_TTL_MS,
  PROJECTILE_TTL_MS: PROJECTILE_TTL_MS,
  WINDOW_MS: WINDOW_MS,
  MAX_LOCAL: MAX_LOCAL,
  QUICK_TEXTS: QUICK_TEXTS,
  QUICK_EMOJIS: QUICK_EMOJIS,
  BOT_REPLIES: BOT_REPLIES,
  makeId: makeId,
  findPreset: findPreset,
  aimFor: aimFor,
  makeMessage: makeMessage,
  trim: trim,
  merge: merge,
  send: send,
  list: list,
  chatVM: chatVM
};
