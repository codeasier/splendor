'use strict';
const nodePath = require('path');
const path = nodePath.join(__dirname, '..', 'utils') + nodePath.sep;
const E = require(path + 'game-engine.js');
const AI = require(path + 'ai.js');
const D = require(path + 'game-data.js');
const TOKENS = D.ALL_TOKENS;

function assert(cond, msg) {
  if (!cond) { throw new Error('FAIL: ' + msg); }
}

function checkConservation(s) {
  const expect = { white: 4, blue: 4, green: 4, red: 4, black: 4, gold: 5 };
  TOKENS.forEach(function (g) {
    let sum = s.bank[g];
    s.players.forEach(function (p) { sum += p.tokens[g]; });
    assert(sum === expect[g], '筹码守恒 ' + g + ' expect=' + expect[g] + ' got=' + sum);
    assert(s.bank[g] >= 0, 'bank 不为负 ' + g);
    s.players.forEach(function (p) { assert(p.tokens[g] >= 0, '玩家筹码不为负 ' + g); });
  });
  let cards = 0;
  s.decks.forEach(function (d) { cards += d.length; });
  s.board.forEach(function (row) { row.forEach(function (c) { if (c) cards += 1; }); });
  s.players.forEach(function (p) { cards += p.cards.length + p.reserved.length; });
  assert(cards === 90, '卡牌守恒 expect=90 got=' + cards);
}

// 基础初始化
const s0 = E.createGame(2);
assert(s0.decks[0].length === 36 && s0.decks[1].length === 26 && s0.decks[2].length === 16, '牌库初始数量');
assert(s0.board.every(function (r) { return r.length === 4 && r.every(function (c) { return !!c; }); }), '每级 4 张明牌');
assert(s0.nobles.length === 3, '2 人局 3 张贵族');
checkConservation(s0);
console.log('初始化校验通过');

// 官方牌组指纹：40 / 30 / 20，每色 8 / 6 / 4，全库 140 声望
// 这些数字来自官方卡表，任何改动都必须先改卡表再改断言，不允许「凑数」
const officialDecks = D.buildDecks(D.mulberry32(7));
const officialAll = officialDecks[0].concat(officialDecks[1], officialDecks[2]);
assert(officialDecks[0].length === 40 && officialDecks[1].length === 30 && officialDecks[2].length === 20, '官方牌组应为 40/30/20');
assert(officialAll.length === 90, '官方牌组共 90 张');
assert(officialAll.reduce(function (a, c) { return a + c.points; }, 0) === 140, '官方牌组声望合计应为 140');

const expectByLevel = {
  1: { count: 8, points: 1 },
  2: { count: 6, points: 11 },
  3: { count: 4, points: 16 }
};
[1, 2, 3].forEach(function (lv) {
  D.GEMS.forEach(function (gem) {
    const group = officialAll.filter(function (c) { return c.level === lv && c.gem === gem; });
    assert(group.length === expectByLevel[lv].count, 'L' + lv + ' ' + gem + ' 应为 ' + expectByLevel[lv].count + ' 张，实际 ' + group.length);
    const pts = group.reduce(function (a, c) { return a + c.points; }, 0);
    assert(pts === expectByLevel[lv].points, 'L' + lv + ' ' + gem + ' 声望应为 ' + expectByLevel[lv].points + '，实际 ' + pts);
  });
});

// 成本总额分布：一级 3/4/5 各 10/15/15，二级 5/6/7/8 各 5/5/10/10，三级 7/10/12/14 各 5 张
function totalCost(c) { return D.GEMS.reduce(function (a, g) { return a + c.cost[g]; }, 0); }
function costProfile(lv) {
  const out = {};
  officialAll.filter(function (c) { return c.level === lv; }).forEach(function (c) {
    const t = totalCost(c);
    out[t] = (out[t] || 0) + 1;
  });
  return out;
}
assert(JSON.stringify(costProfile(1)) === JSON.stringify({ 3: 10, 4: 15, 5: 15 }), '一级成本分布不符: ' + JSON.stringify(costProfile(1)));
assert(JSON.stringify(costProfile(2)) === JSON.stringify({ 5: 5, 6: 5, 7: 10, 8: 10 }), '二级成本分布不符: ' + JSON.stringify(costProfile(2)));
assert(JSON.stringify(costProfile(3)) === JSON.stringify({ 7: 5, 10: 5, 12: 5, 14: 5 }), '三级成本分布不符: ' + JSON.stringify(costProfile(3)));

// 每色都有一张「单色高成本」牌：三级 7 成本 4 分、二级 6 成本 3 分、一级 4 成本 1 分
D.GEMS.forEach(function (gem) {
  const find = function (lv, amount, points) {
    return officialAll.some(function (c) {
      return c.level === lv && c.gem === gem && c.points === points &&
        D.GEMS.filter(function (g) { return c.cost[g] > 0; }).length === 1 &&
        totalCost(c) === amount;
    });
  };
  assert(find(3, 7, 4), gem + ' 缺三级 7 成本 4 分牌');
  assert(find(2, 6, 3), gem + ' 缺二级 6 成本 3 分牌');
  assert(find(1, 4, 1), gem + ' 缺一级 4 成本 1 分牌');
});

