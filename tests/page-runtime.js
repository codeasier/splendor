'use strict';
const ROOT = require('path').resolve(__dirname, '..');
const U = require(ROOT + '/utils/user.js');
let captured = null;
global.Page = function (cfg) { captured = cfg; };
global.wx = {
  getWindowInfo: function () { return { windowWidth: 812, windowHeight: 375 }; },
  showModal: function (opt) { opt.success({ confirm: true }); }
};
let nextTimerId = 1;
let timers = [];
global.setTimeout = function (fn) {
  const t = { id: nextTimerId++, fn: fn, active: true };
  timers.push(t);
  return t.id;
};
global.clearTimeout = function (id) {
  timers.forEach(function (t) { if (t.id === id) t.active = false; });
};
function drain(max) {
  let n = 0;
  while (n < max) {
    const t = timers.find(function (x) { return x.active; });
    if (!t) break;
    t.active = false;
    t.fn();
    n += 1;
  }
  return n;
}

require(ROOT + '/pages/index/index.js');
if (!captured) throw new Error('Page() 未被调用');
const page = captured;
page.setData = function (obj) { Object.assign(page.data, obj); };

function assert(c, msg) { if (!c) throw new Error('FAIL: ' + msg); }

page.onLoad();
assert(page.data.stageScale > 0, 'stageScale 计算');
assert(Math.abs(page.data.stageScale - Math.min(812 / 1080, 375 / 560)) < 1e-9, 'scale 为等比缩放');
assert(page.data.screen === 'home', '默认进入首页入口界面');
assert(page.data.home.soloCount === 2, '人机对战默认 2 人');
assert(page.data.home.roomCount === 3, '邀请好友默认 3 人');
assert(page.data.home.soloCounts.length === 3, '首页提供 2/3/4 人选项');
assert(page.data.rows.length === 0, '首页不渲染牌桌');
console.log('OK  入口界面 · 人机对战 / 邀请好友 / 加入房间');

// 进入人机对战
page.onStartSolo();
assert(page.data.screen === 'game', '人机对战进入牌桌');
assert(page.data.rows.length === 3, '3 行明牌');
page.data.rows.forEach(function (r) { assert(r.cards.length === 4, '每行 4 张卡'); });
assert(page.data.bankPiles.length === 6, '6 种筹码堆');
assert(page.data.nobles.length === 3, '3 张贵族');
assert(page.data.decks.length === 3, '3 个牌库');
assert(page.data.isMyTurn === true, '首回合为玩家');
assert(page.data.gameOver === false, '开局未结束');
console.log('OK  页面初始化 · 视图模型结构完整');

// 四色成本卡（官方牌组里的 1/1/1/1 与三级 3/3/3/5）必须带 is-dense，
// 否则市场格 92×112 里 21px 圆章会折成第二列压住卡名
let sawDense = 0;
for (let round = 0; round < 10 && sawDense === 0; round++) {
  if (round > 0) page.onStartSolo();
  page.data.rows.forEach(function (r) {
    r.cards.forEach(function (c) {
      if (!c.costs) return;
      assert(c.costDense === (c.costs.length >= 4), '四色成本标记应与成本数量一致：' + c.name + ' costs=' + c.costs.length);
      assert(c.costs.length <= 4, '官方卡最多 4 色成本：' + c.name);
      if (c.costDense) sawDense += 1;
    });
  });
}
assert(sawDense > 0, '10 次发牌里应至少出现一张四色成本卡');
console.log('OK  四色成本卡 · 10 次发牌命中 ' + sawDense + ' 张，均带 is-dense');

// 成本气泡 = 卡面印刷成本（不随持有筹码变化）；买得起与否改用光环表达
page.onStartSolo();
const GEM_KEYS = ['white', 'blue', 'green', 'red', 'black'];
// rows[2] 是近端一级行，对应 state.board[0]（引擎里 lv 0 = 一级）
const probeCard = page.state.board[0][0];
const printed = {};
let printedTotal = 0;
GEM_KEYS.forEach(function (g) { printed[g] = probeCard.cost[g] || 0; printedTotal += printed[g]; });
assert(printedTotal > 0, '一级首张卡应有成本');
const gapGem = GEM_KEYS.filter(function (g) { return printed[g] === 0; })[0];
assert(gapGem, '任一张卡最多 4 色成本，应至少缺 1 色以便构造缺口');

