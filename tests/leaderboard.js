'use strict';
/** 天梯榜数据层回归：六项指标汇总 / 综合评分 / 稳定排名 / 云端契约与降级 */
const path = require('path');
const L = require(path.join(__dirname, '..', 'utils', 'leaderboard.js'));

function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }
function eq(a, b, msg) { assert(a === b, msg + ' expect=' + JSON.stringify(b) + ' got=' + JSON.stringify(a)); }
function near(a, b, msg) { assert(Math.abs(a - b) < 1e-6, msg + ' expect≈' + b + ' got=' + a); }

const RECORDS = [
  { win: true, score: 18, cards: 12, nobles: 2, turns: 20, turnAvgMs: 5000 },
  { win: false, score: 9, cards: 6, nobles: 0, turns: 10, turnAvgMs: 3000 },
  { win: true, score: 16, cards: 10, nobles: 1, turns: 20, turnAvgMs: 7000 }
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

/* ---------- 2. 旧战绩兼容 + 空数据 ---------- */
const legacy = L.fromRecords([{ win: false, score: 7, turns: 12 }]);
eq(legacy.games, 1, '旧记录仍计一局');
eq(legacy.totalCards, 0, '旧记录缺发展卡记 0');
eq(legacy.totalTurnMs, 0, '旧记录缺耗时记 0');
eq(L.rating(L.summarize(L.blank())), 0, '无对局评分 0');
eq(L.fromRecords(null).games, 0, '非数组输入不抛错');
console.log('OK  旧记录兼容 · 空数据安全');

/* ---------- 3. 综合评分：每一项都要真正影响分数 ---------- */
const base = L.summarize(L.fromRecords([
  { win: true, score: 16, cards: 10, nobles: 1, turns: 20, turnAvgMs: 5000 },
  { win: false, score: 10, cards: 8, nobles: 0, turns: 20, turnAvgMs: 5000 },
  { win: true, score: 17, cards: 11, nobles: 2, turns: 20, turnAvgMs: 5000 }
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

/* ---------- 4. 排名：稳定、同分有确定次序、我的行可定位 ---------- */
const a = L.entryOf('u-a', '甲', '', L.fromRecords(RECORDS));
const b = L.entryOf('u-b', '乙', '', L.fromRecords([
  { win: false, score: 5, cards: 3, nobles: 0, turns: 10, turnAvgMs: 9000 }
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
console.log('OK  视图模型 · 格式化 / 空态 / 离线说明');

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
  console.log('OK  云端契约 · 独立表 / 字段映射 / 无云与报错均静默降级');
}

runCloud().then(function () {
  console.log('ALL PASS');
}).catch(function (e) {
  console.error(e.message || e);
  process.exitCode = 1;
});