// 卡名与写实卡面槽位必须 90 张全不重复（5 色 × 18 个插画位）
assert(new Set(officialAll.map(function (c) { return c.name; })).size === 90, '卡名应 90 张全不重复');
const photoSlots = officialAll.map(function (c) { return D.GEMS.indexOf(c.gem) * 18 + (c.art % 18); });
assert(new Set(photoSlots).size === 90, '卡面插画槽位应 90 张全不重复');
assert(Math.min.apply(null, photoSlots) === 0 && Math.max.apply(null, photoSlots) === 89, '插画槽位应覆盖 0~89');

// 同一种子两次洗牌结果一致，保证回归可复现
const replayA = D.buildDecks(D.mulberry32(7))[0].map(function (c) { return c.id; }).join(',');
const replayB = D.buildDecks(D.mulberry32(7))[0].map(function (c) { return c.id; }).join(',');
assert(replayA === replayB, '同一种子的牌序应可复现');
console.log('官方牌组指纹校验通过（90 张 / 140 声望 / 成本分布对称）');

// 贵族牌指纹：官方 10 张 —— 5 张双色各 4 + 5 张三色各 3，组合是固定的
function nobleKey(n) {
  return D.GEMS.filter(function (g) { return n.req[g] > 0; })
    .map(function (g) { return g + n.req[g]; })
    .sort()
    .join('+');
}
const nobleKeys = D.NOBLE_POOL.map(nobleKey).sort();
const expectNobles = [
  'black3+blue3+white3', 'black3+green3+red3', 'black3+red3+white3',
  'blue3+green3+red3', 'blue3+green3+white3',
  'black4+red4', 'black4+white4', 'blue4+green4', 'blue4+white4', 'green4+red4'
].sort();
assert(nobleKeys.length === 10, '贵族牌应为 10 张');
assert(JSON.stringify(nobleKeys) === JSON.stringify(expectNobles),
  '贵族组合与官方不一致: ' + nobleKeys.join(' '));
assert(new Set(D.NOBLE_POOL.map(function (n) { return n.title; })).size === 10, '贵族名应 10 张不重复');
console.log('官方贵族牌指纹校验通过（5 张双色 4+4 / 5 张三色 3+3+3）');

// 规则边界
let r = E.performAction(s0, { type: 'take', gems: ['gold'] });
assert(!r.ok, '黄金不可直接拿取');
r = E.performAction(s0, { type: 'take', gems: ['white'] });
assert(r.ok, '库存紧张时允许只拿 1 枚');
assert(s0.bank.white === 3, '拿 1 枚后库存为 3');
r = E.performAction(s0, { type: 'take', gems: ['white', 'white'] });
assert(!r.ok, '库存 3 时同色 2 枚应被拒绝');
r = E.performAction(s0, { type: 'take', gems: ['blue', 'green'] });
assert(r.ok && r.ended, '两种不同色可拿');
checkConservation(s0);
console.log('规则边界校验通过');

// 多局 AI 自动对战（用可复现随机源覆盖不同牌序）
let finished = 0, minSteps = Infinity, maxSteps = 0, totalSteps = 0, maxPoints = 0;
let stalemates = 0;
const GAMES = 120;
for (let k = 1; k <= GAMES; k++) {
  const s = E.createGame(2, D.mulberry32(k));
  let steps = 0;
  while (!s.gameOver && steps < 600) {
    const action = AI.chooseAction(s);
    const res = E.performAction(s, action);
    if (!res.ok) {
      const fallback = E.performAction(s, { type: 'pass' });
      assert(fallback.ok, '第 ' + k + ' 局第 ' + steps + ' 步兜底 pass 失败: ' + res.error + ' / ' + JSON.stringify(action));
    }
    checkConservation(s);
    steps += 1;
  }
  assert(s.gameOver, '第 ' + k + ' 局(seed=' + k + ')未能在 600 步内结束');
  assert(s.winner === -2 || (s.winner >= 0 && s.winner < 2), '非法 winner=' + s.winner);
  s.players.forEach(function (p) { maxPoints = Math.max(maxPoints, p.points); });
  if (s.log.some(function (l) { return l.indexOf('提前结算') >= 0; })) stalemates += 1;
  finished += 1;
  minSteps = Math.min(minSteps, steps);
  maxSteps = Math.max(maxSteps, steps);
  totalSteps += steps;
}
console.log('AI 自动对战 ' + GAMES + ' 局全部正常结束');
console.log('回合步数 min/avg/max = ' + minSteps + ' / ' + (totalSteps / GAMES).toFixed(1) + ' / ' + maxSteps);
console.log('最高声望 = ' + maxPoints + '，僵局提前结算局数 = ' + stalemates);
console.log('ALL PASS');