function boardCardVM() { return page.data.rows[2].cards[0]; }
function costSignature(vm) { return (vm.costs || []).map(function (c) { return c.key + c.display; }).join(','); }

// ① 筹码恰好够：绿光，且气泡仍是印刷值
page.state.players[0].tokens = Object.assign({ gold: 0 }, printed);
page.refresh('');
let vm = boardCardVM();
assert(vm.buyState === 'direct' && vm.buyClass === 'is-buyable', '筹码够时应为绿光直购，实际 ' + vm.buyState);
assert(vm.costs.every(function (c) { return c.display === String(printed[c.key]); }), '筹码够时气泡应为印刷成本');
const sigDirect = costSignature(vm);

// ② 差 1 枚、用黄金补：金光，气泡数字不能变成缺口值
const giveGem = GEM_KEYS.filter(function (g) { return printed[g] > 0; })[0];
page.state.players[0].tokens[giveGem] -= 1;
page.state.players[0].tokens.gold = 1;
page.refresh('');
vm = boardCardVM();
assert(vm.buyState === 'gold' && vm.buyClass === 'is-gold-buy', '需动用黄金时应为金光，实际 ' + vm.buyState);
assert(vm.goldPay === 1, '缺口 1 枚应由黄金补足，实际 ' + vm.goldPay);
assert(costSignature(vm) === sigDirect, '气泡不应随筹码缺口变化（仍是印刷成本）');
assert(costSignature(vm).indexOf('✓') < 0, '成本气泡不应再出现打勾抵扣');

// ③ 连黄金都不够：无光环，气泡依旧
page.state.players[0].tokens.gold = 0;
page.refresh('');
vm = boardCardVM();
assert(vm.buyState === 'no' && vm.buyClass === '', '买不起时不应有光环，实际 ' + vm.buyState);
assert(costSignature(vm) === sigDirect, '买不起时气泡仍为印刷成本');
console.log('OK  卡面成本恒定 · 绿光/金光/无光三态判定正确');

// 预留卡直接铺在桌面左侧：卡面同款 + 空位补槽 + 成本同为印刷值
// 从牌库顶取两张（不动市场），断言完再放回，避免影响后续用例
const deckA = page.state.decks[0];
const deckB = page.state.decks[1];
const probeReserved = [deckA.pop(), deckB.pop()];
page.state.players[0].reserved = probeReserved.filter(Boolean);
page.refresh('');
assert(page.data.reservedCards.length === 2, '两张预留卡应铺到桌面左侧');
assert(page.data.emptyReservedSlots.length === 1, '3 个预留位应补 1 个空槽');
page.data.reservedCards.forEach(function (c) {
  assert(c.photoClass && c.costs.length > 0, '预留卡应带完整卡面数据：' + c.name);
  assert(c.tiltStyle.indexOf('perspective') > 0, '预留卡应带 2.5D 摆放姿态');
  c.costs.forEach(function (x) {
    assert(/^\d+$/.test(x.display), '预留卡成本气泡应为纯数字（印刷值）：' + x.display);
  });
});
assert(page.data.reservedCards[0].index === 0 && page.data.reservedCards[1].index === 1, '预留卡应带可点击的下标');
console.log('OK  预留卡上桌 · 2 张就位 + 1 个空槽');

// 复原牌库与预留位，后续用例按原状态继续
page.state.players[0].reserved = [];
probeReserved.forEach(function (c, i) { (i === 0 ? deckA : deckB).push(c); });
page.refresh('');

// 工作台：红利行固定 5 色，与筹码行逐列同色
assert(page.data.me.discountCells.length === 5, '红利行应固定 5 色');
assert(page.data.me.tokens.length === 6, '筹码行应为 5 色 + 黄金');
page.data.me.discountCells.forEach(function (cell, i) {
  assert(cell.key === page.data.me.tokens[i].key, '第 ' + i + ' 列红利与筹码应同色：' + cell.key + ' vs ' + page.data.me.tokens[i].key);
  assert(cell.num >= 0 && cell.zero === (cell.num === 0), '红利格应如实反映数量与零值');
});
console.log('OK  工作台红利/筹码逐列对齐（白蓝绿红黑 + 黄金）');

