'use strict';
const ROOT = require('path').resolve(__dirname, '..');
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

page.onUnload();
console.log('ALL RUNTIME CHECKS PASSED');
