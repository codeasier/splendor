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

// 规则边界：选篮必须凑成「同色 2 枚（库存 ≥4）」或「3 种不同色各 1 枚」
let r = E.performAction(s0, { type: 'take', gems: ['gold'] });
assert(!r.ok, '黄金不可直接拿取');
const bankBefore = s0.bank.white;
r = E.performAction(s0, { type: 'take', gems: ['white'] });
assert(!r.ok, '只选 1 枚不应结束回合');
r = E.performAction(s0, { type: 'take', gems: ['blue', 'green'] });
assert(!r.ok, '只选 2 个不同色不应结束回合');
r = E.performAction(s0, { type: 'take', gems: ['white', 'white', 'white'] });
assert(!r.ok, '3 枚同色不合法');
r = E.performAction(s0, { type: 'take', gems: ['white', 'blue', 'white'] });
assert(!r.ok, '3 枚里夹同色不合法');
assert(s0.bank.white === bankBefore && s0.bank.blue === bankBefore && s0.bank.green === bankBefore,
  '非法组合不应扣银行筹码');
r = E.performAction(s0, { type: 'take', gems: ['white', 'blue', 'green'] });
assert(r.ok && r.ended, '3 种不同色可拿');
assert(s0.bank.white === bankBefore - 1 && s0.bank.blue === bankBefore - 1 && s0.bank.green === bankBefore - 1,
  '三色各扣 1 枚');
checkConservation(s0);
console.log('规则边界校验通过');

// 同色 2 枚 / 缺货降级：页面 canConfirm 门禁与引擎共用同一份 validateTake
{
  const sx = E.createGame(2);
  assert(E.validateTake(sx, ['white']) !== null, '库存充足时选 1 枚不可提交');
  assert(E.validateTake(sx, ['white', 'blue']) !== null, '库存充足时选 2 个不同色不可提交');
  assert(E.validateTake(sx, ['white', 'white']) === null, '库存 4 时可拿同色 2 枚');
  assert(E.validateTake(sx, ['white', 'blue', 'green']) === null, '3 种不同色可提交');
  sx.bank.blue = 0; sx.bank.green = 0; sx.bank.red = 0; sx.bank.black = 0;
  sx.bank.white = 2;
  assert(E.validateTake(sx, ['white']) === null, '全桌只剩 1 色时允许拿 1 枚');
  assert(E.validateTake(sx, ['white', 'white']) !== null, '库存 2 时同色 2 枚仍被拒绝');
  sx.bank.white = 5;
  assert(E.validateTake(sx, ['white', 'white']) === null, '只剩 1 色且库存 ≥4 时可拿同色 2 枚');
  sx.bank.blue = 1;
  assert(E.validateTake(sx, ['white']) !== null, '剩 2 色时只拿 1 色仍不合法');
  assert(E.validateTake(sx, ['white', 'blue']) === null, '剩 2 色时拿满 2 色合法');
  assert(E.performAction(sx, { type: 'take', gems: ['white', 'blue'] }).ok, '缺货降级动作能被引擎接受');
}
console.log('拿筹码组合门禁校验通过（同色 2 枚 / 3 不同色 / 缺货降级）');