// 逐个模拟事件处理方法
function tap(method, dataset) {
  page[method]({ currentTarget: { dataset: dataset } });
}

// 点选 3 个不同色筹码并确认
['white', 'blue', 'green'].forEach(function (k) { tap('onTapPile', { key: k }); });
assert(page.data.selectionCount === 3, '选中 3 枚筹码');
assert(page.data.canConfirm === true, '可确认');
page.onConfirmTake();
assert(page.data.selectionCount === 0, '确认后清空选择');
assert(page.state.current === 1, '轮到 AI');
const aiSteps = drain(80);
assert(aiSteps > 0, 'AI 回合被执行');
assert(page.state.current === 0, 'AI 行动后回到玩家');
console.log('OK  拿筹码 → AI 回合 → 回到玩家 (' + aiSteps + ' 次 AI 动作)');

// 卡牌详情
tap('onTapCard', { lv: 0, index: 0 });
assert(page.data.detail !== null, '详情弹层打开');
assert(page.data.detail.card !== undefined, '详情含卡片视图数据');
assert(page.data.detail.costLines !== undefined, '详情含成本明细');
page.onCloseDetail();
assert(page.data.detail === null, '详情关闭');
console.log('OK  卡牌详情弹层');

// 规则与预留卡弹层
page.onShowRules();
assert(page.data.showRules === true, '规则弹层打开');
page.onCloseRules();
page.onShowReserved();
assert(page.data.showReserved === true, '预留卡弹层打开');
page.onCloseReserved();
console.log('OK  规则 / 预留卡弹层');

// 预留牌库（showModal 自动确认）
const before = page.state.decks[0].length;
tap('onTapDeck', { lv: 0 });
assert(page.state.decks[0].length === before - 1, '盲抽预留消耗 1 张牌');
assert(page.state.players[0].reserved.length === 1, '预留卡 +1');
drain(80);
console.log('OK  盲抽预留牌库顶');

// 退还筹码路径：构造超限再逐枚退还
const s = page.state;
s.current = 0;
s.pendingDiscard = 0;
s.players[0].tokens = { white: 3, blue: 3, green: 2, red: 2, black: 2, gold: 1 };
s.bank = { white: 1, blue: 1, green: 2, red: 2, black: 2, gold: 4 };
s.pendingDiscard = 3;
page.refresh('');
assert(page.data.needDiscard === true, '退还模式开启');
tap('onTapMyToken', { key: 'white' });
assert(s.pendingDiscard === 2, '退还 1 枚后剩余 2');
tap('onTapMyToken', { key: 'blue' });
tap('onTapMyToken', { key: 'green' });
assert(s.pendingDiscard === 0, '退还完毕');
drain(80);
console.log('OK  超额筹码逐枚退还');

// 重开后完整跑一局：玩家始终执行「买得起就买，否则拿 3 枚」
page.onRestart();
let guard = 0;
while (!page.state.gameOver && guard < 300) {
  if (page.state.current !== 0) { drain(80); continue; }
  const s2 = page.state;
  const E = require(ROOT + '/utils/game-engine.js');
  let bought = false;
  // 真实 UI 在 pendingDiscard 时只开放「退还」入口（onTapCard/onTapPile/onPass 均有保护），
  // 模拟脚本也必须先处理退还，否则会提交被引擎拒绝的买卡动作而误判为已行动。
  if (s2.pendingDiscard === 0) {
    for (let lv = 0; lv < 3 && !bought; lv++) {
      for (let i = 0; i < 4; i++) {
        if (s2.board[lv][i] && E.canBuy(s2, 0, s2.board[lv][i])) {
          bought = page.applyPlayerAction({ type: 'buyBoard', lv: lv, index: i });
          break;
        }
      }
    }
  }
  if (!bought) {
    const s3 = page.state;
    let acted = false;
    if (s3.pendingDiscard > 0) {
      // 超出 10 枚时按真实 UI 逐枚退还，直到解除待退还状态
      const keys = Object.keys(s3.players[0].tokens);
      for (let k = 0; k < keys.length && page.state.pendingDiscard > 0; k++) {
        while (page.state.pendingDiscard > 0 && page.state.players[0].tokens[keys[k]] > 0) {
          if (!page.applyPlayerAction({ type: 'discard', gems: [keys[k]] })) break;
        }
      }
      acted = page.state.pendingDiscard === 0;
    } else {
      const avail = E.availableGems(s3).slice(0, 3);
      acted = page.applyPlayerAction(avail.length ? { type: 'take', gems: avail } : { type: 'pass' });
    }
    // 动作被规则拒绝时（例如满 10 枚仍尝试拿取），真实玩家可点「跳过」
    if (!acted) page.applyPlayerAction({ type: 'pass' });
  }
  assert(page.data.rows.length === 3, '每步视图模型完整');
  drain(80);
  guard += 1;
}
assert(page.state.gameOver, '完整对局能结束 (guard=' + guard + ')');
assert(page.data.gameOver === true, '结算弹层状态');
assert(page.data.resultTitle.length > 0, '结算标题');

