'use strict';
/** 天梯榜数据层回归：六项指标汇总 / 综合评分 / 稳定排名 / 云端契约与降级 */
const path = require('path');
const L = require(path.join(__dirname, '..', 'utils', 'leaderboard.js'));

function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }
function eq(a, b, msg) { assert(a === b, msg + ' expect=' + JSON.stringify(b) + ' got=' + JSON.stringify(a)); }
function near(a, b, msg) { assert(Math.abs(a - b) < 1e-6, msg + ' expect≈' + b + ' got=' + a); }

// 天梯准入：必须是联机局（mode='room'）且真人 ≥ 2。
// 本文件后面所有「正常对局」样本都满足该条件。
const RECORDS = [
  { mode: 'room', humanCount: 2, win: true, score: 18, cards: 12, nobles: 2, turns: 20, turnAvgMs: 5000 },
  { mode: 'room', humanCount: 3, win: false, score: 9, cards: 6, nobles: 0, turns: 10, turnAvgMs: 3000 },
  { mode: 'room', humanCount: 4, win: true, score: 16, cards: 10, nobles: 1, turns: 20, turnAvgMs: 7000 }
];

/* ---------- 1. 六项指标：累计量 → 均值 ---------- */
const totals = L.fromRecords(RECORDS);
eq(totals.games, 3, '总局数');
eq(totals.wins, 2, '胜场数量');
eq(totals.bestWinScore, 18, '最高胜场声望只取胜局');
eq(totals.totalScore, 43, '总声望');
eq(totals.totalCards, 28, '总发展卡');
eq(totals.totalNobles, 3, '总贵族');
eq(totals.totalTurns, 50, '总回合数');
eq(totals.totalTurnMs, 270000, '总耗时按回合数加权');
const s = L.summarize(totals);
near(s.winRate, 2 / 3, '胜率');
near(s.avgScore, 43 / 3, '场均声望');
near(s.avgCards, 28 / 3, '场均发展卡');
near(s.avgNobles, 1, '场均贵族');
near(s.avgTurnMs, 5400, '回合平均耗时按回合数加权');
near(s.avgTurnSec, 5.4, '回合平均耗时（秒）');
console.log('OK  六项指标 · 累计量 / 均值 / 按回合加权');

/* ---------- 2. 旧战绩兼容 + 空数据 ----------
   注意口径变化：天梯准入要求「联机 + 真人≥2」，旧记录既没有 mode 也没有
   humanCount，属于「无法判定」，一律不计入榜单 —— 这里验的正是这条。
   字段缺失但准入合法的记录，缺的那几项指标仍按 0 计，不影响其余统计。 */
const legacyNotEligible = L.fromRecords([{ win: false, score: 7, turns: 12 }]);
eq(legacyNotEligible.games, 0, '缺 mode/humanCount 的旧记录不进天梯');
const legacyOk = L.fromRecords([{ mode: 'room', humanCount: 2, win: false, score: 7, turns: 12 }]);
eq(legacyOk.games, 1, '准入合法但缺指标字段时仍计一局');
eq(legacyOk.totalCards, 0, '旧记录缺发展卡记 0');
eq(legacyOk.totalTurnMs, 0, '旧记录缺耗时记 0');
eq(L.rating(L.summarize(L.blank())), 0, '无对局评分 0');
eq(L.fromRecords(null).games, 0, '非数组输入不抛错');
console.log('OK  旧记录兼容 · 空数据安全');