// 多贵族同时满足：真人席位必须挂起选择，选定后才推进回合
{
  const sn = E.createGame({ playerCount: 2, seats: [{ name: '甲' }, { isAI: true, name: '乙' }] });
  sn.nobles = [
    { id: 'n1', title: '霜港勋爵', points: 3, claimedBy: -1, req: { white: 4, blue: 4, green: 0, red: 0, black: 0 } },
    { id: 'n2', title: '铸币大臣', points: 3, claimedBy: -1, req: { white: 4, blue: 0, green: 0, red: 0, black: 4 } }
  ];
  const human = sn.players[0];
  // 直接注入发展卡制造「白 4 蓝 4 黑 4」红利，n1 / n2 同时满足
  human.cards = [
    { gem: 'white', points: 0, cost: {}, name: 'x', level: 1, art: 0 },
    { gem: 'white', points: 0, cost: {}, name: 'x', level: 1, art: 1 },
    { gem: 'white', points: 0, cost: {}, name: 'x', level: 1, art: 2 },
    { gem: 'white', points: 0, cost: {}, name: 'x', level: 1, art: 3 },
    { gem: 'blue', points: 0, cost: {}, name: 'x', level: 1, art: 0 },
    { gem: 'blue', points: 0, cost: {}, name: 'x', level: 1, art: 1 },
    { gem: 'blue', points: 0, cost: {}, name: 'x', level: 1, art: 2 },
    { gem: 'blue', points: 0, cost: {}, name: 'x', level: 1, art: 3 },
    { gem: 'black', points: 0, cost: {}, name: 'x', level: 1, art: 0 },
    { gem: 'black', points: 0, cost: {}, name: 'x', level: 1, art: 1 },
    { gem: 'black', points: 0, cost: {}, name: 'x', level: 1, art: 2 },
    { gem: 'black', points: 0, cost: {}, name: 'x', level: 1, art: 3 }
  ];
  human.points = 0;
  const before = { current: sn.current, turnCount: sn.turnCount, nobles: sn.nobles.length };
  assert(E.eligibleNobles(sn, 0).length === 2, '应同时满足 2 张贵族');
  const rn = E.performAction(sn, { type: 'pass' });
  assert(rn.ok && rn.waitingNoble && !rn.ended, '真人满足多贵族应挂起等待选择');
  assert(sn.pendingNoble && sn.pendingNoble.seat === 0, 'pendingNoble 应记录席位');
  assert(JSON.stringify(sn.pendingNoble.options) === JSON.stringify(['n1', 'n2']), 'options 应含两张贵族 id');
  assert(sn.current === before.current && sn.turnCount === before.turnCount, '挂起期间回合不推进');
  assert(human.points === 0, '挂起期间不计分');
  assert(sn.nobles.length === before.nobles, '挂起期间贵族牌不离桌');

  // 未选择贵族前不允许做其他动作
  const blocked = E.performAction(sn, { type: 'take', gems: ['white'] });
  assert(!blocked.ok, '挂起期间其他动作应被拒绝');

  // 非法 id / 非 options 内的 id 应被拒绝
  assert(!E.performAction(sn, { type: 'chooseNoble', id: 'n9' }).ok, 'options 外的贵族应被拒绝');

  // 正式选择：获得贵族、计分、清挂起、推进回合
  const pick = E.performAction(sn, { type: 'chooseNoble', id: 'n2' });
  assert(pick.ok, 'chooseNoble 应成功: ' + pick.error);
  assert(human.nobles.length === 1 && human.nobles[0].id === 'n2', '应获得选中的贵族');
  assert(human.points === 3, '贵族 +3 声望');
  assert(sn.pendingNoble === null, '选择后清除挂起');
  assert(sn.nobles.length === before.nobles - 1, '贵族牌离桌');
  assert(sn.current !== before.current || sn.turnCount === before.turnCount + 1, '选择后回合推进');
  console.log('多贵族选择（真人挂起 / 门禁 / 结算）校验通过');
}

// 只满足 1 张时不应挂起；机器人满足多张时自动挑选第一张
{
  const s1 = E.createGame({ playerCount: 2, seats: [{ name: '甲' }, { isAI: true, name: '乙' }] });
  s1.nobles = [
    { id: 'n1', title: '霜港勋爵', points: 3, claimedBy: -1, req: { white: 4, blue: 4, green: 0, red: 0, black: 0 } },
    { id: 'n2', title: '铸币大臣', points: 3, claimedBy: -1, req: { white: 4, blue: 0, green: 0, red: 0, black: 4 } }
  ];
  const human1 = s1.players[0];
  human1.cards = [];
  for (let i = 0; i < 4; i++) human1.cards.push({ gem: 'white', points: 0, cost: {}, name: 'x', level: 1, art: i });
  for (let i = 0; i < 4; i++) human1.cards.push({ gem: 'blue', points: 0, cost: {}, name: 'x', level: 1, art: i });
  const r1 = E.performAction(s1, { type: 'pass' });
  assert(r1.ok && r1.ended && !r1.waitingNoble, '只满足 1 张应自动获得不挂起');
  assert(human1.nobles.length === 1 && human1.nobles[0].id === 'n1', '自动获得第一张满足的贵族');
  assert(!s1.pendingNoble, '不产生挂起');

  const s2 = E.createGame({ playerCount: 2, seats: [{ name: '甲' }, { name: '乙', isAI: true }] });
  s2.nobles = s1.nobles.slice();
  s2.current = 1;
  const bot = s2.players[1];
  for (let i = 0; i < 4; i++) bot.cards.push({ gem: 'white', points: 0, cost: {}, name: 'x', level: 1, art: i });
  for (let i = 0; i < 4; i++) bot.cards.push({ gem: 'blue', points: 0, cost: {}, name: 'x', level: 1, art: i });
  for (let i = 0; i < 4; i++) bot.cards.push({ gem: 'black', points: 0, cost: {}, name: 'x', level: 1, art: i });
  const aiAct = AI.chooseAction(s2);
  assert(aiAct.type !== 'chooseNoble', '机器人不需要显式选择动作');
  const r2 = E.performAction(s2, aiAct.type === 'pass' ? { type: 'pass' } : aiAct);
  if (!r2.ok) E.performAction(s2, { type: 'pass' });
  // 机器人回合结束时应已自动获得贵族（无论本步动作是什么，只要回合结束）
  if (s2.current !== 1) {
    assert(bot.nobles.length === 1, '机器人满足多贵族应自动获得一张');
    assert(!s2.pendingNoble, '机器人不挂起');
  }
  console.log('单贵族自动获得 / 机器人自动挑选校验通过');
}


