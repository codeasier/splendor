'use strict';

/**
 * 天梯榜 —— 把战绩汇总成六项指标，做综合评分后排名。
 *
 * 指标口径（用户指定）
 * ------------------------------------------------------------------
 *   胜场数量        wins              胜局累计（st.winner === mySeat）
 *   最高胜场声望    bestWinScore      所有「胜局」里的最高声望
 *   场均声望        avgScore          总声望 / 总局数
 *   场均发展卡      avgCards          总发展卡数 / 总局数
 *   场均贵族        avgNobles         总贵族数 / 总局数
 *   回合平均耗时    avgTurnMs         本局总耗时 / 本局回合数，再按回合数加权汇总
 *
 * 为什么云端存「累计量」而不是算好的均值
 * ------------------------------------------------------------------
 *   均值是除法结果，无法增量合并。云端只存 games / wins / best_win_score /
 *   total_* 与 total_turn_ms / total_turns，改昵称、换设备、重算权重时
 *   都能用同一份累计量重新出分，不用回填历史记录。
 *
 * 数据边界
 * ------------------------------------------------------------------
 *   本机战绩是设备级 uid 的（见 utils/user.js），最多 60 条；
 *   云端行按 uid upsert，后写覆盖先写。正式接入微信登录后 uid 稳定，
 *   这里不用改。所有云端 IO 都吞异常：榜单挂了不能拖死牌桌。
 *
 * 安全提示：splendor_leaderboard 目前与其它表一样是共享读写策略
 * （anon 可写任意 uid 行），上线前必须按登录态收敛 RLS，否则分数可伪造。
 */

const R = require('./room.js');

const LEADERBOARD_TABLE = 'splendor_leaderboard';
const MIN_GAMES = 3;       // 少于 3 局标「观察期」，不隐藏（榜单要能看到新玩家）
const MAX_ROWS = 50;
const FETCH_LIMIT = 100;

/* 综合评分权重，满分 680。局数少的人靠 volume 项天然压低，不需要硬门槛。 */
const WEIGHTS = {
  winRate: 220,   // 胜率：最能代表水平
  bestWin: 90,    // 最高胜场声望：上限表现
  avgScore: 120,  // 场均声望：稳定输出
  avgCards: 60,   // 场均发展卡：引擎建设
  avgNobles: 60,  // 场均贵族：路线完成度
  speed: 50,      // 回合平均耗时：越快越高（封顶 45s/回合记 0）
  volume: 80      // 活跃度：防一局刷榜
};

function num(v) {
  const n = Number(v);
  return isFinite(n) && n > 0 ? n : 0;
}

function clamp01(v) {
  const n = Number(v) || 0;
  return Math.max(0, Math.min(1, n));
}

function blank() {
  return {
    games: 0, wins: 0, bestWinScore: 0,
    totalScore: 0, totalCards: 0, totalNobles: 0,
    totalTurnMs: 0, totalTurns: 0
  };
}

/** 一条战绩 → 一份增量。兼容旧记录（缺 cards/nobles/turnAvgMs 时记 0） */
function fromRecord(rec) {
  const r = rec || {};
  const turns = num(r.turns);
  const perTurn = num(r.turnAvgMs);
  const t = blank();
  t.games = 1;
  t.wins = r.win ? 1 : 0;
  t.bestWinScore = r.win ? num(r.score) : 0;
  t.totalScore = num(r.score);
  t.totalCards = num(r.cards);
  t.totalNobles = num(r.nobles);
  t.totalTurns = turns;
  t.totalTurnMs = Math.round(perTurn * turns);
  return t;
}

function mergeTotals(a, b) {
  const x = a || blank();
  const y = b || blank();
  return {
    games: num(x.games) + num(y.games),
    wins: num(x.wins) + num(y.wins),
    bestWinScore: Math.max(num(x.bestWinScore), num(y.bestWinScore)),
    totalScore: num(x.totalScore) + num(y.totalScore),
    totalCards: num(x.totalCards) + num(y.totalCards),
    totalNobles: num(x.totalNobles) + num(y.totalNobles),
    totalTurnMs: num(x.totalTurnMs) + num(y.totalTurnMs),
    totalTurns: num(x.totalTurns) + num(y.totalTurns)
  };
}

