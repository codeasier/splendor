'use strict';

const D = require('../../utils/game-data.js');
const E = require('../../utils/game-engine.js');
const AI = require('../../utils/ai.js');
const R = require('../../utils/room.js');
const U = require('../../utils/user.js');
const F = require('../../utils/friend.js');
const C = require('../../utils/chat.js');
const L = require('../../utils/leaderboard.js');
const Nick = require('../../utils/nickname.js');
const T = require('../../utils/theme.js');
const V = require('../../utils/reset-vote.js');
const Ent = require('../../utils/entertainment.js');
const Sound = require('../../utils/sound.js');

// 设计稿舞台尺寸（与参考截图比例一致），运行时等比缩放适配屏幕
const DESIGN_W = 1080;
const DESIGN_H = 560;
// 悬浮菜单停靠尺寸与默认安全位置（舞台右下角工作台外侧，避开微信右上角胶囊与所有牌桌元素）
const MENU_DEFAULT_X = 1014;
const MENU_DEFAULT_Y = 422;
const MENU_DOCK_W = 56;
const MENU_DOCK_H = 128;

function haptic(type) {
  if (typeof wx === 'undefined' || !wx.vibrateShort) return;
  try { wx.vibrateShort({ type: type || 'light' }); } catch (e) {}
}

/* 动作类型 → 音效名。集中映射而不是在每个动作函数里各写一次播放调用，
 * 这样新增动作时只改这张表，也不会漏掉某个入口。
 * 语义分组：拿/买/预留各不相同，让玩家闭眼也能听出刚才发生了什么。 */
const ACTION_SOUND = {
  take: 'takeGem',
  discard: 'tap',
  pass: 'tap',
  buyBoard: 'buyCard',
  buyReserved: 'buyCard',
  reserveBoard: 'reserve',
  reserveDeck: 'reserve',
  chooseNoble: 'noble',
  skill: 'noble'
};

/** 播放某个对局动作对应的音效；未知动作静默跳过 */
function playActionSound(action) {
  if (!action || !action.type) return;
  const name = ACTION_SOUND[action.type];
  if (name) Sound.play(name);
}

/* 交互入口 → 音效名。79 个 bindtap 逐个配音既无意义也难维护，
 * 按语义分 6 组：开/关/选/确认/复制/否定。
 * 用一张表集中声明，而不是在每个方法里散落 Sound.play()，
 * 这样新增入口时只需在这里加一行，也一眼看得出哪些还没覆盖。 */
const TAP_SOUND = {
  /* 打开类：弹层 / 详情 / 面板 / 侧栏 */
  onOpenFriends: 'uiOpen',
  onOpenLeaderboard: 'uiOpen',
  onOpenRecords: 'uiOpen',
  onOpenProfile: 'uiOpen',
  onOpenHomeDialog: 'uiOpen',
  onOpenLobby: 'uiOpen',
  onOpenMoreModes: 'uiOpen',
  onShowRules: 'uiOpen',
  onShowReserved: 'uiOpen',
  onToggleChatPanel: 'uiOpen',
  onTapCard: 'uiOpen',
  onTapNoble: 'uiOpen',
  onTapPlayer: 'uiOpen',
  onTapMyPortrait: 'uiOpen',
  onTapDeck: 'uiOpen',

  /* 关闭类：关闭弹层 / 取消选择 / 返回 */
  onCloseFriends: 'uiClose',
  onCloseLeaderboard: 'uiClose',
  onCloseRecords: 'uiClose',
  onCloseProfile: 'uiClose',
  onCloseHomeDialog: 'uiClose',
  onCloseLobby: 'uiClose',
  onCloseRules: 'uiClose',
  onCloseReserved: 'uiClose',
  onCloseDetail: 'uiClose',
  onCloseNobleDetail: 'uiClose',
  onClosePlayerDetail: 'uiClose',
  onCloseChatPanel: 'uiClose',
  onCloseSkillPanel: 'uiClose',
  onCancelSelection: 'uiClose',
  onCancelChatTarget: 'uiClose',
  onDismissSkillResult: 'uiClose',
  onCloseMenu: 'uiClose',

  /* 选择类：切换 tab / 单选 / 选人 / 挑席位 */
  onSelectMode: 'uiPick',
  onSelectRoomTheme: 'uiPick',
  onSelectSoloCount: 'uiPick',
  onSelectRoomCount: 'uiPick',
  onSelectTurnLimit: 'uiPick',
  onRoomCount: 'uiPick',
  onRoomTurnLimit: 'uiPick',
  onPickSoloSeats: 'uiPick',
  onRoomSeatTap: 'uiPick',
  onRoomToggleBot: 'uiPick',
  onRoomToggleReady: 'uiPick',
  onToggleAutoPlay: 'uiPick',
  onSwitchChatTab: 'uiPick',
  onPickChatTarget: 'uiPick',
  onPickAvatar: 'uiPick',
  onPickNickname: 'uiPick',
  onPickBuff: 'uiPick',
  onSelectSkill: 'uiPick',
  onPickSkillTarget: 'uiPick',
  onTapPile: 'uiPick',
  onTapMyToken: 'uiPick',
  onTapReservedSlot: 'uiPick',
  onTapReservedCard: 'uiPick',

  /* 确认类：创建 / 加入 / 保存 / 发送 / 开局 */
  onQuickStart: 'uiConfirm',
  onCreateRoom: 'uiConfirm',
  onJoinRoom: 'uiConfirm',
  onJoinFromHome: 'uiConfirm',
  onRetryCreateRoom: 'uiConfirm',
  onRoomStart: 'uiConfirm',
  onSaveHomeSettings: 'uiConfirm',
  onSaveProfile: 'uiConfirm',
  onSendQuickChat: 'uiConfirm',
  onAddFriend: 'uiConfirm',
  onAcceptInvite: 'uiConfirm',
  onInviteFriend: 'uiConfirm',
  onConfirmTake: 'uiConfirm',
  onRestart: 'uiConfirm',
  onClearRecords: 'uiConfirm',
  onLeaveRoom: 'uiConfirm',
  onWechatLogin: 'uiConfirm',

  /* 复制类：真正复制成功才有提示，所以用清脆单音 */
  onCopyMyId: 'uiCopy',
  onCopyRoomCode: 'uiCopy',

  /* 否定类：删除 / 拒绝 / 移除 */
  onRemoveFriend: 'uiDeny',
  onDeclineInvite: 'uiDeny'
};

/** 播放某个交互入口对应的音效；表里没有的入口静默跳过（不报错） */
function playTapSound(handler) {
  if (!handler) return;
  const name = TAP_SOUND[handler];
  if (name) Sound.play(name);
}
const GEMS = D.GEMS;
const ALL = D.ALL_TOKENS;
const META = D.GEM_META;
// 终局线：声望达到 15 触发最后一轮。界面按真实数值渲染，不在此截断
const FINAL_POINTS = 15;

function clampMenuPos(x, y) {
  const nx = typeof x === 'number' && isFinite(x) ? Math.round(x) : MENU_DEFAULT_X;
  const ny = typeof y === 'number' && isFinite(y) ? Math.round(y) : MENU_DEFAULT_Y;
  return {
    x: Math.max(10, Math.min(DESIGN_W - MENU_DOCK_W - 10, nx)),
    y: Math.max(10, Math.min(DESIGN_H - MENU_DOCK_H - 10, ny))
  };
}

function menuDirClassOf(x, y) {
  const dx = x > DESIGN_W * 0.5 ? 'open-left' : 'open-right';
  const dy = y > DESIGN_H * 0.4 ? 'open-up' : 'open-down';
  return dx + ' ' + dy;
}

/**
 * 每次行动耗时的可信下限。
 * 重连进场时若把「进场时刻」当成开局时刻，一局 101 个行动会被算成
 * 505ms / 101 ≈ 0.005s/行动，写进累计后把 avgTurnSec 拉向 0，
 * 等于凭空拿满速度分。低于下限的计时一律记 0，让速度项跳过这一局。
 */
const MIN_VALID_TURN_MS = 200;

/** 本局唯一标识：开局时生成一次，随云端牌局快照下发，全场同一份 */
function newGameId() {
  return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function gemStyle(g) {
  const m = META[g];
  return 'background:radial-gradient(circle at 34% 26%,' + m.edge + ' 0%,' + m.main + ' 44%,' + m.dark + ' 100%);';
}

function readWindowSize() {
  // 基础库版本差异：优先 getWindowInfo，低版本回退 getSystemInfoSync
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  return { w: info.windowWidth, h: info.windowHeight };
}

/**
 * 计算舞台布局。pageOrientation=landscape 在真机客户端生效，但开发者工具的
 * 竖屏模拟器、低版本基础库以及 Web 预览容器仍会给出 w < h 的窗口尺寸。
 * 此时把 1080×560 的横屏舞台整体旋转 90°，并按交换后的逻辑尺寸等比缩放，
 * 保证任何容器里看到的都是完整的横屏牌桌，而不是被压成一条横条。
 */
function calcLayout(w, h) {
  if (!w || !h) return { scale: 1, rotate: 0 };
  if (w >= h) {
    return { scale: Math.min(w / DESIGN_W, h / DESIGN_H), rotate: 0 };
  }
  return { scale: Math.min(h / DESIGN_W, w / DESIGN_H), rotate: 90 };
}

/**
 * 微信胶囊按钮（右上角「…」/ 退出）避让：真机横屏时胶囊悬浮在屏幕右上，
 * 正好压住舞台右上角的操作区（黄金 + 大厅 / 资料 / 规则 / 重开圆钮）。
 * 返回 .top-right 应使用的 top 值（舞台 px）：
 * 取「胶囊底边 + 8px 间隙」换算进舞台坐标系，与原值取大。
 * 开发者工具的竖屏旋转模式（rotate 90）与 H5 预览（无 wx）保持原位。
 */
function topRightOffset(w, h, rotate) {
  const BASE = 10;
  if (rotate !== 0 || typeof wx === 'undefined' || !wx.getMenuButtonBoundingClientRect) return BASE;
  let r = null;
  try { r = wx.getMenuButtonBoundingClientRect(); } catch (e) { r = null; }
  if (!r || !r.height) return BASE;
  const scale = Math.min(w / DESIGN_W, h / DESIGN_H);
  const stageTop = (h - DESIGN_H * scale) / 2;
  const stageLeft = (w - DESIGN_W * scale) / 2;
  const stageRight = stageLeft + DESIGN_W * scale;
  // 胶囊与舞台没有横向交叠时无需避让
  if (r.right <= stageLeft + 1 || r.left >= stageRight - 1) return BASE;
  const need = Math.ceil((r.bottom - stageTop) / scale) + 8;
  return Math.max(BASE, need);
}

function countIn(list, key) {
  let n = 0;
  for (let i = 0; i < list.length; i++) if (list[i] === key) n += 1;
  return n;
}

/**
 * 计算中央市场 3 行 × 4 列卡槽的单灭点 2.5D 桌面透视变换：
 *   r=0 为远端 III 级行（窄、略小），r=1 为中端 II 级行，r=2 为近端 I 级行（宽、略大）；
 *   左列向右倾斜（/），右列向左倾斜（\），四列延长线汇聚于屏幕上方中央灭点，还原参考图1的斜铺牌桌。
 */
function boardSlotTransform(r, c, jitterDeg) {
  const rowScaleX = [0.88, 0.96, 1.05][r] || 1;
  const rowScaleY = [0.78, 0.84, 0.91][r] || 0.85;
  const colSkew = [-10, -3.4, 3.4, 10][c] || 0;
  // 远端行向中央收拢、近端行向两侧展开，形成真实梯形透视网格
  const colOffset = [-1.5, -0.5, 0.5, 1.5][c] || 0;
  const rowSpread = [-15, 0, 15][r] || 0;
  const tx = (colOffset * rowSpread).toFixed(1);
  const rotZ = (jitterDeg || 0).toFixed(2);
  return 'transform:translateX(' + tx + 'px) perspective(360px) rotateX(22deg) skewX(' +
    colSkew + 'deg) rotateZ(' + rotZ + 'deg) scale(' + rowScaleX + ',' + rowScaleY + ');';
}

/**
 * 把一张发展卡转换为视图数据。
 * 成本气泡一律显示**卡面印刷成本**（原作数值），不随玩家持有筹码变化——
 * 这样桌面上每张卡看起来和实体卡一致，玩家自己用「工作台红利 + 筹码」去心算。
 * 买得起与否不再靠改数字表达，改用卡框光环：绿光=现有筹码直接可买，金光=需动用黄金。
 */
function cardVM(state, card, seat, r, c) {
  const s = seat || 0;
  const costs = printedCosts(card);
  // direct：筹码足够；gold：缺口靠黄金补齐；no：连黄金都不够
  const pay = E.getPayment(state, s, card);
  const buyState = pay ? (pay.gold > 0 ? 'gold' : 'direct') : 'no';
  const jitter = ((card.art % 5) - 2) * 0.35;
  const tiltStyle = (typeof r === 'number' && typeof c === 'number')
    ? boardSlotTransform(r, c, jitter)
    : 'transform:perspective(420px) rotateX(18deg) rotateZ(' + jitter.toFixed(2) + 'deg);';
  return {
    id: card.id,
    empty: false,
    name: T.cardName(state && state.themeId, card),
    level: card.level,
    pointsText: card.points > 0 ? String(card.points) : '',
    pointsLabel: card.points + ' 声望',
    gemLabel: META[card.gem].label,
    gemClass: 'gem-' + card.gem,
    gemStyle: gemStyle(card.gem),
    // 写实油画按「红利宝石色系 × 画面序号」索引，与规则数据解耦、可整组替换
    photoClass: 'photo-' + (GEMS.indexOf(card.gem) * 18 + (card.art % 18)),
    // 程序化矢量插画作为无照片素材时的兜底
    artClass: 'art-' + (GEMS.indexOf(card.gem) * 3 + (card.art % 3)),
    tiltStyle: tiltStyle,
    costs: costs,
    // 官方牌组里有 4 色成本的卡（如 1/1/1/1 与三级 3/3/3/5），
    // 市场格只有 92×112，默认 21px 圆章会折成第二列压住卡名，这里标记出来收窄
    costDense: costs.length >= 4,
    buyState: buyState,
    buyClass: buyState === 'direct' ? 'is-buyable' : (buyState === 'gold' ? 'is-gold-buy' : ''),
    goldPay: pay ? pay.gold : 0,
    affordable: buyState !== 'no'
  };
}

function emptyCardVM(lv, i, r) {
  const rowIdx = typeof r === 'number' ? r : (2 - lv);
  return {
    id: 'empty-' + lv + '-' + i,
    empty: true,
    tiltStyle: boardSlotTransform(rowIdx, i, 0)
  };
}

function tokensVM(player, keys) {
  return keys.map(function (g, idx) {
    const count = player.tokens[g];
    const layers = count <= 0 ? 1 : Math.min(count, 4);
    const stack = [];
    for (let k = 0; k < layers; k++) {
      const dy = -k * 3;
      const dx = k > 0 ? (((k + idx) % 3 - 1) * 0.6) : 0;
      stack.push({
        idx: k,
        coinClass: 'coin-' + g,
        style: 'transform:translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) rotateX(22deg);'
      });
    }
    return {
      key: g,
      label: META[g].label,
      count: count,
      zero: count === 0,
      isGold: g === 'gold',
      ink: META[g].ink,
      gemClass: 'gem-' + g,
      coinClass: 'coin-' + g,
      style: gemStyle(g),
      stack: stack
    };
  });
}

/**
 * 工作台「红利」行：固定 5 色各一格（哪怕为 0 也占位），
 * 才能和下面「持有筹码」行按颜色严格上下对齐，便于逐列做减法。
 * 零值不再隐藏数字：0 本身是「这色还没有红利」的有效信息，
 * 只靠减弱底色与描边降权（旧版 opacity .3 且不渲染 0，看起来像整项坏掉）。
 */
function discountCellsVM(state, idx) {
  const disc = E.getDiscounts(state, idx);
  return GEMS.map(function (g) {
    const num = disc[g] || 0;
    return {
      key: g,
      num: num,
      numText: String(num),
      zero: num === 0,
      wide: num >= 10,
      light: g === 'white',
      label: META[g].label,
      gemClass: 'gem-' + g,
      style: gemStyle(g)
    };
  });
}

function discountsVM(state, idx) {
  const disc = E.getDiscounts(state, idx);
  const list = [];
  for (let i = 0; i < GEMS.length; i++) {
    const g = GEMS[i];
    if (disc[g] > 0) {
      list.push({ key: g, num: disc[g], label: META[g].label, gemClass: 'gem-' + g, style: gemStyle(g) });
    }
  }
  return list;
}

/** 对手席位卡用的轻量筹码格：5 宝石 + 黄金，各一格，不渲染筹码叠层 */
function miniTokensVM(p) {
  return ALL.map(function (g) {
    const num = p.tokens[g] || 0;
    return {
      key: g,
      num: num,
      zero: num === 0,
      isGold: g === 'gold',
      gemClass: 'gem-' + g
    };
  });
}

/**
 * 对手席位卡概览：6 列分组（白/蓝/绿/红/黑/金），每列上下两格严格对齐——
 * 上格红利（方块）、下格持有筹码（圆章），同一列同一色，可直接逐色相加。
 * 旧实现用两套独立循环（红利 5 格带标签 / 筹码 6 格不带），列起点与格宽都
 * 不同，视觉上永远对不齐。黄金没有红利，该格留给预购数（VM 标记 isGold）。
 * 数字由 VM 给 show 布尔，零值只留淡色块不渲染 "0"，减少视觉噪声。
 */
function seatColumnsVM(state, idx, reservedCount) {
  const p = state.players[idx];
  const disc = E.getDiscounts(state, idx);
  return ALL.map(function (g) {
    const bonus = g === 'gold' ? 0 : (disc[g] || 0);
    const tok = p.tokens[g] || 0;
    return {
      key: g,
      label: META[g] ? META[g].label : '黄金',
      gemClass: 'gem-' + g,
      isGold: g === 'gold',
      // 白宝石章底色浅，数字必须用深色墨（与卡面成本气泡同一约定）
      light: g === 'white',
      // 预购数随黄金列一起下发：嵌套 wx:for 里引用外层 item 在预览编译器
      // 作用域下会丢失，列数据必须自洽
      res: String(reservedCount),
      // 黄金没有红利：席位卡该格改放预购数，详情弹层显示破折号
      bonus: g === 'gold' ? '—' : String(bonus),
      bonusShow: bonus > 0,
      bonusWide: bonus >= 10,
      token: String(tok),
      tokenShow: tok > 0,
      tokenWide: tok >= 10
    };
  });
}

/** 贵族肖像槽位：按官方牌池顺序（n1~n10）取模，同一张贵族永远同一张脸 */
function nobleSlot(noble) {
  let at = -1;
  for (let i = 0; i < D.NOBLE_POOL.length; i++) {
    if (D.NOBLE_POOL[i].id === noble.id) { at = i; break; }
  }
  if (at < 0) at = 0;
  return { photoClass: 'noble-photo-' + (at % 10), artClass: 'noble-art-' + (at % 3) };
}

/** 把 gems 数组压成 [{key,label,count}]，顺序固定按白蓝绿红黑，便于逐行读数 */
function tallyGems(gems) {
  const out = [];
  for (let i = 0; i < GEMS.length; i++) {
    const g = GEMS[i];
    let n = 0;
    for (let k = 0; k < gems.length; k++) if (gems[k] === g) n += 1;
    if (n > 0) out.push({ key: g, label: META[g].label, count: n, gemClass: 'gem-' + g, light: g === 'white' });
  }
  return out;
}

/** 「白×1、蓝×1」这种紧凑文案，给摘要行用 */
function gemsText(list) {
  const parts = [];
  for (let i = 0; i < list.length; i++) parts.push(list[i].label + '×' + list[i].count);
  return parts.join('、');
}

/** 选篮按色聚合后的「+n」标记：已有数量不动，只表达本次将增加多少 */
function gainColumns(sel, goldAdd) {
  const cols = [];
  for (let i = 0; i < ALL.length; i++) {
    const g = ALL[i];
    let n = 0;
    for (let k = 0; k < sel.length; k++) if (sel[k] === g) n += 1;
    if (g === 'gold' && goldAdd) n += goldAdd;
    cols.push({
      key: g,
      gemClass: 'gem-' + g,
      light: g === 'white',
      isGold: g === 'gold',
      gain: n,
      gainText: '+' + n,
      show: n > 0
    });
  }
  return cols;
}

/**
 * 自己的资源两组数据：上行永久折扣（方形卡）、下行持有筹码（圆形）。
 * 与对手摘要、公共筹码池共用同一顺序（白蓝绿红黑 + 黄金末位）。
 * 零值也下发数字，用 zero 标记降权而不是隐藏——「这色为 0」本身是有效信息。
 */
function myResourceVM(state, idx) {
  const p = state.players[idx];
  const disc = E.getDiscounts(state, idx);
  const discount = GEMS.map(function (g) {
    const num = disc[g] || 0;
    return {
      key: g, num: num, numText: String(num), zero: num === 0,
      // 折扣格是深色方卡（只有左侧竖色条带颜色），深墨字会糊在深底上，不能用 light
      wide: num >= 10, light: false,
      // 方形卡左侧竖色条（sq-*）与圆形筹码共用同一套色序，但形状/色标不同
      sqClass: 'sq-' + g,
      label: META[g].label, gemClass: 'gem-' + g
    };
  });
  const tokens = ALL.map(function (g) {
    const num = p.tokens[g] || 0;
    return {
      key: g, num: num, numText: String(num), zero: num === 0,
      // 筹码圆格统一深底 + 本色描边，数字恒白，不能用浅底深墨
      wide: num >= 10, light: false, isGold: g === 'gold',
      label: META[g] ? META[g].label : '黄金', gemClass: 'gem-' + g
    };
  });
  return { discount: discount, tokens: tokens };
}

/**
 * 工作台右下「本次选择 / 待确认摘要」的唯一数据源。
 *
 * 四种上下文按优先级排列，同一时刻只会命中一种：
 *   discard  筹码超 10 枚 → 攒够要退的枚数再一次性确认（旧版点一枚退一枚，退多了没法撤回）
 *   buy      卡牌详情打开且买得起 → 展示扣除永久折扣后的逐色实付与黄金替代
 *   reserve  卡牌详情打开且可预留 → 展示预留名额与该次黄金变化
 *   take     默认 → 本次拿取明细 + 确认后总量
 *
 * 这里只做「将要发生什么」的推演，绝不改 state：正式库存只在 applyPlayerAction 后变化。
 */
function pickVM(state, ui, seat, takeError, needDiscard) {
  const p = state.players[seat];
  const sel = ui.selectedGems || [];
  const disc = E.getDiscounts(state, seat);
  const total = E.tokenTotal(p);
  const out = {
    mode: 'take',
    kind: '拿取筹码',
    title: '',
    lines: [],
    goldLine: '',
    fromText: String(total),
    toText: String(total),
    delta: 0,
    arrow: '→',
    items: [],
    gain: gainColumns(sel, 0),
    dots: gainColumns(sel, 0).filter(function (g) { return g.show; }),
    hasGain: sel.length > 0,
    canSubmit: false,
    reason: takeError || '',
    label: '确认拿取',
    pending: needDiscard,
    discardPicked: [],
    discardLeft: 0,
    discardPlan: 0
  };

  // ① 退还筹码：先攒批，再一次性确认
  if (needDiscard) {
    const plan = ui.discardPlan || [];
    out.mode = 'discard';
    out.kind = '退还筹码';
    out.title = '';
    out.lines = [];
    out.gain = gainColumns([], 0);
    out.hasGain = plan.length > 0;
    out.items = tallyGems(plan).map(function (it) {
      it.negative = true;
      it.sign = '−' + it.count;
      return it;
    });
    out.dots = out.items;
    out.discardPicked = plan.slice();
    out.discardPlan = plan.length;
    out.discardLeft = state.pendingDiscard;
    out.fromText = String(total);
    out.toText = String(total - plan.length);
    out.arrow = '→';
    out.canSubmit = plan.length === state.pendingDiscard && plan.length > 0;
    out.reason = plan.length === 0
      ? '还需选择 ' + state.pendingDiscard + ' 枚'
      : (out.canSubmit ? '' : '已选 ' + plan.length + '/' + state.pendingDiscard + ' 枚，还差 ' + (state.pendingDiscard - plan.length) + ' 枚');
    out.label = '确认归还 ' + state.pendingDiscard + ' 枚';
    return out;
  }

  // ② / ③ 卡牌详情：购买或预留
  const d = ui.detail;
  const card = d ? (d.kind === 'board' ? state.board[d.lv][d.index] : p.reserved[d.index]) : null;
  if (d && card && state.current === seat && !state.gameOver) {
    const canAct = !state.pendingNoble && state.pendingDiscard === 0;
    // 购买分支对桌面卡与预留卡一视同仁：预留卡买得起时必须是「购买此卡」。
    // 旧版把这段包在 kind === 'board' 里，预留卡会掉进下面的预留分支，
    // 于是主按钮显示成「确认预留」且灰着 —— 这就是「预留卡可买却没有购买按钮」的根因。
    const pay = E.getPayment(state, seat, card);
    if (pay) {
      let paid = 0;
      const paidLines = [];
      for (let i = 0; i < ALL.length; i++) {
        const g = ALL[i];
        if (!pay[g]) continue;
        paid += pay[g];
        paidLines.push({
          key: g, label: META[g] ? META[g].label : '黄金', count: pay[g],
          gemClass: 'gem-' + g, light: g === 'white', isGold: g === 'gold'
        });
      }
      out.mode = 'buy';
      out.kind = '购买发展卡';
      out.title = T.cardName(state.themeId, card) + ' · 实付 ' + paid + ' 枚' + (pay.gold ? '（含黄金 ' + pay.gold + ' 枚）' : '');
      out.lines = paidLines.map(function (l) {
        l.sign = '−' + l.count;
        l.negative = true;
        return l;
      });
      out.items = paidLines;
      out.dots = paidLines;
      out.goldLine = pay.gold ? '黄金替代 ' + pay.gold + ' 枚（缺口用万能筹码补足）' : '';
      out.fromText = String(total);
      out.toText = String(total - paid);
      out.delta = -paid;
      out.label = '购买此卡';
      out.canSubmit = canAct;
      out.reason = canAct ? '' : (state.pendingNoble ? '先挑选到访的贵族' : '先退还超出的筹码');
      return out;
    }
    if (d.kind === 'board') {
      const slotsLeft = 3 - p.reserved.length;
      const getGold = state.bank.gold > 0 ? 1 : 0;
      out.mode = 'reserve';
      out.kind = '预留卡牌';
      out.title = T.cardName(state.themeId, card) + ' · 预留后名额 ' + (p.reserved.length + 1) + '/3';
      out.lines = [{ key: 'gold', label: '黄金', count: getGold, gemClass: 'gem-gold', isGold: true, sign: '+' + getGold, positive: true }];
      out.items = getGold ? out.lines : [];
      out.dots = out.items;
      out.goldLine = getGold ? '预留附赠 1 枚黄金万能筹码' : '银行黄金已发完，本次预留不再附赠黄金';
      out.fromText = String(total);
      out.toText = String(total + getGold);
      out.delta = getGold;
      out.label = '确认预留';
      out.canSubmit = canAct && slotsLeft > 0;
      out.reason = slotsLeft <= 0
        ? '预留位已满（3/3），先购买或放弃一张'
        : (canAct ? '' : (state.pendingNoble ? '先挑选到访的贵族' : '先退还超出的筹码'));
      return out;
    }
    // 预留卡且买不起：这张卡已经在预留区里，再「预留」一次没有意义。
    // 保持购买语义但不可提交，明确告诉玩家还差多少，而不是给出一个假动作。
    let shortfall = 0;
    for (let i = 0; i < GEMS.length; i++) {
      const g = GEMS[i];
      const rest = Math.max(0, (card.cost[g] || 0) - (disc[g] || 0));
      shortfall += Math.max(0, rest - (p.tokens[g] || 0));
    }
    shortfall = Math.max(0, shortfall - (p.tokens.gold || 0));
    out.mode = 'buy';
    out.kind = '购买发展卡';
    out.title = T.cardName(state.themeId, card) + ' · 暂不可购买';
    out.lines = [];
      out.items = [];
      out.dots = [];
    out.goldLine = '';
    out.fromText = String(total);
    out.toText = String(total);
    out.delta = 0;
    out.label = '购买此卡';
    out.canSubmit = false;
    out.reason = shortfall > 0
      ? '筹码不足，还差 ' + shortfall + ' 枚（黄金已计入）'
      : '筹码不足，暂时无法购买';
    return out;
  }

  // ④ 默认：本次拿取筹码（色点与 +n 标记已直观表达所选筹码，不再重复输出冗长文字）
  out.title = '';
  out.fromText = String(total);
  out.toText = String(total + sel.length);
  out.delta = sel.length;
  out.canSubmit = sel.length > 0 && takeError === null;
  // 只有真的能提交时才在按钮上报枚数，否则「确认拿取 2 枚」会谎报已就绪
  out.label = out.canSubmit ? '确认拿取 ' + sel.length + ' 枚' : '确认拿取';
  out.reason = takeError || '';
  return out;
}

/* ---------- 多人房间 / 玩家详情视图模型 ---------- */

function avatarHue(key) {
  const list = R.PRESET_AVATARS;
  for (let i = 0; i < list.length; i++) if (list[i].key === key) return list[i].hue;
  return '#8a6bb0';
}

/**
 * 对手卡第二 / 第三行：五色永久折扣（方形）、五色持有筹码 + 黄金（圆形）。
 * 两行都从白起按白蓝绿红黑排列，格宽固定，于是同一色在上下两行天然对齐；
 * 黄金只在筹码行末位出现（它没有永久折扣）。
 * 零值也渲染 0，只降权——「这色没有」是有效信息，藏起来会被误读成数据缺失。
 */
function seatRowsVM(state, idx) {
  const p = state.players[idx];
  const disc = E.getDiscounts(state, idx);
  const discRow = GEMS.map(function (g) {
    const num = disc[g] || 0;
    return {
      key: g, numText: String(num), zero: num === 0, wide: num >= 10,
      // 折扣格恒为深色方卡，只有左侧竖色条带颜色 —— 不需要、也不能用浅底深墨
      light: false,
      sqClass: 'sq-' + g,
      gemClass: 'gem-' + g
    };
  });
  const tokenRow = ALL.map(function (g) {
    const num = p.tokens[g] || 0;
    return {
      key: g, numText: String(num), zero: num === 0, wide: num >= 10,
      // 筹码圆格统一深底 + 本色描边，数字恒白，不能用浅底深墨
      light: false, isGold: g === 'gold', gemClass: 'gem-' + g
    };
  });
  return { discRow: discRow, tokenRow: tokenRow };
}

/**
 * 对手席位卡的紧凑状态，供顶部席位条与详情弹层共用。
 *
 * 头像只按 uid 从 avatars 映射里取，绝不读 state/room 里的 avatarUrl：
 * 那是「某台设备本地文件」的路径，推到云端后别人的设备一定加载失败。
 * 这就是上一版「只能看到自己的头像」的根因。
 */
/**
 * 从玩家/席位对象取显示名，统一做敏感字过滤。
 * ------------------------------------------------------------------
 * 页面里有多处「p.nickname || p.name || 兜底」的重复取值（席位、日志、
 * 结算排名、好友列表）。分散着改必然漏，集中到这里只剩一个出口。
 * fallback 用参数传入而不是靠 || 拼在外面，避免嵌套在 String(...) 里时括号错位。
 */
function displayName(p, fallback) {
  const src = (p && (p.nickname || p.name)) || fallback || '';
  return Nick.maskName(src);
}

function seatVM(state, index, room, selfSeat, avatars) {
  const p = state.players[index];
  const s = (room && room.seats && room.seats[index]) || {};
  const uid = p.uid || s.uid || '';
  const avatar = p.avatar || s.avatar || 'a0';
  const isSelf = index === (selfSeat || 0);
  const type = p.type || (p.isAI ? 'bot' : 'human');
  // 号位从本局 1 号位锚点起顺延，不是建房时的数组下标（见 E.seatNoOf）
  const seatNo = E.seatNoOf(state, index);
  const name = displayName(p, '玩家 ' + seatNo);
  const isCurrent = state.current === index && !state.gameOver;
  return {
    index: index,
    seatNo: seatNo,
    seatLabel: seatNo + ' 号位',
    name: name,
    // 没有头像图片时用昵称首字占位：一眼能认出是谁，也给号位徽章留出位置
    initial: String(name).slice(0, 1),
    // 号位由头像上的徽章表达，副标题只留身份，避免窄卡里被截断
    subtitle: isSelf ? '本机玩家' : (type === 'bot' ? '机器人托管' : (p.joined ? '真人席位' : '等待加入')),
    type: type,
    isSelf: isSelf,
    isBot: !!p.isAI,
    // 主动托管：席位仍是真人，只是暂时由 AI 代打，头像要盖「托管」角标
    autoPlay: !!p.autoPlay,
    isCurrent: isCurrent,
    // 「行动中」文字与青色边框同时表达，只靠边框在小屏上会被误读成选中态
    turnTag: isCurrent ? '行动中' : '',
    // 起始玩家（本局 1 号位）与当前行动者是两种身份，用不同标记区分
    isFirst: index === (Number(state.startSeat) || 0),
    joined: p.joined,
    empty: !p.joined && !p.isAI,
    points: p.points,
    pointsText: String(p.points),
    // 声望达到终局线（15）后不再按 15 截断，用 reached 标记重着色
    pointsReached: p.points >= FINAL_POINTS,
    cardCount: p.cards.length,
    reservedCount: p.reserved.length,
    reservedText: p.reserved.length + '/3',
    nobleCount: p.nobles.length,
    avatar: avatar,
    avatarUrl: (uid && avatars && avatars[uid]) || '',
    avatarHue: avatarHue(avatar),
    // 对手卡第二 / 三行：五色永久折扣（方）与五色筹码 + 黄金（圆），同色同序
    rows: seatRowsVM(state, index),
    // 对手概览：6 列分组，上红利下筹码逐色对齐；旧的两套格子保留给详情/测试
    columns: seatColumnsVM(state, index, p.reserved.length),
    bonusCells: discountCellsVM(state, index),
    tokenCells: miniTokensVM(p),
    tokens: tokensVM(p, GEMS)
  };
}

function nobleReqs(n) {
  const reqs = [];
  for (let k = 0; k < GEMS.length; k++) {
    const g = GEMS[k];
    if ((n.req[g] || 0) > 0) {
      reqs.push({ key: g, num: n.req[g], gemClass: 'gem-' + g, style: gemStyle(g) });
    }
  }
  return reqs;
}

/** 卡面印刷成本（不扣红利）：给「看别人的预留卡」用，和桌面上看到的卡面一致 */
function printedCosts(card) {
  const costs = [];
  for (let i = 0; i < GEMS.length; i++) {
    const g = GEMS[i];
    const n = card.cost[g] || 0;
    if (n <= 0) continue;
    costs.push({
      key: g,
      display: String(n),
      ink: g === 'white' ? '#142030' : '#FFFFFF',
      gemClass: 'gem-' + g,
      style: gemStyle(g)
    });
  }
  return costs;
}

/** 点击玩家头像后的详情：预留卡 / 贵族到访 / 永久红利 / 持有筹码 / 声望构成 */
function playerDetailVM(state, index, room, selfSeat, avatars) {
  const p = state.players[index];
  if (!p) return null;
  const seat = seatVM(state, index, room, selfSeat, avatars);
  let cardPoints = 0;
  for (let i = 0; i < p.cards.length; i++) cardPoints += p.cards[i].points;
  let noblePoints = 0;
  const nobles = p.nobles.map(function (n) {
    noblePoints += n.points;
    return { id: n.id, title: T.nobleTitle(state.themeId, n), points: n.points, reqs: nobleReqs(n) };
  });
  // 预留卡按「卡面」呈现：插画 / 购买所需筹码 / 声望，与桌面上的牌完全一致
  const reserved = p.reserved.map(function (c) {
    return {
      id: c.id,
      name: T.cardName(state.themeId, c),
      level: c.level,
      pointsText: c.points > 0 ? String(c.points) : '',
      pointsLabel: c.points > 0 ? c.points + ' 声望' : '无声望',
      gemLabel: META[c.gem].label,
      gemClass: 'gem-' + c.gem,
      costs: printedCosts(c),
      photoClass: 'photo-' + (GEMS.indexOf(c.gem) * 18 + (c.art % 18)),
      artClass: 'art-' + (GEMS.indexOf(c.gem) * 3 + (c.art % 3))
    };
  });
  return {
    index: index,
    seatNo: seat.seatNo,
    seatLabel: seat.seatLabel,
    title: seat.seatLabel + ' · ' + seat.name,
    subtitle: seat.subtitle + '　|　' + (seat.isCurrent ? '当前回合' : '等待中'),
    avatar: seat.avatar,
    avatarUrl: seat.avatarUrl,
    avatarHue: seat.avatarHue,
    initial: seat.initial,
    isBot: seat.isBot,
    autoPlay: seat.autoPlay,
    points: p.points,
    cardCount: p.cards.length,
    reservedCount: p.reserved.length,
    totalTokens: E.tokenTotal(p),
    scoreLines: [
      { label: '发展卡声望', value: cardPoints },
      { label: '贵族到访', value: noblePoints },
      { label: '当前合计', value: p.points }
    ],
    // 详情弹层同口径 6 列分组，字号放大到 18px，作为席位卡看不清时的精确查阅
    columns: seatColumnsVM(state, index, p.reserved.length),
    discounts: discountsVM(state, index),
    discountCells: discountCellsVM(state, index),
    tokens: tokensVM(p, ALL),
    reservedCards: reserved,
    nobles: nobles,
    emptyReserved: reserved.length === 0,
    emptyNobles: nobles.length === 0
  };
}

/** 回合计时选项：0 = 不限时；建房时选定，开局后随快照下发给所有设备 */
function turnLimitVM(active, disabled) {
  const cur = R.normTurnLimit(active);
  const list = R.TURN_LIMITS.map(function (m) {
    return {
      value: m.value,
      label: m.label,
      active: cur === m.value,
      locked: !!disabled
    };
  });
  let text = '不限时';
  for (let i = 0; i < list.length; i++) if (list[i].active) text = list[i].label;
  return { list: list, value: cur, text: text };
}

/** 游戏大厅以开局为主；档案与完整战绩按需打开，不占首页主操作区。 */
/** 好友头像样式：有图用图，没图用预设色渐变。在 VM 里拼好，
    模板里不写长三元 —— H5 预览编译器对内联长表达式支持不稳。 */
function friendAvatarStyle(url, hue) {
  if (url) return 'background-image:url(' + url + ');background-size:cover;background-position:center;';
  return 'background:radial-gradient(circle at 32% 24%, rgba(255,240,210,.55), ' +
    (hue || '#c98a4b') + ' 52%, rgba(20,10,16,.92) 100%);';
}

/** 好友列表视图模型：把「好友 uid + 资料 + 在线状态」合成可渲染的行 */
function friendsVM(ui) {
  const list = ui.friends || [];
  const online = ui.onlineUids || {};
  const identity = U.getIdentity();
  const rows = list.map(function (f, i) {
    const isOnline = !!online[f.uid];
    const hue = avatarHue(f.avatar || 'a0');
    return {
      uid: f.uid,
      // 账号 ID 很长，界面上只露后 6 位，避免占满一行
      shortId: String(f.uid || '').slice(-6),
      // 好友昵称来自云端行，虽然 utils/friend.js 读表时已过滤，这里仍过一遍
      // displayName：展示层出口统一收口，任何新增数据来源都不会漏
      nickname: displayName(f, '玩家 ' + (i + 1)),
      initial: String(displayName(f, '玩')).slice(0, 1),
      avatarUrl: f.avatarUrl || '',
      avatarStyle: friendAvatarStyle(f.avatarUrl, hue),
      online: isOnline,
      statusText: isOnline ? '在线' : '离线',
      // 邀请按钮只在「我开着房间」且对方在线时可点 —— 离线好友点了也收不到
      canInvite: isOnline && !!ui.friendInviteCode,
      sinceText: f.sinceText || ''
    };
  });
  const found = ui.friendFound;
  return {
    list: rows,
    count: rows.length,
    onlineCount: rows.filter(function (r) { return r.online; }).length,
    empty: rows.length === 0,
    ready: ui.friendsReady === true,
    notice: ui.friendsNotice || '',
    query: ui.friendQuery || '',
    found: found ? {
      uid: found.uid,
      nickname: displayName(found, '珠宝商'),
      initial: String(displayName(found, '珠')).slice(0, 1),
      avatarUrl: found.avatarUrl || '',
      avatarStyle: friendAvatarStyle(found.avatarUrl, avatarHue(found.avatar || 'a0'))
    } : null,
    // 自己的完整账号 ID：好友靠它互加，必须完整展示可复制
    myId: identity.uid || '',
    // 邀请入口：只有房主且房间还在时才有房间号可发
    inviteCode: ui.friendInviteCode || '',
    canInvite: !!ui.friendInviteCode
  };
}

/** 邀请弹窗数据：只取最新一条，其余排队 */
function inviteVM(ui) {
  const list = ui.invites || [];
  if (!list.length) return null;
  const it = list[0];
  return {
    id: it.id,
    fromName: displayName({ nickname: it.fromName }, '好友'),
    roomCode: it.roomCode,
    more: list.length - 1,
    moreText: list.length > 1 ? ('另有 ' + (list.length - 1) + ' 条邀请') : ''
  };
}

/**
 * 表情投递目标：列出全部席位（含自己——给自己送花/鼓掌也是常见玩法）。
 * isSelf / isBot 预先算成布尔，WXML 里不做字符串比较（H5 预览编译器限制）。
 */
function chatTargetsVM(state, mySeat, avatars) {
  if (!state || !state.players) return [];
  const out = [];
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i] || {};
    const seatNo = E.seatNoOf(state, i);
    const name = String(displayName(p, '玩家 ' + seatNo)).slice(0, 8);
    out.push({
      seat: i,
      seatLabel: seatNo + ' 号位',
      seatSub: seatNo + ' 号位' + (p.isAI ? ' · 机器人' : '') + (i === mySeat ? ' · 我' : ''),
      name: name,
      initial: name.slice(0, 1),
      isSelf: i === mySeat,
      isBot: !!p.isAI,
      botLabel: p.isAI ? '机器人' : '',
      avatarUrl: (p.uid && avatars && avatars[p.uid]) || '',
      avatarHue: avatarHue(p.avatar || 'a0')
    });
  }
  return out;
}

