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
['经典对局', '快速开始', '人机对战', '创建房间', '加入房间', '对局战绩', '游戏规则', '对局设置'].forEach(function (label) {
  assert(homeHtml.indexOf(label) > 0, '商会大厅入口缺失：' + label);
});
['guild-scenery', 'guild-panel', 'guild-nav'].forEach(function (cls) {
  assert(homeHtml.indexOf('class="' + cls + '"') > 0, '场景式大厅结构缺失：' + cls);
});
['onOpenProfile', 'onOpenRecords', 'onShowRules', 'onQuickStart'].forEach(function (handler) {
  assert((homeHtml.match(new RegExp('data-tap="' + handler + '"', 'g')) || []).length === 1,
    '大厅入口应保留且不重复：' + handler);
});
['mode-bar', '筹备中', 'lobby-stats', 'lobby-recent', '本机账号', 'count-chip', 'timer-chip', '<input', 'home-notice'].forEach(function (noise) {
  assert(homeHtml.indexOf(noise) < 0, '首屏不应常驻说明或配置表单：' + noise);
});
a.page.setData({ topRightTop: 110 });
assert(a.host.innerHTML.indexOf('top:110px;') > 0, '操作板应能整体下移避让真机胶囊');
a.page.setData({ topRightTop: 10 });
assert(homeHtml.indexOf('undefined') < 0, '入口界面含 undefined');
assert(homeHtml.indexOf('{{') < 0, '入口界面存在未求值的模板表达式');
assert(homeHtml.indexOf('wx:') < 0, '入口界面残留 wx: 指令');

