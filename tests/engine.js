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