function lobbyVM(ui, profile) {
  function counts(active, key) {
    return [2, 3, 4].map(function (n) {
      return { n: n, key: key, label: n + ' 人', active: active === n };
    });
  }
  const solo = ui.soloCount || 2;
  const room = ui.roomCount || 3;
  const cloud = R.hasCloud();
  const cloudInfo = R.cloudStatus ? R.cloudStatus() : { mode: cloud ? 'ready' : 'preview', reason: '' };
  const needsLogin = R.requiresWechatLogin() && !cloud;
  const login = U.wechatLoginStatus();
  const stats = U.statsOf();
  const identity = U.getIdentity();
  const activeMode = ui.lobbyMode || 'standard';
  const modeStyles = {
    standard: { tagline: '收集宝石，争夺声望', artClass: 'is-standard', gemClass: 'gem-green' },
    entertainment: { tagline: '体验更多规则变化', artClass: 'is-entertainment', gemClass: 'gem-red' },
    draft: { tagline: '轮抽组牌，筹备中', artClass: 'is-standard', gemClass: 'gem-blue' },
    team: { tagline: '双人协作，筹备中', artClass: 'is-entertainment', gemClass: 'gem-white' }
  };
  const modes = U.listModes(activeMode).map(function (m) {
    const style = modeStyles[m.key] || modeStyles.standard;
    return Object.assign({}, m, style);
  });
  const activeModeVM = modes.filter(function (m) { return m.active; })[0] || modes[0];
  const featuredModes = modes.filter(function (m) { return m.available; }).slice(0, 2);
  const timer = turnLimitVM(ui.turnLimit, false);
  const recent = U.recordList(4).map(function (r) {
    return {
      id: r.id,
      text: r.modeText + ' · ' + r.rankText,
      sub: r.dateText + ' · ' + r.scoreText,
      resultText: r.resultText,
      resultClass: r.resultClass
    };
  });
  return {
    // 大厅顶部是自己的名字，但它是公开展示位（截图 / 分享都会露出），
    // 与榜单、席位同一口径过滤；设置页（profileVM）才保留原字可编辑。
    nickname: displayName(profile, '珠宝商'),
    initial: String(displayName(profile, '珠宝商')).slice(0, 1),
    avatarHue: avatarHue((profile && profile.avatar) || 'a0'),
    avatarUrl: (profile && profile.avatarUrl) || '',
    rankTitle: stats.rankTitle,
    playerId: identity.shortId,
    identityText: identity.label,
    stats: stats,
    statCells: [
      { key: 'total', label: '对局', value: String(stats.total) },
      { key: 'winRate', label: '胜率', value: stats.total ? stats.winRate + '%' : '—' },
      { key: 'best', label: '最高', value: stats.best ? String(stats.best) : '—' }
    ],
    recent: recent,
    hasRecent: recent.length > 0,
    modes: modes,
    featuredModes: featuredModes,
    activeModeName: activeModeVM.name,
    activeModeGem: activeModeVM.gemClass,
    hasMoreModes: modes.length > featuredModes.length,
    modeHint: U.modeByKey(activeMode).desc,
    soloCount: solo,
    roomCount: room,
    soloCounts: counts(solo, 'solo'),
    roomCounts: counts(room, 'room'),
    turnLimits: timer.list,
    turnLimit: timer.value,
    turnLimitText: timer.text,
    cloud: cloud,
    themes: T.list(ui.roomThemeId),
    themeName: T.resolve(ui.roomThemeId).name,
    cloudState: cloudInfo.mode,
    // 三态文案：只有真能跨设备时才不提限制；预览与初始化失败必须分开说。
    cloudText: needsLogin ? '微信登录后可邀请好友跨设备加入' : cloud
      ? '云端已连接 · 可微信邀请好友跨设备加入'
      : (cloudInfo.mode === 'failed'
        ? '云服务未就绪 · 当前仅本机房间'
        : '浏览器预览 · 当前仅本机房间，跨设备邀请请在微信中打开'),
    cloudHint: needsLogin ? (login.error || '正在确认微信身份，请稍候') : cloud
      ? ''
      : (cloudInfo.mode === 'failed'
        ? '云服务未就绪，暂时只能创建本机房间'
        : '浏览器预览环境，暂不可跨设备邀请'),
    joinCode: ui.joinCode || '',
    dialog: ui.homeDialog || '',
    notice: ui.homeNotice || '',
    // 声音开关状态：直接读音效模块（它内部已从 storage 恢复偏好），
    // 不另存一份 ui 字段，避免出现「界面显示开、实际静音」的不一致。
    sfxOn: !Sound.isSfxMuted(),
    bgmOn: !Sound.isBgmMuted(),
    // 实时在线人数：由心跳表统计（近 2 分钟内有心跳），不是「历史玩家总数」。
    // onlineReady=false 表示还没查到（首屏 / 离线 / 云不可用），界面据此显示「—」而不是假报 0。
    online: (ui.onlineCount === undefined || ui.onlineCount === null) ? 0 : ui.onlineCount,
    onlineReady: ui.onlineReady === true,
    onlineText: ui.onlineReady === true
      ? (ui.onlineCount > 0 ? String(ui.onlineCount) : '0')
      : '—',
    onlineNote: cloud
      ? '实时在线 · 近 2 分钟有操作'
      : '本机模式 · 在线人数需云端'
  };
}

/** 战绩页：总览 + 最近对局列表 */
function recordsVM(ui) {
  const stats = U.statsOf();
  return {
    stats: stats,
    rankTitle: stats.rankTitle,
    items: U.recordList(8),
    empty: stats.total === 0,
    notice: ui.recordsNotice || ''
  };
}

/**
 * 房间界面：加入人数 / 准备状态 / 房主开始条件。
 * 房主创建房间即视为就绪，机器人恒定就绪，真人入席后必须自己点「准备」。
 */
function roomScreenVM(ui, room, profile, mySeat, avatars) {
  const self = mySeat || 0;
  const amHost = self === 0;
  // 房主移出玩家只在房间大厅态开放：开局后牌局快照按席位索引对齐，
  // 改席位会让快照与房间错位，所以 playing / ended 一律不给按钮。
  const inLobby = !!room && (room.status || 'lobby') === 'lobby';
  const raw = (room && room.seats) || [];
  const list = [];
  let joinedHumans = 0;
  let botCount = 0;
  let readyCount = 0;
  let waitingReady = 0;
  let emptyCount = 0;

  for (let i = 0; i < raw.length; i++) {
    const s = raw[i] || {};
    const isHost = i === 0;
    const isBot = !!s.isAI;
    const joined = !!s.joined;
    const isSelf = i === self;
    const ready = isBot || isHost || !!s.ready;
    if (isBot) botCount += 1;
    else if (joined) joinedHumans += 1;
    if (ready) readyCount += 1;
    if (!isBot && joined && !ready) waitingReady += 1;
    if (!isBot && !joined) emptyCount += 1;
    list.push({
      index: i,
      seatNo: i + 1,
      isHost: isHost,
      isBot: isBot,
      isSelf: isSelf,
      joined: joined,
      ready: ready,
      empty: !joined && !isBot,
      label: isHost ? '房主' : (isBot ? '机器人' : '席位 ' + (i + 1) + (isSelf ? ' · 你' : '')),
      name: isSelf
        ? displayName(profile, '珠宝商')
        : displayName(s, isBot ? '机器人 ' + (i + 1) : '等待好友'),
      initial: String(isSelf
        ? displayName(profile, '珠宝商')
        : displayName(s, isBot ? '机器人' : '+')).slice(0, 1),
      avatarHue: avatarHue(isSelf
        ? ((profile && profile.avatar) || 'a0')
        : (s.avatar || R.PRESET_AVATARS[i % R.PRESET_AVATARS.length].key)),
      avatarUrl: (s.uid && avatars && avatars[s.uid]) || '',
      stateText: isBot ? '已就绪'
        : (isHost ? '房主 · 已就绪'
          : (ready ? '已准备' : (joined ? '未准备' : '空席'))),
      canReady: !isHost && !isBot && joined && isSelf,
      // 房主可以点空席加机器人、点机器人席位撤掉；已入席的真人席位不动
      canToggleBot: amHost && !isSelf && (isBot || !joined),
      // 只对「已入席的真人、非自己、非 0 号房主席」显示移出按钮。
      // 与 canToggleBot 天然互斥（后者只针对机器人或空席），不会同框出现。
      canKick: amHost && inLobby && !isSelf && !isHost && !isBot && joined,
      seatAction: isBot ? '取消机器人' : '设为机器人',
      // 整张席位卡可点：房主点空位 = 加机器人，真人点自己席位 = 准备
      tappable: isSelf ? !isHost && !isBot : (amHost && (isBot || !joined))
    });
  }

  const total = list.length || (ui.playerCount || 2);
  const isHost = amHost;
  const allSettled = list.length > 0 && list.every(function (s) {
    return s.isBot || (s.joined && s.ready);
  });
  const cloud = !!(room && room.backend === 'cloud');
  const mySeatData = raw[self] || {};
  const timer = turnLimitVM(room ? room.turnLimit : 0, !amHost);

  return {
    code: room ? room.code : '',
    status: room ? room.status : 'lobby',
    seats: list,
    playerCount: total,
    joinedHumans: joinedHumans,
    botCount: botCount,
    readyCount: readyCount,
    waitingReady: waitingReady,
    emptyCount: emptyCount,
    isHost: isHost,
    myReady: isHost || !!mySeatData.ready,
    canStart: isHost && allSettled && !ui.roomCreating && !ui.roomCreateFailed,
    themeName: T.resolve(T.roomId(room)).name,
    themeFallback: T.resolve(T.roomId(room)).fallback,
    creating: !!ui.roomCreating,
    createFailed: !!ui.roomCreateFailed,
    readyLabel: (isHost || mySeatData.ready) ? '取消准备' : '准备',
    startLabel: isHost
      ? (allSettled ? '开始牌局' : '等待玩家准备')
      : (mySeatData.ready ? '已准备 · 等房主开始' : '准备后等房主开始'),
    statusText: '已加入 ' + joinedHumans + ' 人 · 已准备 ' + readyCount + '/' + total,
    tip: allSettled
      ? '全员已就绪，房主可以开始牌局'
      : (waitingReady > 0
        ? '还有 ' + waitingReady + ' 位玩家未准备'
        : '还有 ' + emptyCount + ' 个空席位：点席位即可安排机器人，或等好友用房间号加入'),
    counts: (function () {
      return [2, 3, 4].map(function (n) {
        return { n: n, label: n + ' 人', active: total === n };
      });
    })(),
    turnLimits: timer.list,
    turnLimit: timer.value,
    turnLimitText: timer.text,
    backend: cloud ? '云端同步' : '本机房间',
    backendHint: cloud
      ? '席位与准备状态实时同步，好友进房后会出现在空席上。'
      : '本机房间：浏览器预览下好友无法跨设备加入，可把空席改成机器人先开局。',
    joinCode: ui.joinCode || '',
    notice: ui.roomNotice || ''
  };
}

function profileVM(ui, profile) {
  const p = profile || R.getProfile();
  const draft = ui.profileDraft || p;
  const avatars = R.PRESET_AVATARS.map(function (a) {
    return { key: a.key, name: a.name, hue: a.hue, active: draft.avatar === a.key && !draft.avatarUrl };
  });
  const identity = U.getIdentity();
  const login = U.wechatLoginStatus();
  const stats = U.statsOf();
  return {
    // 设置页输入框与预览标题显示原文，不做敏感字过滤：
    // 用户在输入框里看到「*爸」会以为自己输错了，也没法正常编辑。
    // 过滤只发生在公开展示处（榜单/席位/聊天/结算/大厅/分享）。
    nickname: draft.nickname || '',
    // 但头像首字属于「别人也能看到」的展示位（资料弹层会出现在牌桌上），
    // 仍要脱敏 —— 否则设置页一打开，敏感字首字就又露出来了。
    initial: String(displayName(draft, '珠宝商')).slice(0, 1),
    avatarUrl: draft.avatarUrl || '',
    avatarHue: avatarHue(draft.avatar || 'a0'),
    avatarName: draft.avatarUrl ? '微信头像' : R.avatarName(draft.avatar),
    avatars: avatars,
    nicknames: ['珠宝商', '宝石收藏家', '贸易行会', '威尼斯商人'],
    isWechat: identity.mode === 'wechat',
    loginBusy: !!ui.loginBusy,
    showLogin: !identity.authenticated,
    canLogin: login.canLogin && !ui.loginBusy,
    loginLabel: ui.loginBusy ? '微信登录中…' : '微信登录',
    loginHint: ui.loginBusy ? '正在验证微信身份并同步账号资料' : login.error,
    notice: ui.profileNotice || '',
    // 账号信息：让「用户系统」是可见的，而不是只在存储里有个 uid
    playerId: identity.shortId,
    identityLabel: identity.label,
    identityDetail: identity.detail,
    sinceText: identity.sinceText,
    rankTitle: stats.rankTitle,
    statsLine: stats.total
      ? '已对局 ' + stats.total + ' 场 · 胜率 ' + stats.winRate + '% · 最高 ' + stats.best + ' 声望'
      : '还没有对局记录，开一局就会记进战绩'
  };
}

function detailVM(state, ui, seat) {
  if (!ui.detail) return null;
  const s = seat || 0;
  const d = ui.detail;
  const card = d.kind === 'board'
    ? state.board[d.lv][d.index]
    : state.players[s].reserved[d.index];
  if (!card) return null;

  const disc = E.getDiscounts(state, s);
  const pay = E.getPayment(state, s, card);
  const costLines = [];
  for (let i = 0; i < GEMS.length; i++) {
    const g = GEMS[i];
    const raw = card.cost[g] || 0;
    if (raw <= 0) continue;
    costLines.push({
      key: g,
      label: META[g].label,
      raw: raw,
      discount: disc[g] || 0,
      need: Math.max(0, raw - (disc[g] || 0)),
      gemClass: 'gem-' + g,
      missing: Math.max(0, raw - (disc[g] || 0)) > (state.players[s].tokens[g] || 0),
      style: gemStyle(g)
    });
  }

  let summary = '';
  if (pay) {
    let total = 0;
    for (let i = 0; i < ALL.length; i++) total += pay[ALL[i]];
    summary = '可购买 · 实付 ' + total + ' 枚' + (pay.gold > 0 ? '（含黄金 ' + pay.gold + ' 枚）' : '');
  } else {
    summary = '筹码不足，暂时无法购买';
  }

  // 弹层里的主行动入口：买得起时按钮文案直接带实付枚数，一眼对上上面的逐色明细
  let buyLabel = '购买此卡';
  if (pay) {
    let paid = 0;
    for (let i = 0; i < ALL.length; i++) paid += pay[ALL[i]];
    buyLabel = '购买此卡（实付 ' + paid + ' 枚）';
  }
  const canActNow = state.current === s && !state.gameOver &&
    state.pendingDiscard === 0 && !state.pendingNoble;
  let actionNote;
  if (canActNow) {
    actionNote = pay
      ? '确认后立即获得该卡的红利与声望'
      : (d.kind === 'board' ? '买不起也可以先预留，并获 1 枚黄金' : '筹码不足，可稍后再来购买');
  } else if (state.current !== s) {
    actionNote = '当前不是你的回合，可先查看明细';
  } else if (state.pendingDiscard > 0) {
    actionNote = '先退还超出上限的筹码';
  } else if (state.pendingNoble) {
    actionNote = '先挑选到访的贵族';
  } else {
    actionNote = '对局已结束';
  }

  return {
    kind: d.kind,
    lv: d.lv,
    index: d.index,
    card: cardVM(state, card, s),
    costLines: costLines,
    summary: summary,
    canBuy: !!pay,
    buyLabel: buyLabel,
    actionNote: actionNote,
    // 只有轮到自己且不在退还筹码 / 挑选贵族阶段，按钮才真正可点；否则仍可查看卡片明细
    canAct: canActNow,
    canReserve: d.kind === 'board' && state.players[s].reserved.length < 3,
    reserveHint: state.decks[d.lv] ? '' : ''
  };
}

/**
 * 购买/预留卡牌、确认拿取筹码时的 3 段式桌面动作展演：
 *   1) 从桌面对应卡槽 / 牌库 / 筹码堆位置翻起升空；
 *   2) 在桌面中央向所有玩家悬停展示 ~1.2s；
 *   3) 飞入当前行动玩家的工作台（本机玩家飞入底部工作台，对手飞入左上席位铭牌）。
 *
 * cardOverride：联机时其他设备拿到的是「动作之后」的快照，桌面上那张卡已经没了。
 * 由动作发起方把卡面一起写进 lastAction，接收方用快照回放，才能看到同一段展演。
 */