/* ---------- 2.1 天梯准入：人机局 / 单真人局不收 ---------- */
{
  const solo = { mode: 'solo', humanCount: 1, win: true, score: 15, cards: 9, nobles: 1, turns: 10, turnAvgMs: 4000 };
  const roomOneHuman = { mode: 'room', humanCount: 1, win: true, score: 15, cards: 9, nobles: 1, turns: 10, turnAvgMs: 4000 };
  const roomTwoHuman = { mode: 'room', humanCount: 2, win: true, score: 15, cards: 9, nobles: 1, turns: 10, turnAvgMs: 4000 };
  const noHumanField = { mode: 'room', win: true, score: 15, cards: 9, nobles: 1, turns: 10, turnAvgMs: 4000 };

  eq(L.eligible(solo), false, '人机局不进天梯');
  eq(L.eligible(roomOneHuman), false, '联机但只有 1 名真人不进天梯');
  eq(L.eligible(roomTwoHuman), true, '联机 2 名真人可进天梯');
  eq(L.eligible(noHumanField), false, '缺 humanCount 视为无法判定，不放行');
  eq(L.eligible(null), false, '空记录不抛错且不放行');

  // 4 人房 2 机器人补位：只算 2 真人，仍合格
  eq(L.eligible({ mode: 'room', humanCount: 2, playerCount: 4 }), true, '4 人房 2 真人 2 机器人仍合格');
  // 托管中的真人仍是真人（引擎用 isAI 区分，humanCount 已按此口径算好）
  eq(L.eligible({ mode: 'room', humanCount: 2, autoPlay: true }), true, '真人托管不降低真人数');

  eq(L.fromRecords([solo, roomOneHuman, roomTwoHuman]).games, 1, '混合记录只累计合格局');
  eq(L.eligibleCount([solo, roomOneHuman, roomTwoHuman, roomTwoHuman]), 2, 'eligibleCount 只数合格局');

  // 全不合格时评分为 0，且发布应被拦截（不能占一行 0 分）
  eq(L.rating(L.summarize(L.fromRecords([solo, roomOneHuman]))), 0, '无合格局评分 0');
  console.log('OK  天梯准入 · 人机局与单真人局被排除');
}

/* ---------- 3. 综合评分：每一项都要真正影响分数 ---------- */
const base = L.summarize(L.fromRecords([
  { mode: 'room', humanCount: 2, win: true, score: 16, cards: 10, nobles: 1, turns: 20, turnAvgMs: 5000 },
  { mode: 'room', humanCount: 2, win: false, score: 10, cards: 8, nobles: 0, turns: 20, turnAvgMs: 5000 },
  { mode: 'room', humanCount: 2, win: true, score: 17, cards: 11, nobles: 2, turns: 20, turnAvgMs: 5000 }
]));
const baseScore = L.rating(base);
assert(baseScore > 0, '有效战绩评分必须 > 0');

function scoreWith(patch) {
  const t = L.mergeTotals(totals, L.blank());
  Object.keys(patch).forEach(function (k) { t[k] = patch[k]; });
  return L.rating(L.summarize(t));
}
assert(scoreWith({ wins: 3 }) > baseScore, '胜场/胜率更高应加分');
assert(scoreWith({ bestWinScore: 25 }) >= baseScore, '最高胜场声望更高不减分');
assert(scoreWith({ totalScore: 60 }) > baseScore, '场均声望更高应加分');
assert(scoreWith({ totalCards: 45 }) > baseScore, '场均发展卡更高应加分');
assert(scoreWith({ totalNobles: 9 }) > baseScore, '场均贵族更高应加分');
// 回合平均耗时越短分越高：把总耗时放大 10 倍，速度项归零
assert(scoreWith({ totalTurnMs: 2700000 }) < baseScore, '回合平均耗时更长应减分');
// 活跃度：同样胜率下多打的人更靠前
const more = L.summarize(L.fromRecords(RECORDS.concat(RECORDS)));
assert(L.rating(more) > baseScore, '局数更多应提高活跃度得分');
console.log('OK  综合评分 · 六项指标 + 活跃度都参与且方向正确');