/* ---------- 结算自动落战绩（幂等） ---------- */
const recs = U.getRecords();
assert(recs.length === 1, '结算应自动落一条战绩，实际 ' + recs.length);
assert(recs[0].mode === 'solo', '人机局战绩应标记 solo');
assert(recs[0].playerCount === page.state.players.length, '战绩人数应与牌局一致');
assert(recs[0].score === page.state.players[0].points, '战绩声望应取本机席位');
assert(recs[0].win === (page.state.winner === 0), '胜负应与引擎判定一致');
assert(recs[0].rank >= 1 && recs[0].rank <= page.state.players.length, '名次应在席位范围内');
const recCount = U.getRecords().length;
page.refresh('');
page.refresh('');
assert(U.getRecords().length === recCount, '重复刷新不应重复记账（结算弹层会反复重绘）');
assert(page.data.home.stats.total === recCount, '回到大厅时战绩统计应已包含本局');
console.log('OK  结算落战绩 · ' + recs[0].rank + ' 名 / ' + recs[0].score + ' 声望 · 重复刷新不重复记账');
console.log('OK  完整对局跑通 · ' + page.data.resultTitle + ' · ' + page.data.resultDetail);

/* ---------- 入口 → 房间 → 准备 → 房主开始 ---------- */
page.onLeaveRoom();
assert(page.data.screen === 'home', '离开牌局回到首页');

page.onCreateRoom();
assert(page.data.screen === 'room', '创建房间进入房间界面');
assert(page.data.roomScreen.seats.length === 3, '默认 3 个席位');
assert(page.data.roomScreen.joinedHumans === 1, '只有房主已加入');
assert(page.data.roomScreen.canStart === false, '空席未就绪时房主不能开始');
assert(page.data.roomScreen.isHost === true, '房主视角');

tap('onRoomToggleBot', { index: 1 });
tap('onRoomToggleBot', { index: 2 });
assert(page.data.roomScreen.botCount === 2, '两个席位转为机器人');
assert(page.data.roomScreen.canStart === true, '机器人席位就绪后房主可开始');
assert(page.data.roomScreen.readyCount === 3, '全员就绪计数正确');

// 未就绪时先撤掉一个机器人，验证开始被拦
tap('onRoomToggleBot', { index: 2 });
assert(page.data.roomScreen.canStart === false, '存在空席时不能开始');
page.onRoomStart();
assert(page.data.screen === 'room', '未就绪时开始被拦下');
tap('onRoomToggleBot', { index: 2 });
assert(page.data.roomScreen.canStart === true, '补回机器人后恢复可开始');

page.onRoomStart();
assert(page.data.screen === 'game', '房主开始后进入牌桌');
assert(page.state.players.length === 3, '3 人牌局');
assert(page.state.players[1].isAI === true, '机器人席位由 AI 托管');
drain(80);
console.log('OK  房间准备流 · 空席拦截 / 机器人就绪 / 房主开局');

page.onLeaveRoom();
assert(page.data.screen === 'home', '离开房间回到首页');
assert(page.room === null, '房间引用已释放');

/* ---------- 真人入席 → 点准备 → 全员就绪房主才可开始 ---------- */
page.onCreateRoom();
assert(page.data.screen === 'room', '重新建房回到房间界面');
assert(page.data.roomScreen.statusText === '已加入 1 人 · 已准备 1/3', '开局只有房主已就绪');