function buildActionShowcase(state, action, actorSeat, mySeat, seq, cardOverride) {
  if (!state || !action || !action.type) return null;
  const p = state.players[actorSeat];
  if (!p) return null;
  const self = mySeat || 0;
  const isSelf = actorSeat === self;
  const actorName = displayName(p, '玩家 ' + (actorSeat + 1));

  let rivalIdx = 0;
  for (let si = 0; si < state.players.length; si++) {
    if (si === self) continue;
    if (si === actorSeat) break;
    rivalIdx += 1;
  }
  const rivalX = -408 + rivalIdx * 118;
  const rivalY = -222;

  if (action.type === 'buyBoard' || action.type === 'buyReserved') {
    const isBoard = action.type === 'buyBoard';
    const card = cardOverride || (isBoard
      ? (state.board[action.lv] && state.board[action.lv][action.index])
      : (p.reserved && p.reserved[action.index]));
    if (!card) return null;
    const r = isBoard ? (2 - action.lv) : 0;
    const c = isBoard ? action.index : 0;
    const fromX = isBoard ? (-246 + c * 148) : (isSelf ? -295 : rivalX);
    const fromY = isBoard ? (-114 + r * 117) : (isSelf ? 222 : rivalY);
    const toX = isSelf ? -42 : rivalX;
    const toY = isSelf ? 214 : rivalY;
    const lvIdx = Math.max(0, Math.min(2, (card.level || 1) - 1));
    return {
      seq: seq,
      kind: 'card',
      mode: 'buy',
      isSelf: isSelf,
      actorName: actorName,
      badgeText: isBoard ? '✦ 购买发展卡 · 展示入库 ✦' : '✦ 购入预留卡 · 展示入库 ✦',
      title: actorName + ' 购入了「' + T.cardName(state.themeId, card) + '」',
      subtitle: '永久红利 +' + META[card.gem].label + (card.points > 0 ? ' · 声望 +' + card.points : '') + ' · 展示后收入工作台',
      card: cardVM(state, card, actorSeat),
      gotGold: false,
      blindBack: false,
      deckArtClass: 'deck-art-' + lvIdx,
      deckLabel: ['I', 'II', 'III'][lvIdx],
      coins: [],
      motionStyle: '--from-x:' + fromX + 'px;--from-y:' + fromY + 'px;--to-x:' + toX + 'px;--to-y:' + toY + 'px;--flip-from:0deg;'
    };
  }

  if (action.type === 'reserveBoard' || action.type === 'reserveDeck') {
    const fromDeck = action.type === 'reserveDeck';
    const lv = action.lv;
    const deck = state.decks[lv];
    const card = cardOverride || (fromDeck
      ? (deck && deck.length ? deck[deck.length - 1] : null)
      : (state.board[lv] && state.board[lv][action.index]));
    if (!card) return null;
    const r = 2 - lv;
    const fromX = fromDeck ? -378 : (-246 + action.index * 148);
    const fromY = -114 + r * 117;
    const toX = isSelf ? -295 : rivalX;
    const toY = isSelf ? 224 : rivalY;
    const gotGold = state.bank.gold > 0;
    const blindBack = fromDeck && !isSelf;
    return {
      seq: seq,
      kind: 'card',
      mode: fromDeck ? 'blind' : 'reserve',
      isSelf: isSelf,
      actorName: actorName,
      badgeText: fromDeck ? '✦ 盲抽预留牌库顶 ✦' : '✦ 预留桌面发展卡 ✦',
      title: blindBack
        ? (actorName + ' 盲抽预留了第 ' + ['I', 'II', 'III'][lv] + ' 级发展卡')
        : (actorName + ' 预留了「' + T.cardName(state.themeId, card) + '」'),
      subtitle: (gotGold ? '获得 1 枚黄金万能筹码 · ' : '') + '展示后收入预留卡位',
      card: cardVM(state, card, actorSeat),
      gotGold: gotGold,
      blindBack: blindBack,
      deckArtClass: 'deck-art-' + lv,
      deckLabel: ['I', 'II', 'III'][lv] || 'I',
      coins: [],
      motionStyle: '--from-x:' + fromX + 'px;--from-y:' + fromY + 'px;--to-x:' + toX + 'px;--to-y:' + toY + 'px;--flip-from:' + (fromDeck ? '-165deg' : '0deg') + ';'
    };
  }

  // 贵族到访：选定贵族后全桌展示（联机时其他设备用快照里的 noble 数据重放）
  if (action.type === 'chooseNoble' && action.noble) {
    const noble = action.noble;
    const slot = nobleSlot(noble);
    const fromX = 92;
    const fromY = -170;
    const toX = isSelf ? -42 : rivalX;
    const toY = isSelf ? 214 : rivalY;
    return {
      seq: seq,
      kind: 'noble',
      mode: 'noble',
      isSelf: isSelf,
      actorName: actorName,
      badgeText: '✦ 贵族到访 ✦',
      title: actorName + ' 迎来贵族「' + T.nobleTitle(state.themeId, noble) + '」',
      subtitle: '声望 +3 · 贵族牌离开桌面',
      card: null,
      nobleVM: {
        title: T.nobleTitle(state.themeId, noble),
        points: noble.points,
        photoClass: slot.photoClass,
        artClass: slot.artClass,
        reqs: nobleReqs(noble)
      },
      gotGold: false,
      blindBack: false,
      deckArtClass: '',
      deckLabel: '',
      coins: [],
      motionStyle: '--from-x:' + fromX + 'px;--from-y:' + fromY + 'px;--to-x:' + toX + 'px;--to-y:' + toY + 'px;--flip-from:0deg;'
    };
  }

  if (action.type === 'take' && action.gems && action.gems.length) {
    const slotYMap = { gold: -126, red: -72, blue: -18, white: 36, green: 90, black: 144 };
    const toX = isSelf ? 32 : rivalX;
    const toY = isSelf ? 228 : rivalY;
    const coins = action.gems.map(function (g, idx) {
      const fy = slotYMap[g] !== undefined ? slotYMap[g] : 0;
      const spreadX = (idx - (action.gems.length - 1) / 2) * 74;
      return {
        idx: idx,
        key: g,
        label: META[g] ? META[g].label : g,
        gemClass: 'gem-' + g,
        coinClass: 'coin-' + g,
        itemStyle: '--coin-from-x:' + (296 - spreadX).toFixed(0) + 'px;--coin-from-y:' + fy + 'px;--coin-to-x:' + (toX - spreadX * 0.6).toFixed(0) + 'px;--coin-to-y:' + toY + 'px;'
      };
    });
    const labels = action.gems.map(function (g) { return META[g] ? META[g].label : g; });
    return {
      seq: seq,
      kind: 'take',
      mode: 'take',
      isSelf: isSelf,
      actorName: actorName,
      badgeText: '✦ 拿取宝石筹码 · 展示入库 ✦',
      title: actorName + ' 拿取了 ' + coins.length + ' 枚宝石筹码',
      subtitle: labels.join(' + ') + ' · 展示后收入工作台筹码槽',
      card: null,
      gotGold: false,
      blindBack: false,
      deckArtClass: '',
      deckLabel: '',
      coins: coins,
      motionStyle: '--from-x:296px;--from-y:0px;--to-x:' + toX + 'px;--to-y:' + toY + 'px;--flip-from:0deg;'
    };
  }

  return null;
}

/**
 * 回合计时的显示模型。
 * 单独抽出来是为了让倒计时只 setData 这一小块——
 * 整页 setData 每秒一次会把 250 多个字段全推一遍，中低端机上纯属浪费。
 */
function clockVM(state, ui) {
  if (!state) return { on: false, left: 0, total: 0, text: '—', pct: 0, urgent: false };
  const limit = Number(state.turnLimit) || 0;
  const left = typeof ui.turnLeft === 'number' && ui.turnLeft >= 0 ? Math.max(0, ui.turnLeft) : limit;
  const on = limit > 0 && !state.gameOver;
  return {
    on: on,
    left: left,
    total: limit,
    text: on ? (Math.floor(left / 60) + ':' + (left % 60 < 10 ? '0' : '') + (left % 60)) : '—',
    pct: on ? Math.round(Math.max(0, Math.min(1, left / (limit || 1))) * 100) : 0,
    // 10 秒快棋档不能全程闪红：短局把紧急阈值压到最后 3 秒
    urgent: on && left <= (limit <= 10 ? 3 : 10)
  };
}

/**
 * 重开投票弹层的视图模型。
 * 投票数据来自云端牌局快照 state.resetVote，所有端读同一份，不需要额外
 * 轮询房间行。昵称过滤沿用 displayName，号位换算沿用 E.seatNoOf —— 不
 * 在这里造第二套展示口径（历史上「算对≠显示」吃过亏）。
 */
function resetVoteVM(state, ui, seat, profile, room) {
  const vote = state && state.resetVote;
  if (!vote || !room || room.mode !== 'room' || !V.isCurrent(vote, state)) return null;
  const open = vote.status === 'open';
  const key = vote.id + ':' + vote.status;
  // 手动收起只对「这一次投票的当前状态」生效；key 含 status，
  // 状态一变（open → rejected / passed）就自动重新弹出，不会漏掉结果
  if (ui.resetVoteHiddenKey === key) return null;

  const voters = V.votersOf(state);
  const t = V.tally(vote, voters);
  const myUid = String((profile && profile.uid) || '');
  const myEntry = voters.filter(function (v) { return v.uid === myUid; })[0];
  const myVote = vote.votes ? vote.votes[myUid] : undefined;
  const isHost = (seat || 0) === 0;
  const players = (state && state.players) || [];

  const rows = voters.map(function (v) {
    const p = players[v.seat] || {};
    const val = vote.votes ? vote.votes[v.uid] : undefined;
    const seatNo = E.seatNoOf(state, v.seat);
    const tag = (v.uid === myUid ? ' · 我' : '') + (v.uid === vote.byUid ? ' · 发起人' : '');
    return {
      uid: v.uid,
      seatNo: seatNo,
      name: displayName(p, seatNo + ' 号位') + tag,
      stateText: val === true ? '已同意' : (val === false ? '不同意' : '等待投票'),
      cls: val === true ? 'is-agree' : (val === false ? 'is-reject' : 'is-pending')
    };
  });

  let title = '房主提议重新开始';
  let sub = '';
  let note = '';
  if (open) {
    sub = (vote.byName || '房主') + ' 发起 · 其余在场真人全部同意后回大厅重新准备';
    note = '已同意 ' + t.agreed + '/' + t.total + ' 人 · 任一真人不同意即取消本次重开';
  } else if (vote.status === 'rejected') {
    title = '重开已取消';
    sub = (vote.rejectedBy || '有玩家') + ' 不同意，本次重开作废，牌局继续';
    note = '房主可以重新发起一次投票';
  } else if (vote.status === 'passed') {
    title = '全员同意 · 正在回大厅';
    sub = '所有在场真人都已同意，房主正在重置房间';
    note = '请稍候，马上回到房间重新准备';
  } else {
    return null;
  }

  return {
    id: vote.id,
    status: vote.status,
    title: title,
    sub: sub,
    note: note,
    rows: rows,
    canAgree: open && !!myEntry && myVote === undefined,
    canReject: open && !!myEntry && myVote === undefined,
    // 只有被否决后房主能重新发起；通过态房主正在回大厅，不该再给按钮
    canRestart: vote.status === 'rejected' && isHost,
    canClose: true
  };
}

function buildViewModel(state, ui, layout, ctx) {
  const context = ctx || {};
  const room = context.room || null;
  const profile = context.profile || null;
  // uid → 头像（data URI 或本机文件路径）。席位与快照里只有 uid，图片在这里补齐
  const avatars = context.avatars || {};
  // 联机后本机可能是 1/2/3 号席；所有「我的」视角都由 mySeat 驱动
  const seat = context.mySeat === undefined ? 0 : context.mySeat;
  // 入口界面 / 房间大厅 / 牌桌 三态；无牌局状态时自动落到首页
  const screen = ui.screen || (state ? 'game' : 'home');
  const theme = T.forView(screen, state, room);
  const canNativeAvatar = !!(typeof wx !== 'undefined' && wx.canIUse &&
    wx.canIUse('button.open-type.chooseAvatar'));

  const menuPos = clampMenuPos(ui.menuX, ui.menuY);
  const menuDirClass = menuDirClassOf(menuPos.x, menuPos.y);
  const safeChatTop = Math.max(82, (layout.topRight || 10) + 10);

  if (screen !== 'game' || !state) {
    return {
      stageScale: layout.scale,
      stageRotate: layout.rotate,
      topRightTop: layout.topRight || 10,
      menuOpen: false,
      menuX: menuPos.x,
      menuY: menuPos.y,
      menuDirClass: menuDirClass,
      menuToggleLabel: '菜单',
      chatPanelTop: safeChatTop,
      // 娱乐模式字段在非牌桌屏给空值，满足 WXML 根变量声明校验
      isEntertainment: false,
      buffPick: { open: false, list: [], chosen: '' },
      skill: { open: false, list: [], targets: [], result: null, pending: '' },
      // 非牌桌屏也要声明 chat：WXML 根变量缺声明会被静态校验拦下，
      // 且 setData 不带 chat 时 wx:for 遍历 undefined 会在部分 WebView 里报错
      chat: C.chatVM([], seat, Date.now(), false, 'text', {
        targets: [], pendingEmoji: null, projectiles: []
      }),
      screen: screen,
      themeId: theme.id,
      themeName: theme.name,
      themeFallback: theme.fallback,
      home: lobbyVM(ui, profile),
      roomScreen: roomScreenVM(ui, room, profile, seat, avatars),
      profileDialog: profileVM(ui, profile),
      records: recordsVM(ui),
      // 好友体系：大厅与房间层都可打开（房间里正好用来一键邀请）
      friendsPanel: friendsVM(ui),
      showFriends: !!ui.showFriends,
      invitePop: inviteVM(ui),
      showRecords: !!ui.showRecords,
      showProfile: !!ui.showProfile,
      showLeaderboard: !!ui.showLeaderboard,
      leaderboard: ui.leaderboard || null,
      showRules: !!ui.showRules,
      showReserved: false,
      showLobby: false,
      showPlayerDetail: false,
      playerDetail: null,
      canUseNativeAvatar: canNativeAvatar,
      toast: ui.toast || '',
      meName: displayName(profile, '珠宝商'),
      meAvatarHue: avatarHue((profile && profile.avatar) || 'a0'),
      playerCount: (room && room.playerCount) || ui.playerCount || 2,
      roomCode: room ? room.code : '',
      roomMode: !!(room && room.mode === 'room'),
      roomBackend: room && room.backend === 'cloud' ? '云端同步' : '本机房间',
      resetVote: null,
      rows: [],
      decks: [],
      bankPiles: [],
      nobles: [],
      noblesCompact: false,
      seats: [],
      rivals: [],
      reservedCards: [],
      emptyReservedSlots: [],
      detail: null,
      nobleDetail: null,
      gameOver: false,
      isMyTurn: false,
      needDiscard: false,
      discardCount: 0,
      selectionCount: 0,
      canConfirm: false,
      canPass: false,
      pickHint: '',
      meAutoPlay: false,
      canAutoPlay: false,
      pick: {
        mode: 'take', kind: '拿取筹码', title: '', lines: [], items: [], gain: [], dots: [],
        hasGain: false, fromText: '0', toText: '0', delta: 0, arrow: '→',
        goldLine: '', canSubmit: false, reason: '', label: '确认拿取',
        pending: false, discardPicked: [], discardLeft: 0, discardPlan: 0
      },
      confirmLabel: '确认拿取',
      statusText: '',
      statusLong: false,
      turnText: '',
      logText: '',
      netNotice: (ui && ui.netNotice) || '',
      hintText: '',
      goldCount: 0,
      goldStyle: '',
      resultTitle: '',
      resultDetail: '',
      resultBoard: null,
      endNotice: null,
      showcaseList: [],
      floatScoreDeltas: [],
      floatTokenDeltas: [],
      turnFlash: null,
      turnClock: { on: false, text: '', left: 0, total: 0, pct: 0, urgent: false },
      nobleChoice: null,
      meSeatNo: seat + 1,
      meSeatLabel: (seat + 1) + ' 号位',
      me: {
        name: '', points: 0, totalTokens: 0, reservedCount: 0, cardCount: 0, nobleCount: 0,
        avatarUrl: '', avatarHue: '', initial: '珠', tokens: [], discounts: [], discountCells: []
      },
      rival: { name: '', points: 0, cardCount: 0, reservedCount: 0, tokens: [] }
    };
  }

  const me = state.players[seat] || state.players[0];
  const rival = state.players[seat === 0 ? 1 : 0] || me;
  const isMyTurn = state.current === seat && !state.gameOver;
  const needDiscard = isMyTurn && state.pendingDiscard > 0;
  const sel = ui.selectedGems;
  // 选篮是否凑成合法组合：唯一判定在规则引擎，页面只负责把它变成门禁与引导文案
  const takeError = E.validateTake(state, sel);

  // 2 / 3 / 4 人统一由 state.players 驱动，席位条与详情弹层共用同一份视图模型
  const rivals = [];
  const seats = [];
  for (let si = 0; si < state.players.length; si++) {
    const vm = seatVM(state, si, room, seat, avatars);
    seats.push(vm);
    if (si !== seat) rivals.push(vm);
  }

  // 常规牌桌排布：自上而下 III / II / I（r=0 远端 III，r=1 中端 II，r=2 近端 I）。
  // 左侧牌库与右侧明牌行使用同一组 y 坐标，保证同级一一水平对齐。
  const rows = [];
  for (let r = 0; r < 3; r++) {
    const lv = 2 - r;
    const cards = [];
    for (let i = 0; i < 4; i++) {
      const card = state.board[lv][i];
      const vm = card ? cardVM(state, card, seat, r, i) : emptyCardVM(lv, i, r);
      vm.selected = !!(ui.detail && ui.detail.kind === 'board' &&
        ui.detail.lv === lv && ui.detail.index === i);
      cards.push(vm);
    }
    rows.push({
      lv: lv,
      label: ['I', 'II', 'III'][lv],
      rowClass: ['row-far', 'row-mid', 'row-near'][r],
      cards: cards
    });
  }

  // 牌库按显示顺序（上 III / 中 II / 下 I）生成，lv 仍是引擎的真实等级下标
  const decks = [];
  for (let r = 0; r < 3; r++) {
    const lv = 2 - r;
    const m = D.DECK_META[lv];
    decks.push({
      lv: lv,
      label: m.label,
      name: m.name,
      count: state.decks[lv].length,
      empty: state.decks[lv].length === 0,
      artClass: 'deck-art-' + lv,
      style: 'background:linear-gradient(150deg,' + m.edge + ' 0%,' + m.main + ' 32%,' + m.dark + ' 100%);'
    });
  }

  const isSelPair = sel.length === 2 && sel[0] === sel[1];
  const bankPiles = ALL.map(function (g, i) {
    const count = state.bank[g];
    const picked = countIn(sel, g);
    const layers = count <= 0 ? 1 : Math.min(count, 5);
    const stack = [];
    for (let k = 0; k < layers - 1; k++) {
      const dx = ((k + i) % 3 - 1) * 1.4;
      const dy = (layers - 1 - k) * 4.0;
      stack.push({
        idx: k,
        coinClass: 'coin-' + g,
        style: 'transform:translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) scaleY(0.76) skewX(4deg);'
      });
    }
    const topDx = layers > 1 ? (((layers + i) % 3 - 1) * 0.9) : 0;
    const topStyle = 'transform:translate(' + topDx.toFixed(1) + 'px,0px) scaleY(0.76) skewX(4deg);';
    const illegal = isMyTurn && !needDiscard && !state.pendingNoble && g !== 'gold' && (
      count <= 0 ||
      (isSelPair && picked === 0) ||
      (sel.length >= 3 && picked === 0) ||
      (sel.length === 1 && sel[0] === g && count < 4)
    );
    return {
      key: g,
      slot: i,
      slotClass: 'pile-slot-' + i,
      label: META[g].label,
      count: count,
      gemClass: 'gem-' + g,
      coinClass: 'coin-' + g,
      style: gemStyle(g),
      stack: stack,
      topStyle: topStyle,
      selected: picked > 0,
      // 已选的筹码堆右侧挂「-」：点一次只放回 1 枚，×2 角标提示同色拿了两枚
      picked: picked,
      pickedMany: picked > 1,
      showMinus: picked > 0 && isMyTurn && !needDiscard && !state.pendingNoble,
      isGold: g === 'gold',
      illegal: illegal,
      disabled: g === 'gold' || count <= 0 || !isMyTurn || needDiscard
    };
  });

  const isCompactNobles = state.nobles.length > 3;
  const nobles = state.nobles.map(function (n, i) {
    const slot = nobleSlot(n);
    const reqs = [];
    for (let k = 0; k < GEMS.length; k++) {
      const g = GEMS[k];
      if ((n.req[g] || 0) > 0) {
        reqs.push({ key: g, num: n.req[g], gemClass: 'gem-' + g, style: gemStyle(g) });
      }
    }
    const nx = isCompactNobles ? ((i >= 2 ? 1 : 0) * 6) : ((i - 1) * 9);
    const ns = isCompactNobles ? 0.94 : (0.91 + i * 0.045);
    const nStyle = 'transform:translateX(' + nx + 'px) perspective(380px) rotateX(20deg) skewX(8.5deg) rotateZ(-1.5deg) scale(' + ns.toFixed(2) + ',0.84);';
    return {
      id: n.id,
      title: T.nobleTitle(state.themeId, n),
      points: n.points,
      artClass: slot.artClass,
      photoClass: slot.photoClass,
      style: nStyle,
      reqs: reqs
    };
  });

  // 预留卡直接铺在桌面左侧空档里，卡面与待购区完全同款（插画 / 声望 / 红利 / 成本 / 购卡光环）
  const reservedCards = me.reserved.map(function (c, i) {
    const vm = cardVM(state, c, seat);
    vm.index = i;
    vm.tiltStyle = 'transform:perspective(520px) rotateX(14deg) skewX(-6deg) scale(.99);';
    return vm;
  });
  // 空位补齐到 3 个，让「预留区」始终是 3 个卡位，玩家一眼知道还能留几张
  const emptyReservedSlots = [];
  for (let i = reservedCards.length; i < 3; i++) emptyReservedSlots.push(i);

  let selectedText = '';
  for (let i = 0; i < sel.length; i++) {
    selectedText += (i > 0 ? ' + ' : '') + META[sel[i]].label;
  }

  // 多贵族挑选：本机席位弹选择卡，其他席位显示等待横幅
  let nobleChoice = null;
  if (state.pendingNoble && !state.gameOver) {
    const pn = state.pendingNoble;
    const pnSeat = E.seatNoOf(state, pn.seat);
    const pnActor = state.players[pn.seat] || {};
    const options = [];
    for (let oi = 0; oi < pn.options.length; oi++) {
      for (let ni = 0; ni < state.nobles.length; ni++) {
        const n = state.nobles[ni];
        if (n.id !== pn.options[oi]) continue;
        const slot = nobleSlot(n);
        options.push({
          id: n.id,
          title: T.nobleTitle(state.themeId, n),
          points: n.points,
          reqs: nobleReqs(n),
          photoClass: slot.photoClass,
          artClass: slot.artClass
        });
        break;
      }
    }
    nobleChoice = {
      mine: pn.seat === seat,
      waiting: pn.seat !== seat,
      seatNo: pnSeat,
      seatLabel: pnSeat + ' 号位',
      name: displayName(pnActor, '玩家 ' + pnSeat),
      options: options
    };
  }

  let hint;
  if (nobleChoice && nobleChoice.mine) {
    hint = '同时满足多张贵族 · 点击弹层中的贵族牌挑选 1 张（+3 声望）';
  } else if (nobleChoice && nobleChoice.waiting) {
    hint = nobleChoice.seatLabel + ' · ' + nobleChoice.name + ' 正在挑选贵族';
  } else if (needDiscard) {
    hint = '筹码超过 10 枚 · 点击下方自己的筹码，退还 ' + state.pendingDiscard + ' 枚';
  } else if (sel.length > 0) {
    hint = takeError
      ? '已选 ' + selectedText + ' · ' + takeError
      : '已选 ' + selectedText + ' · 点「确认拿取」完成行动';
  } else if (ui.toast) {
    hint = ui.toast;
  } else {
    hint = '绿框＝当即可买　金框＝需黄金补足';
  }

  // 工作台右下：本次选择 / 待确认摘要（只推演，不改 state）
  const pick = pickVM(state, ui, seat, takeError, needDiscard);
  // 「跳过」只在没有任何合法动作时出现（规则兜底），不做常驻按钮
  const canPass = isMyTurn && !needDiscard && !state.pendingNoble && !E.hasAnyAction(state);

  // 操作区底部一行恒定文案：解释「现在该做什么 / 为什么不能点」，
  // 四种上下文都要有话说，不能出现空行导致按钮上下跳动
  let pickHint;
  if (!isMyTurn) {
    pickHint = '等待 ' + E.seatNoOf(state, state.current) + ' 号位行动 · 可查看牌面与库存';
  } else if (needDiscard) {
    // 官方规则允许退同色多枚，文案必须说清「可重复点」，否则玩家会以为点第二次是撤回
    pickHint = '点自己的筹码加入退还（同色可重复点），攒够 ' + state.pendingDiscard + ' 枚再确认；点「−」撤回';
  } else if (pick.mode === 'buy' || pick.mode === 'reserve') {
    pickHint = pick.goldLine || '卡面气泡为印刷成本，左上角为实付';
  } else if (takeError) {
    pickHint = takeError;
  } else if (ui.selectedGems.length) {
    pickHint = '点「−」可放回单枚';
  } else {
    pickHint = canPass ? '已无合法动作，可跳过本回合' : '点右侧筹码堆选取';
  }

  // 最近一手：从日志里摘出「谁 · 做了什么」，作为低权重记录展示，不与当前选择混排
  let lastMove = null;
  if (state.log && state.log.length) {
    const last = state.log[state.log.length - 1];
    lastMove = {
      text: T.text(state.themeId, last),
      // 系统消息（开局 / 结算 / 退还提示）与「上一手」用不同权重，避免混为一谈
      sys: /对局开始|对局结束|请退还|提前结算/.test(last)
    };
  }

  let statusText;
  if (state.gameOver) statusText = '对局结束';
  else if (state.pendingNoble) {
    statusText = state.pendingNoble.seat === seat
      ? '请挑选 1 张贵族'
      : E.seatNoOf(state, state.pendingNoble.seat) + ' 号位 · 正在挑选贵族';
  } else if (needDiscard) statusText = '请退还筹码';
  else if (isMyTurn) statusText = '你的回合 · ' + E.seatNoOf(state, seat) + ' 号位';
  else statusText = E.seatNoOf(state, state.current) + ' 号位 · ' +
    displayName(state.players[state.current], '玩家') + ' 的回合';

  let resultTitle = '';
  let resultDetail = '';
  let resultBoard = null;
  if (state.gameOver) {
    if (state.winner === -2) resultTitle = '平局';
    else if (state.winner === seat) resultTitle = '你赢了';
    else {
      const w = state.players[state.winner];
      resultTitle = w ? displayName(w, '玩家') + ' 获胜' : '对局结束';
    }
    resultDetail = '共 ' + state.turnCount + ' 回合 · 声望高者胜，同分发展卡少者靠前';
    // 排名表：与引擎 computeWinner 同口径（声望降序、同分发展卡少者靠前）
    const order = state.players.map(function (p, i) {
      let cardPts = 0;
      for (let k = 0; k < p.cards.length; k++) cardPts += p.cards[k].points;
      let noblePts = 0;
      for (let k = 0; k < p.nobles.length; k++) noblePts += p.nobles[k].points;
      const seatNo = E.seatNoOf(state, i);
      return {
        seat: i,
        seatLabel: seatNo + ' 号位',
        name: displayName(p, '玩家 ' + seatNo),
        initial: String(displayName(p, '玩')).slice(0, 1),
        avatarHue: avatarHue(p.avatar || 'a0'),
        avatarUrl: (p.uid && avatars && avatars[p.uid]) || '',
        points: p.points,
        cardPoints: cardPts,
        noblePoints: noblePts,
        cardCount: p.cards.length,
        nobleCount: p.nobles.length,
        totalTokens: E.tokenTotal(p),
        isMe: i === seat,
        isAI: !!p.isAI,
        autoPlay: !!p.autoPlay,
        // 逐色明细：折扣与筹码各自五色（黄金只计入筹码）
        disc: myResourceVM(state, i).discount,
        tok: myResourceVM(state, i).tokens
      };
    });
    order.sort(function (a, b) {
      if (b.points !== a.points) return b.points - a.points;
      if (a.cardCount !== b.cardCount) return a.cardCount - b.cardCount;
      return a.seat - b.seat;
    });
    // 同名次（声望与卡数都相同）并列，否则按顺序 1..n
    let rank = 0;
    for (let i = 0; i < order.length; i++) {
      if (i === 0) rank = 1;
      else {
        const prev = order[i - 1];
        const cur = order[i];
        if (cur.points !== prev.points || cur.cardCount !== prev.cardCount) rank = i + 1;
      }
      order[i].rank = rank;
      order[i].rankText = rank === 1 ? '第 1 名' : ('第 ' + rank + ' 名');
      order[i].isWinner = rank === 1 && state.winner !== -2;
    }
    resultBoard = {
      rows: order,
      champion: order.length ? order[0] : null,
      turnCount: state.turnCount
    };
  }

  // 终局提示：有人达到 15 声望、但牌局还要走完本轮时，必须明确告知
  let endNotice = null;
  if (!state.gameOver && state.endAtTurn > 0) {
    const left = Math.max(0, state.endAtTurn - state.turnCount);
    let leader = null;
    for (let i = 0; i < state.players.length; i++) {
      if (leader === null || state.players[i].points > state.players[leader].points) leader = i;
    }
    const lp = leader === null ? null : state.players[leader];
    endNotice = {
      leaderSeat: E.seatNoOf(state, leader === null ? 0 : leader),
      leaderName: lp ? displayName(lp, '玩家') : '',
      leftText: left > 0 ? ('还剩 ' + left + ' 个回合') : '本轮即将结算'
    };
  }

  return {
    stageScale: layout.scale,
    stageRotate: layout.rotate,
    topRightTop: layout.topRight || 10,
    menuOpen: !!ui.menuOpen,
    menuX: menuPos.x,
    menuY: menuPos.y,
    menuDirClass: menuDirClass,
    menuToggleLabel: ui.menuOpen ? '收起' : '菜单',
    chatPanelTop: safeChatTop,
    // 娱乐模式视图：模式标识 / 增益选择弹层 / 技能面板
    isEntertainment: Ent.isEntertainment(state),
    buffPick: (function () {
      if (!Ent.isEntertainment(state)) return { open: false };
      const mine = state.entertainment.buffs[seat];
      return {
        open: !!ui.buffPickOpen && !mine,
        list: Ent.BUFFS.map(function (b) { return b; }),
        chosen: mine || ''
      };
    })(),
    skill: (function () {
      if (!Ent.isEntertainment(state)) return { open: false, list: [], targets: [], result: null, pending: '' };
      const raw = ui.skillResultInfo || null;
      let result = null;
      if (raw) {
        result = raw.gem
          ? { title: '窃取得手', text: '从对手处夺得 1 枚' + (raw.gem === 'gold' ? '黄金' : raw.gem) + '筹码' }
          : { title: '侦察结果', text: raw.names && raw.names.length ? '对手预留：' + raw.names.join('、') : '对手没有预留手牌' };
      }
      return {
        open: !!ui.skillPanelOpen,
        list: Ent.skillVM(state, seat),
        targets: Ent.targetVM(state, seat),
        pending: ui.skillPending || '',
        result: result
      };
    })(),
    chat: (function () {
      const vm = C.chatVM(ui.chatMessages, seat, Date.now(), ui.chatPanelOpen, ui.chatTab, {
        pendingEmoji: ui.chatPendingEmoji || null,
        targets: chatTargetsVM(state, seat, avatars),
        projectiles: ui.chatProjectiles || [],
        // 防误触窗口的时间戳（见 utils/chat.js 的 TAB_DWELL_MS / TARGET_DWELL_MS）
        tabSwitchAt: ui.chatTabSwitchAt || 0,
        pendingAt: ui.chatPendingAt || 0,
        // 气泡 / 定向表情的号位必须跟牌桌同一套编号
        seatStart: Number(state.startSeat) || 0,
        playerCount: state.players.length
      });
      vm.fly = ui.chatFly || null;
      // 用 wx:for + wx:key 承载大表情：连续发两个表情时节点会随 id 重建，
      // CSS 动画才会重播；单靠 wx:if 在原生 WXML 里不会重建节点。
      vm.flyList = ui.chatFly ? [ui.chatFly] : [];
      return vm;
    })(),
    screen: 'game',
    toast: ui.toast || '',
    themeId: theme.id,
    themeName: theme.name,
    themeFallback: theme.fallback,
    home: lobbyVM(ui, profile),
    roomScreen: roomScreenVM(ui, room, profile, seat, avatars),
    // 牌桌层也要声明好友字段：WXML 根变量缺声明会渲染成空，
    // 从牌桌退回大厅时不会重新求值这些节点
    friendsPanel: friendsVM(ui),
    showFriends: !!ui.showFriends,
    invitePop: inviteVM(ui),
    // 战绩只在入口 / 房间层可开；牌桌层保留占位避免 WXML 根变量缺声明
    records: null,
    showRecords: false,
    rows: rows,
    decks: decks,
    bankPiles: bankPiles,
    nobles: nobles,
    // 3/4 人局有 4~5 张贵族牌，单列会压到工作台下面，改双列紧凑排布
    noblesCompact: nobles.length > 3,
    goldCount: state.bank.gold,
    goldStyle: gemStyle('gold'),
    rivals: rivals,
    // 对手卡定宽 188、间距 7：3/4 人局 3 张刚好收在 594px，为中央回合条留出充裕间隙
    rivalStripWidth: rivals.length * 188 + Math.max(0, rivals.length - 1) * 7,
    seats: seats,
    playerCount: state.players.length,
    roomCode: room ? room.code : '',
    roomMode: !!(room && room.mode === 'room'),
    roomBackend: room && room.backend === 'cloud' ? '云端同步' : '本机房间',
    resetVote: resetVoteVM(state, ui, seat, profile, room),
    profileDialog: profileVM(ui, profile),
    playerDetail: ui.showPlayerDetail ? playerDetailVM(state, ui.detailSeat, room, seat, avatars) : null,
    showLobby: !!ui.showLobby,
    showPlayerDetail: !!ui.showPlayerDetail,
    showProfile: !!ui.showProfile,
    // 牌桌层也要声明 me 相关字段：WXML 根变量缺声明会渲染成空
    meName: displayName(me, (profile && profile.nickname) || me.name || '珠宝商'),
    meAvatarHue: avatarHue((profile && profile.avatar) || me.avatar || 'a0'),
    canUseNativeAvatar: canNativeAvatar,
    rival: {
      // 左下角「头号对手」卡片上的名字，是牌桌上最显眼的展示位之一
      name: displayName(rival, '对手'),
      points: rival.points,
      cardCount: rival.cards.length,
      reservedCount: rival.reserved.length,
      tokens: tokensVM(rival, GEMS)
    },
    me: {
      name: displayName(me),
      nameText: displayName(me, me.name),
      avatarUrl: (me.uid && avatars && avatars[me.uid]) || (profile && profile.avatarUrl) || '',
      avatarHue: avatarHue((profile && profile.avatar) || me.avatar || 'a0'),
      initial: String(displayName(me, (profile && profile.nickname) || me.name || '珠')).slice(0, 1),
      points: me.points,
      pointsText: String(me.points),
      // 声望达到终局线后不截断：显示真实值，只换成金色高亮
      pointsReached: me.points >= FINAL_POINTS,
      pointsDen: '/' + FINAL_POINTS,
      cardCount: me.cards.length,
      nobleCount: me.nobles.length,
      totalTokens: E.tokenTotal(me),
      tokenText: E.tokenTotal(me) + '/10',
      reservedCount: me.reserved.length,
      reservedText: me.reserved.length + '/3',
      tokens: tokensVM(me, ALL),
      discounts: discountsVM(state, seat),
      // 红利行固定 5 色，与筹码行逐列对齐
      discountCells: discountCellsVM(state, seat),
      // 工作台两行资源：同色同序（白蓝绿红黑 + 黄金末位），零值可读。
      // 退还阶段下发「已选枚数」；拿取/购买阶段下发逐列 +n / −n 实时预览。
      res: (function () {
        const r = myResourceVM(state, seat);
        const plan = ui.discardPlan || [];
        const gainMap = {};
        (pick.gain || []).forEach(function (g) { if (g.show) gainMap[g.key] = g.gainText; });
        const payMap = {};
        if (pick.mode === 'buy' && pick.items) {
          pick.items.forEach(function (it) { payMap[it.key] = it.sign; });
        }
        r.tokens.forEach(function (t) {
          t.pickedCount = countIn(plan, t.key);
          t.gainText = isMyTurn && !needDiscard && gainMap[t.key] ? gainMap[t.key] : '';
          t.gainShow = !!t.gainText;
          t.payText = isMyTurn && !needDiscard && payMap[t.key] ? payMap[t.key] : '';
          t.payShow = !!t.payText;
        });
        return r;
      })()
    },
    reservedCards: reservedCards,
    emptyReservedSlots: emptyReservedSlots,
    mySeat: seat,
    statusText: statusText,
    // 铭牌宽度固定且右侧让位给计时块，长状态行（别人的昵称）降一档字号
    statusLong: statusText.length > 12,
    turnText: '第 ' + (Math.floor(state.turnCount / state.players.length) + 1) + ' 轮',
    logText: state.log.length ? T.text(state.themeId, state.log[state.log.length - 1]) : '',
    // 上一手记录：单独一条，权重低于当前选择，不与确认区混排
    lastMove: lastMove,
    // 断线时用状态行提示重连进度，不额外占版面
    netNotice: ui.netNotice || '',
    hintText: T.text(state.themeId, hint),
    isMyTurn: isMyTurn,
    needDiscard: needDiscard,
    discardCount: state.pendingDiscard,
    // 归还流程：攒批后一次确认（不再点一枚退一枚）
    discardPlanCount: (ui.discardPlan || []).length,
    discardPlanText: gemsText(tallyGems(ui.discardPlan || [])),
    selectionCount: sel.length,
    confirmLabel: pick.label,
    canConfirm: pick.canSubmit && isMyTurn,
    pick: pick,
    // 操作区恒定一行解释文案（空态也要有，避免按钮上下跳动）
    pickHint: pickHint,
    // 主动托管状态：自己是否托管、以及是否允许托管（人机局无意义）
    meAutoPlay: !!(me && me.autoPlay),
    canAutoPlay: !!(room && room.mode === 'room') && !state.gameOver,
    // 「跳过」是规则兜底，只在无合法动作时出现
    canPass: canPass,
    detail: detailVM(state, ui, seat),
    nobleDetail: (function () {
      if (!ui.nobleDetailId) return null;
      const noble = (state.nobles || []).filter(function (n) { return n.id === ui.nobleDetailId; })[0];
      if (!noble) return null;
      const slot = nobleSlot(noble);
      const disc = E.getDiscounts(state, seat);
      const reqs = nobleReqs(noble).map(function (r) {
        const have = disc[r.key] || 0;
        return Object.assign({}, r, {
          label: META[r.key].label,
          have: have,
          met: have >= r.num,
          missing: Math.max(0, r.num - have)
        });
      });
      const ready = reqs.every(function (r) { return r.met; });
      return {
        id: noble.id,
        title: T.nobleTitle(state.themeId, noble),
        points: noble.points,
        photoClass: slot.photoClass,
        artClass: slot.artClass,
        reqs: reqs,
        ready: ready,
        summary: ready ? '你的永久红利已满足到访条件，回合末将自动到访' : '集齐上述永久红利（发展卡产出）后，回合末自动到访'
      };
    })(),
    showRules: ui.showRules,
    showReserved: ui.showReserved,
    showLeaderboard: !!ui.showLeaderboard,
    leaderboard: ui.leaderboard || null,
    gameOver: state.gameOver,
    resultTitle: resultTitle,
    resultDetail: resultDetail,
    // 结算排名表（含逐色资源明细）与终局提示
    resultBoard: resultBoard,
    endNotice: endNotice,
    showcaseList: ui.showcase ? [ui.showcase] : [],
    floatScoreDeltas: ui.floatScoreDeltas || [],
    floatTokenDeltas: ui.floatTokenDeltas || [],
    // 回合切换的全屏提醒：进入 / 离开自己的回合各一次
    turnFlash: ui.turnFlash || null,
    turnClock: clockVM(state, ui),
    nobleChoice: nobleChoice,
    meSeatNo: E.seatNoOf(state, seat),
    meSeatLabel: E.seatNoOf(state, seat) + ' 号位'
  };
}