/* ---------- 3.1 胜率可信度：样本少不能靠运气刷满胜率分 ---------- */
{
  function mk(g, w) {
    return L.summarize({
      games: g, wins: w, bestWinScore: 15, totalScore: g * 14,
      totalCards: g * 9, totalNobles: 0, totalTurns: g * 30, totalTurnMs: g * 30 * 4000
    });
  }

  // 原始胜率照旧保留真实值：界面显示「1/1 = 100%」，不能被平滑成 58%
  const one = mk(1, 1);
  eq(one.winRate, 1, '原始胜率保持 100%，界面要显示真实数字');
  assert(one.adjWinRate < 1, '1 局全胜的评分用胜率必须打折，实际 ' + one.adjWinRate);
  near(one.adjWinRate, (1 + 2.5) / 6, '1 局全胜收缩到 58.3%');

  // 样本越多越接近真实胜率
  const three = mk(3, 3);
  const ten = mk(10, 10);
  const twenty = mk(20, 20);
  assert(one.adjWinRate < three.adjWinRate, '3 局全胜的可信度应高于 1 局');
  assert(three.adjWinRate < ten.adjWinRate, '10 局更高');
  assert(ten.adjWinRate < twenty.adjWinRate, '20 局更高');
  assert(twenty.adjWinRate < 1, '即使 20 局全胜也不给满，永远留一手');

  // 只向下收缩：输家不给安慰分
  const lose1 = mk(1, 0);
  eq(lose1.adjWinRate, 0, '0 胜 1 局不得被抬高到 42%');
  const half = mk(4, 2);
  near(half.adjWinRate, 0.5, '恰好 50% 不做任何调整');
  const below = mk(10, 3);
  near(below.adjWinRate, 0.3, '低于 50% 保持原值，不向上抬');

  // 核心诉求：稳定玩家必须压过一局运气
  const lucky = mk(1, 1);
  const solid = L.summarize({
    games: 20, wins: 14, bestWinScore: 15, totalScore: 290,
    totalCards: 180, totalNobles: 12, totalTurns: 600, totalTurnMs: 600 * 4000
  });
  assert(L.rating(solid) > L.rating(lucky),
    '20 局 14 胜应高于 1 局 1 胜，实际 solid=' + L.rating(solid) + ' lucky=' + L.rating(lucky));

  // 评分必须真的用 adjWinRate 而不是原始胜率：
  // 1 局里「赢」比「输」多拿的分，应是收缩后的额度（约 128），
  // 而不是满额 220 —— 否则等于胜率项没打折扣。
  const winDiff = L.rating(mk(1, 1)) - L.rating(mk(1, 0));
  const fullYield = L.WEIGHTS.winRate;
  assert(winDiff < fullYield * 0.75,
    '1 局全胜不应拿满胜率分，实际差值 ' + winDiff + '（满分 ' + fullYield + '）');
  assert(winDiff > fullYield * 0.4,
    '差距也不能小到胜率失去意义，实际差值 ' + winDiff);

  // 同胜率、样本不同 → 样本多的分更高
  const few = mk(3, 3);
  const many = mk(20, 20);
  assert(L.rating(many) > L.rating(few), '全胜时局数多的人分更高');

  console.log('OK  胜率可信度 · 样本少向下收缩 / 输家不抬分 / 稳定玩家优先');
}

/* ---------- 3.2 速度项：阈值 90s，不为难正常思考 ---------- */
{
  // 构造若干「只差速度」的玩家：其他指标完全一致，只改每次行动耗时
  function withSpeed(secPerTurn, turns) {
    const t = turns || 30;
    return L.summarize({
      games: 1, wins: 1, bestWinScore: 15, totalScore: 15,
      totalCards: 9, totalNobles: 1,
      totalTurns: t, totalTurnMs: Math.round(secPerTurn * 1000 * t)
    });
  }

  // 13 秒/行动是实测的正常节奏，不应被判成「慢」
  const normal = withSpeed(13);
  near(normal.avgTurnSec, 13, '13s/行动应被正确还原');
  const normalScore = L.rating(normal);
  const fast = L.rating(withSpeed(5));
  const slow = L.rating(withSpeed(85));
  const stall = L.rating(withSpeed(120));

  assert(fast > normalScore, '更快应更高分（保持方向不变）');
  assert(normalScore > slow, '正常快于接近阈值的人');
  assert(slow > stall, '90s 以内仍有分，超过则归零');

  // 关键：13s 不该被判成接近 0 分。旧阈值 45s 下速度项仅 36/50，
  // 新阈值应为 43/50 —— 用「与 5s 的分差」间接锁定，避免复算实现细节。
  const gap = fast - normalScore;
  assert(gap <= 8, '5s 与 13s 的速度分差不应过大（实际 ' + gap + '），否则正常思考被过度惩罚');

  // 超过 90s 必须归零，不能给挂机者递分
  const over = withSpeed(88);
  const wayOver = withSpeed(95);
  assert(L.rating(over) > L.rating(wayOver), '88s 应得分高于 95s（后者归零）');

  console.log('OK  速度项 · 阈值 90s / 正常节奏不吃亏 / 超时归零');

  // 胜率列文案「50%(2/4)」：百分比 + 分子/分母，让人看清样本基础
  {
    const row = L.formatRow(L.entryOf('u1', '甲', '', L.fromRecords([
      { mode:'room', humanCount:2, win:true, score:15, cards:9, nobles:1, turns:10, turnAvgMs:4000 },
      { mode:'room', humanCount:2, win:true, score:14, cards:8, nobles:0, turns:10, turnAvgMs:4000 },
      { mode:'room', humanCount:2, win:false, score:12, cards:7, nobles:0, turns:10, turnAvgMs:4000 },
      { mode:'room', humanCount:2, win:false, score:11, cards:6, nobles:0, turns:10, turnAvgMs:4000 }
    ])), 1, 'x');
    eq(row.winRateFullText, '50%(2/4)', '2 胜 4 局应显示 50%(2/4)');
    // 原始胜率仍在，便于别的场合单独使用
    eq(row.winRateText, '50%', 'winRateText 保持纯百分比');

    // 1 局全胜必须显示 100%(1/1)，不能只给 100% —— 那会掩盖样本极少
    const one = L.formatRow(L.entryOf('u2', '乙', '', L.fromRecords([
      { mode:'room', humanCount:2, win:true, score:15, cards:13, nobles:1, turns:10, turnAvgMs:4000 }
    ])), 1, 'x');
    eq(one.winRateFullText, '100%(1/1)', '1 局全胜应显示 100%(1/1)');

    // 0 局不能出现 0%(0/0) 这种无意义除法
    const none = L.formatRow(L.entryOf('u3', '丙', '', L.fromRecords([])), 1, 'x');
    eq(none.winRateFullText, '—', '0 局显示破折号而不是 0%(0/0)');
  }
  console.log('OK  胜率列文案 · 合并显示百分比与胜负场 / 0 局不显示无意义除法');
}

