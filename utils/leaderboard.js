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
const MIN_HUMANS = 2;      // 天梯准入：至少 2 名真人

/**
 * 天梯准入：只有「联机对局」且「真人席位 ≥ 2」才计入榜单。
 * ------------------------------------------------------------------
 * 为什么要卡这两条：
 *   - 人机局可以刷。单人打 3 个送分机器人，胜率和场均声望都能轻松拉满，
 *     不限制的话榜单会被本地刷分占据，失去比较意义。
 *   - 联机但对面全是机器人（1 真人 + 3 机器人）本质仍是人机局，同理排除。
 *
 * 为什么以「真人数」而不是「总席位」为准：
 *   4 人房里可能有 2 个机器人补位，总席位是 4 但只有 2 个真人，
 *   这种局的计算强度与 4 真人局不同，用 humanCount 才准确。
 *
 * autoPlay（真人临时托管）仍算真人：那是可随时收回操作权的真人席位，
 * 引擎里用 isAI 区分「天生机器人」与「临时托管」，这里沿用同一口径。
 *
 * 旧记录兼容：humanCount 是后加字段，早期记录没有。
 * 缺字段时按「无法判定」处理 —— **不计入**，而不是默认放行。
 * 宁可少算历史局，也不能让无法验证的局污染榜单。
 */
function eligible(rec) {
  const r = rec || {};
  if (r.mode !== 'room') return false;
  const humans = Number(r.humanCount);
  if (!isFinite(humans)) return false;
  return humans >= MIN_HUMANS;
}

/** 本机战绩里有多少局够天梯资格（用于界面提示「还差几局」） */
function eligibleCount(records) {
  const list = Array.isArray(records) ? records : [];
  let n = 0;
  for (let i = 0; i < list.length; i++) if (eligible(list[i])) n += 1;
  return n;
}

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
  // 只累计够天梯资格的对局；人机局与非联机局一律不进榜
  for (let i = 0; i < list.length; i++) if (eligible(list[i])) t = mergeTotals(t, fromRecord(list[i]));
  return t;
}

/**
 * 胜率可信度修正（单侧收缩）
 * ------------------------------------------------------------------
 * 直接用 wins/games 会奖励运气：1 局 1 胜就是 100%，拿满胜率分，
 * 压过打 20 局赢 14 局（70%）的长期玩家 —— 前者只是样本少，不是更强。
 *
 * 为什么用「单侧」而不是标准贝叶斯收缩：
 *   标准收缩把样本向先验 50% 拉，双向都会动。实测 0 胜 1 局会从 0%
 *   被抬到 42% —— 等于给连输的人发安慰分，这对天梯是**有害的**：
 *   输了就是输了，样本少不能成为「胜率凭空变高」的理由。
 *   所以只在「胜率高于 50%」时向下收缩，低于 50% 保持原值。
 *
 * 效果：
 *   1 局 1 胜   100% → 58%   （运气不再直接兑满分）
 *   3 局 3 胜   100% → 69%
 *   20 局 14 胜  70% → 66%   （真本事几乎不受影响）
 *   0 胜 N 局     0% → 0%    （不抬高）
 */
const PRIOR_GAMES = 5;

function adjustedWinRate(wins, games) {
  if (!games) return 0;
  const w = num(wins);
  const g = num(games);
  const raw = w / g;
  // 只对「赢多于输」的成绩打折，输家不给补偿
  if (raw <= 0.5) return raw;
  const shrunk = (w + 0.5 * PRIOR_GAMES) / (g + PRIOR_GAMES);
  return shrunk;
}

function summarize(totals) {
  const t = totals || blank();
  const games = num(t.games);
  const turns = num(t.totalTurns);
  const avgTurnMs = turns ? num(t.totalTurnMs) / turns : 0;
  const wins = num(t.wins);
  return {
    games: games,
    wins: wins,
    // winRate 保留原始值：界面「胜率」一栏要显示真实数字（2/4 = 50%），
    // 不能给用户看一个被平滑过的 50%→50% 或 100%→58%，那会像算错了。
    winRate: games ? wins / games : 0,
    // 评分专用：样本不足时向 50% 收缩，避免一局定榜
    adjWinRate: adjustedWinRate(wins, games),
    bestWinScore: num(t.bestWinScore),
    avgScore: games ? num(t.totalScore) / games : 0,
    avgCards: games ? num(t.totalCards) / games : 0,
    avgNobles: games ? num(t.totalNobles) / games : 0,
    avgTurnMs: avgTurnMs,
    avgTurnSec: avgTurnMs / 1000
  };
}

/** 综合评分：六项指标归一化后加权求和，速度取反向、活跃度取对数压缩 */
/**
 * 综合评分：六项指标归一化后加权求和，速度取反向、活跃度取对数压缩。
 * 胜率用 adjWinRate（样本不足向 50% 收缩），不用原始 winRate。
 */