// 好友凭房间号入席，尚未点准备
page.room.seats[1] = Object.assign({}, page.room.seats[1], {
  joined: true, uid: 'guest-a', name: '群友甲', nickname: '群友甲', ready: false
});
page.refresh('');
assert(page.data.roomScreen.joinedHumans === 2, '房主端实时看到已加入 2 人');
assert(page.data.roomScreen.statusText === '已加入 2 人 · 已准备 1/3', '状态行随入席更新');
assert(page.data.roomScreen.waitingReady === 1, '统计到 1 人未准备');
assert(page.data.roomScreen.tip === '还有 1 位玩家未准备', '提示差几位未准备');
assert(page.data.roomScreen.canStart === false, '有人未准备时房主不能开始');
assert(page.data.roomScreen.startLabel === '等待玩家准备', '开始按钮保持等待态');
assert(page.data.roomScreen.seats[1].stateText === '未准备', '席位状态为未准备');
assert(page.data.roomScreen.seats[1].joined === true, '席位标记为已入席');
assert(page.data.roomScreen.seats[1].canToggleBot === false, '已入席席位不能再改机器人');
assert(page.data.roomScreen.emptyCount === 1, '仍剩 1 个空席');
assert(page.data.roomScreen.seats[2].canToggleBot === true, '空席对房主开放「设为机器人」');
assert(page.data.roomScreen.seats[0].canToggleBot === false, '自己的席位没有改机器人按钮');

// 好友点准备
page.mySeat = 1;
page.refresh('');
assert(page.data.roomScreen.seats[1].isSelf === true, '好友定位到 2 号席');
assert(page.data.roomScreen.seats[1].label.indexOf('你') > 0, '席位标注「你」');
assert(page.data.roomScreen.seats[1].canReady === true, '好友可自己点准备');
page.onRoomToggleReady();
assert(page.data.roomScreen.seats[1].ready === true, '好友准备成功');
assert(page.data.roomScreen.readyCount === 2, '准备数 +1');
assert(page.data.roomScreen.waitingReady === 0, '无人待准备');
assert(page.data.roomScreen.tip.indexOf('还有 1 个空席位') === 0, '提示改为空席缺口');
assert(page.data.roomScreen.canStart === false, '空席未补满时仍不能开始');
assert(page.data.roomScreen.startLabel === '已准备 · 等房主开始', '好友侧显示等待房主');
assert(page.data.roomScreen.seats[2].canToggleBot === false, '非房主不能把空席改机器人');

// 好友取消准备 → 房主端回到「有人未准备」
page.onRoomToggleReady();
assert(page.data.roomScreen.myReady === false, '好友取消准备');
assert(page.data.roomScreen.readyLabel === '准备', '按钮文案回到「准备」');
page.mySeat = 0;
page.refresh('');
assert(page.data.roomScreen.canStart === false, '取消准备后房主不能开始');
assert(page.data.roomScreen.tip === '还有 1 位玩家未准备', '房主端重新提示未准备');
assert(page.data.roomScreen.seats[1].stateText === '未准备', '席位回到未准备');

// 好友重新准备 + 房主把空席补成机器人 → 全员就绪
page.mySeat = 1;
page.onRoomToggleReady();
page.mySeat = 0;
tap('onRoomToggleBot', { index: 2 });
assert(page.data.roomScreen.botCount === 1, '空席补入机器人');
assert(page.data.roomScreen.readyCount === 3, '全员准备 3/3');
assert(page.data.roomScreen.tip === '全员已就绪，房主可以开始牌局', '就绪后提示可开局');
assert(page.data.roomScreen.canStart === true, '全员准备后房主才可开始');
assert(page.data.roomScreen.startLabel === '开始牌局', '按钮转为「开始牌局」');

page.onRoomStart();
assert(page.data.screen === 'game', '房主开局进入牌桌');
assert(page.state.players.length === 3, '按房间人数开出 3 人局');
assert(page.state.players[1].name === '群友甲', '真人席位用昵称入局');
assert(page.state.players[1].isAI === false, '真人席位不托管');
assert(page.state.players[2].isAI === true, '机器人席位 AI 托管');
drain(80);
console.log('OK  真人入席准备流 · 人数/准备实时变化 · 全员就绪房主才可开局');