/* ---------- 4. 排名：稳定、同分有确定次序、我的行可定位 ---------- */
const a = L.entryOf('u-a', '甲', '', L.fromRecords(RECORDS));
const b = L.entryOf('u-b', '乙', '', L.fromRecords([
  { mode: 'room', humanCount: 2, win: false, score: 5, cards: 3, nobles: 0, turns: 10, turnAvgMs: 9000 }
]));
const c = L.entryOf('u-c', '丙', '', L.blank());
const ranked = L.rankRows([c, b, a], 'u-b');
eq(ranked.list.length, 3, '三行都要出现，不能因为局数少就藏起来');
eq(ranked.list[0].uid, 'u-a', '强玩家排第一');
eq(ranked.list[0].rank, 1, '名次从 1 开始');
eq(ranked.myRow.uid, 'u-b', '能定位自己的行');
assert(ranked.list[2].provisional, '0 局标记观察期');
const again = L.rankRows([a, c, b], 'u-b');
eq(again.list[0].uid, 'u-a', '输入顺序变化不影响结果');
eq(again.list[2].uid, 'u-c', '稳定排序：同分按 uid 兜底');
console.log('OK  排名 · 稳定 / 名次 / 我的行 / 观察期');

/* ---------- 5. 视图模型：展示字段预先格式化 ---------- */
const vm = L.rowsVM([c, b, a], 'u-b', { source: 'cloud', updatedAt: '22:30' });
eq(vm.rows.length, 3, '行透传');
eq(vm.myRank, vm.myRow.rank, '我的名次与行一致');
assert(vm.sourceLine.indexOf('全站榜单') >= 0 && vm.sourceLine.indexOf('22:30') >= 0, '来源与更新时间拼好');
assert(vm.myRankText.indexOf('综合') >= 0, '我的排名文案预计算');
eq(typeof vm.rows[0].avgScoreText, 'string', '指标为字符串，WXML 不做算术');
assert(vm.rows[0].avgTurnText.indexOf('s') > 0, '耗时带单位');
assert(vm.formulaText.indexOf('胜率') >= 0, '评分口径要写在界面上');
const localVM = L.rowsVM([], 'u-x', { source: 'local' });
eq(localVM.empty, true, '空榜单有空态');
eq(localVM.hasMe, false, '空榜单无我的行');
assert(localVM.sourceText.indexOf('云端未连接') >= 0, '离线来源如实说明');