// 配置按需展开：取消不能误开局；保存人数后快速开始使用同一份选择。
function openHome(kind) {
  a.page.onOpenHomeDialog({ currentTarget: { dataset: { kind: kind } } });
}
openHome('invalid');
assert(a.page.data.home.dialog === '', '非法弹层类型应忽略');
openHome('solo');
assert(a.host.innerHTML.indexOf('人机对战设置') > 0, '人机设置弹层应打开');
assert((a.host.innerHTML.match(/class="count-chip /g) || []).length === 3, '人机设置提供 2/3/4 人');
a.page.onSelectSoloCount({ currentTarget: { dataset: { n: 4 } } });
assert(a.page.data.home.soloCount === 4, '人机人数选择应生效');
a.page.onSaveHomeSettings();
// 快速开始的副标题改为固定说明「可选 2–4 人」：人数在点击后即时选，不再回显旧默认值
assert(a.host.innerHTML.indexOf('人机对战 · 可选 2–4 人') > 0, '快速开始应说明可选人数范围');
assert(a.host.innerHTML.indexOf('guild-dialog"') < 0 && !a.page.state, '保存设置不应误开局');

// 快速开始：先弹人数层，点人数才开局
a.page.onQuickStart();
assert(a.page.data.home.dialog === 'quick', '快速开始应打开人数弹层');
assert(a.host.innerHTML.indexOf('选择对局人数') > 0, '弹层标题应说明是选人数');
assert((a.host.innerHTML.match(/class="seat-pick /g) || []).length === 3, '人数弹层应给 2/3/4 三张大卡');
assert(a.host.innerHTML.indexOf('1 名对手') > 0 && a.host.innerHTML.indexOf('3 名对手') > 0, '每档应标出对手数量');
assert(a.page.state === null || !a.page.state, '仅打开弹层不应开局');
// 人数弹层里不该混入与人数无关的云能力提示
assert(a.host.innerHTML.indexOf('暂不可跨设备邀请') < 0, '人数弹层不应出现云能力提示');
a.page.onCloseHomeDialog();
assert(!a.page.state, '取消人数弹层不开局');
openHome('solo');
a.page.onSelectSoloCount({ currentTarget: { dataset: { n: 3 } } });
a.page.onCloseHomeDialog();
assert(a.page.data.home.soloCount === 4, '取消修改应恢复上次已保存的人数');
a.page.onSelectSoloCount({ currentTarget: { dataset: { n: 2 } } });
openHome('create');
assert(a.host.innerHTML.indexOf('回合计时') > 0, '建房时应展示回合计时');
assert(a.host.innerHTML.indexOf('60 秒') > 0 && a.host.innerHTML.indexOf('不限时') > 0, '建房应保留全部计时选项');
assert(a.host.innerHTML.indexOf('浏览器预览环境，暂不可跨设备邀请') > 0, '预览环境应如实说明不可跨设备邀请');
const onlineHomeHtml = a.sandbox.renderStage(Object.assign({}, a.page.data, {
  home: Object.assign({}, a.page.data.home, { cloud: true, cloudHint: '' })
}));
assert(onlineHomeHtml.indexOf('暂不可跨设备邀请') < 0, '云端可用时不应误报离线');
assert(onlineHomeHtml.indexOf('浏览器预览') < 0, '云端可用时不应误报预览环境');

// 实时在线人数：必须真的渲染出「N 人在线」，未就绪时是「—」而不是 0
{
  const pendingHtml = a.host.innerHTML;
  assert(pendingHtml.indexOf('guild-online') > 0, '大厅应渲染在线人数条');
  assert(pendingHtml.indexOf('guild-online is-pending') > 0, '未查到在线人数时应是 pending 态');
  assert(pendingHtml.indexOf('—') > 0, '未就绪时显示「—」，不能谎报 0');
  const readyHtml = a.sandbox.renderStage(Object.assign({}, a.page.data, {
    home: Object.assign({}, a.page.data.home, { onlineReady: true, online: 7, onlineText: '7' })
  }));
  assert(readyHtml.indexOf('guild-online is-ready') > 0, '拿到数据后应切到 ready 态');
  assert(readyHtml.indexOf('人在线') > 0, '应有「人在线」文案');
  assert(readyHtml.indexOf('>7<') > 0, '应渲染真实在线人数 7');
}
a.page.onSelectRoomCount({ currentTarget: { dataset: { n: 4 } } });
assert(a.page.data.home.roomCount === 4, '房间人数选择应生效');
a.page.onSelectRoomCount({ currentTarget: { dataset: { n: 3 } } });
a.page.onSelectTurnLimit({ currentTarget: { dataset: { value: 90 } } });
assert(a.page.data.home.turnLimit === 90, '建房计时选择应生效');
assert(a.page.ui.toast === '', '计时选中态不应产生重复提示');
a.page.onSelectTurnLimit({ currentTarget: { dataset: { value: 0 } } });
a.page.onCloseHomeDialog();
openHome('join');
assert(a.host.innerHTML.indexOf('data-input="onJoinCodeInput"') > 0, '加入弹层应提供房间号输入');
a.page.onJoinFromHome();
assert(a.host.innerHTML.indexOf('class="home-notice"') > 0, '无效房间号应在弹层显示必要错误提示');
assert(a.host.innerHTML.indexOf('房间号为 6 位字母数字') > 0, '房间号格式错误应可见');
a.page.onJoinCodeInput({ detail: { value: 'abc123' } });
assert(a.page.ui.joinCode === 'ABC123', '房间号输入应转为大写');
a.page.onJoinFromHome();
assert(a.host.innerHTML.indexOf('未连接云端') > 0, '离线加入房间应有明确错误反馈');
assert(a.host.innerHTML.indexOf('undefined') < 0, '大厅错误态不得含 undefined');
a.page.onCloseHomeDialog();
assert(a.page.data.home.notice === '' && a.page.data.home.dialog === '', '关闭弹层后不应遗留错误提示');
a.page.onJoinCodeInput({ detail: { value: '' } });
a.page.ui.homeNotice = '房间已结束';
a.page.refresh('');
assert(a.host.innerHTML.indexOf('class="guild-notice"') > 0, '邀请 / 重连结果仍应能在首页展示');
a.page.ui.homeNotice = '';
a.page.refresh('');

// 1.1.1 战绩弹层：空态
a.page.onOpenRecords();
let recHtml = a.host.innerHTML;
assert(a.page.data.showRecords === true, '战绩弹层应打开');
assert(recHtml.indexOf('records-dialog') > 0, '战绩弹层结构缺失');
assert(recHtml.indexOf('还没有对局记录') > 0, '无战绩时应显示空态引导');
assert(recHtml.indexOf('总对局') > 0 && recHtml.indexOf('胜率') > 0, '战绩总览格缺失');
a.page.onCloseRecords();

// 1.1.2 结算自动落一条战绩 → 战绩弹层与大厅数据同步
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
assert((optHtml.match(/vault-sq/g) || []).length >= 5, '工作台应有 5 个方形永久折扣除');
assert((optHtml.match(/vault-coin/g) || []).length >= 6, '工作台应有 5 色 + 黄金共 6 个圆形筹码格');
assert(optHtml.indexOf('永久折扣') > 0 && optHtml.indexOf('持有筹码') > 0, '两行要各自标注名称');
assert(optHtml.indexOf('我的筹码') > 0, '筹码总量要写明归属「我的筹码」');
assert(optHtml.indexOf('尚无永久红利') < 0, '红利行应固定 5 色，不再用文字占位');
// 号位标注 + 换手全屏提醒
assert(optHtml.indexOf('class="seat-no') > 0, '席位条应带号位徽章');
assert(optHtml.indexOf('portrait-seat') > 0, '本机工作台应标出自己的号位');
assert((optHtml.match(/号位/g) || []).length >= 3, '号位文案应出现在席位 / 工作台 / 状态行');
assert(optHtml.indexOf('turn-flash') > 0, '轮到自己时应弹全屏换手提醒');
assert(optHtml.indexOf('轮到你出牌') > 0, '换手提醒应写明「轮到你出牌」');
// 对手席位卡：三行结构（头像+昵称+号位+声望 / 五色永久折扣 / 五色筹码+黄金+预购）
assert((optHtml.match(/class="seat-row"/g) || []).length === 2, '席位卡应有折扣行与筹码行两行');
// 两行必须等槽数：折扣 5 色 + 1 个空占位 = 6，筹码 5 色 + 黄金 = 6。
// 槽数不等时 flex 等分会给出不同宽度，逐列偏移会一路累积（曾达 33px）。
assert((optHtml.match(/class="seat-sq/g) || []).length === 6, '折扣行应有 6 个槽位（5 色 + 空占位）');
assert((optHtml.match(/seat-sq is-empty-slot/) || []).length >= 1, '折扣行第 6 槽应是空占位');
assert((optHtml.match(/class="seat-coin/g) || []).length === 6, '筹码行应为 5 色 + 黄金共 6 个圆形格');
assert(optHtml.indexOf('seat-row-tag') > 0, '两行应带「折 / 筹」行标');
assert(optHtml.indexOf('seat-res') > 0 && optHtml.indexOf('seat-res-num') > 0, '席位卡应显示预购数');
assert(optHtml.indexOf('seat-score') > 0, '席位卡应有独立声望数字');
// 预购数必须是「第一行内的正常流式元素」，不能绝对定位：
// 卡片内宽仅 ~186px，两行 6 格已铺满，任何角落定位都会压住黄金格或昵称。
{
  const resIdx = optHtml.indexOf('class="seat-res"');
  const topIdx = optHtml.indexOf('class="seat-top"');
  const rowIdx = optHtml.indexOf('class="seat-row"');
  assert(resIdx > 0 && resIdx < rowIdx, '预购数应渲染在第一行内（早于资源行）');
  assert(topIdx > 0 && resIdx > topIdx, '预购数应在 seat-top 容器内');
}
// 折扣方卡与筹码圆格都是深底，不得带 is-light（浅底深墨），否则数字对比度不足
{
  const discSeg = optHtml.slice(optHtml.indexOf('class="seat-row"'));
  const firstCoin = discSeg.indexOf('class="seat-coin');
  const discOnly = discSeg.slice(0, firstCoin);
  assert(discOnly.indexOf('is-light') < 0, '折扣方卡是深底，不应带 is-light');
}

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
assert(a.host.innerHTML.indexOf('逐色实付') > 0, '卡牌详情弹层应渲染成本明细');
click('onCloseDetail');
click('onShowReserved');
assert(a.host.innerHTML.indexOf('我的预留卡') > 0, '预留卡弹层应渲染');
click('onCloseReserved');
console.log('交互链路：规则 / 卡牌详情 / 预留卡 弹层渲染 OK');

// 3.05 好友弹层：必须渲染出「我的账号 ID」与空态说明（预览环境无云端）
{
  click('onOpenFriends');
  const fh = a.host.innerHTML;
  assert(page.data.showFriends === true, '好友弹层应打开');
  assert(fh.indexOf('好友') > 0, '弹层标题应含「好友」');
  assert(fh.indexOf('我的账号 ID') > 0, '必须露出自己的账号 ID 供好友互加');
  assert(fh.indexOf('friends-myid-value') > 0, '账号 ID 值节点应渲染');
  assert(fh.indexOf(' friendships') < 0, '不应出现占位类名');
  // 列表为空时给的是「还没有好友」而不是空白弹层
  assert(fh.indexOf('还没有好友') > 0 || fh.indexOf('正在加载好友') > 0, '空列表应给说明');
  click('onCloseFriends');
  assert(page.data.showFriends === false, '关闭后应收起');

  // 有好友 + 有邀请时的渲染。注意顺序：
  // 必须先 onOpenFriends() 再注入 friendInviteCode —— onOpenFriends 会按「当前是否在房间里」
  // 重置 inviteCode，先设后开会被清掉。
  click('onOpenFriends');
  page.ui.friends = [
    { uid: 'fx-online', nickname: '在线甲', avatar: 'a1' },
    { uid: 'fx-offline', nickname: '离线乙', avatar: 'a2' }
  ];
  page.ui.onlineUids = { 'fx-online': true };
  page.ui.friendsReady = true;
  page.ui.friendInviteCode = 'ABC234';
  page.ui.invites = [{ id: 'iv-x', fromUid: 'fx-online', fromName: '在线甲', roomCode: 'ABC234', at: '' }];
  page.refresh('');
  const fh2 = a.host.innerHTML;
  assert(page.data.friendsPanel.list.length === 2, '两位好友应进入视图模型');
  assert(fh2.indexOf('在线甲') > 0 && fh2.indexOf('离线乙') > 0, '好友行应渲染昵称');
  assert(fh2.indexOf('邀请你联机') > 0, '有邀请时应渲染提醒');
  assert(fh2.indexOf('ABC234') > 0, '提醒里应带房间号');
  assert(fh2.indexOf('onAcceptInvite') > 0 || fh2.indexOf('data-tap="onAcceptInvite"') > 0,
    '提醒应有「加入」入口');
  // 邀请提醒必须是舞台级浮层，不能写在某个 screen-layer 里 ——
  // 写在 home-screen 内，进牌桌就收不到；命中深度必须等于 stage 的直接子层。
  {
    const tagOf = /<div class="invite-toast[^"]*"/;
    const at = fh2.search(tagOf);
    assert(at > 0, '邀请提醒节点应渲染');
    let depth = 0;
    const re = /<\/?(?:div|text)\b[^>]*>/g;
    let mm;
    const before = fh2.slice(0, at);
    while ((mm = re.exec(before)) !== null) {
      if (mm[0].startsWith('</')) depth -= 1; else depth += 1;
    }
    // viewport > stage > invite-toast（host 不在 innerHTML 字符串内）
    assert(depth === 2, '邀请提醒必须挂在 stage 下（实际深度 ' + depth + '），否则换屏会消失');
  }
  // 房间里在线好友可邀请，离线的不可以
  const r0 = page.data.friendsPanel.list[0];
  const r1 = page.data.friendsPanel.list[1];
  assert(r0.canInvite === true, '房间内在线的可邀请');
  assert(r1.canInvite === false, '离线不可邀请');
  click('onCloseFriends');
  page.ui.friends = [];
  page.ui.onlineUids = {};
  page.ui.invites = [];
  page.ui.friendInviteCode = '';
  page.refresh('');
  console.log('好友弹层：账号 ID / 空态 / 在线态 / 邀请提醒 OK');
}

// 3.1 预留卡可购买时，弹层必须渲染出购买按钮（本轮 bug 回归）
//     买得起：只有「购买此卡（实付 n 枚）」+「返回牌桌」，不得出现「预留此卡」
{
  const st = page.state;
  st.current = 0;
  st.pendingDiscard = 0;
  st.pendingNoble = null;
  st.players[0].reserved = [
    { gem: 'blue', points: 1, cost: { white: 0, blue: 4, green: 0, red: 0, black: 0 }, name: '暗河渡口', level: 1, art: 0 }
  ];
  st.players[0].tokens = { white: 0, blue: 5, green: 0, red: 0, black: 0, gold: 0 };
  page.refresh('');
  click('onTapReservedCard', { index: 0 });
  const html = a.host.innerHTML;
  assert(page.data.detail.canBuy === true, '预览环境：预留卡应判定可购买');
  assert(html.indexOf('购买此卡（实付 4 枚）') > 0, '弹层必须渲染带实付的购买按钮');
  assert(html.indexOf('预留此卡') < 0, '可购买时不应同时渲染「预留此卡」');
  assert(html.indexOf('确认后立即获得该卡的红利与声望') > 0, '弹层应给出动作后果说明');
  click('onCloseDetail');

  // 买不起：不给假的主操作，只留返回 + 缺口说明
  st.players[0].tokens = { white: 0, blue: 1, green: 0, red: 0, black: 0, gold: 0 };
  page.refresh('');
  click('onTapReservedCard', { index: 0 });
  const html2 = a.host.innerHTML;
  assert(page.data.detail.canBuy === false, '预览环境：筹码不足应判为不可购买');
  assert(html2.indexOf('购买此卡（实付') < 0, '买不起时不应渲染购买主按钮');
  assert(html2.indexOf('筹码不足，可稍后再来购买') > 0, '买不起时应说明可稍后再买');
  click('onCloseDetail');
  console.log('预留卡详情：可购买渲染主按钮 / 买不起只留返回 OK');
}

// 4.0 选篮门禁与「-」放回按钮（编译产物必须真的渲染出 catchtap 节点）
click('onTapPile', { key: 'white' });
assert(page.data.canConfirm === false, '只选 1 枚不可确认');
assert(a.host.innerHTML.indexOf('data-catchtap="onRemovePile"') > 0, '已选筹码堆应渲染「-」按钮');
assert(a.host.innerHTML.indexOf('class="pile-minus"') > 0, '「-」按钮样式类应渲染');
const bankAtSelect = page.state.bank.white;
click('onConfirmTake');
assert(page.state.bank.white === bankAtSelect, '未凑满时误触确认不应扣筹码');
click('onRemovePile', { key: 'white' });
assert(page.ui.selectedGems.length === 0, '「-」应放回已选筹码');
assert(a.host.innerHTML.indexOf('data-catchtap="onRemovePile"') < 0, '放回后「-」按钮应消失');
click('onTapPile', { key: 'white' });
click('onTapPile', { key: 'blue' });
assert(page.data.canConfirm === false, '2 个不同色不可确认');
click('onTapPile', { key: 'green' });
assert(page.data.canConfirm === true, '凑满 3 色才可确认');
click('onCancelSelection');
console.log('交互链路：选篮门禁 / 「-」放回 / 3 色放行 OK');

// 4.05 待确认摘要：勾选后必须能读到「本次拿取」与「确认后 n/10 → m/10」
click('onTapPile', { key: 'white' });
click('onTapPile', { key: 'blue' });
let summaryHtml = a.host.innerHTML;
assert(summaryHtml.indexOf('pick-kind') > 0, '工作台应有待确认摘要区');
assert(summaryHtml.indexOf('本次拿取') > 0, '选中后应显示「本次拿取」明细');
assert(summaryHtml.indexOf('确认后') > 0, '摘要应给出确认后的总量');
assert(summaryHtml.indexOf('pick-total-num is-next') > 0, '应并排显示变化后的数值');
assert(summaryHtml.indexOf('pick-delta') > 0, '应有独立的 +n 增量标记');
assert(summaryHtml.indexOf('确认拿取 2 枚') < 0, '未凑满时按钮文案不应谎报可提交');
click('onCancelSelection');
summaryHtml = a.host.innerHTML;
assert(summaryHtml.indexOf('未选择筹码') > 0, '清除后摘要应回到空态');
console.log('交互链路：待确认摘要 · 本次拿取 / 确认后总量 / 清除回空态 OK');

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

// 4.2.1 多贵族挑选弹层：本机席位挂起时渲染选择卡；别人挑选时渲染等待横幅
const pnState = a.page.state;
pnState.current = 0;
pnState.players[0].cards = [];
['white', 'blue', 'black'].forEach(function (g) {
  for (let i = 0; i < 4; i++) pnState.players[0].cards.push({ gem: g, points: 0, cost: {}, name: 'x', level: 1, art: i });
});
pnState.players[0].points = 0;
pnState.nobles = [
  { id: 'n1', title: '霜港勋爵', points: 3, claimedBy: -1, req: { white: 4, blue: 4, green: 0, red: 0, black: 0 } },
  { id: 'n2', title: '铸币大臣', points: 3, claimedBy: -1, req: { white: 4, blue: 0, green: 0, red: 0, black: 4 } }
];
pnState.pendingDiscard = 0;
a.page.mySeat = 0;
a.page.applyPlayerAction({ type: 'pass' });
assert(pnState.pendingNoble && pnState.pendingNoble.seat === 0, '3 人局本机满足多贵族应挂起');
const pickHtml = a.host.innerHTML;
assert(pickHtml.indexOf('noble-pick-row') > 0, '应渲染贵族挑选弹层');
assert((pickHtml.match(/noble noble-pick/g) || []).length >= 2, '弹层应列出两张可选贵族');
assert(pickHtml.indexOf('贵族到访 · 挑选 1 张') > 0, '弹层标题应说明规则');
assert(pickHtml.indexOf('undefined') < 0, '挑选弹层不得含 undefined');
// 点击其中一张完成选择
const pickId = pnState.pendingNoble.options[1];
a.page.onChooseNoble({ currentTarget: { dataset: { id: pickId } } });
assert(pnState.pendingNoble === null, '点击后挂起应解除');
assert(pnState.players[0].points === 3, '点击后 +3 声望');
assert(a.host.innerHTML.indexOf('noble-pick-row') < 0, '选择完成弹层应关闭');
// 别人挑选：等待横幅
pnState.current = 1;
pnState.turnCount += 1;
pnState.pendingNoble = { seat: 1, options: ['n1'] };
a.page.refresh('');
const waitHtml = a.host.innerHTML;
assert(waitHtml.indexOf('noble-waiting') > 0, '别人挑选时应渲染等待横幅');
assert(waitHtml.indexOf('正在挑选贵族') > 0, '横幅应写明谁在挑');
assert(waitHtml.indexOf('noble-pick-row') < 0, '别人挑选时不应弹选择卡');
pnState.pendingNoble = null;
pnState.current = 0;
pnState.pendingDiscard = 0;
a.page.refresh('');

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
assert(pdHtml.indexOf('pd-grid') > 0, '详情弹层应渲染 6 列分组');
assert((pdHtml.match(/class="pd-chip/g) || []).length === 12, '6 列 × 上下两格应渲染 12 个大字章');
assert(pdHtml.indexOf('逐色对齐') > 0, '应标明红利/筹码逐色对齐');
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

// Exercise the compiled template/module bundle for every new room theme.
const themesPreview = run(844, 390);
const tp = themesPreview.page;
['pokemon', 'cyberpunk', 'ai'].forEach(function (id) {
  tp.onOpenHomeDialog({ currentTarget: { dataset: { kind: 'create' } } });
  assert((themesPreview.host.innerHTML.match(/data-tap="onSelectRoomTheme"/g) || []).length === 4, '建房须提供四套主题');
  tp.onSelectRoomTheme({ currentTarget: { dataset: { id: id } } });
  tp.onCreateRoom();
  assert(themesPreview.host.innerHTML.indexOf('viewport theme-' + id) > 0, '房间根容器应应用所选主题');
  assert(themesPreview.host.innerHTML.indexOf('本房间固定') > 0, '房间应说明主题范围');
  tp.onRoomCount({ currentTarget: { dataset: { n: 2 } } });
  tp.onRoomToggleBot({ currentTarget: { dataset: { index: 1 } } });
  tp.onRoomStart();
  assert.equal(tp.state.themeId, id);
  const theme = require(path.join(ROOT, 'utils/theme.js'));
  tp.state.board.forEach(function (row) {
    row.forEach(function (card) {
      assert(themesPreview.host.innerHTML.indexOf(theme.cardName(id, card)) > 0, '卡面主标题应使用主题名称');
      assert(themesPreview.host.innerHTML.indexOf(card.name) < 0, '新主题不应残留皇家商会卡名');
    });
  });
  tp.onTapCard({ currentTarget: { dataset: { lv: 0, index: 0 } } });
  const name = theme.cardName(id, tp.state.board[0][0]);
  assert.equal(tp.data.detail.card.name, name);
  assert(themesPreview.host.innerHTML.indexOf(name) > 0, '详情标题也应使用主题名称');
  assert(themesPreview.host.innerHTML.indexOf('theme-card-caption') < 0, '主标题改名后不再叠加重复角色标签');
  assert(themesPreview.host.innerHTML.indexOf('undefined') < 0, '主题渲染不得包含 undefined');
  tp.onLeaveRoom();
  assert(themesPreview.host.innerHTML.indexOf('viewport theme-royal') > 0, '退房恢复大厅默认主题');
});
tp.onUnload();
console.log('四主题入口 / 三套主题房间与牌桌 / 退房恢复 OK');

console.log('\nALL PREVIEW TESTS PASSED');
process.exit(0);