/* ---------- 3/4 人局贵族牌：改双列，避免被工作台挡住 ---------- */
assert(page.data.nobles.length === 4, '3 人局应有 4 张贵族');
assert(page.data.noblesCompact === true, '4 张贵族应切到紧凑双列');
page.onLeaveRoom();
page.onSelectSoloCount({ currentTarget: { dataset: { n: 2 } } });
page.onStartSolo();
assert(page.data.nobles.length === 3, '2 人局 3 张贵族');
assert(page.data.noblesCompact === false, '3 张贵族仍用单列');
console.log('OK  贵族牌排布 · 2 人单列 / 3-4 人紧凑双列');

/* ---------- 预留卡详情：按卡面展示成本与声望 ---------- */
tap('onTapCard', { lv: 0, index: 0 });
page.onReserveFromDetail();
assert(page.state.players[0].reserved.length === 1, '预留成功');
page.ui.showPlayerDetail = true;
page.ui.detailSeat = 0;
page.refresh('');
const pd = page.data.playerDetail;
assert(pd.reservedCards.length === 1, '详情列出预留卡');
const rc = pd.reservedCards[0];
const rawCard = page.state.players[0].reserved[0];
assert(rc.costs.length > 0, '预留卡应带成本气泡');
assert(rc.costs.every(function (c) { return c.display === String(rawCard.cost[c.key]); }),
  '气泡数量应等于卡面印刷成本');
assert(rc.pointsLabel.indexOf('声望') >= 0, '预留卡应显示声望');
assert(rc.name === rawCard.name, '预留卡名称一致');
page.ui.showPlayerDetail = false;
page.refresh('');
console.log('OK  预留卡详情 · 卡面成本气泡 / 声望 / 名称');

/* ---------- 房间默认无机器人；点空席即可安排 ---------- */
page.onLeaveRoom();
page.onCreateRoom();
assert(page.data.roomScreen.botCount === 0, '新开的房间默认不加机器人');
assert(page.data.roomScreen.seats[1].canToggleBot === true, '空席提供「设为机器人」');
tap('onRoomSeatTap', { index: 2 });
assert(page.data.roomScreen.botCount === 1, '点空席即可加入机器人');
assert(page.data.roomScreen.seats[2].seatAction === '取消机器人', '机器人席位可撤回');
tap('onRoomSeatTap', { index: 2 });
assert(page.data.roomScreen.botCount === 0, '再点一次即撤回机器人');
page.room.seats[1] = Object.assign({}, page.room.seats[1], {
  joined: true, uid: 'guest-b', name: '好友乙', nickname: '好友乙'
});
page.refresh('');
tap('onRoomSeatTap', { index: 1 });
assert(page.data.roomScreen.botCount === 0, '已入席的好友不会被改成机器人');
assert(page.data.roomScreen.notice.indexOf('已有好友') >= 0, '给出「已有好友」提示');
page.onLeaveRoom();
console.log('OK  席位交互 · 默认无机器人 / 点空席加入 / 再点撤回 / 好友席位保护');

/* ---------- 断线提示进入视图模型 ---------- */
page.ui.netNotice = '网络中断 · 正在重连…';
page.refresh('');
assert(page.data.netNotice.indexOf('网络中断') >= 0, '断线提示应进入视图模型');
page.ui.netNotice = '';
page.refresh('');
assert(page.data.netNotice === '', '恢复后提示应清除');
console.log('OK  断线重连提示 · 状态行可承载 / 可清除');

/* ---------- 冷启动重连：有会话时 onShow 自动回到房间 ---------- */
const RS = require(ROOT + '/utils/room.js');
const origHasCloud = RS.hasCloud;
const origJoin = RS.cloudJoinRoom;
RS.hasCloud = function () { return true; };
let joinCalls = 0;
RS.cloudJoinRoom = function () { joinCalls += 1; return new Promise(function () {}); };
RS.saveSession({ code: 'ABC123', seat: 1, screen: 'room', at: Date.now() });
page.onShow();
assert(joinCalls === 1, '有会话时 onShow 应自动发起一次入席');
assert(page.ui.homeNotice.indexOf('ABC123') >= 0, '应提示正在回到原房间');
assert(page._resuming === true, '重连过程中应处于 resuming 状态');
// 无会话时不应打扰用户
RS.clearSession();
page._resuming = false;
page._joining = false;
joinCalls = 0;
page.onShow();
assert(joinCalls === 0, '没有会话时 onShow 不应发起入席');
RS.cloudJoinRoom = origJoin;
RS.hasCloud = origHasCloud;
console.log('OK  冷启动重连 · 有会话自动入席 / 无会话静默');