/* ---------- 5.1 来源三态：云端 / 未登录 / 云不可用 ---------- */
{
  const cloudVM = L.rowsVM([a], 'u-a', { source: 'cloud', updatedAt: '22:30' });
  eq(cloudVM.source, 'cloud', '云端可用时来源为 cloud');
  eq(cloudVM.showLoginHint, false, '云端可用时不提示登录');
  assert(cloudVM.sourceText.indexOf('全站榜单') >= 0, '云端应显示全站榜单');

  const loginVM = L.rowsVM([a], 'u-a', { source: 'local', loginRequired: true });
  eq(loginVM.source, 'login', '未登录时来源为 login');
  eq(loginVM.loginRequired, true, '标记需要登录');
  eq(loginVM.showLoginHint, true, '未登录应给出登录提示');
  assert(loginVM.sourceText.indexOf('未登录') >= 0, '未登录要说明未登录');
  assert(loginVM.sourceText.indexOf('登录后可见全站') >= 0, '要说明登录后能看到全站');
  // 未登录与云不可用必须能区分，否则用户会去排查网络
  assert(loginVM.sourceText.indexOf('云端未连接') < 0, '未登录不该说成云端未连接');

  const localVM2 = L.rowsVM([a], 'u-a', { source: 'local' });
  eq(localVM2.source, 'local', '云不可用时来源为 local');
  eq(localVM2.showLoginHint, false, '云不可用时不提示登录');
  assert(localVM2.sourceText.indexOf('云端未连接') >= 0, '云不可用才说云端未连接');

  console.log('OK  来源三态 · 云端 / 未登录 / 云不可用互不混淆');
}
console.log('OK  视图模型 · 格式化 / 空态 / 离线说明');

/* ---------- 6. 榜首专属头像框：只给真正上榜的第 1 名 ---------- */
{
  // a 是 3 局全优的强玩家，排名第一
  const top = L.entryOf('u-a', '甲', '', L.fromRecords(RECORDS));
  // 造一个只有 1 局的弱玩家：即便凑数排到前面，观察期也不该戴皇冠
  const rookie = L.entryOf('u-r', '新人', '', L.fromRecords([
    { mode: 'room', humanCount: 2, win: true, score: 15, cards: 5, nobles: 0, turns: 10, turnAvgMs: 2000 }
  ]));

  const vmChamp = L.rowsVM([top, b, c], 'u-b', { source: 'cloud' });
  eq(vmChamp.rows[0].uid, 'u-a', '强玩家排第一');
  eq(vmChamp.rows[0].isChampion, true, '榜首应获得专属头像框');
  eq(vmChamp.rows[0].championLabel, '榜首', '榜首标签文案');
  // 其余行一律不是冠军，不能出现「人人有框」
  eq(vmChamp.rows[1].isChampion, false, '第二名没有专属框');
  eq(vmChamp.rows[2].isChampion, false, '观察期玩家没有专属框');
  eq(vmChamp.rows[2].championLabel, '', '非榜首标签为空');

  // 观察期玩家即使排到第 1 名也不授予皇冠（打一局就拿最显眼标识会误导）
  const vmRookie = L.rowsVM([rookie], 'u-x', { source: 'cloud' });
  eq(vmRookie.rows[0].rank, 1, '只有一局时也是第 1 名');
  eq(vmRookie.rows[0].provisional, true, '一局属于观察期');
  eq(vmRookie.rows[0].isChampion, false, '观察期不授予榜首头像框');

  // 空榜单不能崩，也不能凭空给框
  const vmEmpty = L.rowsVM([], 'u-x', { source: 'local' });
  eq(vmEmpty.rows.length, 0, '空榜单没有行');
  assert(!vmEmpty.rows.some(function (r) { return r.isChampion; }), '空榜单没有冠军');

  // 并列时只能有一个冠军（名次唯一，不会并列）
  const twin = [
    L.entryOf('u-1', '甲', '', L.fromRecords(RECORDS)),
    L.entryOf('u-2', '乙', '', L.fromRecords(RECORDS))
  ];
  const vmTwin = L.rowsVM(twin, 'u-1', { source: 'cloud' });
  const champs = vmTwin.rows.filter(function (r) { return r.isChampion; });
  eq(champs.length, 1, '同分并列时冠军也只授 1 人');

  console.log('OK  榜首头像框 · 仅第 1 名且脱离观察期 / 并列只授一人');
}