function fromRecords(records) {
  let t = blank();
  const list = Array.isArray(records) ? records : [];
  for (let i = 0; i < list.length; i++) t = mergeTotals(t, fromRecord(list[i]));
  return t;
}

function summarize(totals) {
  const t = totals || blank();
  const games = num(t.games);
  const turns = num(t.totalTurns);
  const avgTurnMs = turns ? num(t.totalTurnMs) / turns : 0;
  return {
    games: games,
    wins: num(t.wins),
    winRate: games ? num(t.wins) / games : 0,
    bestWinScore: num(t.bestWinScore),
    avgScore: games ? num(t.totalScore) / games : 0,
    avgCards: games ? num(t.totalCards) / games : 0,
    avgNobles: games ? num(t.totalNobles) / games : 0,
    avgTurnMs: avgTurnMs,
    avgTurnSec: avgTurnMs / 1000
  };
}

/** 综合评分：六项指标归一化后加权求和，速度取反向、活跃度取对数压缩 */
function rating(summary) {
  const s = summary || summarize(blank());
  if (!s.games) return 0;
  const speed = clamp01(1 - s.avgTurnSec / 45);
  const volume = clamp01(s.games / 30) * 0.6 +
    clamp01(Math.log2(1 + s.wins) / 5) * 0.4;
  const raw =
    WEIGHTS.winRate * clamp01(s.winRate) +
    WEIGHTS.bestWin * clamp01(s.bestWinScore / 20) +
    WEIGHTS.avgScore * clamp01(s.avgScore / 15) +
    WEIGHTS.avgCards * clamp01(s.avgCards / 12) +
    WEIGHTS.avgNobles * clamp01(s.avgNobles / 2) +
    WEIGHTS.speed * speed +
    WEIGHTS.volume * volume;
  return Math.round(raw);
}

function entryOf(uid, nickname, avatarUrl, totals) {
  return {
    uid: String(uid || ''),
    nickname: String(nickname || '珠宝商').slice(0, 12),
    avatarUrl: String(avatarUrl || ''),
    totals: totals || blank()
  };
}

function cloudToEntry(row) {
  if (!row || !row.uid) return null;
  return entryOf(row.uid, row.nickname, row.avatar_url, {
    games: num(row.games), wins: num(row.wins),
    bestWinScore: num(row.best_win_score),
    totalScore: num(row.total_score), totalCards: num(row.total_cards),
    totalNobles: num(row.total_nobles), totalTurnMs: num(row.total_turn_ms),
    totalTurns: num(row.total_turns)
  });
}

function entryToCloud(entry, score) {
  const t = entry.totals || blank();
  return {
    uid: entry.uid,
    nickname: entry.nickname,
    avatar_url: entry.avatarUrl || '',
    games: num(t.games), wins: num(t.wins),
    best_win_score: num(t.bestWinScore),
    total_score: num(t.totalScore), total_cards: num(t.totalCards),
    total_nobles: num(t.totalNobles), total_turn_ms: num(t.totalTurnMs),
    total_turns: num(t.totalTurns),
    rating: score,
    updated_at: new Date().toISOString()
  };
}