/**
 * 需要自动托管的席位：机器人，或真人尚未入席的空位。
 * 云端牌局下机器人只由房主托管，否则多台设备会同时提交同一个回合。
 */
function needsAutoPlay(state, ctx) {
  const p = state.players[state.current];
  const c = ctx || {};
  if (c.cloud && !c.isHost) return false;
  // autoPlay：真人主动托管，席位仍是真人，只是这一段时间交给 AI 代打
  return !!p && (p.isAI || p.autoPlay || (p.type === 'remote' && !p.joined));
}

function freshUI(config) {
  const c = config || {};
  return {
    // 入口界面 / 房间大厅 / 牌桌
    screen: c.screen || 'home',
    selectedGems: [],
    // 退还流程的暂存选篮：攒够 pendingDiscard 枚再一次性提交，
    // 与 selectedGems 分开，避免两种选篮互相污染
    discardPlan: [],
    toast: '',
    detail: null,
    nobleDetailId: '',
    showRules: false,
    showReserved: false,
    // 重开投票弹层：记录「哪一次投票的哪个状态」被用户手动收起。
    // 状态变化（open → rejected/passed）会换 key，弹层自动重新出现。
    resetVoteHiddenKey: '',
    // 好友体系：列表数据 + 弹层开关 + 加载/错误态
    showFriends: false,
    friends: [],
    friendsReady: false,
    friendsNotice: '',
    friendQuery: '',
    friendFound: null,
    // 在线好友的 uid 集合（由心跳表反查得到，键存在即为在线）
    onlineUids: {},
    // 当前可用于邀请的房间号：只有自己在房里且是房主时才填
    friendInviteCode: '',
    // 待处理邀请（弹窗提醒）：只放最上面一条，处理完自动让位给下一条
    invites: [],
    inviteNotice: '',
    // 大厅：选中的对局模式（当前只有 standard 可用）
    lobbyMode: 'standard',
    // 娱乐模式：增益选择弹层 / 技能面板 / 当前选中的技能 / 上次技能结果
    buffPickOpen: false,
    skillPanelOpen: false,
    skillPending: null,
    skillResultInfo: null,
    // 战绩弹层
    showRecords: false,
    recordsNotice: '',
    // 入口界面的两种模式人数
    soloCount: c.soloCount || 2,
    roomCount: c.roomCount || 3,
    // 回合计时（秒）：0 = 不限时；建房时选定
    turnLimit: R.normTurnLimit(c.turnLimit),
    roomThemeId: T.normalizeRoom(c.roomThemeId),
    roomCreating: false,
    roomCreateFailed: false,
    homeDialog: '',
    homeDialogBefore: null,
    homeNotice: '',
    // 房间配置：重开一局时保留人数与机器人席位
    playerCount: c.playerCount || 2,
    bots: c.bots || { 1: false, 2: false, 3: false },
    showLobby: false,
    showPlayerDetail: false,
    detailSeat: -1,
    showProfile: false,
    profileDraft: null,
    profileNotice: '',
    joinCode: '',
    roomNotice: '',
    netNotice: '',
    showcase: null,
    // 回合剩余秒数（本地倒计时，每台设备按自己看到的那次换手重新计时，
    // 不依赖系统时钟对齐）
    turnLeft: -1,
    // 换手全屏提醒
    turnFlash: null,
    // 局内快捷聊天：本机消息队列 / 面板 / 大表情动画
    chatMessages: [],
    chatPanelOpen: false,
    chatTab: 'text',
    chatFly: null,
    chatBotCursor: 0,
    // 表情两步发送：先暂存白名单表情，再选目标玩家；投射动画与本局绑定
    chatPendingEmoji: null,
    // 两个防误触时间戳：切 tab / 进入选目标后极短时间内不接收点选，
    // 防「手指还停在原位、新内容已长到指尖下」导致的误发（见 utils/chat.js）
    chatTabSwitchAt: 0,
    chatPendingAt: 0,
    chatProjectiles: [],
    // 天梯榜：弹层与数据
    showLeaderboard: false,
    leaderboard: null,
    leaderboardLoading: false,
    // 牌桌悬浮菜单：默认停靠右下角安全区（避开微信右上角胶囊），支持拖拽与中文标签展开
    menuOpen: false,
    menuX: c.menuX !== undefined ? c.menuX : MENU_DEFAULT_X,
    menuY: c.menuY !== undefined ? c.menuY : MENU_DEFAULT_Y,
    floatScoreDeltas: [],
    floatTokenDeltas: []
  };
}

/**
 * 给页面所有交互入口自动挂上点击音效。
 *
 * 为什么装饰而不是在每个方法里写 Sound.play()：
 *   WXML 里共有 79 个 bindtap 入口，逐个加调用既啰嗦又必然漏。
 *   这里在页面配置对象导出前统一包一层 —— 只改这一处就能覆盖全部入口，
 *   而且新增 handler 时只要在 TAP_SOUND 表里登记即可，不会忘记挂音效。
 *
 * 注意两个细节：
 *   1. 只包装没有返回值的普通点击；onLoad/refresh 这类非交互方法靠 TAP_SOUND
 *      白名单过滤，不会误触发（表里没有就直接跳过）。
 *   2. 音效在方法执行「之前」播：点击反馈要即时，不能等业务逻辑跑完
 *      （联机轮询的方法可能耗时几十毫秒，延迟播会显得迟钝）。
 */
function withTapSound(config) {
  Object.keys(TAP_SOUND).forEach(function (name) {
    const original = config[name];
    if (typeof original !== 'function') return;
    config[name] = function () {
      Sound.play(TAP_SOUND[name]);
      return original.apply(this, arguments);
    };
  });
  return config;
}