/* ---------- 7. 分段排名：正式榜与观察期各自独立编号 ---------- */
{
  const official1 = L.entryOf('u-off1', '老将', '', L.fromRecords([
    { mode:'room', humanCount:2, win:true, score:15, cards:9, nobles:1, turns:20, turnAvgMs:5000 },
    { mode:'room', humanCount:2, win:true, score:14, cards:8, nobles:0, turns:20, turnAvgMs:5000 },
    { mode:'room', humanCount:2, win:false, score:12, cards:7, nobles:0, turns:20, turnAvgMs:5000 }
  ]));
  const official2 = L.entryOf('u-off2', '次将', '', L.fromRecords([
    { mode:'room', humanCount:2, win:false, score:9, cards:5, nobles:0, turns:20, turnAvgMs:6000 },
    { mode:'room', humanCount:2, win:false, score:8, cards:4, nobles:0, turns:20, turnAvgMs:6000 },
    { mode:'room', humanCount:2, win:false, score:7, cards:3, nobles:0, turns:20, turnAvgMs:6000 }
  ]));
  // 新人分高但只有 1 局：混排会排第 1，分段后应落到观察期
  const rookie = L.entryOf('u-new', '新人', '', L.fromRecords([
    { mode:'room', humanCount:2, win:true, score:18, cards:12, nobles:2, turns:10, turnAvgMs:1000 }
  ]));

  const vm = L.rowsVM([rookie, official1, official2], 'u-new', { source: 'cloud' });

  // 正式榜必须排在前面，且第 1 名是正式榜里分数最高的人
  eq(vm.rows[0].uid, 'u-off1', '正式榜第一应是资深玩家，不是数据少的新人');
  eq(vm.rows[0].section, 'official', '首行属于正式榜');
  eq(vm.rows[0].isChampion, true, '冠军授予正式榜第 1 名');
  eq(vm.rows[1].section, 'official', '第二行仍是正式榜');
  eq(vm.rows[1].rankText, '2', '正式榜内部按 1、2 编号');
  eq(vm.rows[1].isChampion, false, '正式榜第 2 不戴冠');

  // 观察期独立编号：从 1 重新开始
  eq(vm.rows[2].section, 'trial', '新人进入观察期段');
  eq(vm.rows[2].rankText, '1', '观察期独立编号，从 1 开始（而不是混排第 3）');
  eq(vm.rows[2].rank, 1, '观察期内部名次为 1');
  eq(vm.rows[2].isChampion, false, '观察期第 1 不戴冠');
  eq(vm.rows[2].championLabel, '', '观察期无榜首标签');

  // 分组标题只出现在每段第一行
  eq(vm.rows[0].sectionHead, '正式榜', '正式榜首行带标题');
  eq(vm.rows[1].sectionHead, '', '正式榜第二行不重复标题');
  eq(vm.rows[2].sectionHead, '观察期', '观察期首行带标题');

  eq(vm.officialCount, 2, '正式榜人数');
  eq(vm.trialCount, 1, '观察期人数');
  eq(vm.hasChampion, true, '存在冠军');
  eq(vm.championName, '老将', '冠军姓名');

  // 我的名次文案必须带分组前缀，否则会被误读成全站第 1
  assert(vm.myRankText.indexOf('观察期第 1') === 0, '观察期名次带分组前缀：' + vm.myRankText);
  assert(vm.myRankText.indexOf('转入正式榜') > 0, '提示晋级条件');

  console.log('OK  分段排名 · 正式榜在前 / 观察期独立从 1 编号 / 皇冠只给正式榜第一');
}

/* ---------- 7.1 只有观察期玩家时：正式榜为空，无人戴冠 ---------- */
{
  const r1 = L.entryOf('u-r1', '甲', '', L.fromRecords([
    { mode:'room', humanCount:2, win:true, score:15, cards:9, nobles:1, turns:10, turnAvgMs:3000 }
  ]));
  const r2 = L.entryOf('u-r2', '乙', '', L.fromRecords([
    { mode:'room', humanCount:2, win:false, score:9, cards:5, nobles:0, turns:10, turnAvgMs:4000 }
  ]));
  const vm = L.rowsVM([r1, r2], 'u-r1', { source: 'cloud' });
  eq(vm.officialCount, 0, '无人满 3 局时正式榜为空');
  eq(vm.hasChampion, false, '没有正式榜第一时不授冠');
  assert(!vm.rows.some(function (r) { return r.isChampion; }), '全榜无人戴冠');
  eq(vm.rows[0].rankText, '1', '观察期仍从 1 编号');
  eq(vm.officialEmpty, true, '标记正式榜为空');
  assert(vm.trialHint.indexOf('还没有人满') >= 0, '要说明为什么没人戴冠：' + vm.trialHint);
  console.log('OK  分段排名 · 正式榜为空时如实说明且不授冠');
}