// 终局判定：达标后只打完本轮；最后一号位达标立即结算
// ------------------------------------------------------------------
// 官方规则：有人到 15 声望后，本轮剩余席位各行动一次即结算，保证回合数相同。
// 旧实现无条件加 players.length-1 个回合，末位达标时会轮转回 1 号位凭空
// 多打一整轮（2/3/4 人局全中）。这里逐个人数、逐个席位枚举验证。
function endgameState(n, triggerSeat) {
  const s = E.createGame(n, D.mulberry32(99));
  s.current = triggerSeat;
  s.turnCount = 10;
  s.endAtTurn = -1;
  s.nobles = [];                                  // 避免多贵族挂起干扰回合推进
  s.players[triggerSeat].cards = [{ points: 15 }];
  s.players[triggerSeat].nobles = [];
  return s;
}
[2, 3, 4].forEach(function (n) {
  for (let seat = 0; seat < n; seat++) {
    const s = endgameState(n, seat);
    const rest = n - 1 - seat;
    const r = E.endTurn(s);
    if (rest === 0) {
      assert(s.gameOver === true, n + ' 人局末位(' + (seat + 1) + ' 号位)达标应立即结算');
      assert(s.current === seat, n + ' 人局末位达标后不应再轮转回 1 号位');
      assert(r.gameOver === true, '末位达标 endTurn 应返回 gameOver');
    } else {
      assert(s.gameOver === false, n + ' 人局 ' + (seat + 1) + ' 号位达标后不应立即结算');
      assert(s.current === (seat + 1) % n, '达标后应正常轮转到下一席');
      assert(s.endAtTurn === 11 + rest, '结算回合数应为 turnCount + 本轮剩余席位数');
      let extra = 0;
      while (!s.gameOver && extra < 10) { E.endTurn(s); extra += 1; }
      assert(s.gameOver === true, n + ' 人局本轮走完应结算');
      assert(extra === rest, n + ' 人局 ' + (seat + 1) + ' 号位达标后应再走 ' + rest + ' 席，实际 ' + extra);
    }
  }
});
console.log('终局判定：2/3/4 人局共 9 个席位达标场景全部正确');

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
// 官方规则「Selecting Tokens」：回合末 >10 枚时可退还任意颜色组合，
// 包含同色多枚与黄金，不限颜色种类，只要退到 ≤10。引擎层必须逐一放行。
{
  const s = E.createGame(2, D.mulberry32(777));
  s.current = 0;
  s.pendingDiscard = 3;
  s.players[0].tokens = { white: 5, blue: 1, green: 0, red: 0, black: 0, gold: 0 };
  s.bank = { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 };
  const r = E.performAction(s, { type: 'discard', gems: ['white', 'white', 'white'] });
  assert(r.ok, '同色 3 枚一次性退还必须合法: ' + (r.error || ''));
  assert(s.players[0].tokens.white === 2, '同色退还后持有量正确');
  assert(s.bank.white === 3, '同色退还后银行回补 3 枚');
  assert(s.pendingDiscard === 0, '一次退完应解除待退还状态');

  const s2 = E.createGame(2, D.mulberry32(778));
  s2.current = 0;
  s2.pendingDiscard = 3;
  s2.players[0].tokens = { white: 2, blue: 1, green: 0, red: 0, black: 0, gold: 2 };
  const r2 = E.performAction(s2, { type: 'discard', gems: ['gold', 'gold', 'blue'] });
  assert(r2.ok, '黄金可与普通色混合、同色多枚退还: ' + (r2.error || ''));
  assert(s2.players[0].tokens.gold === 0, '黄金退还成功');

  const s3 = E.createGame(2, D.mulberry32(779));
  s3.current = 0;
  s3.pendingDiscard = 2;
  s3.players[0].tokens = { white: 1, blue: 0, green: 0, red: 0, black: 0, gold: 0 };
  const r3 = E.performAction(s3, { type: 'discard', gems: ['white', 'white'] });
  assert(!r3.ok, '退还数量超过持有量必须拒绝');
  const r4 = E.performAction(s3, { type: 'discard', gems: ['white', 'bogus'] });
  assert(!r4.ok, '非法颜色必须拒绝');
  console.log('退还规则：同色多枚 / 混合黄金 / 超量拦截全部正确');
}

console.log('ALL PASS');