/** 结算后把本机「全量累计」写进云端；失败静默降级，不影响结算面板 */
async function publish(cloud, profile, totals) {
  try {
    const database = cloud && cloud.database;
    if (!database || !profile || !profile.uid) return { ok: false, error: 'no-cloud' };
    const entry = entryOf(profile.uid, profile.nickname,
      profile.avatarData || '', totals || blank());
    const score = rating(summarize(entry.totals));
    const res = await database.from(LEADERBOARD_TABLE).upsert(entryToCloud(entry, score));
    if (res && res.error) return { ok: false, error: String(res.error.message || res.error) };
    return { ok: true, rating: score };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/** 拉全站榜单；不做服务端排序（SDK 链式能力有限），本地统一排序更可控 */
async function fetchRows(cloud) {
  try {
    const database = cloud && cloud.database;
    if (!database) return [];
    const res = await database.from(LEADERBOARD_TABLE).select('*').limit(FETCH_LIMIT);
    if (!res || res.error || !Array.isArray(res.data)) return [];
    const out = [];
    for (let i = 0; i < res.data.length; i++) {
      const e = cloudToEntry(res.data[i]);
      if (e) out.push(e);
    }
    return out;
  } catch (e) {
    return [];
  }
}

function fmt1(v) {
  return (Math.round((Number(v) || 0) * 10) / 10).toFixed(1);
}

function formatRow(entry, rank, myUid) {
  const s = summarize(entry.totals || blank());
  const score = rating(s);
  return {
    rank: rank,
    uid: entry.uid,
    name: entry.nickname,
    initial: String(entry.nickname || '珠').slice(0, 1),
    avatarUrl: entry.avatarUrl || '',
    isMe: entry.uid === myUid,
    provisional: s.games < MIN_GAMES,
    rating: score,
    ratingText: String(score),
    wins: s.wins,
    winsText: String(s.wins),
    bestWinScore: s.bestWinScore,
    bestWinText: String(s.bestWinScore),
    avgScoreText: fmt1(s.avgScore),
    avgCardsText: fmt1(s.avgCards),
    avgNoblesText: fmt1(s.avgNobles),
    avgTurnText: fmt1(s.avgTurnSec) + 's',
    gamesText: String(s.games),
    winRateText: Math.round(s.winRate * 100) + '%'
  };
}

/** 稳定排序：综合分 → 胜场 → 局数 → uid，避免同分时每次打开名次乱跳 */
function rankRows(entries, myUid) {
  const list = (entries || []).slice().map(function (e) {
    return { entry: e, score: rating(summarize(e.totals || blank())), wins: num((e.totals || blank()).wins), games: num((e.totals || blank()).games) };
  });
  list.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.games !== a.games) return b.games - a.games;
    return a.entry.uid < b.entry.uid ? -1 : (a.entry.uid > b.entry.uid ? 1 : 0);
  });
  const all = list.map(function (x, i) { return formatRow(x.entry, i + 1, myUid); });
  let myRow = null;
  for (let i = 0; i < all.length; i++) if (all[i].isMe) { myRow = all[i]; break; }
  return { list: all.slice(0, MAX_ROWS), myRow: myRow, total: all.length };
}

/** 榜单视图模型：所有展示字段预先格式化，WXML 不做算术 */
function rowsVM(entries, myUid, opts) {
  const o = opts || {};
  const ranked = rankRows(entries, myUid);
  const mine = ranked.myRow;
  const games = mine ? Number(mine.gamesText) : 0;
  return {
    rows: ranked.list,
    myRow: mine,
    myRank: mine ? mine.rank : 0,
    hasMe: !!mine,
    provisional: !mine || games < MIN_GAMES,
    needText: games < MIN_GAMES
      ? ('再打 ' + (MIN_GAMES - games) + ' 局即可脱离观察期')
      : '',
    empty: ranked.list.length === 0,
    source: o.source === 'cloud' ? 'cloud' : 'local',
    sourceText: o.source === 'cloud'
      ? '全站榜单 · 数据来自云端'
      : '云端未连接 · 仅展示本机战绩',
    // 文案统一在 VM 里拼好：WXML 表达式里做字符串拼接在部分 WebView 不稳
    sourceLine: (o.source === 'cloud' ? '全站榜单 · 数据来自云端' : '云端未连接 · 仅展示本机战绩') +
      (o.updatedAt ? ' · 更新于 ' + o.updatedAt : ''),
    myRankText: mine ? ('第 ' + mine.rank + ' 名 · 综合 ' + mine.ratingText + ' 分') : '',
    loading: !!o.loading,
    formulaText: '综合分 = 胜率 220 + 最高胜场声望 90 + 场均声望 120 + 场均发展卡 60 + 场均贵族 60 + 回合速度 50 + 活跃度 80（各项归一化后加权）',
    updatedText: o.updatedAt ? ('更新于 ' + o.updatedAt) : ''
  };
}

module.exports = {
  LEADERBOARD_TABLE: LEADERBOARD_TABLE,
  MIN_GAMES: MIN_GAMES,
  MAX_ROWS: MAX_ROWS,
  WEIGHTS: WEIGHTS,
  blank: blank,
  fromRecord: fromRecord,
  mergeTotals: mergeTotals,
  fromRecords: fromRecords,
  summarize: summarize,
  rating: rating,
  entryOf: entryOf,
  cloudToEntry: cloudToEntry,
  entryToCloud: entryToCloud,
  publish: publish,
  fetchRows: fetchRows,
  formatRow: formatRow,
  rankRows: rankRows,
  rowsVM: rowsVM
};
