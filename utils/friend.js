'use strict';

/**
 * 好友体系与联机邀请。
 *
 * 数据表：
 *   splendor_friends(id PK, uid, friend_uid, created_at)
 *     —— **每个方向一行**：A 加 B 成功时同时写 A→B 与 B→A。
 *        单行双向的写法（一条记录两支 uid）无法让双方各自独立删除，
 *        一方删好友会把对方的列表也清空，这是好友系统最常见的返工点。
 *   splendor_invites(id PK, from_uid, to_uid, room_code, status, created_at)
 *     —— 好友点「邀请」写一行 pending；被邀方轮询到后一键加入。
 *
 * 身份说明（重要，别改错）：
 *   正式小程序的 uid 来自云端微信登录会话。云端业务在登录并对齐账号后开放，
 *   好友关系按该稳定 uid 关联。旧游客 uid 不作为接管云端好友的凭据。
 *
 * 边界：
 *   没有云客户端时全部返回 offline，不抛错、不发请求。
 *   H5 预览与 Node 测试天然处于 offline，因此不影响回归。
 */

const R = require('./room.js');
const Nick = require('./nickname.js');

const FRIEND_TABLE = 'splendor_friends';
const INVITE_TABLE = 'splendor_invites';
/* 邀请有效期：10 分钟。超过这个时间的邀请再弹出来会让玩家莫名加入一局陌生牌局 */
const INVITE_TTL_MS = 10 * 60 * 1000;
/* 好友上限：单机桌游不需要社交广度，200 足够，也避免一次拉回上千行 */
const MAX_FRIENDS = 200;