function rating(summary) {
  const s = summary || summarize(blank());
  if (!s.games) return 0;
  const speed = clamp01(1 - s.avgTurnSec / 45);
  const volume = clamp01(s.games / 30) * 0.6 +
    clamp01(Math.log2(1 + s.wins) / 5) * 0.4;
  const winRate = s.adjWinRate === undefined ? clamp01(s.winRate) : clamp01(s.adjWinRate);
  const raw =
    WEIGHTS.winRate * winRate +
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
    // 没有任何合格对局就不上榜：否则「从没打过联机真人局的人」也会占一行 0 分，
    // 榜单会被大量空行稀释。已有云端行的玩家若之后局数归零（清空战绩），
    // 这里同样不会写回，云端旧行保持原样。
    if (!num((totals || blank()).games)) return { ok: false, error: 'no-eligible-games' };
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

/** 拉全站榜单；服务端按评分降序取前 N，本地再统一排序 */
async function fetchRows(cloud) {
  try {
    const database = cloud && cloud.database;
    if (!database) return [];
    // 必须带 order 再 limit：PostgreSQL 不保证无序查询返回哪 100 行，
    // 一旦玩家超过 FETCH_LIMIT，不同请求可能拿到不同子集 ——
    // 那才会真的出现「每个人看到的榜单不一样」。
    // 按 rating 降序取，保证截断时留下的是高分玩家；updated_at 兜底避免同分抖动。
    let query = database.from(LEADERBOARD_TABLE).select('*');
    try {
      query = query.order('rating', { ascending: false }).order('updated_at', { ascending: false });
    } catch (e) {
      // 老版本 SDK 没有 order 链式方法时退化为原行为，不能让榜单整个挂掉
    }
    const res = await query.limit(FETCH_LIMIT);
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
  // 授冠不在这里判断：皇冠归属由 rankRows 按「正式榜第 1」决定，
  // 这里只给默认值，避免两处规则各说各话。
  return {
    rank: rank,
    section: '',
    rankText: String(rank),
    sectionHead: '',
    sectionSub: '',
    uid: entry.uid,
    name: entry.nickname,
    initial: String(entry.nickname || '珠').slice(0, 1),
    avatarUrl: entry.avatarUrl || '',
    isMe: entry.uid === myUid,
    isChampion: false,
    championLabel: '',
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
    winRateText: Math.round(s.winRate * 100) + '%',
    // 胜率列合并显示「50%(2/4)」：胜场单独占一列太浪费横向空间，
    // 而「胜率 + 分子/分母」放一起才能看清这个百分比的样本基础 ——
    // 100%(1/1) 和 70%(14/20) 的说服力差别一眼可见。
    // 0 局不显示 0%(0/0)：那是无意义的除法，用一个破折号表述「还没数据」。
    winRateFullText: s.games
      ? (Math.round(s.winRate * 100) + '%(' + s.wins + '/' + s.games + ')')
      : '—'
  };
}

/** 稳定排序：综合分 → 胜场 → 局数 → uid，避免同分时每次打开名次乱跳 */
/**
 * 排名：正式榜与观察期榜**各自独立编号**。
 * ------------------------------------------------------------------
 * 为什么分段而不是混排：
 *   混排时会出现「1 局的新人排第 1、打了 4 局的人排第 2」——
 *   新人分数高只是因为样本少，不该占据榜首并拿走冠军标识。
 *   分开后正式榜是真正的实力比较，观察期榜是「等够局数再晋级」的候选区。
 *
 * 皇冠（isChampion）只给正式榜第 1 名，观察期组内第 1 不授予。
 */
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
  const official = list.filter(function (x) { return x.games >= MIN_GAMES; });
  const trial = list.filter(function (x) { return x.games < MIN_GAMES; });

  const all = [];
  official.forEach(function (x, i) {
    const row = formatRow(x.entry, i + 1, myUid);
    row.section = 'official';
    // 只有正式榜第 1 名戴冠
    row.isChampion = i === 0;
    row.championLabel = row.isChampion ? '榜首' : '';
    row.rankText = String(i + 1);
    if (i === 0) { row.sectionHead = '正式榜'; row.sectionSub = '满 ' + MIN_GAMES + ' 局'; }
    all.push(row);
  });
  trial.forEach(function (x, i) {
    const row = formatRow(x.entry, i + 1, myUid);
    row.section = 'trial';
    row.isChampion = false;
    row.championLabel = '';
    row.rankText = String(i + 1);
    if (i === 0) { row.sectionHead = '观察期'; row.sectionSub = '满 ' + MIN_GAMES + ' 局后晋级正式榜'; }
    all.push(row);
  });

  let myRow = null;
  for (let i = 0; i < all.length; i++) if (all[i].isMe) { myRow = all[i]; break; }
  const champ = all.filter(function (r) { return r.isChampion; })[0] || null;
  return {
    list: all.slice(0, MAX_ROWS),
    myRow: myRow,
    total: all.length,
    officialCount: official.length,
    trialCount: trial.length,
    champion: champ
  };
}

/** 榜单视图模型：所有展示字段预先格式化，WXML 不做算术 */
function rowsVM(entries, myUid, opts) {
  const o = opts || {};
  const ranked = rankRows(entries, myUid);
  const mine = ranked.myRow;
  const games = mine ? Number(mine.gamesText) : 0;
  // 来源文案分三种，不能只分「云端 / 本机」两种：
  //   cloud  —— 云端可用，全站榜单
  //   login  —— 云端可用但未登录微信，只能看本机（这是「不同人看到不一样」的主因）
  //   local  —— 云服务本身没就绪（未联网 / SDK 不可用）
  // 未登录与云不可用对用户是两件完全不同的事：前者登录一下就能解决，
  // 后者只能排查环境。混成一句「云端未连接」会让人以为是网络问题。
  const source = o.source === 'cloud' ? 'cloud' : (o.loginRequired ? 'login' : 'local');
  const SOURCE_TEXT = {
    cloud: '全站榜单 · 数据来自云端',
    login: '未登录微信 · 仅显示本机战绩，登录后可见全站排名',
    local: '云端未连接 · 仅展示本机战绩'
  };
  const sourceText = SOURCE_TEXT[source];
  // 我的名次文案要带分组前缀：观察期是 3 号，正式榜也是 3 号，
  // 不加前缀会让人以为自己是「全站第 3」。
  let myRankText = '';
  if (mine) {
    const prefix = mine.section === 'trial' ? '观察期第 ' : '第 ';
    const suffix = mine.section === 'trial' ? ' 名（满 ' + MIN_GAMES + ' 局后转入正式榜）' : ' 名';
    myRankText = prefix + mine.rank + suffix + ' · 综合 ' + mine.ratingText + ' 分';
  }
  return {
    rows: ranked.list,
    myRow: mine,
    myRank: mine ? mine.rank : 0,
    mySection: mine ? mine.section : '',
    hasMe: !!mine,
    provisional: !mine || games < MIN_GAMES,
    needText: games < MIN_GAMES
      ? ('再打 ' + (MIN_GAMES - games) + ' 局即可脱离观察期')
      : '',
    empty: ranked.list.length === 0,
    // 是否真的需要滚动：按像素算，不靠行数猜。
    // 表格内容区 232px（234 减 2px 边框），表头 30px，
    // 分组标题 34px（每段一个），数据行 34px（带分组标题的首行 38px）。
    // 之前用「行数 > 7」的粗判，5 行 + 2 个标题 = 7 被判为不需要滚动，
    // 但实际 30 + 34*2 + 34*5 = 268px 装不下 —— 出现「明明截断了却没提示」。
    scrollable: (function () {
      const TABLE_INNER_H = 206;   // max-height 208 减去 2px 边框
      const HEAD_H = 30;
      const hasOfficial = ranked.officialCount > 0;
      const hasTrial = ranked.trialCount > 0;
      const SEC_H = 34 * ((hasOfficial ? 1 : 0) + (hasTrial ? 1 : 0));
      // 每个分段的首行因为要避开皇冠上溢，高 38px；其余 34px
      const firstRows = (hasOfficial ? 1 : 0) + (hasTrial ? 1 : 0);
      const ROW_H = 34 * ranked.list.length + 4 * firstRows;
      return HEAD_H + SEC_H + ROW_H > TABLE_INNER_H;
    })(),
    officialCount: ranked.officialCount,
    trialCount: ranked.trialCount,
    hasChampion: !!ranked.champion,
    championName: ranked.champion ? ranked.champion.name : '',
    // 观察期人数提示：正式榜为空时要说明「为什么没人戴冠」
    officialEmpty: ranked.officialCount === 0,
    trialHint: ranked.trialCount > 0
      ? (ranked.officialCount === 0
        ? ('还没有人满 ' + MIN_GAMES + ' 局，正式榜待产生；下方 ' + ranked.trialCount + ' 人处于观察期')
        : (ranked.trialCount + ' 人处于观察期，暂列下方'))
      : '',
    source: source,
    loginRequired: source === 'login',
    showLoginHint: source === 'login',
    sourceText: sourceText,
    // 文案统一在 VM 里拼好：WXML 表达式里做字符串拼接在部分 WebView 不稳
    sourceLine: sourceText + (o.updatedAt ? ' · 更新于 ' + o.updatedAt : ''),
    myRankText: myRankText,
    loading: !!o.loading,
    // 口径要写全：胜率项用了「样本量修正」的胜率（不是表里显示的原始胜率），
    // 不说明的话，玩家会问「我胜率 100% 为什么不如胜率 70% 的人」。
    formulaText: '综合分 = 胜率 220 + 最高胜场声望 90 + 场均声望 120 + 场均发展卡 60 + 场均贵族 60 + 回合速度 50 + 活跃度 80（各项归一化后加权）。胜率一项按局数折算可信度：局数少时向 50% 收敛，避免「打一局全胜」直接拿满；表中胜率仍显示真实值。',
    updatedText: o.updatedAt ? ('更新于 ' + o.updatedAt) : ''
  };
}

module.exports = {
  LEADERBOARD_TABLE: LEADERBOARD_TABLE,
  MIN_GAMES: MIN_GAMES,
  MIN_HUMANS: MIN_HUMANS,
  MAX_ROWS: MAX_ROWS,
  WEIGHTS: WEIGHTS,
  blank: blank,
  eligible: eligible,
  eligibleCount: eligibleCount,
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