/* ---------- 号位标注：牌桌每个席位都要能对上是几号 ---------- */
page.mode = 'room';
page.mySeat = 0;
page.openRoom();
page.room.seats[0] = Object.assign({}, page.room.seats[0], { name: '房主甲', nickname: '房主甲', uid: 'host-a' });
page.room.seats[1] = Object.assign({}, page.room.seats[1], {
  joined: true, uid: 'guest-b', name: '好友乙', nickname: '好友乙', ready: true
});
page.room.seats[2] = Object.assign({}, page.room.seats[2], {
  joined: true, uid: 'guest-c', name: '好友丙', nickname: '好友丙', ready: true
});
// 以 2 号位（好友视角）看大厅
page.mySeat = 1;
page.refresh('');
assert(page.data.roomScreen.seats[0].seatNo === 1 && page.data.roomScreen.seats[2].seatNo === 3, '大厅席位要带号位序号');
assert(page.data.roomScreen.seats[0].initial === '房', '无头像时用昵称首字占位，而不是号位数字');
page.onRoomStart();   // 非房主不能开局，先切回房主
assert(page.ui.screen === 'room', '非房主不能开局');
page.mySeat = 0;
page.refresh('');
page.onRoomStart();
assert(page.ui.screen === 'game', '全员就绪后房主可开局');
assert(page.data.meSeatLabel === '1 号位', '本机工作台标注自己的号位');
assert(page.data.rivals.length === 2, '其余席位进入顶部条');
assert(page.data.rivals[0].seatNo === 2 && page.data.rivals[1].seatNo === 3, '对手席位条带号位');
assert(page.data.rivals[0].seatLabel === '2 号位', '副标题用「n 号位」表述');
assert(page.data.statusText.indexOf('你的回合 · 1 号位') === 0, '回合状态行含号位：' + page.data.statusText);
assert(page.data.statusLong === false, '自己的状态行用大字号，不降档');
page.mySeat = 1;
page.refresh('');
assert(page.data.statusText.indexOf('1 号位') >= 0, '看别人回合时也标号位：' + page.data.statusText);
assert(page.data.statusLong === true, '别人的状态行更长，降档保住单行：' + page.data.statusText);
page.mySeat = 0;
page.refresh('');
console.log('OK  号位标注 · 席位条 / 工作台 / 状态行同一口径');

/* ---------- 回合计时：建房选定 / 大厅可改 / 超时托管 ---------- */
page.onLeaveRoom();
page.mode = 'room';
page.mySeat = 0;
page.ui.turnLimit = 90;
page.openRoom();
assert(page.room.turnLimit === 90, '建房时带上的计时应写入房间');
assert(page.data.roomScreen.turnLimitText === '90 秒', '大厅显示当前计时');
page.onRoomTurnLimit({ currentTarget: { dataset: { value: '120' } } });
assert(page.room.turnLimit === 120, '房主可在大厅改计时');
page.onRoomTurnLimit({ currentTarget: { dataset: { value: '45' } } });
assert(page.room.turnLimit === 120, '非法计时值应被忽略（0/60/90/120 之外）');
page.onRoomTurnLimit({ currentTarget: { dataset: { value: '0' } } });
assert(page.room.turnLimit === 0 && page.data.roomScreen.turnLimitText === '不限时', '可切到不限时');
page.onRoomTurnLimit({ currentTarget: { dataset: { value: '60' } } });

page.beginRoomGame();
assert(page.state.turnLimit === 60, '开局快照要带上限时，其他设备据此显示');
assert(page.data.turnClock.on === true, '限时局应显示倒计时');
assert(page.data.turnClock.text === '1:00', '开局显示满额：' + page.data.turnClock.text);
assert(page.data.turnClock.pct === 100, '进度条从满格开始');
assert(page.data.turnFlash && page.data.turnFlash.mine === true, '轮到自己时弹全屏提醒');
assert(page.data.turnFlash.title.indexOf('轮到你') === 0, '提醒文案：' + page.data.turnFlash.title);