/* ---------- 6. 云端表字段往返 ---------- */
const cloudRow = L.entryToCloud(a, L.rating(L.summarize(a.totals)));
eq(cloudRow.uid, 'u-a', 'uid 落库');
eq(cloudRow.best_win_score, 18, '最高胜场声望列名');
eq(cloudRow.total_turn_ms, 270000, '总耗时列名');
const back = L.cloudToEntry(cloudRow);
eq(back.uid, 'u-a', '读回 uid');
eq(back.totals.games, 3, '读回局数');
eq(back.totals.bestWinScore, 18, '读回最高胜场声望');
eq(L.cloudToEntry(null), null, '脏行直接丢弃');

function mockCloud(rows, fail) {
  const calls = [];
  const q = {
    from(t) { calls.push(['from', t]); return q; },
    upsert(row) {
      calls.push(['upsert', row]);
      return Promise.resolve(fail ? { error: { message: 'table missing' } } : { data: [row], error: null });
    },
    select() { calls.push(['select']); return q; },
    // 与真实 SDK 同签名：order(column, { ascending, nullsFirst })
    order(col, opt) {
      calls.push(['order', col, opt && opt.ascending]);
      return q;
    },
    limit(n) { calls.push(['limit', n]); return q; },
    then(resolve, reject) {
      return Promise.resolve(fail ? { error: { message: 'boom' } } : { data: rows || [], error: null })
        .then(resolve, reject);
    }
  };
  return { cloud: { database: { from: function (t) { return q.from(t); } } }, calls: calls };
}

async function runCloud() {
  const ok = mockCloud([], false);
  const pub = await L.publish(ok.cloud, { uid: 'u-a', nickname: '甲', avatarData: '' }, totals);
  eq(pub.ok, true, '有云时应写入成功');
  eq(ok.calls[0][1], L.LEADERBOARD_TABLE, '写独立天梯表，不碰 splendor_records');
  const up = ok.calls.filter(function (c) { return c[0] === 'upsert'; })[0];
  eq(up[1].games, 3, '写累计局数');
  eq(up[1].rating, pub.rating, '写综合分');
  assert(up[1].updated_at, '写更新时间');

  const pulled = mockCloud([cloudRow], false);
  const rows = await L.fetchRows(pulled.cloud);
  eq(rows.length, 1, '应拉回 1 行');
  eq(rows[0].uid, 'u-a', 'uid 映射');
  eq(rows[0].totals.totalTurnMs, 270000, '累计耗时映射');

  // 无云 / 表不存在 / 抛异常：全部静默返回，绝不打断结算
  eq((await L.publish(null, { uid: 'u-a' }, totals)).ok, false, '无云时 publish 降级');
  eq((await L.fetchRows(null)).length, 0, '无云时 fetchRows 返回空');
  const bad = mockCloud([], true);
  eq((await L.publish(bad.cloud, { uid: 'u-a' }, totals)).ok, false, '云端报错时 publish 降级');
  eq((await L.fetchRows(bad.cloud)).length, 0, '云端报错时 fetchRows 返回空');

  // 没有任何合格对局时不许上榜：否则「只打过人机局的人」也会占一行 0 分
  const empty = mockCloud([], false);
  const pubEmpty = await L.publish(empty.cloud, { uid: 'u-a', nickname: '甲' }, L.blank());
  eq(pubEmpty.ok, false, '0 局不上榜');
  eq(pubEmpty.error, 'no-eligible-games', '0 局时给出明确原因');
  eq(empty.calls.length, 0, '0 局时根本不该发起写请求');

  // 只有不合格对局（人机局）时同样不上榜
  const soloOnly = L.fromRecords([{ mode: 'solo', humanCount: 1, win: true, score: 15, turns: 10 }]);
  eq(soloOnly.games, 0, '人机局累计为 0 局');
  const soloCloud = mockCloud([], false);
  eq((await L.publish(soloCloud.cloud, { uid: 'u-a', nickname: '甲' }, soloOnly)).ok, false, '只有人机局不上榜');

  // fetchRows 必须带 order 再 limit：否则超过上限时返回子集不确定，
  // 不同玩家会看到不同的榜单。这里断言查询链真的调用了 order。
  const ordered = mockCloud([cloudRow], false);
  await L.fetchRows(ordered.cloud);
  const orderCalls = ordered.calls.filter(function (c) { return c[0] === 'order'; });
  assert(orderCalls.length >= 1, 'fetchRows 必须按评分排序，实际 order 调用 ' + orderCalls.length);
  eq(orderCalls[0][1], 'rating', '首要排序字段为 rating');
  eq(orderCalls[0][2], false, '按 rating 降序（ascending=false）');
  // order 必须在 limit 之前生效，否则先截断再排序等于没排
  const iOrder = ordered.calls.findIndex(function (c) { return c[0] === 'order'; });
  const iLimit = ordered.calls.findIndex(function (c) { return c[0] === 'limit'; });
  assert(iOrder >= 0 && iLimit > iOrder, 'order 必须先于 limit（先排序再截断）');

  console.log('OK  云端契约 · 独立表 / 字段映射 / 无云与报错均静默降级 / 无合格局不上榜 / 拉取有序');
}