Page(withTapSound({
  data: {
    stageScale: 1,
    stageRotate: 0,
    topRightTop: 10
  },

  onLoad(options) {
    const size = readWindowSize();
    this._layout = calcLayout(size.w, size.h);
    this._layout.topRight = topRightOffset(size.w, size.h, this._layout.rotate);
    this._aiTimer = null;
    this._pollTimer = null;
    this._cloudCode = '';
    this._cloudVersion = 0;
    this._roomVersion = 0;
    this._syncing = false;
    this._polling = false;
    this._pendingPush = false;
    this._pendingJoin = false;
    this._enteringGame = false;
    this._joining = false;
    this._resuming = false;
    this._netFails = 0;
    this._netDown = false;
    // 一局只记一条战绩：开局时复位，结算时置位
    this._resultRecorded = false; this._gameStartedAt = Date.now();
    // 只读一次本地静音偏好；音频上下文延迟到首次播放才建
    Sound.init();
    this.mode = 'solo';
    this.mySeat = 0;
    this.profile = R.getProfile();
    // uid → 头像映射；席位与快照里只有 uid，图片在这里补齐
    this._avatars = this.avatarSeed();
    this._avatarSig = '';
    // 上一次已经在本地播过的动作 id，避免自己的动作被自己的轮询重放一遍
    this._seenActionId = '';
    // 回合计时：_turnKey 标记「哪一手」，换手即重置
    this._clockTimer = null;
    this._turnKey = '';
    this._turnStartAt = 0;
    this._timeoutFired = false;
    this._flashTimer = null;
    // 先展示本机数据；正式云端业务须等微信登录与账号切换完成后再启用。
    U.ensureIdentity();
    this.ui = freshUI({ screen: 'home' });

    // 微信分享卡片带 ?room=XXXXXX：有云端能力时直接入席，
    // 没有云端能力（浏览器预览）时留在首页并说明原因。
    const query = options || {};
    if (R.requiresWechatLogin()) {
      this._pendingRoomCode = query.room ? String(query.room).toUpperCase() : '';
      if (this._pendingRoomCode) {
        this.ui.joinCode = this._pendingRoomCode;
        this.clearSession();
      }
      this.bootstrapWechatIdentity(false);
      return;
    }
    if (query.room) {
      const code = String(query.room).toUpperCase();
      this.ui.joinCode = code;
      // 换房间邀请 = 新的入席意图，先作废旧会话，避免失败后被拉回上一间房
      this.clearSession();
      if (R.hasCloud()) {
        this.joinCloudRoom(code);
      } else {
        this.ui.homeNotice = '收到房间邀请 ' + code + ' · 当前设备未连接云端，无法跨设备加入';
        this.refresh('');
      }
      return;
    }
    this.refresh('');
  },

  /** 登录完成前不心跳、不写游客资料、不抢先用旧 uid 加入分享房间。 */
  bootstrapWechatIdentity(force) {
    if (this._identityTask) return this._identityTask;
    const that = this;
    this.ui.loginBusy = true;
    this.clearTimer();
    this.stopClock();
    this.stopCloudPolling();
    this.stopOnlinePolling();
    this.stopInvitePolling();
    U.stopHeartbeat();
    this._identityTask = U.loginWithWechat({ force: !!force }).then(function (result) {
      if (that._unloaded) return result;
      that.ui.loginBusy = false;
      if (!result.ok) {
        that.ui.profileNotice = result.error;
        that.ui.homeNotice = result.error;
        that.refresh('');
        if (!that._hidden && that.mode === 'solo') that.maybeRunAi({ ended: true });
        return result;
      }
      if (result.changed && that.mode === 'room' && that.room) {
        that.quitToHome('微信账号已切换，请重新加入房间');
      }
      that.profile = result.profile;
      if (result.changed) that.resetCloudRequests();
      that._avatars = that.avatarSeed();
      that._avatarSig = '';
      that.ui.profileDraft = that.ui.showProfile ? Object.assign({}, that.profile) : null;
      that.ui.friends = [];
      that.ui.friendsReady = false;
      that.ui.friendFound = null;
      that.ui.onlineUids = {};
      that.ui.invites = [];
      that.ui.homeNotice = '';
      that.ui.profileNotice = result.imported
        ? '微信已登录，已保留本机资料并导入 ' + result.imported + ' 条战绩；旧游客好友需重新添加'
        : '已关联当前微信用户';
      // 启动登录期间允许玩人机；绑定成功后对齐本机席位，结算才会落到新账号。
      if (that.mode === 'solo' && that.state && that.state.players[0]) {
        Object.assign(that.state.players[0], {
          uid: that.profile.uid, name: that.profile.nickname, nickname: that.profile.nickname,
          avatar: that.profile.avatar
        });
      }
      that.refresh('');
      if (!that._hidden && that.mode === 'solo') that.maybeRunAi({ ended: true });
      if (!that._hidden) U.startHeartbeat(that.profile);
      U.syncAll(that.profile).then(function (synced) {
        if (that._unloaded || synced.stale || R.getProfile().uid !== that.profile.uid) return;
        if (!synced.profile.ok || !synced.records.ok || synced.importsPending) {
          that.ui.profileNotice = '微信已登录，部分资料或战绩尚未同步，下次启动会重试';
        }
        that.refresh('');
      }).catch(function () {
        if (!that._unloaded) {
          that.ui.profileNotice = '微信已登录，云端资料或战绩同步失败，稍后可重试';
          that.refresh('');
        }
      });
      if (that._hidden) return result;
      if (that._pendingRoomCode) {
        const code = that._pendingRoomCode;
        that._pendingRoomCode = '';
        that.joinCloudRoom(code);
      } else if (that._cloudCode) {
        that.startCloudPolling();
        that.pollCloud(true);
      } else {
        that.resumeSession();
      }
      return result;
    }).finally(function () { that._identityTask = null; });
    this.refresh('');
    return this._identityTask;
  },

  onWechatLogin() {
    return this.bootstrapWechatIdentity(true);
  },

  /** 人机对战：本地牌局，不建云端房间、不发起任何网络请求 */
  startLocalGame() {
    this.clearTimer();
    this.stopCloudPolling();
    // 单机局与房间无关，清掉重连会话，别让下次启动又回到旧房间
    this.clearSession();
    this.mode = 'solo';
    this.mySeat = 0;
    this._cloudCode = '';
    this._cloudVersion = 0;
    this._roomVersion = 0;
    const profile = this.profile || R.getProfile();
    const seats = R.makeSeats(this.ui.playerCount, this.ui.bots, profile);
    this.state = E.createGame({ playerCount: this.ui.playerCount, seats: seats });
    // 娱乐模式：写入模式字段并弹出增益选择（本机席位）
    if (this.ui.lobbyMode === 'entertainment') {
      Ent.enable(this.state);
      this.ui.buffPickOpen = true;
    } else {
      this.ui.buffPickOpen = false;
    }
    // 一局一条：即使没有云端，本地战绩去重也用得上
    this.state.gameId = newGameId();
    // 人机局不计时：单人对着 AI 看倒计时没有意义
    this.state.turnLimit = 0;
    this.room = R.createRoom({
      playerCount: this.ui.playerCount,
      seats: seats,
      profile: profile,
      status: 'playing',
      turnLimit: 0
    });
    this.room.mode = 'solo';
    this.ui.screen = 'game';
    this.ui.detail = null;
    this.ui.showReserved = false;
    this.ui.showPlayerDetail = false;
    this.ui.showLobby = false;
    this.ui.selectedGems = [];
    this.ui.discardPlan = [];
    this.ui.showcase = null;
    // 上一屏（如「已离开房间」）的提示不该被带进新一局
    this.ui.toast = '';
    this._resultRecorded = false; this._gameStartedAt = Date.now();
    this.resetTurnUI();
    this.refresh('');
    this.maybeRunAi({ ended: true });
  },

  /** 兼容旧调用：默认走人机对战 */
  startGame() { this.startLocalGame(); },

  onShow() {
    this._hidden = false;
    if (R.requiresWechatLogin() && !U.wechatLoginStatus().authenticated) {
      // 未配置正式 AppID 时仍可离线玩人机，切回前台不能把 AI 永久停掉。
      if (!this.state || this.mode === 'room' || U.wechatLoginStatus().canLogin) {
        this.bootstrapWechatIdentity(false);
        if (!this.state || this.mode === 'room') return;
      }
    }
    // 从后台切回时，若仍轮到托管席位则恢复其行动节奏
    if (this.state && !this.state.gameOver && needsAutoPlay(this.state, this.aiContext()) && !this._aiTimer) {
      this.scheduleAi();
    }
    this.startCloudPolling();
    // 聊天轮询在 onHide 被停掉，回到牌桌要恢复；气泡 TTL 定时器同理
    if (this.ui && this.ui.screen === 'game') {
      this.startChatPolling();
      if (this.ui.chatMessages && this.ui.chatMessages.length) this.scheduleChatSweep();
    }
    // 心跳与在线人数：切回前台立刻补一次心跳，否则回到大厅的前 45s 内自己不算在线
    U.startHeartbeat(this.profile || R.getProfile());
    if (this.ui && this.ui.screen === 'home') this.startOnlinePolling();
    // 音频上下文在 onHide 被释放了，回前台按当前界面重新起 BGM
    if (this.ui && (this.ui.screen === 'home' || this.ui.screen === 'game')) {
      Sound.startBgm(this.ui.screen === 'game' ? 'board' : 'lobby');
    }
    if (this._cloudCode) {
      // 回前台立刻对齐一次版本，别等下一个轮询周期
      this.pollCloud(true);
    } else {
      // 冷启动 / 被系统回收后重进：按上次会话回到原房间原座位
      this.resumeSession();
    }
  },

  onHide() {
    this._hidden = true;
    this.clearTimer();
    this.stopClock();
    this.stopCloudPolling();
    // 在线人数是「大厅里看得见」的信息，切到后台就该停，
    // 心跳也停 —— 后台的人不该继续被算作在线（避免人数虚高）。
    this.stopOnlinePolling();
    this.stopInvitePolling();
    this.stopChatPolling();
    U.stopHeartbeat();
    // 音频上下文在后台继续持有会持续占用内存，切后台直接释放；
    // 回前台由 play() 懒建，玩家感知不到延迟。
    Sound.destroy();
  },

  onUnload() {
    this._unloaded = true;
    if (this._toastTimer && typeof clearTimeout === 'function') {
      clearTimeout(this._toastTimer);
      this._toastTimer = null;
    }
    this.clearTimer();
    this.stopClock();
    this.stopCloudPolling();
    this.stopOnlinePolling();
    this.stopInvitePolling();
    this.stopChatPolling();
    U.stopHeartbeat();
    // 官方明确音频资源不会自动回收，页面销毁必须显式释放
    Sound.destroy();
  },

  onResize() {
    const size = readWindowSize();
    this._layout = calcLayout(size.w, size.h);
    this._layout.topRight = topRightOffset(size.w, size.h, this._layout.rotate);
    this.setData({
      stageScale: this._layout.scale,
      stageRotate: this._layout.rotate,
      topRightTop: this._layout.topRight
    });
  },

  clearTimer() {
    if (this._aiTimer) {
      clearTimeout(this._aiTimer);
      this._aiTimer = null;
    }
    if (this._flashTimer) {
      clearTimeout(this._flashTimer);
      this._flashTimer = null;
    }
    if (this._floatDeltaTimer) {
      clearTimeout(this._floatDeltaTimer);
      this._floatDeltaTimer = null;
    }
  },

  /**
   * 结算时落一条战绩。
   * refresh() 在轮询（1.6s）与每次动作后都会调用，所以必须靠 _resultRecorded 幂等，
   * 否则结算弹层每重绘一次就会多记一条，胜率被自己刷歪。
   * 但 _resultRecorded 只是页面内状态：冷启动 / 重连 / 房间恢复都会把它复位，
   * 所以再用随快照下发的 gameId 在本地战绩里做第二道去重（跨页面、跨设备）。
   */
  maybeRecordResult() {
    const st = this.state;
    if (!st || !st.gameOver || this._resultRecorded) return;
    const players = st.players || [];
    if (!players.length) return;
    const gid = String(st.gameId || '');
    if (gid && U.hasGameRecord(gid)) {
      this._resultRecorded = true;
      return;
    }
    const seat = this.mySeat || 0;
    const me = players[seat] || players[0];
    // 名次口径与引擎结算一致：声望高者靠前，同分时发展卡少者靠前
    const order = players.map(function (p, i) { return { i: i, p: p }; }).sort(function (a, b) {
      if (b.p.points !== a.p.points) return b.p.points - a.p.points;
      return a.p.cards.length - b.p.cards.length;
    });
    let rank = 1;
    for (let i = 0; i < order.length; i++) {
      if (order[i].i === seat) { rank = i + 1; break; }
    }
    const opponents = [];
    for (let i = 0; i < order.length; i++) {
      if (order[i].i === seat) continue;
      opponents.push(displayName(order[i].p, '玩家 ' + (order[i].i + 1)) + ' ' + order[i].p.points);
    }
    this._resultRecorded = true;
    // 回合平均耗时：以「本局开始 → 结算」的总耗时 / 回合数。
    // 这是页面级计时，绝不写进 state 快照（联机两端节奏不同，写进去会分叉）。
    const elapsed = Math.max(0, Date.now() - (this._gameStartedAt || Date.now()));
    const perTurn = elapsed / Math.max(1, st.turnCount);
    // 进场就撞上已结束快照时 elapsed≈0，会算出 0.005s/行动这种伪耗时。
    // 记 0 而不是记个假数：fromRecord 会让这一局不参与速度项的分母。
    const turnAvgMs = perTurn < MIN_VALID_TURN_MS ? 0 : Math.round(perTurn);
    // 真人数：isAI=false 的席位。autoPlay（真人临时托管）仍算真人 ——
    // 那是可以随时收回操作权的真人席位，用 isAI 表达就再也拿不回来了。
    let humanCount = 0;
    for (let i = 0; i < players.length; i++) if (!players[i].isAI) humanCount += 1;
    const rec = U.addRecord({
      // 与快照同源的局标识：本地战绩按它去重，云端明细也带它
      gameId: gid,
      mode: this.mode === 'room' ? 'room' : 'solo',
      playerCount: players.length,
      // 天梯榜准入判断用：只有「联机 + 真人 ≥ 2」的对局才计入
      humanCount: humanCount,
      rank: rank,
      score: me.points,
      win: st.winner === seat,
      tie: st.winner === -2,
      turns: st.turnCount,
      // 天梯榜六项指标里的三项：发展卡 / 贵族 / 回合平均耗时
      cards: (me.cards || []).length,
      nobles: (me.nobles || []).length,
      turnAvgMs: turnAvgMs,
      at: Date.now(),
      roomCode: this._cloudCode || '',
      opponents: opponents
    }, this.profile);
    // 结算后才把本局增量推上云，榜单一局只写一次（_resultRecorded + gameId 双重幂等）
    this.publishLeaderboard(rec);
    // 胜负音效放在记账之后：确认这一局真的入账了才响，避免重连撞旧快照时误响
    Sound.play(st.winner === seat ? 'win' : (st.winner === -2 ? 'noble' : 'lose'));
  },

  /**
   * 把「尚未确认发布」的合格局打包成一份增量推榜。
   * 云端累计行才是权威值，本机不再用全量战绩重算覆盖 —— 跨设备回补的
   * 精简战绩缺 humanCount 等字段，全都不满足准入，重算只会把云端 20 局
   * 静默覆盖成 1 局。publish 成功才清队列，读失败时下次结算把积压局一并重放。
   */
  publishLeaderboard(rec) {
    if (!R.hasCloud()) return;
    const profile = this.profile || R.getProfile();
    let pending = U.unpublishedRecords(profile.uid);
    // 兜底：万一入队失败，刚结算这局也要带上
    if (rec && !pending.some(function (r) { return r.id === rec.id; })) {
      pending = pending.concat([rec]);
    }
    let delta = L.blank();
    const ids = [];
    for (let i = 0; i < pending.length; i++) {
      const r = pending[i];
      if (!L.eligible(r)) continue;    // 人机局 / 字段不全的局不推增量
      delta = L.mergeTotals(delta, L.fromRecord(r));
      ids.push(r.id);
    }
    if (!delta.games) return;
    L.publish(R.getCloud(), profile, delta)
      .then(function (res) {
        if (res && res.ok) U.clearUnpublished(ids, profile.uid);
      }).catch(function () {});
  },

  /** 自己的榜单条目：始终用本机战绩，云端行可能落后刚结算的这一局 */
  myLeaderboardEntry() {
    const p = this.profile || R.getProfile();
    return L.entryOf(p.uid, p.nickname, p.avatarData || p.avatarUrl || '',
      L.fromRecords(U.getRecords()));
  },

  onOpenLeaderboard() {
    this.ui.showLeaderboard = true;
    // 先同步渲染本机行，再异步拉云端，弹层不会白屏等待。
    // loginRequired 让界面能区分「没登录」与「云不可用」：前者登录即可看全站，
    // 后者只能排查环境。两者的提示文案不该混用。
    const uid = (this.profile || R.getProfile()).uid;
    this.ui.leaderboard = L.rowsVM([this.myLeaderboardEntry()], uid, {
      source: 'local',
      loginRequired: R.requiresWechatLogin() && !R.getAuthenticatedUid()
    });
    this.refresh('');
    this.loadLeaderboard();
  },

  onCloseLeaderboard() {
    this.ui.showLeaderboard = false;
    this.refresh('');
  },

  loadLeaderboard() {
    if (!R.hasCloud()) return Promise.resolve(false);
    const that = this;
    const ownerUid = this.profile.uid;
    const mine = this.myLeaderboardEntry();
    const myGames = L.fromRecords(U.getRecords()).games;
    // 返回 Promise 便于调用方与测试串联，也便于将来做「刷新中」态
    return L.fetchRows(R.getCloud()).then(function (rows) {
      if (that._unloaded || that.profile.uid !== ownerUid || !that.ui.showLeaderboard) return false;
      const merged = rows.slice();
      let found = false;
      for (let i = 0; i < merged.length; i++) {
        if (merged[i].uid !== ownerUid) continue;
        found = true;
        // 只在「本机确实比云端新」时才覆盖：云端行可能是刚结算那一局之前写的，
        // 用本机值能让玩家立刻看到新分数。但反过来无脑覆盖会让同一份云端数据
        // 在不同设备上呈现不同——别人看你是云端旧值，你自己看是新值。
        // 判据用累计局数：本机多则说明有尚未 publish 的局。
        const cloudGames = Number((merged[i].totals || {}).games) || 0;
        if (myGames > cloudGames) merged[i] = mine;
        break;
      }
      // 0 局不入榜，与 publish 的 no-eligible-games 口径保持一致：
      // 否则新玩家一开榜就看到自己「0 局 0 分」挂在最后一名，像被羞辱。
      if (!found && myGames > 0) merged.push(mine);
      that.ui.leaderboard = L.rowsVM(merged, ownerUid, {
        source: 'cloud',
        updatedAt: new Date().toTimeString().slice(0, 5)
      });
      that.refresh('');
      return true;
    }).catch(function () { return false; });
  },

  refresh(toast) {
    // onLoad 期间的异步回调可能在 ui 初始化前返回
    if (!this.ui) return;
    // 重开投票全员通过后，房主在这里收口回大厅。返回 true 表示它已经
    // 触发过一次完整 refresh（backToLobby 内部），外层直接让位，别把
    // 已经作废的牌桌又画一遍。
    if (this.checkResetVotePassed()) return;
    // 联机快照会整份替换 state.players。资料是「本机账号的展示层数据」，
    // 每次渲染前幂等贴回自己席位，否则在牌桌里改昵称/头像后，下一次
    // 1.6s 轮询拉回旧快照就会把它打回原形 —— 这正是「对局中改资料不生效」。
    this.applySelfProfileToState();
    // 先记账再渲染，保证回到大厅时战绩已是新的（addRecord 只写存储，不会递归）
    this.maybeRecordResult();
    // 换手检测要在渲染前做：全屏提醒与倒计时都由它重置
    this.syncTurnWatch();
    if (toast) {
      this.ui.toast = toast;
      if (this._toastTimer && typeof clearTimeout === 'function') clearTimeout(this._toastTimer);
      if (typeof setTimeout === 'function') {
        const that = this;
        const msg = toast;
        this._toastTimer = setTimeout(function () {
          that._toastTimer = null;
          if (!that.ui || that._unloaded || that.ui.toast !== msg) return;
          that.ui.toast = '';
          that.setData({ toast: '' });
        }, 1400);
      }
    }
    this.setData(buildViewModel(this.state, this.ui, this._layout, {
      room: this.room, profile: this.profile, mySeat: this.mySeat,
      avatars: this._avatars || {}
    }));
    if (this._hidden || this._unloaded) return;
    // 席位里只有 uid：新面孔入席时补一次头像，能命中缓存就不发请求
    this.syncAvatars();
    this.startClock();
    // 在线人数只在大厅有意义：进牌桌/房间就停掉轮询，回大厅再启。
    // 挂在 refresh 里统一处理，避免在 9 处 ui.screen 赋值点上逐一手写（容易漏）。
    if (this.ui.screen === 'home') this.startOnlinePolling();
    else this.stopOnlinePolling();
    // 邀请提醒：大厅与房间层都要收（在房间里也能被别的房主挖走，是正常的社交预期）；
    // 牌桌层不弹，避免打断正在进行的对局。
    if (this.ui.screen === 'home' || this.ui.screen === 'room') this.startInvitePolling();
    else this.stopInvitePolling();
    // 聊天只在牌桌有意义；无云时 startChatPolling 直接返回，纯本地气泡照常工作
    if (this.ui.screen === 'game') this.startChatPolling();
    else this.stopChatPolling();
    // 背景音乐：大厅与牌桌都播，房间准备层静音（那一层玩家在等别人，
    // 安静一点更专注，也避免「还没开局就有 BGM」的突兀）。
    // 挂在 refresh 里统一处理，避免在 9 处 ui.screen 赋值点上逐一手写。
    if (this.ui.screen === 'home' || this.ui.screen === 'game') {
      Sound.startBgm(this.ui.screen === 'game' ? 'board' : 'lobby');
    } else {
      Sound.stopBgm();
    }
  },

  /** 邀请轮询：15s 一次。比好友心跳快，邀请要「立刻」被看到 */
  startInvitePolling() {
    if (!R.hasCloud()) return;
    if (this._inviteTimer) return;
    const that = this;
    const tick = function () { that.pollInvites(); };
    tick();
    if (typeof setInterval === 'function') {
      this._inviteTimer = setInterval(tick, 15000);
    }
  },

  stopInvitePolling() {
    if (this._inviteTimer) {
      if (typeof clearInterval === 'function') clearInterval(this._inviteTimer);
      this._inviteTimer = null;
    }
  },

  /* ---------- 局内快捷聊天：预设短语 / 互动表情 ---------- */

  chatRoomCode() {
    return this._cloudCode || (this.room && this.room.code) || 'local';
  },

  myDisplayName() {
    const p = this.profile || {};
    const st = this.state;
    const me = st && st.players[this.mySeat || 0];
    // 聊天昵称会随消息广播给所有人，属于最典型的公开展示位
    return String(displayName(me, p.nickname || '我')).slice(0, 12);
  },

  onToggleChatPanel() {
    if (this.ui.screen !== 'game') return;
    if (Date.now() < (this._menuSuppressTapUntil || 0)) return;
    this.ui.chatPanelOpen = !this.ui.chatPanelOpen;
    // 关面板时清掉未投出的表情，下次打开回到「选表情」而不是半截的「选目标」
    if (!this.ui.chatPanelOpen) {
      this.ui.chatPendingEmoji = null;
      this.ui.chatPendingAt = 0;
    } else {
      // 刚打开也算一次内容刷新：同样给一点缓冲，避免「点聊天按钮的手势
      // 顺势落到刚弹出的第一条快捷语上」
      this.ui.chatTabSwitchAt = Date.now();
    }
    this.refresh('');
  },

  /**
   * 牌桌悬浮菜单：支持拖拽与清晰中文项展开。
   * 避开微信右上角「…」与关闭胶囊，停靠在工作台外侧安全区并可自由拖放。
   */
  onToggleMenu() {
    if (this.ui.screen !== 'game') return;
    if (Date.now() < (this._menuSuppressTapUntil || 0)) return;
    this.ui.menuOpen = !this.ui.menuOpen;
    this.refresh('');
  },

  onCloseMenu() {
    if (!this.ui || !this.ui.menuOpen) return;
    this.ui.menuOpen = false;
    this.refresh('');
  },

  onMenuTouchStart(event) {
    if (!this.ui || this.ui.screen !== 'game') return;
    const t = (event && event.touches && event.touches[0]) || (event && event.changedTouches && event.changedTouches[0]) || event;
    if (!t || typeof t.clientX !== 'number' || typeof t.clientY !== 'number') return;
    const pos = clampMenuPos(this.ui.menuX, this.ui.menuY);
    this._menuDrag = {
      startClientX: t.clientX,
      startClientY: t.clientY,
      startX: pos.x,
      startY: pos.y,
      moved: false,
      rotated90: !!((this._layout && this._layout.rotate === 90) || (event && event._rotated90))
    };
  },

  onMenuTouchMove(event) {
    const d = this._menuDrag;
    if (!d || !this.ui || this.ui.screen !== 'game') return;
    const t = (event && event.touches && event.touches[0]) || (event && event.changedTouches && event.changedTouches[0]) || event;
    if (!t || typeof t.clientX !== 'number' || typeof t.clientY !== 'number') return;
    const dx = t.clientX - d.startClientX;
    const dy = t.clientY - d.startClientY;
    if (!d.moved && (dx * dx + dy * dy) < 36) return;
    d.moved = true;
    this._menuSuppressTapUntil = Date.now() + 260;
    const scale = (this._layout && this._layout.scale) || 1;
    const dsx = (d.rotated90 ? dy : dx) / scale;
    const dsy = (d.rotated90 ? -dx : dy) / scale;
    const next = clampMenuPos(d.startX + dsx, d.startY + dsy);
    if (next.x === this.ui.menuX && next.y === this.ui.menuY) return;
    this.ui.menuX = next.x;
    this.ui.menuY = next.y;
    this.setData({
      menuX: next.x,
      menuY: next.y,
      menuDirClass: menuDirClassOf(next.x, next.y)
    });
  },

  onMenuTouchEnd() {
    if (this._menuDrag && this._menuDrag.moved) {
      this._menuSuppressTapUntil = Date.now() + 260;
    }
    this._menuDrag = null;
  },

  onMenuOpenLobby() {
    if (Date.now() < (this._menuSuppressTapUntil || 0)) return;
    this.ui.menuOpen = false;
    this.onOpenLobby();
  },

  onMenuToggleChat() {
    if (Date.now() < (this._menuSuppressTapUntil || 0)) return;
    this.ui.menuOpen = false;
    this.onToggleChatPanel();
  },

  /**
   * 菜单「重新开始」：人机局二次确认；联机局进入重开投票。
   * 结算弹层的「再来一局」仍直接走 onRestart() —— 那不属于「对战中」，
   * 且牌局已结束，再拦一次确认纯属打扰。
   */
  onMenuRestart() {
    if (Date.now() < (this._menuSuppressTapUntil || 0)) return;
    this.ui.menuOpen = false;
    if (this.mode !== 'room' || !this.room) {
      const that = this;
      const doRestart = function () { that.onRestart(); };
      // 预览沙箱没有 wx.showModal：降级为直接执行，与移出/投降的口径一致
      if (typeof wx === 'undefined' || !wx.showModal) { doRestart(); return; }
      wx.showModal({
        title: '重新开始？',
        content: '当前这局会作废且不计入战绩，人数与机器人席位保持不变，重新开一局。',
        confirmText: '重新开始',
        cancelText: '继续对局',
        success: function (res) { if (res.confirm) doRestart(); }
      });
      return;
    }
    this.openResetVote();
  },

  /**
   * 联机局点「重新开始」：
   *   · 已有投票 → 重新展开弹层（用户之前可能收起过），让本人投票
   *   · 房主且无进行中投票 → 二次确认后发起
   *   · 非房主且无投票 → 明确告知只有房主能发起
   */
  openResetVote() {
    const st = this.state;
    if (!st || st.gameOver) { this.refresh('本局已结束，用结算面板的「再来一局」即可'); return; }
    const vote = st.resetVote;
    if (vote && V.isCurrent(vote, st)) {
      this.ui.resetVoteHiddenKey = '';
      this.refresh(vote.status === 'open' ? '请完成重开投票' : '');
      return;
    }
    if (this.mySeat !== 0) {
      this.refresh('只有房主可以发起重开投票');
      return;
    }
    const that = this;
    const start = function () { that.startResetVote(); };
    if (typeof wx === 'undefined' || !wx.showModal) { start(); return; }
    wx.showModal({
      title: '发起重开投票？',
      content: '将向所有在场真人发起投票，全部同意后大家回到大厅重新准备。当前这局作废、不计战绩。',
      confirmText: '发起投票',
      cancelText: '取消',
      success: function (res) { if (res.confirm) start(); }
    });
  },

  /** 生成投票并写进快照；弹层里的「重新发起」直接走这里，不再叠一层确认。 */
  startResetVote() {
    const st = this.state;
    if (!st || st.gameOver || this.mySeat !== 0) return;
    if (!V.canStart(st.resetVote, true)) { this.refresh('已有进行中的重开投票'); return; }
    const uid = (this.profile && this.profile.uid) || '';
    const name = displayName(st.players[this.mySeat || 0], '房主');
    this._resetVoteSeq = (this._resetVoteSeq || 0) + 1;
    const id = 'v' + Date.now() + '-' + this._resetVoteSeq;
    const now = Date.now();
    this.writeResetVote(function (s) {
      if (!V.canStart(s.resetVote, true)) return false;
      const v = V.newVote(s, { byUid: uid, byName: name, id: id, now: now });
      if (!v) return false;
      s.resetVote = v;
      return true;
    }, '重开投票已发起');
  },

  onResetVoteAgree() { this.castResetVote(true); },
  onResetVoteReject() { this.castResetVote(false); },
  onResetVoteRestart() { this.startResetVote(); },

  castResetVote(agree) {
    const st = this.state;
    if (!st || !st.resetVote || st.resetVote.status !== 'open') return;
    const uid = (this.profile && this.profile.uid) || '';
    const name = displayName(st.players[this.mySeat || 0], '玩家');
    this.writeResetVote(function (s) {
      if (!s.resetVote || !V.isCurrent(s.resetVote, s)) return false;
      return V.cast(s.resetVote, s, uid, name, agree);
    }, agree ? '已同意重开' : '已选择不同意，本次重开取消');
  },

  onCloseResetVote() {
    const v = this.state && this.state.resetVote;
    if (!v) return;
    // 只收起这一次 open；状态一变（否决 / 通过）key 就不同，弹层会重新出现
    this.ui.resetVoteHiddenKey = v.id + ':' + v.status;
    this.refresh('');
  },

  /**
   * 全员同意后由房主收口：回大厅重新准备。放在 refresh 最前面并用 id 去重，
   * 避免「每帧都调 backToLobby」；返回 true 时外层 refresh 直接让位，
   * 不再重复渲染一次已经作废的牌桌。
   */
  checkResetVotePassed() {
    const v = this.state && this.state.resetVote;
    if (!v || v.status !== 'passed' || this.mySeat !== 0) return false;
    const key = String(v.id || '');
    if (this._resetVoteHandled === key) return false;
    this._resetVoteHandled = key;
    this.backToLobby();
    return true;
  },

  /**
   * 把投票状态写进牌局快照。云端场景先拉最新快照再 CAS 提交、冲突重试两次；
   * 本机房间 / 登录降级直接改本地 state。
   * 必须基于「最新快照」而不是本地 state：投票期间别人可能刚出了一手，
   * 拿旧 state 覆盖会把那一步动作抹掉 —— 这是快照型同步最容易踩的坑。
   */
  writeResetVote(mutator, message) {
    const that = this;
    const adopt = function (st) {
      that.adoptCloudState(st, false);
      that.ui.resetVoteHiddenKey = '';
      that.refresh(message || '');
    };
    if (!R.hasCloud() || !this._cloudCode) {
      if (!this.state) return;
      if (!mutator(this.state)) { this.refresh('投票状态未变化'); return; }
      adopt(this.state);
      return;
    }
    const attempt = function (n) {
      R.cloudPullGame(that._cloudCode).then(function (res) {
        if (that._unloaded) return;
        if (!res.ok || !res.state || res.state.lobby) {
          that.refresh('云端牌局已更新，请重试');
          return;
        }
        const st = res.state;
        if (!mutator(st)) { that.refresh('投票状态未变化'); return; }
        R.cloudPushState(that._cloudCode, st, res.version).then(function (saved) {
          if (that._unloaded) return;
          if (saved.ok) {
            that._cloudVersion = saved.version;
            adopt(st);
          } else if (saved.conflict && n < 2) {
            attempt(n + 1);
          } else {
            that.pollCloud(true);
            that.refresh('投票同步失败，请重试');
          }
        }).catch(function () { that.refresh('投票同步失败，请重试'); });
      }).catch(function () { that.refresh('投票同步失败，请重试'); });
    };
    attempt(0);
  },

  onMenuQuitGame() {
    if (Date.now() < (this._menuSuppressTapUntil || 0)) return;
    this.ui.menuOpen = false;
    this.onQuitGame();
  },

  onCloseChatPanel() {
    if (!this.ui.chatPanelOpen) return;
    this.ui.chatPanelOpen = false;
    this.ui.chatPendingEmoji = null;
    this.ui.chatPendingAt = 0;
    this.refresh('');
  },

  onSwitchChatTab(event) {
    const tab = event && event.currentTarget && event.currentTarget.dataset.tab;
    if (tab !== 'text' && tab !== 'emoji') return;
    // 点当前已选中的 tab 直接忽略：重渲染既闪一下又重置防误触窗口
    if (this.ui.chatTab === tab) return;
    this.ui.chatTab = tab;
    this.ui.chatPendingEmoji = null;
    // 切换后记下时刻：VM 据此在极短时间内不接收内容区点选，
    // 防「手指还按在原来那条上，新内容已长到指尖下」
    this.ui.chatTabSwitchAt = Date.now();
    this.refresh('');
  },

  onCancelChatTarget() {
    if (!this.ui.chatPendingEmoji) return;
    this.ui.chatPendingEmoji = null;
    this.ui.chatPendingAt = 0;
    this.refresh('');
  },

  /**
   * 发送一条快捷消息。文案只从 C.findPreset 白名单出，绝不拼接玩家输入：
   * 本项目没有云函数 / 服务端，开放自由输入就必须接 msgSecCheck，
   * 这里从根上不开放，也就不产生 UGC 审核面。
   */
  onSendQuickChat(event) {
    if (this.ui.screen !== 'game') return;
    const ds = (event && event.currentTarget && event.currentTarget.dataset) || {};
    // kind 必须严格等于两种枚举之一。不能写成 ds.kind === 'emoji' ? 'emoji' : 'text'：
    // 那会把伪造的 kind 静默降级成合法值，白名单只剩 id 一道，等于给客户端开了个口子。
    const kind = ds.kind;
    if (kind !== 'text' && kind !== 'emoji') return;
    // 防误触：刚切完 tab 的极短窗口内忽略内容区点选。
    // 这不是「时间没到就不让操作」，而是「这一下很可能是上一次点击的余波」。
    // 只按时间判定、不额外清标记：窗口一过自动恢复，行为可预测。
    if (Date.now() - (this.ui.chatTabSwitchAt || 0) < C.TAB_DWELL_MS) return;
    // 已进入「选目标」阶段时，表情格里不该再接收点选（内容已经换过一轮）
    if (kind === 'emoji' && this.ui.chatPendingEmoji) return;
    const preset = C.findPreset(kind, ds.id);
    if (!preset) return;                       // 伪造 / 越界 id 直接丢弃
    if (kind === 'emoji') {
      // 表情必须定向：先暂存白名单 preset，面板原地切到「选择目标玩家」。
      // 不在这一步发送，玩家就没法指定「西红柿扔给谁」。
      this.ui.chatTab = 'emoji';
      this.ui.chatPendingEmoji = preset;
      this.ui.chatPendingAt = Date.now();
      this.ui.chatPanelOpen = true;
      this.refresh('选一个玩家，把「' + preset.label + '」投给他');
      return;
    }
    const msg = C.makeMessage(this.chatRoomCode(), this.mySeat || 0,
      (this.profile && this.profile.uid) || '', this.myDisplayName(), kind, preset);
    this.pushChatMessage(msg, true);
    this.ui.chatPanelOpen = false;            // 快捷语选完立刻收起，别挡住牌桌
    this.refresh('');
  },

  /** 第二步：选定目标席位，真正发出表情并播放命中动画 */
  onPickChatTarget(event) {
    if (this.ui.screen !== 'game' || !this.state) return;
    const pending = this.ui.chatPendingEmoji;
    if (!pending) return;
    // 防误触：刚进入「选目标」的极短窗口内不接收点选。
    // 「连点两下表情 → 第二下直接投给某个玩家」是最常见的误发，
    // 这个窗口让第二下失效，用户必须重新抬起手指再选。
    if (Date.now() - (this.ui.chatPendingAt || 0) < C.TARGET_DWELL_MS) return;
    // 二次白名单校验：pending 只能是 findPreset 返回的那个常量对象。
    // 客户端塞进来的伪对象（伪造 icon / tone / aim）一律丢弃。
    if (C.findPreset('emoji', pending.id) !== pending) return;
    const raw = Number(event && event.currentTarget && event.currentTarget.dataset.seat);
    const seat = Math.floor(raw);
    if (!isFinite(seat) || seat < 0 || seat >= this.state.players.length) return;
    const msg = C.makeMessage(this.chatRoomCode(), this.mySeat || 0,
      (this.profile && this.profile.uid) || '', this.myDisplayName(),
      'emoji', pending, Date.now(), seat);
    this.pushChatMessage(msg, true);
    this.ui.chatPendingEmoji = null;
    this.ui.chatPendingAt = 0;
    this.ui.chatPanelOpen = false;
    this.showChatProjectile(msg);
    this.refresh('已向 ' + E.seatNoOf(this.state, seat) + ' 号位' + pending.label);
  },

  /**
   * 席位头像在 1080×560 舞台上的中心坐标。
   * 顶部对手条 left16/top6、每卡 200 宽 gap8，头像落在卡内左 ~34px；
   * 底部工作台 tray left84/top430 + tray-left left14/top10 + 64×80 肖像。
   * 舞台是固定设计尺寸、整层由 transform:scale 缩放，所以用固定几何即可，
   * 不需要 SelectorQuery（H5 预览拿不到布局，且动画必须同步起算）。
   */
  chatSeatAnchor(seat) {
    const st = this.state;
    const my = this.mySeat || 0;
    if (!st || !st.players) return { x: 130, y: 480 };
    if (seat === my) return { x: 130, y: 480 };
    let order = 0;
    for (let i = 0; i < seat; i++) if (i !== my) order += 1;
    return { x: 48 + order * 208, y: 34 };
  },

  /** 定向表情：从发送者头像飞到目标头像；投掷类命中时溅开，递送类亮一圈光环 */
  showChatProjectile(msg) {
    if (!msg || msg.kind !== 'emoji' || !this.ui) return;
    const players = (this.state && this.state.players) || [];
    const st = this.state || { players: players };
    const from = this.chatSeatAnchor(msg.seat);
    const target = (typeof msg.targetSeat === 'number' && msg.targetSeat >= 0 &&
      msg.targetSeat < players.length) ? msg.targetSeat : msg.seat;
    const to = this.chatSeatAnchor(target);
    const aim = C.aimFor(msg.tone || '');
    const nameOf = function (s) {
      const p = players[s] || {};
      return String(displayName(p, E.seatNoOf(st, s) + ' 号位')).slice(0, 8);
    };
    const item = {
      id: C.makeId(),
      icon: msg.icon,
      label: msg.label,
      isThrow: aim === 'throw',
      isGift: aim === 'gift',
      fromLabel: String(msg.name || nameOf(msg.seat)).slice(0, 8),
      toLabel: nameOf(target),
      motionStyle: '--dx:' + (to.x - from.x) + 'px;--dy:' + (to.y - from.y) +
        'px;left:' + from.x + 'px;top:' + from.y + 'px;',
      targetStyle: 'left:' + to.x + 'px;top:' + to.y + 'px;'
    };
    this.ui.chatProjectiles = (this.ui.chatProjectiles || []).concat([item]).slice(-3);
    const that = this;
    // 可选能力不得拖死主流程：预览沙箱没有定时器时，动画节点由 sweep 兜底清理
    if (typeof setTimeout === 'function') {
      setTimeout(function () {
        if (!that.ui) return;
        that.ui.chatProjectiles = (that.ui.chatProjectiles || []).filter(function (p) {
          return p.id !== item.id;
        });
        if (that.ui.screen === 'game') that.refresh('');
      }, C.PROJECTILE_TTL_MS + 80);
    }
  },

  /** 本地入队 + 可选云端投递；云端失败静默降级，本机气泡照常显示 */
  pushChatMessage(msg, deliver) {
    this.ui.chatMessages = C.trim(this.ui.chatMessages || [], Date.now());
    this.ui.chatMessages.push(msg);
    this.scheduleChatSweep();
    // 只有云端房间局才投递。hasCloud() 只说明「云服务可用」，真机上打人机局它也是
    // true；若按它判断，会把单机消息写进 room_code='local' 这个全站共享键里，
    // 谁也读不到、还一直堆垃圾数据。_cloudCode 才是「本局确实在联机」的判据。
    if (deliver && R.hasCloud() && this._cloudCode) {
      C.send(R.getCloud(), msg).then(function () {}).catch(function () {});
    }
    // 人机局：机器人回一个表情，快捷聊天不至于自说自话。
    // 只看 mode === 'room' 判定联机局，不能用 !R.hasCloud()：真机上云已开通，
    // 打人机局时它也返回 true，会让机器人再也不回应。联机局每个席位都是真人，
    // 绝不能替别人说话。
    if (deliver && this.mode !== 'room' && this.state) this.scheduleBotReply();
  },

  showChatFly(msg) {
    this.ui.chatFly = {
      id: msg.id, icon: msg.icon, label: msg.label, tone: msg.tone || '', seat: msg.seat
    };
    const that = this;
    if (this._chatFlyTimer) clearTimeout(this._chatFlyTimer);
    this._chatFlyTimer = setTimeout(function () {
      that._chatFlyTimer = null;
      if (!that.ui) return;
      that.ui.chatFly = null;
      that.refresh('');
    }, C.FLY_TTL_MS);
  },

  /** 气泡 TTL 到点统一重绘一次，不为每条消息各起一个定时器 */
  scheduleChatSweep() {
    if (this._chatSweepTimer) clearTimeout(this._chatSweepTimer);
    const that = this;
    this._chatSweepTimer = setTimeout(function () {
      that._chatSweepTimer = null;
      if (!that.ui || that.ui.screen !== 'game') return;
      that.ui.chatMessages = C.trim(that.ui.chatMessages || [], Date.now());
      that.refresh('');
    }, C.BUBBLE_TTL_MS + 150);
  },

  /** 确定性轮转选一个机器人席回表情，避免随机导致测试不可复现 */
  scheduleBotReply() {
    const st = this.state;
    if (!st || st.gameOver) return;
    const bots = [];
    for (let i = 0; i < st.players.length; i++) {
      if (i !== (this.mySeat || 0) && st.players[i].isAI) bots.push(i);
    }
    if (!bots.length) return;
    const cursor = this.ui.chatBotCursor || 0;
    const seat = bots[cursor % bots.length];
    this.ui.chatBotCursor = cursor + 1;
    const preset = C.findPreset('emoji', C.BOT_REPLIES[cursor % C.BOT_REPLIES.length]);
    const that = this;
    if (this._chatBotTimer) clearTimeout(this._chatBotTimer);
    this._chatBotTimer = setTimeout(function () {
      that._chatBotTimer = null;
      if (!that.ui || that.ui.screen !== 'game' || !that.state) return;
      const p = that.state.players[seat] || {};
      const msg = C.makeMessage(that.chatRoomCode(), seat, '',
        displayName(p, E.seatNoOf(that.state, seat) + ' 号位'), 'emoji', preset,
        Date.now(), that.mySeat || 0);
      that.pushChatMessage(msg, false);       // 本地即可，别再触发机器人自回复
      // 只回气泡，不调 showChatFly：大表情是玩家主动打出的全屏效果，动画 1600ms，
      // 机器人 700ms 就回，一旦抢占会把玩家自己的动画直接掐掉（实测截图里
      // 「炸弹」被替换成「递茶」）。机器人回应在气泡里照样看得见。
      that.refresh('');
    }, 700);
  },

  /**
   * 聊天独立轮询 + 独立单飞锁：pollCloud 的 _polling 锁是给对局快照的，
   * 聊天不能与它互锁，否则一次慢请求会把整局状态同步一起拖住。
   */
  startChatPolling() {
    if (!R.hasCloud() || !this._cloudCode) return;
    if (typeof setInterval !== 'function') return;
    if (this._chatTimer) return;
    const that = this;
    this._chatTimer = setInterval(function () { that.pollChat(); }, 1500);
  },

  stopChatPolling() {
    if (this._chatTimer) {
      if (typeof clearInterval === 'function') clearInterval(this._chatTimer);
      this._chatTimer = null;
    }
    if (this._chatSweepTimer) { clearTimeout(this._chatSweepTimer); this._chatSweepTimer = null; }
    if (this._chatFlyTimer) { clearTimeout(this._chatFlyTimer); this._chatFlyTimer = null; }
    if (this._chatBotTimer) { clearTimeout(this._chatBotTimer); this._chatBotTimer = null; }
    // 离开牌桌时收掉未投出的表情与飞行节点，回大厅后再进新局不残留旧动画
    if (this.ui) { this.ui.chatProjectiles = []; this.ui.chatPendingEmoji = null; }
    this._chatPolling = false;
  },

  pollChat() {
    if (this._chatPolling || this._hidden || this._unloaded) return;
    if (!R.hasCloud() || !this._cloudCode || this.ui.screen !== 'game') return;
    this._chatPolling = true;
    const that = this;
    C.list(R.getCloud(), this._cloudCode, Date.now()).then(function (rows) {
      that._chatPolling = false;
      if (!that.ui || that.ui.screen !== 'game') return;
      const merged = C.merge(that.ui.chatMessages || [], rows, Date.now());
      that.ui.chatMessages = merged.list;
      if (!merged.added) return;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].kind === 'emoji' && rows[i].seat !== (that.mySeat || 0)) {
          // 远端消息带 target_seat / tone，按目标席位重放同一段命中动画，
          // 两端看到的是同一个「谁砸了谁」，而不是各自全屏乱飞。
          that.showChatProjectile(rows[i]);
          break;
        }
      }
      that.scheduleChatSweep();
      that.refresh('');
    }).catch(function () { that._chatPolling = false; });
  },

  /* ---------- 头像：按 uid 补齐，跨设备可见 ---------- */

  /** 自己的头像优先用本机文件（清晰、离线可用），其余席位靠资料表补齐 */
  avatarSeed() {
    const p = this.profile || {};
    const map = {};
    if (p.uid && (p.avatarUrl || p.avatarData)) map[p.uid] = p.avatarUrl || p.avatarData;
    return map;
  },

  /**
   * 席位 / 快照里只放 uid，头像靠这一步补。
   * 用「uid 集合签名」去重：refresh 每 0.5~1.6s 跑一次，不加这个判断会变成轮询个人资料表。
   */
  syncAvatars() {
    const that = this;
    if (!this._avatars) this._avatars = this.avatarSeed();
    const selfUid = this.profile && this.profile.uid;
    const uids = [];
    function add(u) { if (u && uids.indexOf(u) < 0) uids.push(u); }
    ((this.room && this.room.seats) || []).forEach(function (s) { add(s && s.uid); });
    ((this.state && this.state.players) || []).forEach(function (p) { add(p && p.uid); });
    if (!uids.length) return;
    uids.sort();
    // 30s TTL：uid 集合不变时也要周期性重拉。只用 uid 集合做签名的话，
    // 某人中途换头像，其他设备的签名永远不变，会一直显示旧头像。
    const sig = uids.join(',') + '@' + Math.floor(Date.now() / 30000);
    if (sig === this._avatarSig) return;
    this._avatarSig = sig;
    U.fetchProfiles(uids).then(function (res) {
      if (!res || !res.map || !that.ui) return;
      let changed = false;
      Object.keys(res.map).forEach(function (uid) {
        // 自己的头像以本机为准：syncProfile 上云是异步的，拿云端旧值覆盖
        // 会立刻把刚保存的新头像打回去。别人的改动靠上面的 TTL 拉到。
        if (uid === selfUid) return;
        const av = res.map[uid] && res.map[uid].avatarUrl;
        if (!av) return;
        if (that._avatars[uid] !== av) { that._avatars[uid] = av; changed = true; }
      });
      if (changed) that.refresh('');
    });
  },

  /* ---------- 回合：号位提醒 + 限时 ---------- */

  /**
   * 「一手」的唯一标识 —— 只认回合数与当前席位。
   * 旧实现把 pendingDiscard 拼进 key：一旦触发退还筹码 / 多贵族挑选，
   * 换手检测就把这一步误判成新的一手，倒计时与 _timeoutFired 被重新置位，
   * 已经超时的玩家又拿到一整段新限时，AI 迟迟不接管。一个回合只该有
   * 一个计时起点，退还与挑选属于同一回合的子步骤，不重新计时。
   */
  turnKeyOf(state) {
    if (!state) return '';
    return state.turnCount + ':' + state.current;
  },

  /** 换手时重置倒计时并弹一次全屏提醒；由 refresh 与倒计时循环调用，本身不触发渲染 */
  syncTurnWatch() {
    const st = this.state;
    if (!st || this.ui.screen !== 'game') {
      this._turnKey = '';
      this.ui.turnLeft = -1;
      return;
    }
    const key = this.turnKeyOf(st);
    if (key === this._turnKey) return;
    this._turnKey = key;
    this._turnStartAt = Date.now();
    this._timeoutFired = false;
    const limit = Number(st.turnLimit) || 0;
    this.ui.turnLeft = limit;
    this.showTurnFlash(st, limit);
  },

  /**
   * 全屏换手提醒。
   * 人机局只在轮到自己时弹：每一步 AI 都弹会把牌桌刷成红绿灯。
   */
  showTurnFlash(state, limit) {
    if (!state || state.gameOver) { this.ui.turnFlash = null; return; }
    const seat = this.mySeat || 0;
    const mine = state.current === seat;
    const isRoom = this.mode === 'room';
    if (!mine && !isRoom) { this.ui.turnFlash = null; return; }
    const p = state.players[state.current] || {};
    const seatNo = E.seatNoOf(state, state.current);
    const name = displayName(p, '玩家 ' + seatNo);
    const limitText = limit > 0 ? '限时 ' + limit + ' 秒' : '不限时';
    this.ui.turnFlash = {
      id: this._turnKey + '-' + (mine ? 'me' : 'other'),
      mine: mine,
      other: !mine,
      seatNo: seatNo,
      seatLabel: seatNo + ' 号位',
      name: name,
      // 号位已经在上一行徽标里，标题不再重复，避免「2 号位 / 2 号位 · xx」叠字
      title: mine ? '轮到你出牌' : name,
      sub: mine ? limitText + ' · 拿筹码 / 预留 / 购买任选其一'
        : '轮到对方 · ' + limitText,
      tone: mine ? 'mine' : (p.isAI ? 'bot' : 'other')
    };
    const that = this;
    if (mine) { haptic('medium'); Sound.play('turn'); }
    if (this._flashTimer) clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(function () {
      that._flashTimer = null;
      if (!that.ui) return;
      that.ui.turnFlash = null;
      that.refresh('');
    }, 1100);
  },

  /** 限时倒计时：每台设备按「自己看到换手的那一刻」起算，不依赖系统时钟对齐 */
  startClock() {
    // 限时是房间配置，不该被「未登录」连带禁用：那种状态下云端请求全部
    // offline，牌局实际只有本机一台设备，本地计时与 AI 代打都是安全的。
    // 旧实现在这里按房间模式 + 未登录直接 return，让本机房间的限时档
    // 完全失效（连倒计时都不出现）。
    if (this._clockTimer) return;
    if (this.ui.screen !== 'game') return;
    const st = this.state;
    if (!st || st.gameOver || !(Number(st.turnLimit) > 0)) return;
    const that = this;
    // 预览沙箱（node:vm）没有 setInterval：直接调会抛 ReferenceError 把 refresh 打断。
    // 倒计时只是锦上添花，缺了它不该让牌桌进不去。
    if (typeof setInterval !== 'function') return;
    this._clockTimer = setInterval(function () { that.tickClock(); }, 500);
  },

  stopClock() {
    if (this._clockTimer) {
      if (typeof clearInterval === 'function') clearInterval(this._clockTimer);
      this._clockTimer = null;
    }
  },

  /** 开新局 / 回大厅 / 离开房间：清掉上一局残留的计时与提醒 */
  resetTurnUI() {
    this.stopClock();
    this._turnKey = '';
    this._turnStartAt = 0;
    this._timeoutFired = false;
    this._timeoutFailures = 0;
    this.ui.turnLeft = -1;
    this.ui.turnFlash = null;
  },

  tickClock() {
    const st = this.state;
    if (!st || st.gameOver || this.ui.screen !== 'game') { this.stopClock(); return; }
    const limit = Number(st.turnLimit) || 0;
    if (limit <= 0) { this.stopClock(); return; }
    if (this.turnKeyOf(st) !== this._turnKey) { this.syncTurnWatch(); this.refresh(''); return; }
    const elapsed = Math.floor((Date.now() - (this._turnStartAt || Date.now())) / 1000);
    const left = Math.max(0, limit - elapsed);
    if (left !== this.ui.turnLeft) {
      this.ui.turnLeft = left;
      // 只推计时块，不整页 refresh：250+ 字段每秒全量推一遍在中低端机上会掉帧
      this.setData({ turnClock: clockVM(st, this.ui) });
    }
    if (left <= 0) this.onTurnTimeout();
  },

  /**
   * 超时托管：倒计时归 0 的那一刻，立刻由 AI 把「当前这一回合」打完并结束。
   *
   * 谁会超时：只有在场的真人席位。机器人 / 空席 / 主动托管的席位由
   * scheduleAi() 硬编码驱动，本来就不属于超时托管的范畴，这里直接放行。
   *
   * 单点权威：联机局只有房主设备代打并推快照，非房主不本地推进。否则
   * 多台设备会各自用 AI 推演同一回合并 CAS 抢写；更糟的是非房主可能先
   * 在本地算出 gameOver，抢在权威快照到达前记下一条不一致的结算战绩。
   * 非房主只提示一次，随后由 1.6s 轮询拿到房主代打的结果（换手时
   * syncTurnWatch 会自动清掉 _timeoutFired）。
   *
   * 这里刻意不做「再宽限 N 秒」：旧实现的房主二次等待 12 秒，让
   * 「超时立即由机器人接管」变成超时十几秒后才动，与规则文案不符。
   */
  onTurnTimeout() {
    if (this._timeoutFired) return;
    const st = this.state;
    if (!st || st.gameOver || this.ui.screen !== 'game') return;
    const actor = st.players[st.current] || {};
    // 自动席位不叫超时：它们由 scheduleAi 驱动，倒计时只是陪同显示
    if (actor.isAI || actor.autoPlay || (actor.type === 'remote' && !actor.joined)) return;

    const cloudRoom = this.mode === 'room' && R.hasCloud();
    if (cloudRoom && this.mySeat !== 0) {
      this._timeoutFired = true;
      this.refresh('对方超时 · 房主正在代为完成本回合');
      return;
    }

    this._timeoutFired = true;
    const seat = this.mySeat || 0;
    const mine = st.current === seat;
    const label = mine ? '超时 · 机器人已代为完成本回合'
      : displayName(actor, '玩家') + ' 超时 · 已代为完成本回合';
    const finished = this.runForcedTurn(label);
    if (finished) {
      this._timeoutFailures = 0;
      return;
    }
    // 没推动回合就不能让 _timeoutFired 一直挂着：同一个 turnKey 将永远不再触发超时。
    // 但也不能无限每 500ms 空转，连续失败就停表并明确告知玩家。
    this._timeoutFired = false;
    this._timeoutFailures = (this._timeoutFailures || 0) + 1;
    if (this._timeoutFailures >= 3) {
      this.stopClock();
      this.refresh('超时托管未能推进，请从菜单重开或回大厅');
    }
  },

  /**
   * 强制由 AI 打完当前回合（超时专用）。
   * runAi 只代打「一手」，但一个回合可能拆成多步：
   *   行动 → 筹码超 10 枚要退还 → 同时满足多张贵族要挑选 → 才 finishTurn。
   * 只打一手会停在 pendingDiscard / pendingNoble 上；此时 _timeoutFired 已置位、
   * turnKeyOf 又没变，超时不会二次触发，牌局就永久卡住了。
   * 因此用 turnCount 是否推进作为「回合真正结束」的唯一判据。
   */
  runForcedTurn(message) {
    const s = this.state;
    if (!s || s.gameOver) return false;
    // 旧实现在这里按「房间模式 + 未登录」一刀切 return false。但那种状态下
    // 云端请求全部 offline，牌局其实只有本机一台设备：pushCloudState() 会因
    // hasCloud()=false 直接返回，本地推进不会与任何设备抢写。保留短路只会让
    // 本机房间 / 登录降级时的限时局永远卡在超时那一刻。
    // 超时常发生在玩家选了一半筹码 / 退了一半筹码时，暂存选篮必须清空，
    // 否则下一次 refresh 会把旧计划带进新回合，一进牌桌就被误提交。
    this.ui.selectedGems = [];
    this.ui.discardPlan = [];
    this.ui.detail = null;

    const startTurn = s.turnCount;
    let acted = false;
    // 正常回合最多 3 步；8 步是防 AI 反复返回无效动作的保险丝
    for (let i = 0; i < 8; i++) {
      if (s.gameOver || s.turnCount > startTurn) break;
      const action = AI.chooseAction(s);
      let res = E.performAction(s, action);
      if (!res.ok) res = E.performAction(s, { type: 'pass' });
      if (!res.ok) break;
      acted = true;
    }
    const finished = s.gameOver || s.turnCount > startTurn;
    this.refresh(message || '超时 · 机器人已代为完成本回合');
    if (acted) this.pushCloudState();
    // 换手后若轮到的席位本就是机器人 / 空席，交给常规链路继续，不在这里抢跑
    if (!s.gameOver && needsAutoPlay(s, this.aiContext())) this.scheduleAi();
    return finished;
  },

  /* ---------- 断线重连 ---------- */

  /** 把「在哪个房间、坐哪一席、停在哪个界面」写进本地会话 */
  saveSession() {
    if (!R.hasCloud() || !this._cloudCode || !this.room) return;
    R.saveSession({
      code: this._cloudCode,
      seat: this.mySeat,
      screen: this.ui.screen,
      at: Date.now()
    });
  },

  clearSession() {
    if (R.clearSession) R.clearSession();
  },

  /**
   * 冷启动或切回前台时的自动重连：拿本地会话里的房间号重新入席。
   * cloudJoinRoom 按 uid 复用原席位，因此不会挤掉别人，也不会占新位。
   */
  resumeSession() {
    if (!R.hasCloud() || this._cloudCode || this._joining || this._resuming) return;
    const s = R.getSession ? R.getSession() : null;
    if (!s || !s.code) return;
    // 超过 12 小时的会话基本是上一场的残留，直接作废，避免连到已清空的房间
    if (s.at && Date.now() - s.at > 12 * 3600 * 1000) { this.clearSession(); return; }
    this._resuming = true;
    this.mode = 'room';
    this.ui.homeNotice = '正在回到房间 ' + s.code + ' …';
    this.refresh('');
    this.joinCloudRoom(s.code, { silent: true });
  },

  /** 连续失败才提示，避免一次抖动就弹「网络中断」 */
  noteNetFail(res) {
    if (!res || res.offline) return;
    this._netFails = (this._netFails || 0) + 1;
    if (this._netFails < 2 || this._netDown) return;
    this._netDown = true;
    this.ui.netNotice = '网络中断 · 正在重连…';
    if (this.ui.screen === 'room') this.ui.roomNotice = '网络中断，正在重连…';
    this.refresh('');
  },

  noteNetOk() {
    this._netFails = 0;
    if (!this._netDown) return;
    this._netDown = false;
    this.ui.netNotice = '';
    if (this.ui.screen === 'room') this.ui.roomNotice = '';
    this.refresh('已恢复同步');
  },

  /** 房间没了（房主解散 / 过期 / 云上查不到）：收摊回首页，别让轮询永远空转 */
  handleRoomLost(reason, message) {
    this.stopCloudPolling();
    this.clearSession();
    this.state = null;
    this.room = null;
    this.mySeat = 0;
    this._cloudCode = '';
    this._roomVersion = 0;
    this._cloudVersion = 0;
    this._netFails = 0;
    this._netDown = false;
    this.mode = 'solo';
    const solo = this.ui.soloCount;
    const roomCount = this.ui.roomCount;
    this.ui = freshUI({ screen: 'home', soloCount: solo, roomCount: roomCount });
    this.ui.homeNotice = message || ('房间已结束：' + (reason || '房主已解散或房间已过期'));
    this.refresh('');
  },

  /**
   * 轮询到新的席位表时，判断本机是否已被房主移出房间。
   * 房主（mySeat=0）不会被移出；非房主按 uid 在 1..n-1 号席里找自己，
   * 席位被释放后 uid 变空，这里就会返回 false。
   */
  seatStillMine(seats) {
    if (this.mySeat <= 0) return true;
    const uid = String((this.profile && this.profile.uid) || '');
    if (!uid) return true;
    for (let i = 1; i < (seats || []).length; i += 1) {
      const s = seats[i];
      if (s && !s.isAI && String(s.uid || '') === uid) return true;
    }
    return false;
  },

  /** 被房主移出：只解除本机绑定，不解散房间；允许对方凭房间号重新加入 */
  handleKicked() {
    this.handleRoomLost('', '你已被房主移出房间 · 可重新输入房间号加入');
  },

  /* ---------- 云端牌局同步（浏览器预览下全部为空操作） ---------- */

  aiContext() {
    return { cloud: R.requiresWechatLogin() || R.hasCloud(), isHost: this.mySeat === 0 };
  },

  createCloudRoom() {
    const that = this;
    const code = this.room.code;
    const ownerUid = this.profile.uid;
    this.ui.roomCreating = true;
    this.ui.roomCreateFailed = false;
    this.refresh('正在创建云端房间…');
    // 大厅阶段不写牌局快照，等房主点「开始牌局」时再落 state，
    // 否则好友入席时会拿到一副还没开始的牌。
    return R.cloudCreateRoom(this.room, null).then(function (res) {
      if (that._unloaded || that._cloudCode !== code || that.profile.uid !== ownerUid) return;
      that.ui.roomCreating = false;
      if (res.ok) {
        that._roomVersion = res.version;
        that.saveSession();
        that.ui.roomNotice = '房间 ' + that.room.code + ' 已同步到云端，分享给好友即可跨设备加入';
        that.startCloudPolling();
      } else if (!res.offline) {
        that.ui.roomCreateFailed = true;
        that.ui.roomNotice = '云端房间尚未创建完成：' + res.error + '。主题与设置已保留，请重试。';
      }
      that.refresh('');
    });
  },

  /** 好友通过分享卡片 / 房间号入席：进大厅准备，或接管进行中的牌局 */
  joinCloudRoom(code, opts) {
    const that = this;
    const ownerUid = this.profile.uid;
    const silent = !!(opts && opts.silent);
    this._joining = true;
    this._resuming = !!(opts && opts.silent) || this._resuming;
    const tipText = (silent ? '正在重新连接房间 ' : '正在加入房间 ') + code + ' …';
    this.ui.roomNotice = tipText;
    this.ui.homeNotice = tipText;
    this.refresh('');
    return R.cloudJoinRoom(code, this.profile).then(function (res) {
      if (that._unloaded || that.profile.uid !== ownerUid || R.getProfile().uid !== ownerUid) return;
      that._joining = false;
      if (!res.ok) {
        that._resuming = false;
        // 房间已结束 / 席位被占：会话已失效，别再无限重试；
        // 其它（网络抖动）保留会话，下次切回前台继续试
        const dead = /未找到|没有空余|已经开始|已结束/.test(res.error || '');
        if (dead) that.clearSession();
        that.mode = 'solo';
        that.ui.screen = 'home';
        that.ui.homeNotice = silent
          ? (dead ? '上次的房间已结束：' + res.error : '重新连接失败：' + res.error + '（稍后会自动重试）')
          : res.error;
        that.ui.roomNotice = res.error;
        that.refresh('');
        return;
      }
      that._resuming = false;
      that.ui.homeNotice = '';
      that.ui.roomNotice = '';
      that.clearTimer();
      that.mode = 'room';
      that.mySeat = res.seat;
      that.room = res.room;
      that.room.mode = 'room';
      that._cloudCode = res.room.code;
      that._roomVersion = res.room.version || 1;
      that._cloudVersion = res.version || 0;
      that.ui.playerCount = res.room.playerCount;
      that.ui.turnLimit = R.normTurnLimit(res.room.turnLimit);
      that._netFails = 0;
      that._netDown = false;
      that.ui.netNotice = '';

      if (res.status === 'playing' && res.state) {
        // 恢复会话 / 好友进场：已结束的牌局不补记战绩（见 adoptCloudState）
        that.adoptCloudState(res.state, true);
        if (res.state.lastAction) that._seenActionId = res.state.lastAction.id;
        const p = that.state.players[that.mySeat];
        if (p) {
          p.nickname = that.profile.nickname;
          p.name = that.profile.nickname;
          p.avatar = that.profile.avatar;
          p.joined = true;
        }
        that.ui.screen = 'game';
        that.saveSession();
        that.refresh(silent
          ? '已重连牌局 ' + res.room.code + ' · 席位 ' + (res.seat + 1)
          : '已重新加入牌局 ' + res.room.code + ' · 席位 ' + (res.seat + 1));
      } else {
        that.state = null;
        that.ui.screen = 'room';
        that.ui.roomNotice = '';
        that.saveSession();
        that.refresh(silent
          ? '已回到房间 ' + res.room.code + ' · 席位 ' + (res.seat + 1)
          : '已加入房间 ' + res.room.code + ' · 点「准备」等房主开始');
      }
      that.startCloudPolling();
      // 首次入席且从未改过资料：立刻引导取昵称，否则同房间多人全叫「珠宝商」
      if (!that.profile.customized) {
        that.ui.profileDraft = Object.assign({}, that.profile);
        that.ui.profileNotice = '取个昵称，群里其他人才认得出你（当前默认「珠宝商」）';
        that.ui.showProfile = true;
        that.refresh('');
      }
      if (that.ui.screen === 'game') that.maybeRunAi({ ended: true });
    });
  },

  /**
   * 接收一份云端牌局快照时，同步「一局一条战绩」的记账状态。
   * ------------------------------------------------------------------
   * entering=true 表示这是进场 / 恢复会话：若拿到的快照已经结束，本机
   * 并没有这局的过程数据，既不该记战绩，更不能把「进场时刻」当开局时刻
   * （那会算出 0.005s/行动这种伪耗时，把速度项污染掉）。
   * 同一局重连（gameId 相同）则保留原来的计时起点与记账状态；换了局且
   * 正在进行，才把计时起点移到当前时刻。
   * 轮询替换快照用 entering=false：本机亲历了这局，结算时照常记账。
   */
  adoptCloudState(st, entering) {
    const prevGid = String((this.state && this.state.gameId) || '');
    const nextGid = String((st && st.gameId) || '');
    const sameGame = !!nextGid && prevGid === nextGid;
    const ended = !!(st && st.gameOver);
    this.state = st;
    if (!entering) return;
    this._resultRecorded = !!(ended || (sameGame && this._resultRecorded));
    if (!sameGame && !ended) this._gameStartedAt = Date.now();
    // 娱乐模式：联机各端首次进场时，若本机席位尚未选增益则弹出选择层。
    // 只在进入新局且非终局时弹，避免每次轮询覆盖玩家正在进行的选 buff 操作。
    if (!sameGame && !ended && Ent.isEntertainment(st)) {
      const mine = st.entertainment.buffs[this.mySeat || 0];
      this.ui.buffPickOpen = !mine;
    }
  },

  /** 房主开局后，其他设备轮询到 status=playing 时切入牌桌 */
  enterCloudGame() {
    if (this._enteringGame) return;
    this._enteringGame = true;
    const that = this;
    const code = this._cloudCode;
    const ownerUid = this.profile.uid;
    R.cloudPullGame(this._cloudCode).then(function (res) {
      if (that._unloaded || that._cloudCode !== code || that.profile.uid !== ownerUid) return;
      that._enteringGame = false;
      if (!res.ok) return;         // 快照还没写完，下一轮轮询再试
      that.adoptCloudState(res.state, true);
      that._cloudVersion = res.version;
      // 进场不重放上一手：重连回来先看清牌面，再看别人下一步怎么走
      if (res.state && res.state.lastAction) that._seenActionId = res.state.lastAction.id;
      that.ui.screen = 'game';
      that.ui.playerCount = res.state.players.length;
      that.ui.detail = null;
      that.ui.selectedGems = [];
      that.ui.discardPlan = [];
      // 记账状态与计时起点已由 adoptCloudState 按「是否同一局 / 是否已结束」定好，
      // 这里不能再无条件复位：那正是重复记一局 + 伪耗时的来源。
      that.resetTurnUI();
      that.refresh('牌局开始');
      that.saveSession();
      that.maybeRunAi({ ended: true });
    });
  },

  /** 每次合法动作后提交快照；并发动作排队，避免漏推 */
  pushCloudState() {
    if (!R.hasCloud() || !this._cloudCode || !this.state) return;
    if (this._syncing) { this._pendingPush = true; return; }
    const that = this;
    const code = this._cloudCode;
    const ownerUid = this.profile.uid;
    const expected = this._cloudVersion;
    const snapshot = JSON.parse(JSON.stringify(this.state));
    this._syncing = true;
    R.cloudPushState(this._cloudCode, snapshot, expected).then(function (res) {
      if (that._unloaded || that._cloudCode !== code || that.profile.uid !== ownerUid) return;
      that._syncing = false;
      if (res.ok) {
        that._cloudVersion = res.version;
        that.noteNetOk();
      } else if (res.conflict) {
        that.pollCloud(true);
      } else if (!res.offline) {
        that.noteNetFail(res);
        that.ui.roomNotice = '云端同步失败：' + res.error;
        that.refresh('');
      }
      if (that._pendingPush) {
        that._pendingPush = false;
        that.pushCloudState();
      }
    });
  },

  startCloudPolling() {
    if (!R.hasCloud() || !this._cloudCode) return;
    this.stopCloudPolling();
    const that = this;
    // 大厅阶段只需要更快看到「谁进来了 / 谁准备了」，牌局阶段可以稍慢
    const period = this.ui.screen === 'room' ? 1200 : 1600;
    this._pollTimer = setInterval(function () { that.pollCloud(false); }, period);
  },

  stopCloudPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  resetCloudRequests() {
    this._syncing = false;
    this._polling = false;
    this._pendingPush = false;
    this._enteringGame = false;
    this._joining = false;
    this._resuming = false;
  },

  /**
   * 大厅在线人数：每 20s 刷新一次（心跳本身 45s 一次、在线窗口 2 分钟，
   * 查询比心跳快是必要的——否则别的玩家进来后要等半分钟才看得到数字跳）。
   *
   * 只在首页轮询：牌桌里这块数字不显示，白耗流量。
   * 查询失败不清零、不改 onlineReady —— 网络抖一下就把在线人数从 12 掉成「—」很突兀。
   */
  startOnlinePolling() {
    if (!R.hasCloud()) return;
    if (this._onlineTimer) return;
    const that = this;
    const tick = function () {
      U.countOnline().then(function (res) {
        if (that.ui.screen !== 'home') return;
        if (!res || !res.ok) return;
        that.ui.onlineCount = res.count;
        that.ui.onlineReady = true;
        // 只推 home 分支，不整体 refresh：大厅每秒重绘会把滚动位置和动画全打断
        that.setData({ home: lobbyVM(that.ui, that.profile || R.getProfile()) });
      }).catch(function () {});
    };
    tick();
    // 与心跳同理：预览沙箱里可能没有 setInterval，缺了它只影响「自动刷新」，
    // 不能因此让 refresh → startOnlinePolling 抛错、把整个大厅渲染打断。
    if (typeof setInterval === 'function') {
      this._onlineTimer = setInterval(tick, 20000);
    }
  },

  stopOnlinePolling() {
    if (this._onlineTimer) {
      if (typeof clearInterval === 'function') clearInterval(this._onlineTimer);
      this._onlineTimer = null;
    }
  },

  /* ---------- 好友体系：列表 / 添加 / 删除 / 邀请 ---------- */

  /**
   * 拉好友列表。顺带把「谁在线」算出来 —— 好友的在线状态来自 splendor_presence 心跳表，
   * 与大厅在线人数同源，不额外造一套。
   */
  loadFriends() {
    const that = this;
    const me = this.profile || R.getProfile();
    if (!R.hasCloud() || !me || !me.uid) {
      this.ui.friendsReady = false;
      this.ui.friendsNotice = R.hasCloud() ? '' : '本机模式：好友需要云端能力';
      return Promise.resolve(false);
    }
    return F.listFriends(me.uid).then(function (res) {
      if (that._unloaded || that.profile.uid !== me.uid) return false;
      if (!res || !res.ok) {
        that.ui.friendsNotice = (res && res.error) || '好友列表加载失败';
        that.ui.friendsReady = false;
        return false;
      }
      that.ui.friends = res.list || [];
      that.ui.friendsReady = true;
      that.ui.friendsNotice = '';
      return that.refreshFriendPresence();
    }).catch(function () {
      that.ui.friendsNotice = '好友列表加载失败';
      that.ui.friendsReady = false;
      return false;
    });
  },

  /** 用在线心跳反查好友里谁在线：一次查询，不在本地逐个比对 */
  refreshFriendPresence() {
    const that = this;
    const list = this.ui.friends || [];
    if (!list.length) {
      this.ui.onlineUids = {};
      return Promise.resolve(true);
    }
    return U.listOnlineUids(list.map(function (f) { return f.uid; })).then(function (res) {
      if (res && res.ok) that.ui.onlineUids = res.map || {};
      return true;
    }).catch(function () { return false; });
  },

  onOpenFriends() {
    this.ui.showFriends = true;
    this.ui.friendsNotice = '';
    this.ui.friendFound = null;
    this.ui.friendQuery = '';
    // 房间层打开时把当前房间号作为可邀请目标；大厅里没有房间则不能邀请
    this.ui.friendInviteCode = (this.room && this.room.mode === 'room' && this.room.code) ? this.room.code : '';
    this.refresh('');
    this.loadFriends().then(() => this.refresh(''));
  },
  onCloseFriends() {
    this.ui.showFriends = false;
    this.refresh('');
  },

  onFriendQueryInput(event) {
    this.ui.friendQuery = String((event.detail && event.detail.value) || '');
    this.ui.friendFound = null;
    this.ui.friendsNotice = '';
    this.refresh('');
  },

  /** 复制自己的账号 ID：好友体系靠它互加，必须能一键发出去 */
  onCopyMyId() {
    const id = U.getIdentity().uid || '';
    if (!id) return;
    if (typeof wx !== 'undefined' && wx.setClipboardData) {
      wx.setClipboardData({
        data: id,
        success: () => this.refresh('账号 ID 已复制，发给好友即可互加'),
        fail: () => this.refresh('复制失败，请手动长按选择')
      });
      return;
    }
    this.refresh('账号 ID：' + id);
  },

  /** 按账号 ID 精确查找。不做模糊搜索：避免把全站昵称变成可枚举列表 */
  onSearchFriend() {
    const that = this;
    const uid = String(this.ui.friendQuery || '').trim();
    if (!uid) {
      this.ui.friendsNotice = '请输入好友的账号 ID';
      this.refresh('');
      return;
    }
    const me = this.profile || R.getProfile();
    if (me && uid === me.uid) {
      this.ui.friendsNotice = '这是你自己的账号 ID';
      this.refresh('');
      return;
    }
    F.findPlayer(uid).then(function (res) {
      if (!res || !res.ok) {
        that.ui.friendFound = null;
        that.ui.friendsNotice = (res && res.error) || '没找到这个账号';
        that.refresh('');
        return;
      }
      that.ui.friendFound = res.player;
      that.ui.friendsNotice = '';
      that.refresh('');
    }).catch(function () {
      that.ui.friendsNotice = '查找失败，请重试';
      that.refresh('');
    });
  },

  onAddFriend() {
    const that = this;
    const found = this.ui.friendFound;
    if (!found) return;
    const me = this.profile || R.getProfile();
    F.addFriend(me, found.uid, found.nickname).then(function (res) {
      if (!res || !res.ok) {
        that.ui.friendsNotice = (res && res.error) || '添加失败';
        that.refresh('');
        return;
      }
      that.ui.friendsNotice = '已添加 ' + displayName(found, '好友') + ' 为好友';
      that.ui.friendFound = null;
      that.ui.friendQuery = '';
      that.loadFriends().then(function () { that.refresh(''); });
    }).catch(function () {
      that.ui.friendsNotice = '添加失败，请重试';
      that.refresh('');
    });
  },

  onRemoveFriend(event) {
    const that = this;
    const uid = event.currentTarget.dataset.uid;
    const row = (this.ui.friends || []).filter(function (f) { return f.uid === uid; })[0];
    if (!row) return;
    const me = this.profile || R.getProfile();
    const doRemove = function () {
      F.removeFriend(me.uid, uid).then(function (res) {
        if (!res || !res.ok) {
          that.ui.friendsNotice = (res && res.error) || '删除失败';
          that.refresh('');
          return;
        }
        that.loadFriends().then(function () { that.refresh(''); });
      }).catch(function () {
        that.ui.friendsNotice = '删除失败，请重试';
        that.refresh('');
      });
    };
    // 删除不可撤销（对方列表里还会保留这条边的反向记录），必须二次确认
    if (typeof wx !== 'undefined' && wx.showModal) {
      wx.showModal({
        title: '删除好友',
        content: '确定删除「' + displayName(row, '该好友') + '」吗？删除后需要重新添加才能再邀请。',
        confirmText: '删除',
        cancelText: '取消',
        success: function (r) { if (r.confirm) doRemove(); }
      });
      return;
    }
    doRemove();
  },

  /** 一键邀请：给在线好友发一条邀请，对方大厅会弹窗，可直接加入 */
  onInviteFriend(event) {
    const that = this;
    const uid = event.currentTarget.dataset.uid;
    const row = (this.ui.friends || []).filter(function (f) { return f.uid === uid; })[0];
    const code = this.ui.friendInviteCode;
    if (!row) return;
    if (!code) {
      this.ui.friendsNotice = '先创建房间，再从房间里邀请好友';
      this.refresh('');
      return;
    }
    if (!row.online) {
      this.ui.friendsNotice = displayName(row, '好友') + ' 当前不在线，邀请会收不到';
      this.refresh('');
      return;
    }
    const me = this.profile || R.getProfile();
    // 邀请落库的是 from_name，接收方弹窗直接展示。写入端先脱敏，
    // 这样即使对方是旧版本客户端（没有展示层过滤）也不会看到原字。
    F.sendInvite(me.uid, uid, code, displayName(me, '好友')).then(function (res) {
      that.ui.friendsNotice = res && res.ok
        ? ('已邀请 ' + displayName(row, '好友') + ' 加入房间 ' + code)
        : ((res && res.error) || '邀请发送失败');
      that.refresh('');
    }).catch(function () {
      that.ui.friendsNotice = '邀请发送失败，请重试';
      that.refresh('');
    });
  },

  /**
   * 拉取发给我的邀请。找到就弹窗提醒（大厅 / 房间层都生效），
   * 点「加入」直接走与分享卡片相同的 joinCloudRoom 路径。
   */
  pollInvites() {
    const that = this;
    const me = this.profile || R.getProfile();
    if (!R.hasCloud() || !me || !me.uid) return Promise.resolve(false);
    return F.listInvites(me.uid).then(function (res) {
      if (that._unloaded || that.profile.uid !== me.uid) return false;
      if (!res || !res.ok) return false;
      const list = res.list || [];
      // 已经在同一间房里就不必再提示自己人
      const filtered = list.filter(function (it) {
        return !(that.room && that.room.mode === 'room' && that.room.code === it.roomCode);
      });
      that.ui.invites = filtered;
      that.refresh('');
      return true;
    }).catch(function () { return false; });
  },

  onAcceptInvite() {
    const that = this;
    const it = (this.ui.invites || [])[0];
    if (!it) return;
    F.markInvite(it.id, 'accepted');
    this.ui.invites = (this.ui.invites || []).slice(1);
    this.ui.inviteNotice = '';
    this.refresh('');
    if (!R.hasCloud()) {
      this.refresh('当前设备未连接云端，无法加入房间');
      return;
    }
    // 与分享卡片走同一个入口：清旧会话后按房间号加入
    this.clearSession();
    this.joinCloudRoom(it.roomCode);
  },

  onDeclineInvite() {
    const it = (this.ui.invites || [])[0];
    if (!it) return;
    F.markInvite(it.id, 'declined');
    this.ui.invites = (this.ui.invites || []).slice(1);
    this.refresh('');
  },

  /**
   * 云端没有实时订阅能力，用轮询 + version 比对实现同步：
   *   大厅 → 拉房间行（席位 / 准备 / status）
   *   牌桌 → 拉牌局快照（state / version）
   */
  pollCloud(force) {
    if (!R.hasCloud() || !this._cloudCode || this._polling) return;
    const that = this;
    const code = this._cloudCode;
    const ownerUid = this.profile.uid;

    if (this.ui.screen === 'room') {
      this._polling = true;
      R.cloudPullRoom(this._cloudCode).then(function (res) {
        if (that._unloaded || that._cloudCode !== code || that.profile.uid !== ownerUid) return;
        that._polling = false;
        if (!res.ok) {
          // 房间行都不存在了：不是网络抖动，直接收摊
          if (/未找到/.test(res.error || '')) that.handleRoomLost(res.error);
          else that.noteNetFail(res);
          return;
        }
        that.noteNetOk();
        if (res.room.status === 'ended') { that.handleRoomLost('房主已解散房间'); return; }
        // 被房主移出房间：本机 uid 已从席位表消失。只在 lobby 态判定 ——
        // 开局后不改席位，避免牌桌端因一次抖动被误判踢出。
        if (res.room.status === 'lobby' && !that.seatStillMine(res.room.seats)) {
          that.handleKicked();
          return;
        }
        const changed = force || res.version !== that._roomVersion;
        that._roomVersion = res.version;
        that.room = Object.assign({}, that.room, res.room, { mode: 'room' });
        if (res.room.status === 'playing') {
          that.enterCloudGame();
          return;
        }
        if (changed) that.refresh('');
      });
      return;
    }

    const known = this._cloudVersion;
    this._polling = true;
    R.cloudPullGame(this._cloudCode).then(function (res) {
      if (that._unloaded || that._cloudCode !== code || that.profile.uid !== ownerUid) return;
      that._polling = false;
      if (!res.ok) { that.noteNetFail(res); return; }
      that.noteNetOk();
      if (!force && res.version === known) return;
      // 房主已回到大厅：其他设备同步退回房间界面重新准备
      if (res.state && res.state.lobby) {
        that.state = null;
        that._cloudVersion = 0;
        that.ui.screen = 'room';
        that.ui.selectedGems = [];
        that.ui.discardPlan = [];
        that.ui.detail = null;
        that.refresh('房主已回到房间，等你重新准备');
        return;
      }
      that._cloudVersion = res.version;
      // 轮询替换不算进场：本机亲历了这局，结算时照常记账
      that.adoptCloudState(res.state, false);
      that.ui.detail = null;
      that.ui.selectedGems = [];
      that.ui.discardPlan = [];
      // 别人刚做的动作：在本地按同一份卡面数据重放（这是「看不到对手动画」的修法）
      that.replayRemoteAction(that.state);
      that.refresh('');
      that.maybeRunAi({ ended: true });
    });
  },

  /** 行动结束后驱动非本机席位：机器人，或尚未有真人加入的席位 */
  maybeRunAi(result) {
    if (!result || !result.ended) return;
    if (!this.state || this.state.gameOver) return;
    if (!needsAutoPlay(this.state, this.aiContext())) return;
    this.scheduleAi();
  },

  scheduleAi() {
    this.clearTimer();
    const that = this;
    const waitMs = this.ui && this.ui.showcase ? 1750 : 820;
    this._aiTimer = setTimeout(function () {
      that._aiTimer = null;
      that.runAi();
    }, waitMs);
  },

  runAi(force, message) {
    if (this.mode === 'room' && R.requiresWechatLogin() && !R.hasCloud()) return;
    const s = this.state;
    if (!s || s.gameOver) return;
    if (!force && !needsAutoPlay(s, this.aiContext())) return;
    const actorSeat = s.current;
    const actor = displayName(s.players[actorSeat], '玩家');
    const aiAction = AI.chooseAction(s);
    const card = this.actionCard(aiAction, actorSeat);
    const nextSeq = (this._showcaseSeq = (this._showcaseSeq || 0) + 1);
    const preShowcase = buildActionShowcase(s, aiAction, actorSeat, this.mySeat, nextSeq, card);
    let result = E.performAction(s, aiAction);
    if (!result.ok) {
      result = E.performAction(s, { type: 'pass' });
    } else if (preShowcase) {
      this.ui.showcase = preShowcase;
    }
    this.stampAction(aiAction, card, actorSeat);
    this.refresh(message || (result.ok ? actor + ' · ' + result.message : result.error));
    if (result.ok) this.pushCloudState();
    if (!s.gameOver && needsAutoPlay(s, this.aiContext())) this.scheduleAi();
  },

  applyPlayerAction(action, successMessage) {
    if (this.mode === 'room' && R.requiresWechatLogin() && !R.hasCloud()) {
      this.refresh('请重新微信登录后继续牌局');
      return false;
    }
    const actorSeat = this.state ? this.state.current : 0;
    const myPlayer = this.state && this.state.players[this.mySeat || 0];
    const prevPoints = myPlayer ? myPlayer.points : 0;
    const prevTokens = myPlayer ? E.tokenTotal(myPlayer) : 0;
    const card = this.actionCard(action, actorSeat);
    const nextSeq = (this._showcaseSeq = (this._showcaseSeq || 0) + 1);
    const preShowcase = buildActionShowcase(this.state, action, actorSeat, this.mySeat, nextSeq, card);
    const result = E.performAction(this.state, action);
    if (!result.ok) {
      haptic('medium');
      Sound.play('error');
      this.refresh(result.error);
      return false;
    }
    haptic('light');
    // 音效与动作语义绑定：拿筹码 / 买卡 / 预留 / 贵族各有不同音色
    playActionSound(action);
    if (myPlayer && actorSeat === (this.mySeat || 0)) {
      const dPts = myPlayer.points - prevPoints;
      const dTok = E.tokenTotal(myPlayer) - prevTokens;
      const seqId = nextSeq;
      this.ui.floatScoreDeltas = dPts !== 0
        ? [{ id: 'fs-' + seqId, text: (dPts > 0 ? '+' : '') + dPts, positive: dPts > 0 }]
        : [];
      this.ui.floatTokenDeltas = dTok !== 0
        ? [{ id: 'ft-' + seqId, text: (dTok > 0 ? '+' : '') + dTok, positive: dTok > 0 }]
        : [];
      if ((dPts !== 0 || dTok !== 0) && typeof setTimeout === 'function') {
        if (this._floatDeltaTimer) clearTimeout(this._floatDeltaTimer);
        const that = this;
        this._floatDeltaTimer = setTimeout(function () {
          that._floatDeltaTimer = null;
          if (!that.ui || that._unloaded) return;
          that.ui.floatScoreDeltas = [];
          that.ui.floatTokenDeltas = [];
          that.setData({ floatScoreDeltas: [], floatTokenDeltas: [] });
        }, 650);
      }
    }
    if (preShowcase) this.ui.showcase = preShowcase;
    this.stampAction(action, card, actorSeat);
    // 娱乐技能：把引擎返回的结果信息留给面板展示（如侦察到对手的预留手牌）
    if (action.type === 'skill' && result.info) this.ui.skillResultInfo = result.info;
    this.ui.selectedGems = [];
    this.ui.discardPlan = [];
    this.ui.detail = null;
    this.ui.showReserved = false;
    this.refresh(successMessage || result.message);
    this.pushCloudState();
    this.maybeRunAi(result);
    return true;
  },

  /* ---------- 联机同步：把动作本身也传出去，其他玩家才能看到动画 ---------- */

  /** 动作涉及的卡（购买 / 预留），用于在别人屏幕上重放同一段展演 */
  actionCard(action, actorSeat) {
    const st = this.state;
    if (!st || !action) return null;
    if (action.type === 'buyBoard' || action.type === 'reserveBoard') {
      return (st.board[action.lv] && st.board[action.lv][action.index]) || null;
    }
    if (action.type === 'buyReserved') {
      const p = st.players[actorSeat];
      return (p && p.reserved && p.reserved[action.index]) || null;
    }
    // 盲抽预留不能把牌面发出去，否则等于公开牌库顶
    return null;
  },

  /**
   * 把这一步写进快照，供其他设备回放。
   * 只带最少信息（座位 / 动作 / 涉及卡面），牌局主体仍由 state 表达。
   */
  stampAction(action, card, actorSeat) {
    const st = this.state;
    if (!st || !action) return;
    const id = 'a' + actorSeat + '-' + (st.turnCount || 0) + '-' + Date.now().toString(36) +
      '-' + Math.random().toString(36).slice(2, 6);
    st.lastAction = {
      id: id,
      seat: actorSeat,
      type: action.type,
      lv: action.lv,
      index: action.index,
      gems: action.gems ? action.gems.slice() : null,
      card: (action.type === 'reserveDeck' || !card) ? null : {
        id: card.id, level: card.level, gem: card.gem, points: card.points,
        cost: card.cost, name: card.name, art: card.art
      },
      // 选贵族：贵族是公开信息，把整张牌随快照带出去供对端重放
      noble: (action.type === 'chooseNoble' && action.noble) ? {
        id: action.noble.id, title: action.noble.title,
        points: action.noble.points, req: action.noble.req
      } : null
    };
    this._seenActionId = id;
  },

  /** 收到新快照时回放别人的动作；自己的动作本地已经演过，不重复 */
  replayRemoteAction(st) {
    const la = st && st.lastAction;
    if (!la || !la.id || la.id === this._seenActionId) return;
    this._seenActionId = la.id;
    if (la.seat === (this.mySeat || 0)) return;
    const seq = (this._showcaseSeq = (this._showcaseSeq || 0) + 1);
    const sh = buildActionShowcase(st, la, la.seat, this.mySeat, seq, la.card || null);
    if (sh) {
      sh.remote = true;
      this.ui.showcase = sh;
    }
  },

  /** 点选宝石筹码：同色 2 枚（库存 ≥4）或 3 种不同色，凑满才可确认 */
  onTapPile(event) {
    const s = this.state;
    const key = event.currentTarget.dataset.key;
    if (s.current !== this.mySeat || s.gameOver || s.pendingDiscard > 0 || s.pendingNoble) return;
    if (key === 'gold') {
      haptic('medium');
      this.refresh('黄金筹码只能通过「预留卡牌」获得');
      return;
    }
    if (s.bank[key] <= 0) {
      haptic('medium');
      this.refresh('该宝石已无剩余');
      return;
    }

    const sel = this.ui.selectedGems;
    const inSel = countIn(sel, key);
    const isPair = sel.length === 2 && sel[0] === sel[1];

    if (inSel >= 2) {
      // 第 3 次点同一色 = 放回 1 枚，与右侧「-」按钮共用同一逻辑
      this.removePileGem(key);
      return;
    } else if (isPair) {
      haptic('medium');
      this.refresh('拿 2 枚同色筹码时，不能再拿其他颜色');
      return;
    } else if (sel.length === 0 || (sel.length === 1 && sel[0] === key)) {
      if (sel.length === 1 && s.bank[key] < 4) {
        haptic('medium');
        this.refresh('该颜色剩余不足 4 枚，不能一次拿 2 枚');
        return;
      }
      sel.push(key);
    } else {
      if (sel.length >= 3 && inSel === 0) {
        haptic('medium');
        this.refresh('一回合最多拿 3 枚筹码');
        return;
      }
      if (inSel > 0) {
        // 多色选取时再次点击同一色直接放回 1 枚，不必瞄准右侧小「−」按钮
        this.removePileGem(key);
        return;
      }
      sel.push(key);
    }
    haptic('light');
    this.refresh('');
  },

  /**
   * 从选篮放回 1 枚。第 3 次点同色、以及筹码堆右侧「-」都走这里，
   * 保证「放回」只改 ui.selectedGems，绝不碰 bank / 玩家筹码。
   */
  removePileGem(key) {
    const sel = this.ui.selectedGems;
    const at = sel.lastIndexOf(key);
    if (at < 0) return false;
    sel.splice(at, 1);
    haptic('light');
    this.refresh('已放回 1 枚' + (META[key] ? META[key].label : key));
    return true;
  },

  /** 已选筹码堆右侧的「-」：catchtap 阻断冒泡，避免再触发一次 onTapPile */
  onRemovePile(event) {
    const s = this.state;
    if (!s || s.current !== this.mySeat || s.gameOver ||
        s.pendingDiscard > 0 || s.pendingNoble) return;
    this.removePileGem(event.currentTarget.dataset.key);
  },

  /**
   * 主按钮：按当前上下文执行唯一一个动作。
   * 四种上下文由 pickVM 决定，按钮文案与行为必须一一对应，
   * 不允许「文案说拿取、实际在扣筹码」这类错配。
   */
  onConfirmTake() {
    const s = this.state;
    if (!s || s.current !== this.mySeat || s.gameOver) return;
    const pick = this.data.pick;
    if (!pick) return;

    // ① 退还筹码：攒够 pendingDiscard 枚才提交
    if (pick.mode === 'discard') {
      const plan = this.ui.discardPlan || [];
      if (plan.length !== s.pendingDiscard) {
        this.refresh('还差 ' + (s.pendingDiscard - plan.length) + ' 枚未选');
        return;
      }
      this.applyPlayerAction({ type: 'discard', gems: plan.slice() });
      return;
    }

    if (s.pendingDiscard > 0 || s.pendingNoble) return;

    // ② 卡牌详情打开时，主按钮就是购买 / 预留
    if (pick.mode === 'buy') {
      this.onBuyFromDetail();
      return;
    }
    if (pick.mode === 'reserve') {
      this.onReserveFromDetail();
      return;
    }

    // ③ 默认：确认拿取。二次校验不依赖上次渲染结果，轮询后库存变了也能拦住
    const sel = this.ui.selectedGems;
    const err = E.validateTake(s, sel);
    if (err || !this.data.canConfirm) {
      this.refresh(err || '请先选满筹码再确认');
      return;
    }
    this.applyPlayerAction({ type: 'take', gems: sel.slice() });
  },

  onCancelSelection() {
    this.ui.selectedGems = [];
    this.ui.discardPlan = [];
    this.ui.detail = null;
    this.refresh('已清除所选');
  },

  /**
   * 退还流程：点自己的筹码加入「本次退还」，攒够再确认。
   *
   * 官方规则（Splendor 规则书「Selecting Tokens」）：回合末持有 >10 枚时，
   * 玩家「可退还任意颜色的筹码，包含黄金」，直到只剩 10 枚为止，**不限颜色种类**。
   * 旧实现把「再点同色」当成撤回，等于强制玩家每色最多退 1 枚，是错的：
   * 手里 5 白 + 5 蓝、要退 3 枚时根本选不满。现在点一次加 1 枚（同色可累加，
   * 上限为该色持有量），撤回改由筹码上的「−」小按钮显式承担，两种操作不再争抢
   * 同一个点击。（规则以官方最新规则书为准）
   */
  onTapDiscardPlan(event) {
    const s = this.state;
    if (!s || s.current !== this.mySeat || s.pendingDiscard <= 0) return;
    const key = event.currentTarget.dataset.key;
    if (ALL.indexOf(key) < 0) return;                 // 只认 6 种合法筹码
    const plan = this.ui.discardPlan || [];
    if (plan.length >= s.pendingDiscard) {
      this.refresh('已选满 ' + s.pendingDiscard + ' 枚，点筹码上的「−」可撤回');
      return;
    }
    const held = s.players[this.mySeat].tokens[key] || 0;
    if (held - countIn(plan, key) <= 0) {
      this.refresh('该颜色已全部加入退还篮');
      return;
    }
    plan.push(key);
    this.ui.discardPlan = plan;
    this.refresh('');
  },

  /** 从退还篮撤回 1 枚（同色多枚时逐枚减）；与「再点同色累加」彻底解耦 */
  onRemoveDiscardPlan(event) {
    const s = this.state;
    if (!s || s.current !== this.mySeat || s.pendingDiscard <= 0) return;
    const key = event.currentTarget.dataset.key;
    const plan = this.ui.discardPlan || [];
    const at = plan.lastIndexOf(key);
    if (at < 0) return;
    plan.splice(at, 1);
    this.ui.discardPlan = plan;
    this.refresh('已撤回 1 枚' + (META[key] ? META[key].label : key));
  },

  onPass() {
    if (this.state.current !== this.mySeat || this.state.gameOver || this.state.pendingDiscard > 0) return;
    this.applyPlayerAction({ type: 'pass' }, '跳过本回合');
  },

  /** 多贵族同时满足：本机席位挑选 1 张（点击弹层里的贵族牌） */
  onChooseNoble(event) {
    const s = this.state;
    if (!s || !s.pendingNoble || s.gameOver) return;
    if (s.pendingNoble.seat !== this.mySeat) return;
    const id = event.currentTarget.dataset.id;
    if (!id || s.pendingNoble.options.indexOf(id) < 0) {
      this.refresh('请从可选的贵族中挑选');
      return;
    }
    let noble = null;
    for (let i = 0; i < s.nobles.length; i++) {
      if (s.nobles[i].id === id) { noble = s.nobles[i]; break; }
    }
    if (!noble) return;
    this.applyPlayerAction({
      type: 'chooseNoble',
      id: id,
      noble: { id: noble.id, title: noble.title, points: noble.points, req: noble.req }
    });
  },

  /** 退还模式下点击自己的筹码：加入退还暂存（攒够再确认），点已选的则撤回 */
  onTapMyToken(event) {
    const s = this.state;
    if (s.current !== this.mySeat || s.pendingDiscard <= 0) return;
    this.onTapDiscardPlan(event);
  },

  onTapCard(event) {
    const s = this.state;
    if (!s || s.pendingDiscard > 0) {
      haptic('medium');
      this.refresh('请先退还超出上限的筹码');
      return;
    }
    const lv = Number(event.currentTarget.dataset.lv);
    const index = Number(event.currentTarget.dataset.index);
    if (!s.board[lv] || !s.board[lv][index]) return;
    haptic('light');
    this.ui.nobleDetailId = '';
    this.ui.detail = { kind: 'board', lv: lv, index: index, key: '' };
    this.ui.showReserved = false;
    this.refresh('');
  },

  onTapReservedCard(event) {
    const s = this.state;
    const index = Number(event.currentTarget.dataset.index);
    if (!s || !s.players[this.mySeat].reserved[index]) return;
    // 预留卡随时可点开看明细；能否购买由弹层按钮的 canAct 决定
    this.ui.detail = { kind: 'reserved', lv: -1, index: index, key: '' };
    this.ui.showReserved = false;
    this.refresh('');
  },

  onBuyFromDetail() {
    const d = this.ui.detail;
    if (!d || !this.data.detail || !this.data.detail.canBuy || !this.data.detail.canAct) return;
    const action = d.kind === 'board'
      ? { type: 'buyBoard', lv: d.lv, index: d.index }
      : { type: 'buyReserved', index: d.index };
    this.applyPlayerAction(action);
  },

  onReserveFromDetail() {
    const d = this.ui.detail;
    if (!d || d.kind !== 'board' || !this.data.detail) return;
    if (!this.data.detail.canReserve || !this.data.detail.canAct) return;
    this.applyPlayerAction({ type: 'reserveBoard', lv: d.lv, index: d.index });
  },

  onCloseDetail() {
    this.ui.detail = null;
    this.refresh('');
  },

  onTapNoble(event) {
    const id = event && event.currentTarget && event.currentTarget.dataset.id;
    if (!this.state || !id) return;
    this.ui.nobleDetailId = id;
    this.refresh('');
  },

  onCloseNobleDetail() {
    this.ui.nobleDetailId = '';
    this.refresh('');
  },

  onTapDeck(event) {
    const s = this.state;
    if (s.current !== this.mySeat || s.gameOver || s.pendingDiscard > 0) {
      this.refresh('现在不是你的行动阶段');
      return;
    }
    const lv = Number(event.currentTarget.dataset.lv);
    if (!s.decks[lv] || s.decks[lv].length === 0) {
      this.refresh('该级牌库已空');
      return;
    }
    if (s.players[this.mySeat].reserved.length >= 3) {
      this.refresh('最多只能预留 3 张卡牌');
      return;
    }
    const that = this;
    wx.showModal({
      title: '预留牌库顶',
      content: '从' + D.DECK_META[lv].name + '（剩 ' + s.decks[lv].length + ' 张）盲抽 1 张加入预留区，并获得 1 枚黄金筹码。',
      confirmText: '预留',
      cancelText: '取消',
      success(res) {
        if (res.confirm) that.applyPlayerAction({ type: 'reserveDeck', lv: lv });
      }
    });
  },

  onShowRules() {
    this.ui.showRules = true;
    this.refresh('');
  },
  onCloseRules() {
    this.ui.showRules = false;
    this.refresh('');
  },
  onTapReservedSlot() {
    this.refresh('预留位：点桌面卡牌或左侧牌库即可预留，最多 3 张');
  },

  onShowReserved() {
    this.ui.showReserved = true;
    this.refresh('');
  },
  onCloseReserved() {
    this.ui.showReserved = false;
    this.refresh('');
  },

  onRestart() {
    // 人机对战直接重开；房间牌局回到大厅重新准备，避免多端状态错位
    if (this.mode === 'room' && this.room) {
      this.backToLobby();
      return;
    }
    const solo = this.ui.soloCount;
    const roomCount = this.ui.roomCount;
    const menuX = this.ui.menuX;
    const menuY = this.ui.menuY;
    this.ui = freshUI({
      screen: 'game',
      soloCount: solo,
      roomCount: roomCount,
      playerCount: this.ui.playerCount,
      bots: { 1: true, 2: true, 3: true },
      menuX: menuX,
      menuY: menuY
    });
    this.startLocalGame();
  },

  /* ---------- 入口界面：人机对战 / 邀请好友 ---------- */

  /** 首屏只放三条主操作；人数 / 计时 / 房间号按需展开。 */
  onOpenHomeDialog(event) {
    const kind = event.currentTarget.dataset.kind;
    if (this.ui.screen !== 'home' || ['solo', 'create', 'join'].indexOf(kind) < 0) return;
    this.ui.homeDialogBefore = {
      soloCount: this.ui.soloCount,
      roomCount: this.ui.roomCount,
      turnLimit: this.ui.turnLimit,
      roomThemeId: this.ui.roomThemeId
    };
    this.ui.homeDialog = kind;
    this.ui.homeNotice = '';
    this.refresh('');
  },

  /**
   * 快速开始：先选人数再开局。
   *
   * 上一版点一下就用 ui.soloCount（对局设置里的默认值）直接开局，
   * 首屏没有任何地方能改人数，等于把 2/3/4 人的选择藏进了一个二级弹层。
   * 这里单独开一个只含人数的弹层，点人数即开局，少一次「保存」。
   */
  onQuickStart() {
    if (this.ui.screen !== 'home') return;
    this.ui.homeDialogBefore = {
      soloCount: this.ui.soloCount,
      roomCount: this.ui.roomCount,
      turnLimit: this.ui.turnLimit
    };
    this.ui.homeDialog = 'quick';
    this.ui.homeNotice = '';
    this.refresh('');
  },

  /** 快速开始弹层里点人数：直接以该人数开局（保留为下次默认） */
  onPickSoloSeats(event) {
    const n = Number(event.currentTarget.dataset.n);
    if (n < 2 || n > 4) return;
    this.ui.soloCount = n;
    this.onStartSolo();
  },

  onCloseHomeDialog() {
    // 取消 / 点遮罩不提交设置；只有保存或创建房间才保留选择。
    if (this.ui.homeDialogBefore) Object.assign(this.ui, this.ui.homeDialogBefore);
    this.ui.homeDialogBefore = null;
    this.ui.homeDialog = '';
    this.ui.homeNotice = '';
    this.refresh('');
  },
  onSaveHomeSettings() {
    if (this.ui.homeDialog !== 'solo') return;
    this.ui.homeDialogBefore = null;
    this.ui.homeDialog = '';
    this.ui.homeNotice = '';
    this.refresh('');
  },

  onSelectRoomTheme(event) {
    if (this.ui.screen !== 'home' || this.ui.homeDialog !== 'create') return;
    const id = event.currentTarget.dataset.id;
    if (!T.selectable(id)) return;
    this.ui.roomThemeId = id;
    this.refresh('');
  },

  onRetryCreateRoom() {
    if (!this.room || this.mySeat !== 0 || this.ui.roomCreating || !this.ui.roomCreateFailed) return;
    const that = this;
    const code = this.room.code;
    const ownerUid = this.profile.uid;
    this.ui.roomCreating = true;
    this.refresh('正在确认房间状态…');
    // A failed response may follow an accepted write. Read before retrying so
    // an upsert cannot reset the version or overwrite members who already joined.
    return R.cloudPullRoom(code).then(function (res) {
      if (that._unloaded || that._cloudCode !== code || that.profile.uid !== ownerUid) return;
      if (res.ok && res.room.hostUid === ownerUid && res.room.status !== 'ended') {
        that.room = Object.assign({}, res.room, { mode: 'room' });
        that._roomVersion = res.version;
        that.ui.roomCreating = false;
        that.ui.roomCreateFailed = false;
        that.ui.roomNotice = '已恢复云端房间，主题与成员状态已同步';
        that.saveSession();
        that.startCloudPolling();
        that.refresh('');
        if (res.room.status === 'playing') that.enterCloudGame();
        return;
      }
      if (!res.ok && res.error === '云端未找到该房间') return that.createCloudRoom();
      that.ui.roomCreating = false;
      that.ui.roomNotice = res.ok ? '该房间已失效，请重新创建房间' : '暂时无法确认房间状态：' + res.error + '，请稍后重试';
      that.refresh('');
    });
  },

  onSelectSoloCount(event) {
    const n = Number(event.currentTarget.dataset.n);
    if (n < 2 || n > 4) return;
    this.ui.soloCount = n;
    this.refresh('');
  },
  onSelectRoomCount(event) {
    const n = Number(event.currentTarget.dataset.n);
    if (n < 2 || n > 4) return;
    this.ui.roomCount = n;
    this.refresh('');
  },

  /** 建房前选回合计时：10 / 30 / 60 / 90 / 120 秒，或不限时 */
  onSelectTurnLimit(event) {
    const raw = Number(event.currentTarget.dataset.value);
    if (!R.TURN_LIMITS.some(function (m) { return m.value === raw; })) return;
    this.ui.turnLimit = raw;
    // 选中态已经表达结果，不再重复发提示。
    this.refresh('');
  },

  /* ---------- 大厅：模式选择 / 战绩 ---------- */

  /** 选择对局模式；筹备中的模式给出明确说明，不做假入口 */
  onSelectMode(event) {
    const key = event.currentTarget.dataset.key;
    const mode = U.modeByKey(key);
    if (!mode.available) {
      this.ui.homeNotice = '「' + mode.name + '」还在筹备中，暂未开放';
      this.refresh('');
      return;
    }
    this.ui.lobbyMode = mode.key;
    this.ui.homeNotice = '';
    this.refresh('');
  },

  /** 更多玩法：未开放模式只做如实说明，不制造假入口 */
  onOpenMoreModes() {
    if (this.ui.screen !== 'home') return;
    this.ui.homeNotice = '轮抽模式与双人协作正在筹备中，敬请期待';
    this.refresh('');
  },

  /** 音效开关：只影响音效，不动音乐 */
  onToggleSfx() {
    const next = !Sound.isSfxMuted();
    Sound.setSfxMuted(!next);
    // 打开时立刻给一声，让玩家确认真的开了（静音时点了没反馈会以为失灵）
    if (next) Sound.play('tap');
    this.refresh('');
  },

  /**
   * 音乐开关。关掉立刻停；打开时按当前界面决定是否起播 ——
   * 房间准备层本来就不放 BGM，不该因为点了开关就强行响。
   */
  onToggleBgm() {
    const next = !Sound.isBgmMuted();
    Sound.setBgmMuted(!next);
    if (next && (this.ui.screen === 'home' || this.ui.screen === 'game')) {
      Sound.startBgm(this.ui.screen === 'game' ? 'board' : 'lobby');
    }
    this.refresh('');
  },

  /* ---------- 娱乐模式：开局增益 / 主动技能 ---------- */

  /** 开局选择增益：写入 state（随快照同步），机器人自动补齐，再继续 AI 流程 */
  onPickBuff(event) {
    if (!Ent.isEntertainment(this.state) || this.ui.buffPickOpen === false) return;
    const id = event && event.currentTarget && event.currentTarget.dataset.id;
    const r = Ent.applyBuff(this.state, this.mySeat || 0, id, Math.random);
    if (!r.ok) { this.refresh(r.error); return; }
    // 机器人席位各自自动选一个，避免它们没有增益（纯数据层保证守恒）
    const s = this.state;
    for (let i = 0; i < s.players.length; i++) {
      if (!s.players[i].isAI || s.entertainment.buffs[i]) continue;
      const pool = Ent.BUFFS;
      Ent.applyBuff(s, i, pool[Math.floor(Math.random() * pool.length)].id, Math.random);
    }
    this.ui.buffPickOpen = false;
    haptic('light');
    this.refresh('已获得增益 · ' + (r.detail || ''));
    this.pushCloudState();
    this.maybeRunAi({ ended: true });
  },

  /** 打开技能面板：仅本人回合、无待处理事项时可用 */
  onOpenSkillPanel() {
    if (!Ent.isEntertainment(this.state)) return;
    const s = this.state;
    if (s.gameOver || s.current !== this.mySeat || s.pendingDiscard > 0 || s.pendingNoble) {
      this.refresh('当前不能使用技能');
      return;
    }
    this.ui.menuOpen = false;
    this.ui.skillPanelOpen = true;
    this.ui.skillPending = null;
    this.ui.skillInfo = null;
    this.refresh('');
  },
  onCloseSkillPanel() {
    this.ui.skillPanelOpen = false;
    this.ui.skillPending = null;
    this.refresh('');
  },
  /** 选技能：两种技能都要选目标，进入目标选择态 */
  onSelectSkill(event) {
    if (!this.ui.skillPanelOpen) return;
    const id = event && event.currentTarget && event.currentTarget.dataset.id;
    const chk = Ent.canUseSkill(this.state, this.mySeat || 0, id);
    if (!chk.ok) { this.refresh(chk.error); return; }
    this.ui.skillPending = id;
    this.refresh('选择一名对手作为目标');
  },
  /** 选目标：执行引擎 skill action（消耗整回合），走统一同步链路 */
  onPickSkillTarget(event) {
    const id = this.ui.skillPending;
    if (!id || !this.ui.skillPanelOpen) return;
    const target = Number(event && event.currentTarget && event.currentTarget.dataset.seat);
    const chk = Ent.canUseSkill(this.state, this.mySeat || 0, id);
    if (!chk.ok) { this.refresh(chk.error); return; }
    const okDone = this.applyPlayerAction({ type: 'skill', skillId: id, target: target, rand: Math.random });
    if (okDone) {
      this.ui.skillPanelOpen = false;
      this.ui.skillPending = null;
      this.refresh('');
    }
  },
  /** 关闭技能结果提示（侦察战报） */
  onDismissSkillResult() {
    this.ui.skillResultInfo = null;
    this.refresh('');
  },
  onOpenRecords() {
    this.ui.showRecords = true;
    this.ui.recordsNotice = '';
    this.ui.showProfile = false;
    this.refresh('');
  },
  onCloseRecords() {
    this.ui.showRecords = false;
    this.refresh('');
  },
  /** 清空本机战绩；云端行不删，换设备登录后仍可拉回 */
  onClearRecords() {
    const that = this;
    if (typeof wx === 'undefined' || !wx.showModal) return;
    wx.showModal({
      title: '清空战绩',
      content: '只删除本机记录，云端战绩不受影响。确定清空？',
      confirmText: '清空',
      success: function (res) {
        if (!res.confirm) return;
        U.clearRecords();
        that.ui.recordsNotice = '本机战绩已清空';
        that.refresh('');
      }
    });
  },
  /** 人机对战：全部对手由机器人托管，不建房间、不发网络请求 */
  onStartSolo() {
    this.ui.homeDialogBefore = null;
    this.ui.homeDialog = '';
    this.ui.homeNotice = '';
    this.ui.playerCount = this.ui.soloCount || 2;
    this.ui.bots = { 1: true, 2: true, 3: true };
    this.startLocalGame();
  },
  /** 邀请好友：先开一间大厅，等好友入席并准备后再由房主开始 */
  onCreateRoom() {
    if (this.ui.screen !== 'home' || this.ui.roomCreating) return;
    if (R.requiresWechatLogin() && !U.wechatLoginStatus().authenticated) {
      this.ui.homeNotice = U.wechatLoginStatus().error || '请先完成微信登录';
      this.ui.homeDialog = 'create';
      this.refresh('');
      return;
    }
    this.ui.homeDialogBefore = null;
    this.ui.homeDialog = '';
    this.mode = 'room';
    this.ui.playerCount = this.ui.roomCount || 3;
    // 邀请模式默认所有外席位留给真人，房主可按需逐个改成机器人
    this.ui.bots = { 1: false, 2: false, 3: false };
    this.openRoom();
  },
  onJoinFromHome() {
    // 格式 / 连接错误留在输入框旁，关闭弹层后不残留到首屏。
    if (this.ui.screen === 'home') this.ui.homeDialog = 'join';
    const code = String(this.ui.joinCode || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      this.ui.homeNotice = '房间号为 6 位字母数字';
      this.refresh('');
      return;
    }
    if (!R.hasCloud()) {
      this.ui.homeNotice = R.requiresWechatLogin()
        ? (U.wechatLoginStatus().error || '请先完成微信登录')
        : '当前设备未连接云端，无法跨设备加入房间';
      this.refresh('');
      return;
    }
    this.joinCloudRoom(code);
  },
  onJoinRoom() { this.onJoinFromHome(); },

  /* ---------- 房间大厅：席位 / 准备 / 开局 / 微信邀请 ---------- */

  openRoom() {
    this.clearTimer();
    this.stopCloudPolling();
    this.resetCloudRequests();
    this.mySeat = 0;                       // 房主恒为 0 号席
    this._cloudVersion = 0;
    this._roomVersion = 0;
    const profile = this.profile || R.getProfile();
    const seats = R.makeSeats(this.ui.playerCount, this.ui.bots, profile);
    this.room = R.createRoom({
      playerCount: this.ui.playerCount,
      seats: seats,
      profile: profile,
      status: 'lobby',
      turnLimit: this.ui.turnLimit,
      themeId: this.ui.roomThemeId
    });
    this.ui.roomCreating = R.hasCloud();
    this.ui.roomCreateFailed = false;
    this.room.mode = 'room';
    this._cloudCode = this.room.code;
    this.ui.turnLimit = this.room.turnLimit;
    this.state = null;
    this.ui.screen = 'room';
    this.ui.showLobby = false;
    this.ui.homeNotice = '';
    this.ui.roomNotice = '';
    this.ui.selectedGems = [];
    this.ui.discardPlan = [];
    this.ui.detail = null;
    this.refresh('');
    if (R.hasCloud()) this.createCloudRoom();
  },

  /** 改人数时保留已入席的好友，其余按当前机器人设置重建 */
  rebuildSeats(n) {
    const profile = this.profile || R.getProfile();
    const base = R.makeSeats(n, this.ui.bots, profile);
    const old = (this.room && this.room.seats) || [];
    for (let i = 1; i < n; i++) {
      const o = old[i];
      if (o && o.joined && !o.isAI && o.uid) base[i] = Object.assign({}, o, { index: i });
    }
    return T.withRoomTheme(base, T.roomId(this.room));
  },

  updateCloudRoom(patch) {
    if (!R.hasCloud() || !this._cloudCode) return;
    const that = this;
    R.cloudUpdateRoom(this._cloudCode, patch, this._roomVersion || 1).then(function (res) {
      if (res.ok) { that._roomVersion = res.version; return; }
      if (res.conflict) { that.pollCloud(true); return; }
      if (!res.offline) {
        that.ui.roomNotice = '云端同步失败：' + res.error;
        that.refresh('');
      }
    });
  },

  onRoomCount(event) {
    if (this.mySeat !== 0) return;
    const n = Number(event.currentTarget.dataset.n);
    if (n < 2 || n > 4 || n === this.room.playerCount) return;
    this.ui.playerCount = n;
    const seats = this.rebuildSeats(n);
    this.room.seats = seats;
    this.room.playerCount = n;
    this.refresh('人数已改为 ' + n + ' 人');
    if (R.hasCloud()) this.updateCloudRoom({ player_count: n, seats: seats });
  },

  /** 大厅里也能改回合计时：房主改完全房间生效 */
  onRoomTurnLimit(event) {
    if (this.mySeat !== 0) return;
    const raw = Number(event.currentTarget.dataset.value);
    // 只接受 TURN_LIMITS 白名单：非法值直接忽略，不要静默降级成「不限时」
    if (!R.TURN_LIMITS.some(function (m) { return m.value === raw; })) return;
    if (raw === this.room.turnLimit) return;
    this.room.turnLimit = raw;
    this.ui.turnLimit = raw;
    this.refresh(raw > 0 ? '回合计时已改为 ' + raw + ' 秒' : '回合计时已改为不限时');
    if (R.hasCloud()) this.updateCloudRoom({ turn_limit: raw });
  },

  /** 真人准备 / 取消准备；房主视为已就绪，不参与准备开关 */
  onRoomToggleReady() {
    if (this.mySeat === 0) {
      this.ui.roomNotice = '房主视为已准备，人齐后直接点「开始牌局」';
      this.refresh('');
      return;
    }
    const seat = this.room && this.room.seats[this.mySeat];
    if (!seat) return;
    const next = !seat.ready;
    seat.ready = next;
    this.refresh(next ? '已准备，等待房主开始' : '已取消准备');
    if (!R.hasCloud()) return;
    const that = this;
    R.cloudSetSeat(this._cloudCode, this.mySeat, { ready: next }).then(function (res) {
      if (res.ok) { that._roomVersion = res.version; return; }
      if (res.conflict) { that.pollCloud(true); return; }
      if (!res.offline) {
        that.ui.roomNotice = '准备状态同步失败：' + res.error;
        that.refresh('');
      }
    });
  },

  /** 点整张席位卡：房主点空位 = 加机器人 / 点机器人 = 撤回；真人点自己 = 准备 */
  onRoomSeatTap(event) {
    const i = Number(event.currentTarget.dataset.index);
    if (!this.room || !this.room.seats[i]) return;
    if (i === this.mySeat) {
      this.onRoomToggleReady();
      return;
    }
    if (this.mySeat !== 0) {
      this.ui.roomNotice = '只有房主可以安排机器人';
      this.refresh('');
      return;
    }
    const seat = this.room.seats[i];
    if (seat.joined && !seat.isAI) {
      this.ui.roomNotice = '该席位已有好友，等他点「准备」';
      this.refresh('');
      return;
    }
    this.onRoomToggleBot({ currentTarget: { dataset: { index: i } } });
  },

  /** 房主把空席切成机器人 / 释放回好友席；已入席的好友不能被顶掉 */
  onRoomToggleBot(event) {
    if (this.mySeat !== 0) return;
    const i = Number(event.currentTarget.dataset.index);
    if (i <= 0 || !this.room || !this.room.seats[i]) return;
    const seat = this.room.seats[i];
    if (seat.joined && !seat.isAI) return;
    const next = !seat.isAI;
    this.ui.bots[i] = next;
    // 释放席位与「房主移出玩家」共用同一份空席口径，避免两处字段漂移
    this.room.seats[i] = next
      ? Object.assign({}, seat, {
          index: i,
          isAI: true, type: 'bot', joined: true, ready: true,
          uid: '', name: '机器人 ' + (i + 1), nickname: '机器人 ' + (i + 1),
          avatar: R.PRESET_AVATARS[i % R.PRESET_AVATARS.length].key, avatarUrl: ''
        })
      : R.vacantSeat(seat, i);
    this.ui.roomNotice = next
      ? '席位 ' + (i + 1) + ' 已交给机器人'
      : '席位 ' + (i + 1) + ' 已释放给好友';
    this.ui.toast = '';
    this.refresh('');
    if (!R.hasCloud()) return;
    const that = this;
    R.cloudSetSeat(this._cloudCode, i, this.room.seats[i]).then(function (res) {
      if (res.ok) { that._roomVersion = res.version; return; }
      if (res.conflict) { that.pollCloud(true); return; }
      if (!res.offline) { that.ui.roomNotice = res.error; that.refresh(''); }
    });
  },

  /**
   * 房主移出一位已入席真人（仅大厅态）。
   * ------------------------------------------------------------------
   * 二次确认 → 本机先释放席位（离线 / 浏览器预览也能用）→ 云端 CAS。
   * 云端拒绝时把本机席位回滚，并强制拉一次最新房间：否则房主看到
   * 「已移出」，其他人那边人还在，两边界面会长期不一致。
   */
  onRoomKick(event) {
    const i = Number(event.currentTarget.dataset.index);
    const room = this.room;
    if (!room || !room.seats[i] || i === 0) return;
    if (this.mySeat !== 0) {
      this.ui.roomNotice = '只有房主可以移出玩家';
      this.refresh('');
      return;
    }
    if ((room.status || 'lobby') !== 'lobby') {
      this.ui.roomNotice = '牌局进行中不能移出玩家';
      this.refresh('');
      return;
    }
    const seat = room.seats[i];
    if (seat.isAI || !seat.joined || !seat.uid) {
      this.ui.roomNotice = '该席位没有可移出的真人玩家';
      this.refresh('');
      return;
    }
    const that = this;
    const name = displayName(seat, '该玩家');
    const uid = String(seat.uid);
    const doKick = function () {
      const before = that.room && that.room.seats[i];
      if (!before || String(before.uid || '') !== uid) {
        that.ui.roomNotice = '席位已变化，请刷新后重试';
        that.refresh('');
        return;
      }
      that.room.seats[i] = R.vacantSeat(before, i);
      that.refresh('已移出 ' + name + ' · 席位已释放');
      if (!R.hasCloud() || !that._cloudCode) return;
      const callerUid = ((that.profile || R.getProfile()).uid) || '';
      R.cloudKickSeat(that._cloudCode, i, callerUid, uid).then(function (res) {
        if (res.ok) { that._roomVersion = res.version; return; }
        // 云端没落地就回滚，别让房主端显示一个别人看不到的空席
        if (that.room) that.room.seats[i] = before;
        that.ui.roomNotice = res.error || '移出失败，请重试';
        that.refresh('');
        if (res.conflict) that.pollCloud(true);
      });
    };
    if (typeof wx === 'undefined' || !wx.showModal) { doKick(); return; }
    wx.showModal({
      title: '移出该玩家？',
      content: name + ' 会被移出房间，席位释放为「等待加入」。对方仍可用房间号重新加入。',
      confirmText: '移出',
      cancelText: '取消',
      success: function (res) { if (res.confirm) doKick(); }
    });
  },

  /** 房主开始：所有席位（机器人或已准备真人）就绪才放行 */
  onRoomStart() {
    if (this.mySeat !== 0) {
      this.ui.roomNotice = '只有房主可以开始牌局';
      this.refresh('');
      return;
    }
    const vm = roomScreenVM(this.ui, this.room, this.profile, this.mySeat, this._avatars || {});
    if (!vm.canStart) {
      this.ui.roomNotice = vm.waitingReady > 0
        ? '还有 ' + vm.waitingReady + ' 位玩家未准备'
        : (vm.emptyCount > 0
          ? '还有 ' + vm.emptyCount + ' 个空席位，等好友加入或改成机器人'
          : '房间尚未就绪');
      this.refresh('');
      return;
    }
    this.beginRoomGame();
  },

  beginRoomGame() {
    this.clearTimer();
    const seats = (this.room.seats || []).map(function (s, i) {
      return Object.assign({}, s, { index: i, ready: true });
    });
    // 随机抽出本局 1 号位：联机局不再固定房主 0 号先动，否则后加入的人永远后手。
    // 抽中的人即 1 号位，号位沿座次顺延编号，行动恒从 1 号位起、到末位号位收尾结算。
    // 锚点写进 state 随快照下发，其他端直接读 startSeat / current，不各自抽签。
    this.state = E.createGame({
      playerCount: seats.length,
      seats: seats,
      firstSeat: R.randomFirstSeat(seats.length)
    });
    // 一局一条：房主生成一次，随快照下发，其他端不再各自生成。
    // 重连 / 跨设备拿到同一份 gameId 时按它去重，不会重复记一条战绩。
    this.state.gameId = newGameId();
    // 回合计时随房间配置下发，所有设备看到同一份限时
    this.state.turnLimit = R.normTurnLimit(this.room.turnLimit);
    this.state.themeId = T.roomId(this.room);
    // 娱乐模式由房主建房时选定，写进 state 随快照下发；其他端据此弹增益选择
    if (this.ui.lobbyMode === 'entertainment') {
      Ent.enable(this.state);
    }
    this.room.seats = seats;
    this.room.status = 'playing';
    this.room.playerCount = seats.length;
    this.ui.screen = 'game';
    this.ui.playerCount = seats.length;
    this.ui.detail = null;
    this.ui.nobleDetailId = '';
    this.ui.selectedGems = [];
    this.ui.discardPlan = [];
    this.ui.showLobby = false;
    this.ui.roomNotice = '';
    this.ui.toast = '';
    this._resultRecorded = false; this._gameStartedAt = Date.now();
    this.resetTurnUI();
    this.refresh('');
    this.saveSession();
    if (!R.hasCloud()) {
      this.maybeRunAi({ ended: true });
      return;
    }
    const that = this;
    R.cloudStartGame(this._cloudCode, this.state, this._roomVersion || 1, seats).then(function (res) {
      if (res.ok) {
        that._cloudVersion = res.gameVersion || 1;
      } else if (res.conflict) {
        that.ui.roomNotice = '房间状态刚被更新，请重试';
      } else if (!res.offline) {
        that.ui.roomNotice = '开局同步失败：' + res.error;
      }
      that.startCloudPolling();
      that.maybeRunAi({ ended: true });
    });
  },

  /** 一局结束后回大厅：房主重置房间，其他人等房主重开 */
  backToLobby() {
    this.clearTimer();
    this.resetTurnUI();
    if (this.mySeat !== 0) {
      const vm = roomScreenVM(this.ui, this.room, this.profile, this.mySeat, this._avatars || {});
      this.ui.roomNotice = '等房主回到房间并重新开局（' + vm.joinedHumans + ' 人已加入）';
      this.refresh('');
      return;
    }
    const seats = (this.room.seats || []).map(function (s, i) {
      return Object.assign({}, s, { index: i, ready: i === 0 || !!s.isAI });
    });
    this.room.seats = seats;
    this.room.status = 'lobby';
    this.state = null;
    this.ui.screen = 'room';
    this.ui.selectedGems = [];
    this.ui.discardPlan = [];
    this.ui.detail = null;
    this.ui.showReserved = false;
    this.ui.showPlayerDetail = false;
    this.ui.showLobby = false;
    this.refresh('回到房间，等所有玩家准备后重新开始');
    this.saveSession();
    if (!R.hasCloud()) return;
    const that = this;
    R.cloudResetRoom(this._cloudCode, seats, this._roomVersion || 1).then(function (res) {
      if (res.ok) {
        that._roomVersion = res.version;
        that._cloudVersion = 0;
      }
    });
    this.startCloudPolling();
  },

  /**
   * 切换「托管」：把本席位临时交给 AI 代打，人留在牌桌上。
   *
   * 与「投降」的区别：
   *  - 投降：离开牌局，席位转机器人，牌局继续；
   *  - 托管：**不退出**，席位仍是真人（`isAI` 不变），只是这一段时间不出牌，
   *    由房主设备按 `autoPlay` 代打，随时可以点回来自己接着打。
   *
   * 所以这里写的是 `players[seat].autoPlay`，而不是 `isAI`。
   * 写 `isAI` 会让玩家自己永久失去操作权（席位被当成机器人），那是投降的语义。
   */
  onToggleAutoPlay() {
    const s = this.state;
    if (!s || s.gameOver) return;
    if (this.ui.screen !== 'game') return;
    // 只有联机局需要托管：人机局本来就全是 AI，托管没有意义
    if (!(this.mode === 'room' && this.room)) {
      this.refresh('人机局无需托管');
      return;
    }
    const seat = this.mySeat || 0;
    const p = s.players[seat];
    if (!p) return;
    p.autoPlay = !p.autoPlay;
    // 托管时清掉本机的待确认选择，避免恢复后看见一堆过期选篮
    if (p.autoPlay) {
    this.ui.selectedGems = [];
    this.ui.discardPlan = [];
    this.ui.toast = '';
    this.ui.detail = null;
    this.ui.nobleDetailId = '';
    }
    this.ui.toast = '';
    this.refresh('');
    this.pushCloudState();
    // 托管时若正好轮到自己，立刻让 AI 走一手，不让别人干等
    if (p.autoPlay && s.current === seat) {
      const that = this;
      setTimeout(function () { that.runAi(true); }, 420);
    }
  },

  /**
   * 对局内「退出」：人机局＝放弃，联机局＝投降并转机器人托管。
   *
   * 为什么两种语义不同：
   *  - 人机局没有其他真人，直接收摊回大厅即可，牌局不必留存。
   *  - 联机局中途退出不能让牌局停摆（其他玩家还在等），所以把这个席位
   *    转成机器人继续打，其余玩家的体验才不被一个人拖住。
   *
   * 联机投降的关键约束：**只有房主负责推进托管**。
   * `needsAutoPlay` 在云端模式下对非房主返回 false，避免多台设备同时
   * 替同一个席位出牌。因此这里先改本地席位再推送快照：
   *  - 房主投降：自己仍是房主，推送后由本机（已回大厅但轮询仍在）继续托管；
   *  - 非房主投降：只能推送席位与快照，之后由房主的设备接管该席位。
   */
  onQuitGame() {
    const s = this.state;
    if (!s || this.ui.screen !== 'game') return;
    const isRoom = this.mode === 'room' && !!this.room;
    const that = this;

    const doQuit = function () {
      if (!isRoom) {
        // 人机局：放弃本局，回大厅。不写战绩（没打完就不算一场）。
        that.quitToHome('已放弃本局');
        return;
      }

      // 联机局：本席位转机器人托管，牌局继续
      const seat = that.mySeat || 0;
      const p = s.players[seat];
      if (p) {
        p.isAI = true;
        p.type = 'bot';
        p.joined = false;
        // 名字保留原昵称，玩家回来还能认出「这是谁在托管」；
        // 席位条会按 isAI 显示机器人语义
      }
      // 席位表同步一份，房间大厅里也显示为机器人
      if (that.room && that.room.seats && that.room.seats[seat]) {
        that.room.seats[seat].isAI = true;
        that.room.seats[seat].joined = false;
      }
      that.pushCloudState();
      if (R.hasCloud() && that._cloudCode) {
        R.cloudUpdateSeats(that._cloudCode, that.room.seats, that._roomVersion || 1)
          .then(function (res) { if (res.ok) that._roomVersion = res.version; });
      }
      that.quitToHome('已投降 · 该席位由机器人托管');
    };

    if (typeof wx === 'undefined' || !wx.showModal) { doQuit(); return; }
    wx.showModal({
      title: isRoom ? '投降并退出？' : '放弃本局？',
      content: isRoom
        ? '你的席位会交给机器人接管，牌局继续进行，其他玩家不受影响。'
        : '本局不会计入战绩，返回大厅后可重新开始。',
      confirmText: isRoom ? '投降' : '放弃',
      cancelText: '继续对局',
      success: function (res) { if (res.confirm) doQuit(); }
    });
  },

  /**
   * 收摊回大厅：停表、停轮询、作废会话，但不解散房间。
   * 与 `onLeaveRoom` 的区别是后者会 `cloudUpdateRoom({status:'ended'})` 解散房间，
   * 这里投降后牌局要留给其他玩家继续，所以只解除本机绑定。
   */
  quitToHome(message) {
    this.clearTimer();
    this.resetTurnUI();
    this.stopCloudPolling();
    this.stopChatPolling();
    this.resetCloudRequests();
    this.clearSession();
    this.state = null;
    this.room = null;
    this.mySeat = 0;
    this._cloudCode = '';
    this._cloudVersion = 0;
    this._roomVersion = 0;
    this.mode = 'solo';
    const solo = this.ui.soloCount;
    const roomCount = this.ui.roomCount;
    this.ui = freshUI({ screen: 'home', soloCount: solo, roomCount: roomCount });
    this.refresh(message || '已返回大厅');
  },

  /** 离开房间 / 退出当前牌局，统一回到首页 */
  onLeaveRoom() {    this.clearTimer();
    this.resetTurnUI();
    this.stopCloudPolling();
    this.stopChatPolling();
    this.resetCloudRequests();
    // 房主离开即解散：云上置 ended，其他设备轮询到就直接回首页，
    // 不会对着一个永远不会开始的房间一直等
    const disbandCode = (this.mySeat === 0 && this.mode === 'room') ? this._cloudCode : '';
    const disbandVersion = this._roomVersion || 1;
    if (disbandCode && R.hasCloud()) {
      R.cloudUpdateRoom(disbandCode, { status: 'ended' }, disbandVersion).then(function () {});
      // 牌局中离开：把快照写成 lobby 标记，其他设备先退回房间，再由房间 status=ended 送回家
      if (this.state && this.ui.screen === 'game') {
        R.cloudPushState(disbandCode, { lobby: true, ended: true }, this._cloudVersion || 1)
          .then(function () {});
      }
    }
    // 主动离开即作废会话，否则下次启动会被自动拉回这个房间
    this.clearSession();
    this.state = null;
    this.room = null;
    this.mySeat = 0;
    this._cloudCode = '';
    this._roomVersion = 0;
    this._cloudVersion = 0;
    const solo = this.ui.soloCount;
    const roomCount = this.ui.roomCount;
    this.ui = freshUI({ screen: 'home', soloCount: solo, roomCount: roomCount });
    this.refresh('已离开房间');
  },

  onOpenLobby() {
    this.ui.showLobby = true;
    this.ui.roomNotice = '';
    this.refresh('');
  },
  onCloseLobby() {
    this.ui.showLobby = false;
    this.refresh('');
  },
  onJoinCodeInput(event) {
    this.ui.joinCode = String((event.detail && event.detail.value) || '').toUpperCase();
  },
  onCopyRoomCode() {
    const code = this.room ? this.room.code : '';
    if (!code) return;
    if (typeof wx !== 'undefined' && wx.setClipboardData) {
      wx.setClipboardData({ data: code });
      this.refresh('房间号 ' + code + ' 已复制，发给好友即可邀请');
    } else {
      this.refresh('房间号 ' + code + ' · 请点右上「分享」发送给好友');
    }
  },
  /** 微信分享卡片带房间号；好友点击后由 onLoad 的 query.room 带入 */
  onShareAppMessage() {
    // 只有「邀请好友」房间才带房间号；人机对战 / 首页分享只做普通落地页
    if (!this.room || this.room.mode !== 'room') {
      return {
        title: '璀璨宝石 · 2–4 人文艺复兴珠宝商桌游',
        path: '/pages/index/index',
        imageUrl: ''
      };
    }
    return R.shareMessage(this.room, this.profile);
  },

  /* ---------- 玩家资料：合规的头像昵称填写 ---------- */

  /**
   * 把本机资料贴回「自己席位」的展示字段（昵称 / 预设头像 key）。
   * 只改展示字段，绝不碰 points / cards / tokens 等规则字段：牌局状态是联机
   * 共享的，资料不是；把资料带进快照只是为了让其他设备看得到名字。
   * 每次 refresh 前调用，天然覆盖「动作后 / 轮询后 / 重连后」所有替换 state
   * 的路径，不需要在每个 .then 里各补一次。
   */
  applySelfProfileToState() {
    const p = this.profile;
    const st = this.state;
    if (!p || !st || !st.players) return;
    const si = this.mySeat || 0;
    const me = st.players[si];
    const name = p.nickname || '珠宝商';
    if (me) {
      me.nickname = name;
      me.name = name;
      me.avatar = p.avatar || me.avatar;
    }
    const seat = this.room && this.room.seats && this.room.seats[si];
    if (seat) {
      seat.nickname = name;
      seat.name = name;
      seat.avatar = p.avatar || seat.avatar;
    }
  },

  onOpenProfile() {
    this.ui.profileDraft = Object.assign({}, this.profile);
    this.ui.profileNotice = '';
    this.ui.showProfile = true;
    this.refresh('');
  },
  onCloseProfile() {
    this.ui.showProfile = false;
    this.ui.profileDraft = null;
    this.refresh('');
  },
  onPickAvatar(event) {
    if (!this.ui.profileDraft) this.ui.profileDraft = Object.assign({}, this.profile);
    this.ui.profileDraft.avatar = event.currentTarget.dataset.key;
    this.ui.profileDraft.avatarUrl = '';
    this.refresh('');
  },
  onChooseAvatar(event) {
    // 真机：button open-type="chooseAvatar" 返回临时头像路径；
    // 预览环境没有该能力，退回预设头像并明确提示。
    if (!this.ui.profileDraft) this.ui.profileDraft = Object.assign({}, this.profile);
    const url = event.detail && event.detail.avatarUrl;
    if (!url) {
      this.ui.profileNotice = '当前环境无法调起微信头像选择，请点选下方预设头像';
      this.refresh('');
      return;
    }
    this.ui.profileDraft.avatarUrl = url;
    this.refresh('已选择微信头像，点「保存资料」生效');
  },
  onNicknameInput(event) {
    if (!this.ui.profileDraft) this.ui.profileDraft = Object.assign({}, this.profile);
    // 输入过程不重绘，避免输入框失焦；保存时统一读取草稿
    this.ui.profileDraft.nickname = String((event.detail && event.detail.value) || '').slice(0, 12);
  },
  onPickNickname(event) {
    if (!this.ui.profileDraft) this.ui.profileDraft = Object.assign({}, this.profile);
    this.ui.profileDraft.nickname = event.currentTarget.dataset.name;
    this.refresh('');
  },
  onSaveProfile() {
    const ownerUid = this.profile.uid;
    const d = this.ui.profileDraft || {};
    const nickname = String(d.nickname || '').trim().slice(0, 12);
    if (!nickname) {
      this.ui.profileNotice = '请填写昵称';
      this.refresh('');
      return;
    }
    const that = this;
    const oldUrl = this.profile.avatarUrl || '';
    const oldData = this.profile.avatarData || '';
    const wantCustom = !!d.avatarUrl;
    // 只有「本次真的换了新头像」才压缩。旧实现用 `!!d.avatarUrl` 判断：资料里
    // 只要存过一张头像，连改个昵称都要重跑图片压缩；而 Promise 链没有 catch，
    // 压缩一失败整个保存就静默失效 —— 这是「对局中改昵称不生效」的第二个根因。
    const ready = !wantCustom
      ? Promise.resolve({ avatarUrl: '', avatarData: '' })   // 选预设头像：清掉自定义图
      : (d.avatarUrl === oldUrl
        ? Promise.resolve({ avatarUrl: oldUrl, avatarData: oldData })
        : U.prepareAvatar(d.avatarUrl, ownerUid).catch(function () {
          // 压缩失败不能拖死昵称保存：沿用原图，界面照常更新并如实提示
          return { avatarUrl: oldUrl, avatarData: oldData, degraded: true };
        }));

    ready.then(function (av) {
      if (that._unloaded || that.profile.uid !== ownerUid || R.getProfile().uid !== ownerUid) return;
      that.profile = R.saveProfile({
        nickname: nickname,
        avatar: d.avatar || that.profile.avatar,
        avatarUrl: av.avatarUrl,
        avatarData: av.avatarData
      });
      // 自己的头像以本机为准；让 uid 签名失效，触发一次资料重拉（别人才看得到新头像）
      if (!that._avatars) that._avatars = {};
      if (that.profile.uid) {
        that._avatars[that.profile.uid] = that.profile.avatarUrl || that.profile.avatarData || '';
      }
      that._avatarSig = '';
      U.syncProfile(that.profile);
      // 三态统一：展示资料立即贴回自己席位（含结算排名表与聊天昵称的数据源）
      that.applySelfProfileToState();
      // 联机房间席位表在牌桌里也要更新，旧版只在 screen === 'room' 时写。
      if (that.room && R.hasCloud()) that.updateCloudRoom({ seats: that.room.seats });
      // 牌桌阶段必须把带新昵称的快照推上云：不推，别人永远停在旧名；
      // 本机下一轮轮询拉回旧快照，也会把刚改的名字覆盖回去。
      if (that.ui.screen === 'game' && that._cloudCode && R.hasCloud()) that.pushCloudState();
      that.ui.showProfile = false;
      that.ui.profileDraft = null;
      that.refresh(av.degraded
        ? '资料已保存 · 头像压缩失败，沿用原图'
        : '资料已保存 · ' + nickname);
    }).catch(function () {
      // 兜底：存储异常不再静默吞掉，明确反馈给用户
      that.ui.profileNotice = '保存失败，请重试';
      if (that.ui) that.refresh('');
    });
  },

  /* ---------- 点击玩家头像查看详情 ---------- */

  onTapPlayer(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!this.state || !this.state.players[index]) return;
    this.ui.detailSeat = index;
    this.ui.showPlayerDetail = true;
    this.refresh('');
  },
  onClosePlayerDetail() {
    this.ui.showPlayerDetail = false;
    this.ui.detailSeat = -1;
    this.refresh('');
  },
  onTapMyPortrait() {
    this.onOpenProfile();
  },

  noop() {}
}));