// 时钟推进：把 Date.now 拨到 45 秒后，剩余应同步下降
const realNow = Date.now;
let fakeNow = realNow();
Date.now = function () { return fakeNow; };
fakeNow += 50000;
// 倒计时只推 turnClock 这一块：整页 setData 每秒一次会把 250+ 字段全量重推
const origSetData = page.setData;
let tickKeys = null;
page.setData = function (obj) { tickKeys = Object.keys(obj); origSetData(obj); };
page.tickClock();
page.setData = origSetData;
assert(tickKeys && tickKeys.length === 1 && tickKeys[0] === 'turnClock', '倒计时只 setData 计时块，不整页重推：' + JSON.stringify(tickKeys));
assert(page.data.turnClock.text === '0:10', '50 秒后应剩 10 秒：' + page.data.turnClock.text);
assert(page.data.turnClock.urgent === true, '最后 10 秒内转紧急态');
// 再多 16 秒：超时托管，牌局必须继续推进
const beforeTurn = page.state.turnCount;
fakeNow += 16000;
page.tickClock();
assert(page.state.turnCount > beforeTurn, '超时后应自动代打一手，牌局不卡死');
assert(page.state.current !== 0 || page.state.turnCount > beforeTurn, '代打后换手');
Date.now = realNow;

// 不限时局不跑倒计时
page.onRoomTurnLimit({ currentTarget: { dataset: { value: '0' } } });
page.beginRoomGame();
assert(page.data.turnClock.on === false, '不限时局不显示倒计时');
assert(page.data.turnClock.text === '—', '不限时显示占位符');
console.log('OK  回合计时 · 60/90/120/不限时 + 超时托管');

/* ---------- 对手动作回放：把 action 写进快照，其他设备重放 ---------- */
page.onLeaveRoom();
page.startLocalGame();
const st0 = page.state;
const movedCard = st0.board[2][0];
st0.board[2][0] = null;
const fakeAction = {
  id: 'a1-test', seat: 1, type: 'buyBoard', lv: 2, index: 0,
  card: { id: movedCard.id, level: movedCard.level, gem: movedCard.gem, points: movedCard.points, cost: movedCard.cost, name: movedCard.name, art: movedCard.art }
};
st0.lastAction = fakeAction;
page.mySeat = 0;
page.ui.showcase = null;
page._seenActionId = '';
page.replayRemoteAction(st0);
assert(page.ui.showcase && page.ui.showcase.mode === 'buy', '对手购卡要能重放展演');
assert(page.ui.showcase.card.name === movedCard.name, '重放用的是快照里的卡面，不依赖当前牌桌：' + page.ui.showcase.card.name);
assert(page.ui.showcase.remote === true, '重放的展演带 remote 标记');
page.ui.showcase = null;
page.replayRemoteAction(st0);
assert(page.ui.showcase === null, '同一快照只播一次');
st0.lastAction = { id: 'a1-blind', seat: 1, type: 'reserveDeck', lv: 0 };
page.replayRemoteAction(st0);
assert(page.ui.showcase && page.ui.showcase.blindBack === true, '盲抽预留对别人只显示牌背，不泄露牌面');
page.mySeat = 1;
st0.lastAction = { id: 'a0-own', seat: 0, type: 'take', gems: ['red', 'blue', 'white'] };
page._seenActionId = '';
page.ui.showcase = null;
page.replayRemoteAction(st0);
assert(page.ui.showcase && page.ui.showcase.mode === 'take', '取筹码动作也能重放');

// 自己做完动作时写进快照，供别人回放
page.mySeat = 1;
st0.current = 1;
st0.pendingDiscard = 0;
page.applyPlayerAction({ type: 'take', gems: ['red', 'blue', 'white'] });
assert(st0.lastAction && st0.lastAction.type === 'take', '本机动作也要写进快照');
assert(st0.lastAction.seat === 1, 'lastAction 记录发生座位');
assert(st0.lastAction.id === page._seenActionId, '自己的动作不该再被自己的轮询重放');
page.mySeat = 0;
console.log('OK  联机动作回放 · 购卡 / 盲抽 / 拿筹码 + 本机动作不重放');

page.onUnload();
console.log('ALL RUNTIME CHECKS PASSED');