runCloud().then(function () {
  console.log('ALL PASS');

/* ---------- 18. 昵称敏感字过滤 ---------- */
{
  const N = require(path.join(__dirname, '..', 'utils', 'nickname.js'));

  // 基本替换：命中字符变 '*'，长度不变
  eq(N.maskName('康爸'), '*爸', '单位置命中替换');
  eq(N.maskName('康康'), '**', '多处命中全部替换');
  eq(N.maskName('健康'), '健*', '非首字命中同样替换');
  eq(N.maskName('康'), '*', '单字昵称');
  eq(N.maskName('康康康'), '***', '连续命中');
  // 长度必须不变：长度若变化，榜单单宽与头像首字会跟着跳
  eq(N.maskName('康爸').length, '康爸'.length, '替换后长度不变');
  eq(N.maskName('康康').length, 2, '两字昵称替换后仍是两字');

  // 不该动的
  eq(N.maskName('珠宝商'), '珠宝商', '无敏感字原样返回');
  eq(N.maskName('Vincent'), 'Vincent', '英文昵称不受影响');
  eq(N.maskName(''), '', '空值原样返回，不要变成 *');
  eq(N.maskName(null), '', 'null 安全');

  // 天梯榜：名字与头像首字都必须过滤
  {
    // 必须满 MIN_GAMES 局才会进正式榜并授冠，否则测的是「无冠军」的分支
    const e = L.entryOf('u-k', '康爸', '', L.fromRecords([
      { mode:'room', humanCount:2, win:true, score:15, cards:9, nobles:1, turns:30, turnAvgMs:13000 },
      { mode:'room', humanCount:2, win:true, score:14, cards:8, nobles:0, turns:30, turnAvgMs:13000 },
      { mode:'room', humanCount:2, win:false, score:12, cards:7, nobles:0, turns:30, turnAvgMs:13000 }
    ]));
    const row = L.formatRow(e, 1, 'x');
    eq(row.name, '*爸', '榜单名字应过滤');
    eq(row.initial, '*', '头像首字也要过滤 —— 只改 name 会让首字露出敏感字');

    // 冠军名走的是同一份 vm，也要过滤
    const vm = L.rowsVM([e], 'x', { source: 'cloud' });
    eq(vm.championName, '*爸', '冠军名字应过滤');
    assert(JSON.stringify(vm.rows).indexOf('康') < 0, '整个视图模型不得残留敏感字');

    // 「康康」两个字都要替换，不能只换第一个
    const e2 = L.entryOf('u-k2', '康康', '', L.fromRecords([
      { mode:'room', humanCount:2, win:true, score:15, cards:9, nobles:1, turns:30, turnAvgMs:13000 }
    ]));
    eq(L.formatRow(e2, 1, 'x').name, '**', '两字均命中');
  }

  console.log('OK  昵称敏感字过滤 · 全量替换 / 长度不变 / 榜单与首字均生效');
}
}).catch(function (e) {
  console.error(e.message || e);
  process.exitCode = 1;
});