function db() {
  if (!R.hasCloud()) return null;
  const cloud = R.getCloud ? R.getCloud() : null;
  return cloud && cloud.database ? cloud.database : null;
}
function offline(reason) {
  return { ok: false, offline: true, error: reason || '云端未连接' };
}
function isCurrentUser(uid) {
  return !R.requiresWechatLogin() || R.getAuthenticatedUid() === uid;
}
function errText(e) {
  if (!e) return '未知错误';
  return e.message || e.error_description || e.error || String(e);
}
function nowIso() { return new Date().toISOString(); }
function rid(prefix) {
  return String(prefix || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * 好友关系主键：由「较小 uid + 较大 uid」拼成，保证 A→B 与 B→A 各一个稳定 id。
 * 用随机 id 会让「重复添加」无法被 id 挡住，只能靠查询后判断，容易并发出双份。
 */
function friendId(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  return x < y ? (x + '__' + y) : (y + '__' + x);
}
/** 反向边单独一个 id 后缀，与正向边区分开 */
function friendIdRev(a, b) { return friendId(a, b) + '__rev'; }

/** 加好友：双向各写一行。已存在则视为成功（幂等） */
async function addFriend(me, targetUid, targetNickname) {
  const database = db();
  if (!database) return offline();
  const myUid = (me && me.uid) || '';
  const other = String(targetUid || '').trim();
  if (!myUid) return { ok: false, error: '缺少自己的账号 ID' };
  if (!isCurrentUser(myUid)) return { ok: false, error: '账号已切换，请刷新好友列表' };
  if (!other) return { ok: false, error: '请输入好友账号 ID' };
  if (other === myUid) return { ok: false, error: '不能添加自己为好友' };

  try {
    // 两条边分两次写，而不是 upsert(数组)：
    // 参考文档只承诺「单对象 upsert」，批量数组的行为需以官方文档核实。
    // 好友关系必须准确，不能赌一个没被文档保证的写法。
    const myName = ((me && me.nickname) || '珠宝商').slice(0, 24);
    const otherName = (targetNickname || '').slice(0, 24);
    const edges = [
      { id: friendId(myUid, other), uid: myUid, friend_uid: other, friend_name: otherName, created_at: nowIso() },
      { id: friendIdRev(myUid, other), uid: other, friend_uid: myUid, friend_name: myName, created_at: nowIso() }
    ];
    for (let i = 0; i < edges.length; i++) {
      const res = await database.from(FRIEND_TABLE).upsert(edges[i]);
      if (res && res.error) {
        const code = String((res.error && (res.error.code || res.error.message)) || '');
        // 23505 = 主键冲突。upsert 理论上不该出现，但并发双击可能撞上，
        // 此时这条边已经建成，继续写另一条，不要中途放弃留下半条关系。
        if (code.indexOf('23505') < 0) {
          return { ok: false, error: errText(res.error) };
        }
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/** 我的好友列表（只含 uid/昵称，头像与在线状态由上层补齐） */
async function listFriends(myUid) {
  const database = db();
  if (!database) return Object.assign(offline(), { list: [] });
  const uid = String(myUid || '');
  if (!uid) return { ok: false, error: '缺少账号 ID', list: [] };
  if (!isCurrentUser(uid)) return { ok: false, error: '账号已切换', list: [] };
  try {
    const res = await database
      .from(FRIEND_TABLE)
      .select('*')
      .eq('uid', uid)
      .limit(MAX_FRIENDS);
    if (res && res.error) return { ok: false, error: errText(res.error), list: [] };
    const rows = (res && res.data) || [];
    const list = rows.map(function (r) {
      return {
        uid: r.friend_uid,
        nickname: Nick.maskName(r.friend_name || ''),
        since: r.created_at || ''
      };
    }).filter(function (f) { return !!f.uid; });
    return { ok: true, list: list };
  } catch (e) {
    return { ok: false, error: errText(e), list: [] };
  }
}

/**
 * 删好友：只删「我这一侧」那一条边。
 * 对方列表里仍然保留我 —— 否则单方面删好友会让对方的好友凭空消失且毫无解释，
 * 这是多数社交产品的既定行为（被删方看到的是「对方已不是你好友」而不是整条记录消失）。
 */
async function removeFriend(myUid, targetUid) {
  const database = db();
  if (!database) return offline();
  const a = String(myUid || '');
  const b = String(targetUid || '');
  if (!a || !b) return { ok: false, error: '缺少参数' };
  if (!isCurrentUser(a)) return { ok: false, error: '账号已切换，请刷新好友列表' };
  try {
    const res = await database.from(FRIEND_TABLE).delete().eq('id', friendId(a, b));
    if (res && res.error) return { ok: false, error: errText(res.error) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/** 发邀请：写一行 pending，被邀方轮询到后弹窗 */
async function sendInvite(fromUid, toUid, roomCode, fromName) {
  const database = db();
  if (!database) return offline();
  const f = String(fromUid || '');
  const t = String(toUid || '');
  const code = String(roomCode || '').toUpperCase();
  if (!f || !t) return { ok: false, error: '缺少邀请双方' };
  if (!isCurrentUser(f)) return { ok: false, error: '账号已切换，请重新邀请' };
  if (!/^[A-Z0-9]{6}$/.test(code)) return { ok: false, error: '房间号无效' };
  try {
    const res = await database.from(INVITE_TABLE).upsert({
      id: rid('iv'),
      from_uid: f,
      to_uid: t,
      room_code: code,
      from_name: (fromName || '好友').slice(0, 24),
      status: 'pending',
      created_at: nowIso()
    });
    if (res && res.error) return { ok: false, error: errText(res.error) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/**
 * 拉取「发给我的」待处理邀请，只取 10 分钟内。
 * 过期的邀请不弹窗、也不主动删（删除需要额外写权限，收益不大），
 * 只是不再返回 —— 玩家不会莫名被拉进一局十分钟前的旧房间。
 */
async function listInvites(myUid) {
  const database = db();
  if (!database) return Object.assign(offline(), { list: [] });
  const uid = String(myUid || '');
  if (!uid) return { ok: false, error: '缺少账号 ID', list: [] };
  if (!isCurrentUser(uid)) return { ok: false, error: '账号已切换', list: [] };
  try {
    const since = new Date(Date.now() - INVITE_TTL_MS).toISOString();
    const res = await database
      .from(INVITE_TABLE)
      .select('*')
      .eq('to_uid', uid)
      .eq('status', 'pending')
      .gte('created_at', since);
    if (res && res.error) return { ok: false, error: errText(res.error), list: [] };
    const rows = (res && res.data) || [];
    const list = rows.map(function (r) {
      return {
        id: r.id,
        fromUid: r.from_uid,
        fromName: r.from_name || '好友',
        roomCode: r.room_code,
        at: r.created_at
      };
    });
    return { ok: true, list: list };
  } catch (e) {
    return { ok: false, error: errText(e), list: [] };
  }
}

/** 把邀请标记为已处理（accepted / declined），避免重复弹窗 */
async function markInvite(id, status) {
  const database = db();
  if (!database) return offline();
  if (!id) return { ok: false, error: '缺少邀请 ID' };
  try {
    let query = database
      .from(INVITE_TABLE)
      .update({ status: String(status || 'accepted') })
      .eq('id', id);
    if (R.requiresWechatLogin()) query = query.eq('to_uid', R.getAuthenticatedUid());
    const res = await query;
    if (res && res.error) return { ok: false, error: errText(res.error) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/**
 * 按账号 ID 精确查找一个人（用于「加好友」）。
 * 只在资料表里查 —— 不提供模糊搜索：桌游不需要社交发现，
 * 模糊搜索会把所有玩家的昵称暴露成可枚举列表，属于过度收集。
 */
async function findPlayer(uid) {
  const database = db();
  if (!database) return offline();
  const target = String(uid || '').trim();
  if (!target) return { ok: false, error: '请输入账号 ID' };
  try {
    const res = await database
      .from('splendor_players')
      .select('uid,nickname,avatar,avatar_url')
      .eq('uid', target)
      .maybeSingle();
    if (res && res.error) return { ok: false, error: errText(res.error) };
    const row = res && res.data;
    if (!row) return { ok: false, notFound: true, error: '没找到这个账号，请确认 ID 是否正确' };
    return {
      ok: true,
      player: {
        uid: row.uid,
        nickname: Nick.maskName(row.nickname) || '珠宝商',
        avatar: row.avatar || 'a0',
        avatarUrl: row.avatar_url || ''
      }
    };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

module.exports = {
  FRIEND_TABLE: FRIEND_TABLE,
  INVITE_TABLE: INVITE_TABLE,
  INVITE_TTL_MS: INVITE_TTL_MS,
  MAX_FRIENDS: MAX_FRIENDS,
  friendId: friendId,
  friendIdRev: friendIdRev,
  addFriend: addFriend,
  listFriends: listFriends,
  removeFriend: removeFriend,
  sendInvite: sendInvite,
  listInvites: listInvites,
  markInvite: markInvite,
  findPlayer: findPlayer
};
