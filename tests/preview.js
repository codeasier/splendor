'use strict';

/** 在 Node 里用最小 DOM 执行自包含预览页，验证编译产物可真实渲染与交互 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g)).map((m) => m[1]);
assert(scripts.length === 2, '应有 2 个内联 script');

function makeHost() {
  return {
    innerHTML: '',
    addEventListener: function () {},
    attributes: [],
    getAttribute: function () { return null; }
  };
}

function run(width, height) {
  const host = makeHost();
  const sandbox = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    document: {
      getElementById: function (id) { return id === 'host' ? host : null; },
      body: { innerHTML: '' }
    },
    innerWidth: width,
    innerHeight: height,
    confirm: function () { return true; },
    addEventListener: function () {}
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  scripts.forEach((s, i) => {
    try { vm.runInContext(s, ctx, { filename: 'inline-' + i + '.js' }); }
    catch (e) { throw new Error('script[' + i + '] 运行失败: ' + e.stack); }
  });
  return { host: host, page: sandbox.__splendorPage, sandbox: sandbox };
}

// 1) 横屏桌面窗口
const a = run(1280, 720);
assert(a.page, 'Page 实例应已挂载');

// 1.1 入口界面（默认首屏）
const homeHtml = a.host.innerHTML;
console.log('入口界面 HTML 长度:', homeHtml.length);
assert(a.page.data.screen === 'home', '默认应停在入口界面');
assert(homeHtml.indexOf('人机对战') > 0, '入口界面应有「人机对战」');
assert(homeHtml.indexOf('邀请好友') > 0, '入口界面应有「邀请好友」');
assert(homeHtml.indexOf('创建房间') > 0, '入口界面应有「创建房间」按钮');
assert(homeHtml.indexOf('加入房间') > 0, '入口界面应有「加入房间」入口');
assert(homeHtml.indexOf('class="choice-counts"') > 0, '入口界面应有 2/3/4 人选择');
assert(homeHtml.indexOf('class="mode-bar"') > 0, '大厅应有模式选择条');
assert(homeHtml.indexOf('标准模式') > 0 && homeHtml.indexOf('已开放') > 0, '标准模式应标记为已开放');
assert(homeHtml.indexOf('轮抽模式') > 0 && homeHtml.indexOf('筹备中') > 0, '未开放模式应标记筹备中');
assert(homeHtml.indexOf('class="lobby-stats"') > 0, '大厅应有战绩三格');
assert(homeHtml.indexOf('玩家档案') > 0, '大厅应有玩家档案区');
assert(homeHtml.indexOf('本机账号') > 0, '大厅应显示账号类型');
assert(homeHtml.indexOf('全部战绩') > 0, '大厅应有战绩入口');
assert(homeHtml.indexOf('undefined') < 0, '入口界面含 undefined');
assert(homeHtml.indexOf('{{') < 0, '入口界面存在未求值的模板表达式');
assert(homeHtml.indexOf('wx:') < 0, '入口界面残留 wx: 指令');

// 1.1.1 战绩弹层：空态
a.page.onOpenRecords();
let recHtml = a.host.innerHTML;
assert(a.page.data.showRecords === true, '战绩弹层应打开');
assert(recHtml.indexOf('records-dialog') > 0, '战绩弹层结构缺失');
assert(recHtml.indexOf('还没有对局记录') > 0, '无战绩时应显示空态引导');
assert(recHtml.indexOf('总对局') > 0 && recHtml.indexOf('胜率') > 0, '战绩总览格缺失');
a.page.onCloseRecords();

// 1.1.2 结算自动落一条战绩 → 大厅三格与列表同步
a.page.state = {
  gameOver: true, winner: 0, turnCount: 40,
  players: [
    { nickname: '珠宝商', name: '珠宝商', points: 15, cards: [{}], reserved: [], tokens: {} },
    { nickname: '机器人 1', name: '机器人 1', points: 9, cards: [{}, {}], reserved: [], tokens: {} }
  ]
};
a.page.mode = 'solo';
a.page.mySeat = 0;
a.page._resultRecorded = false;
a.page.refresh('');
a.page.state = null;
a.page.onOpenRecords();
const recFilled = a.host.innerHTML;
assert(recFilled.indexOf('人机 · 2 人') > 0, '战绩列表应显示对局模式与人数');
assert(recFilled.indexOf('第 1 名') > 0, '战绩列表应显示名次');
assert(recFilled.indexOf('清空本机战绩') > 0, '有战绩时应提供清空入口');
a.page.onCloseRecords();
assert(a.page.data.home.stats.total === 1, '返回大厅后战绩统计应更新');
assert(a.page.data.home.recent.length === 1, '大厅应显示最近一条战绩');

// 1.2 进入人机对战
a.page.onStartSolo();
const out = a.host.innerHTML;
console.log('横屏渲染 HTML 长度:', out.length);
assert(out.length > 12000, '渲染结果过短，模板可能未展开');
assert(out.indexOf('undefined') < 0, '渲染结果含 undefined');
assert(out.indexOf('NaN') < 0, '渲染结果含 NaN');
assert(out.indexOf('{{') < 0, '存在未求值的模板表达式');
assert(out.indexOf('wx:') < 0, '残留 wx: 指令');
assert(out.indexOf('data-tap="onTapPile"') > 0, '筹码堆点击事件缺失');
assert(out.indexOf('data-lv="1"') > 0, '牌库点击事件缺失');
assert((out.match(/class="card-slot(?:\s|")/g) || []).length === 12, '应有 12 个卡槽');
assert((out.match(/class="card[\s"]/g) || []).length >= 1, '应有发展卡');
assert((out.match(/class="card-photo photo-\d+/g) || []).length >= 12, '市场卡应绑定写实插画素材');
assert(out.indexOf('noble-photo noble-photo-') > 0, '贵族肖像与卡框应分层渲染');
assert(out.indexOf('gem-icon') > 0, '宝石切面图标应渲染');
assert(out.indexOf('coin-face coin-') > 0, '筹码顶面应渲染');
assert(out.indexOf('noble-photo-') > 0, '贵族肖像应渲染');
assert(out.indexOf('deck-stack deck-art-') > 0, '牌库牌背应渲染');
console.log('横屏：12 个卡槽 / 写实卡面 / 宝石 / 筹码 / 贵族 / 牌库 全部正常');
console.log('舞台 transform:', /class="stage" style="([^"]+)"/.exec(out)[1]);
assert(a.page.data.stageRotate === 0, '横屏窗口不应旋转舞台');

// 1.3 成本气泡恒为印刷值 · 绿光/金光分流 · 预留卡上桌
const p3 = a.page;
const GEM_KEYS = ['white', 'blue', 'green', 'red', 'black'];
const lv1Card = p3.state.board[0][0];
const printedCost = {};
GEM_KEYS.forEach(function (g) { printedCost[g] = lv1Card.cost[g] || 0; });
p3.state.players[0].tokens = Object.assign({ gold: 0 }, printedCost);
p3.refresh('');
let optHtml = a.host.innerHTML;
assert(optHtml.indexOf('is-buyable') > 0, '筹码足够的卡应带绿光类名');
assert(optHtml.indexOf('reserved-rail') > 0, '桌面最左侧应有预留区');
assert(optHtml.indexOf('reserved-tag') > 0, '预留区应有竖排「预留」标签');
assert((optHtml.match(/vault-cell/g) || []).length >= 11, '工作台应有 5 个红利格 + 6 个筹码格');
assert(optHtml.indexOf('尚无永久红利') < 0, '红利行应固定 5 色，不再用文字占位');

const giveGem = GEM_KEYS.filter(function (g) { return printedCost[g] > 0; })[0];
p3.state.players[0].tokens[giveGem] -= 1;
p3.state.players[0].tokens.gold = 1;
p3.refresh('');
optHtml = a.host.innerHTML;
assert(optHtml.indexOf('is-gold-buy') > 0, '需用黄金补齐的卡应带金光类名');

const deckA = p3.state.decks[0];
const deckB = p3.state.decks[1];
const resA = deckA.pop();
const resB = deckB.pop();
p3.state.players[0].reserved = [resA, resB];
p3.refresh('');
optHtml = a.host.innerHTML;
assert((optHtml.match(/reserved-slot/g) || []).length >= 3, '预留区应有 3 个卡位（2 张卡 + 1 空槽）');
assert((optHtml.match(/reserved-empty/g) || []).length === 1, '剩余 1 个预留位应渲染空槽');
p3.state.players[0].reserved = [];
deckA.push(resA);
deckB.push(resB);
p3.refresh('');
console.log('优化项：印刷成本 / 绿光金光 / 预留卡上桌 / 红利-筹码对齐 全部生效');

// 2) 竖屏容器（CSS 旋转 #frame，逻辑窗口仍为横屏）
const b = run(390, 844);
assert(b.page.data.stageRotate === 0, 'H5 竖屏由 CSS 旋转 frame 承担，舞台自身不旋转');
const bTransform = /class="stage" style="([^"]+)"/.exec(b.host.innerHTML)[1];
console.log('竖屏容器舞台 transform:', bTransform);
assert(/scale\(0\.\d+\)/.test(bTransform), '竖屏容器下舞台应等比缩放');

// 3) 弹层渲染（在初始回合、玩家行动阶段验证）
const page = a.page;
function click(method, dataset) {
  page[method]({ type: 'tap', currentTarget: { dataset: dataset || {} }, target: { dataset: dataset || {} } });
}
click('onShowRules');
assert(a.host.innerHTML.indexOf('玩法速览') > 0, '规则弹层应渲染');
click('onCloseRules');
click('onTapCard', { lv: 2, index: 0 });
assert(a.host.innerHTML.indexOf('购买此卡') > 0, '卡牌详情弹层应渲染');
click('onCloseDetail');
click('onShowReserved');
assert(a.host.innerHTML.indexOf('我的预留卡') > 0, '预留卡弹层应渲染');
click('onCloseReserved');
console.log('交互链路：规则 / 卡牌详情 / 预留卡 弹层渲染 OK');

// 4) 模拟真实点击：选取筹码 -> 确认拿取
const before = page.state.bank.white;
click('onTapPile', { key: 'white' });
assert(page.ui.selectedGems.length === 1, '点击筹码应加入待选');
click('onTapPile', { key: 'blue' });
click('onTapPile', { key: 'green' });
click('onConfirmTake');
assert(page.state.bank.white < before, '确认后应扣除银行筹码');
console.log('交互链路：选 3 色筹码 -> 确认拿取 OK，玩家筹码 =', page.state.players[0].tokens);
assert(a.host.innerHTML.indexOf('data-tap="onTapPile"') > 0, '交互后应重新渲染');

// 4.1 房间准备流（本机适配器：空席改机器人后由房主开始）
click('onLeaveRoom');
assert(a.page.data.screen === 'home', '离开牌局回到入口界面');
click('onCreateRoom');
assert(a.page.data.screen === 'room', '创建房间进入房间界面');
const roomHtml = a.host.innerHTML;
assert(roomHtml.indexOf('房间号') > 0, '房间界面应显示房间号');
assert(roomHtml.indexOf('已加入') > 0 && roomHtml.indexOf('已准备') > 0, '房间界面应显示加入与准备人数');
assert(roomHtml.indexOf('等待玩家准备') > 0, '有未就绪席位时房主不可开始');
assert(roomHtml.indexOf('data-catchtap="onRoomToggleBot"') > 0, '空席应可改成机器人');
assert(roomHtml.indexOf('data-tap="onRoomSeatTap"') > 0, '整张席位卡应可点选');

// 4.1.1 好友入席但未点准备：人数 / 准备数 / 提示须实时反映
const origSeat1 = a.page.room.seats[1];
a.page.room.seats[1] = Object.assign({}, origSeat1, {
  joined: true, uid: 'guest-preview', name: '群友乙', nickname: '群友乙', ready: false
});
a.page.refresh('');
const guestHtml = a.host.innerHTML;
assert(guestHtml.indexOf('已加入 2 人 · 已准备 1/3') > 0, '应实时显示已加入 2 人 / 已准备 1/3');
assert(guestHtml.indexOf('还有 1 位玩家未准备') > 0, '应提示还有 1 位玩家未准备');
assert(guestHtml.indexOf('未准备') > 0, '席位胶囊应显示「未准备」');
assert(guestHtml.indexOf('群友乙') > 0, '席位应显示好友昵称');
assert(guestHtml.indexOf('等待玩家准备') > 0, '有人未准备时开始按钮不可用');
assert(guestHtml.indexOf('data-catchtap="onRoomToggleBot"') > 0, '剩余空席仍可改成机器人');

// 好友点准备后，房主端准备数 +1
a.page.room.seats[1].ready = true;
a.page.refresh('');
const readyHtml = a.host.innerHTML;
assert(readyHtml.indexOf('已加入 2 人 · 已准备 2/3') > 0, '好友准备后计数应变为 2/3');
assert(readyHtml.indexOf('还有 1 个空席位') > 0, '提示应转为空席缺口');

// 还原空席，继续原「空席→机器人」链路
a.page.room.seats[1] = origSeat1;
a.page.refresh('');
assert(a.host.innerHTML.indexOf('已准备 1/3') > 0, '还原空席后回到只剩房主就绪');

click('onRoomToggleBot', { index: 1 });
click('onRoomToggleBot', { index: 2 });
assert(a.page.data.roomScreen.canStart === true, '全员就绪后房主可开始');
assert(a.host.innerHTML.indexOf('开始牌局') > 0, '按钮应变为「开始牌局」');
click('onRoomStart');
assert(a.page.data.screen === 'game', '房主开始后进入牌桌');
assert(a.page.state.players.length === 3, '按房间人数开出 3 人局');
console.log('房间流：空席→机器人→全就绪→房主开始 OK');

// 4.2 3 人局：4 张贵族改双列，不再压到工作台下面
assert(a.page.data.nobles.length === 4, '3 人局应有 4 张贵族');
assert(a.page.data.noblesCompact === true, '贵族应切紧凑排布');
assert(a.host.innerHTML.indexOf('is-compact') > 0, '渲染应带紧凑类名');

// 4.3 预留卡详情：按桌面卡面渲染成本气泡与声望
click('onTapCard', { lv: 0, index: 0 });
click('onReserveFromDetail');
assert(a.page.state.players[0].reserved.length === 1, '预留成功');
a.page.ui.showPlayerDetail = true;
a.page.ui.detailSeat = 0;
a.page.refresh('');
const pdHtml = a.host.innerHTML;
assert(pdHtml.indexOf('pd-cards') > 0, '预留卡应以卡面形式渲染');
assert(pdHtml.indexOf('卡面印刷成本') > 0, '应说明气泡为卡面印刷成本');
assert(pdHtml.indexOf('cost-bubble') > 0, '卡面应带成本气泡');
a.page.ui.showPlayerDetail = false;
a.page.refresh('');
console.log('牌桌：3 人局贵族双列 / 预留卡卡面详情 OK');

// 4) 完整对局（直接驱动引擎 + AI，验证视图模型不崩）
let steps = 0;
while (!page.state.gameOver && steps < 600) {
  const action = require(path.join(ROOT, 'utils/ai.js')).chooseAction(page.state);
  const res = require(path.join(ROOT, 'utils/game-engine.js')).performAction(page.state, action);
  if (!res.ok) require(path.join(ROOT, 'utils/game-engine.js')).performAction(page.state, { type: 'pass' });
  steps += 1;
}
assert(page.state.gameOver, '对局应能结束');
page.setData({ gameOver: true, resultTitle: '测试', resultDetail: '测试' });
// 触发一次完整视图模型重绘
const E = require(path.join(ROOT, 'utils/game-engine.js'));
const fresh = E.createGame(2);
page.state = fresh;
page.ui = { selectedGems: [], toast: '', detail: null, showRules: false, showReserved: false };
page.setData({});
assert(a.host.innerHTML.length > 12000, '对局结束后仍应正常渲染');
console.log('完整对局 ' + steps + ' 步 + 结算后重绘 OK');

console.log('\nALL PREVIEW TESTS PASSED');
process.exit(0);
