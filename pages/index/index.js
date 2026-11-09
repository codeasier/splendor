'use strict';

const D = require('../../utils/game-data.js');
const E = require('../../utils/game-engine.js');
const AI = require('../../utils/ai.js');
const R = require('../../utils/room.js');
const U = require('../../utils/user.js');

// 设计稿舞台尺寸（与参考截图比例一致），运行时等比缩放适配屏幕
const DESIGN_W = 1080;
const DESIGN_H = 560;
const GEMS = D.GEMS;
const ALL = D.ALL_TOKENS;
const META = D.GEM_META;
// 终局线：声望达到 15 触发最后一轮。界面按真实数值渲染，不在此截断
const FINAL_POINTS = 15;

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
    name: card.name,
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
      wide: num >= 10, light: g === 'white',
      // 方形卡左侧竖色条（sq-*）与圆形筹码共用同一套色序，但形状/色标不同
      sqClass: 'sq-' + g,
      label: META[g].label, gemClass: 'gem-' + g
    };
  });
  const tokens = ALL.map(function (g) {
    const num = p.tokens[g] || 0;
    return {
      key: g, num: num, numText: String(num), zero: num === 0,
      wide: num >= 10, light: g === 'white', isGold: g === 'gold',
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
    out.title = plan.length ? '本次退还：' + gemsText(tallyGems(plan)) : '点击下方自己的筹码选择要退还的筹码';
    out.lines = [];
    out.gain = gainColumns([], 0);
    out.hasGain = plan.length > 0;
    out.items = tallyGems(plan).map(function (it) {
      it.negative = true;
      it.sign = '−' + it.count;
      return it;
    });
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
    const canAct = !state.pendingNoble;
    if (d.kind === 'board') {
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
        out.title = card.name + ' · 实付 ' + paid + ' 枚' + (pay.gold ? '（含黄金 ' + pay.gold + ' 枚）' : '');
        out.lines = paidLines.map(function (l) {
          l.sign = '−' + l.count;
          l.negative = true;
          return l;
        });
        out.items = paidLines;
        out.goldLine = pay.gold ? '黄金替代 ' + pay.gold + ' 枚（缺口用万能筹码补足）' : '';
        out.fromText = String(total);
        out.toText = String(total - paid);
        out.delta = -paid;
        out.label = '购买此卡';
        out.canSubmit = canAct;
        out.reason = canAct ? '' : '先挑选到访的贵族';
        return out;
      }
    }
    const slotsLeft = 3 - p.reserved.length;
    const getGold = state.bank.gold > 0 ? 1 : 0;
    out.mode = 'reserve';
    out.kind = '预留卡牌';
    out.title = card.name + ' · 预留后名额 ' + (p.reserved.length + 1) + '/3';
    out.lines = [{ key: 'gold', label: '黄金', count: getGold, gemClass: 'gem-gold', isGold: true, sign: '+' + getGold, positive: true }];
    out.items = getGold ? out.lines : [];
    out.goldLine = getGold ? '预留附赠 1 枚黄金万能筹码' : '银行黄金已发完，本次预留不再附赠黄金';
    out.fromText = String(total);
    out.toText = String(total + getGold);
    out.delta = getGold;
    out.label = '确认预留';
    out.canSubmit = canAct && slotsLeft > 0 && d.kind === 'board';
    out.reason = slotsLeft <= 0 ? '预留位已满（3/3），先购买或放弃一张' : (canAct ? '' : '先挑选到访的贵族');
    return out;
  }

  // ④ 默认：本次拿取筹码
  out.title = sel.length ? '本次拿取：' + gemsText(tallyGems(sel)) : '未选择筹码';
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
      light: g === 'white',
      sqClass: 'sq-' + g,
      gemClass: 'gem-' + g
    };
  });
  const tokenRow = ALL.map(function (g) {
    const num = p.tokens[g] || 0;
    return {
      key: g, numText: String(num), zero: num === 0, wide: num >= 10,
      light: g === 'white', isGold: g === 'gold', gemClass: 'gem-' + g
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
function seatVM(state, index, room, selfSeat, avatars) {
  const p = state.players[index];
  const s = (room && room.seats && room.seats[index]) || {};
  const uid = p.uid || s.uid || '';
  const avatar = p.avatar || s.avatar || 'a0';
  const isSelf = index === (selfSeat || 0);
  const type = p.type || (p.isAI ? 'bot' : 'human');
  const seatNo = index + 1;
  const name = p.nickname || p.name || ('玩家 ' + seatNo);
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
    isCurrent: isCurrent,
    // 「行动中」文字与青色边框同时表达，只靠边框在小屏上会被误读成选中态
    turnTag: isCurrent ? '行动中' : '',
    // 起始玩家（0 号位）与当前行动者是两种身份，用不同标记区分
    isFirst: index === 0,
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
    return { id: n.id, title: n.title, points: n.points, reqs: nobleReqs(n) };
  });
  // 预留卡按「卡面」呈现：插画 / 购买所需筹码 / 声望，与桌面上的牌完全一致
  const reserved = p.reserved.map(function (c) {
    return {
      id: c.id,
      name: c.name,
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
    isBot: seat.isBot,
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

/**
 * 游戏大厅：玩家档案（身份 / 称号 / 战绩三格 / 最近对局）+ 模式选择 + 两条入口。
 * 首页不再只是「两个按钮」，而是玩家每次回来的落地页，所以统计信息必须一眼可见。
 */
function lobbyVM(ui, profile) {
  function counts(active, key) {
    return [2, 3, 4].map(function (n) {
      return { n: n, key: key, label: n + ' 人', active: active === n };
    });
  }
  const solo = ui.soloCount || 2;
  const room = ui.roomCount || 3;
  const cloud = R.hasCloud();
  const stats = U.statsOf();
  const identity = U.getIdentity();
  const activeMode = ui.lobbyMode || 'standard';
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
    nickname: (profile && profile.nickname) || '珠宝商',
    initial: ((profile && profile.nickname) || '珠宝商').slice(0, 1),
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
    modes: U.listModes(activeMode),
    modeHint: U.modeByKey(activeMode).desc,
    soloCount: solo,
    roomCount: room,
    soloCounts: counts(solo, 'solo'),
    roomCounts: counts(room, 'room'),
    turnLimits: timer.list,
    turnLimit: timer.value,
    turnLimitText: timer.text,
    cloud: cloud,
    cloudText: cloud
      ? '云端已连接 · 可微信邀请好友跨设备加入'
      : '本机模式 · 人机对战可玩；跨设备邀请需连接云端',
    joinCode: ui.joinCode || '',
    notice: ui.homeNotice || ''
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
        ? ((profile && profile.nickname) || '珠宝商')
        : (s.nickname || s.name || (isBot ? '机器人 ' + (i + 1) : '等待好友')),
      initial: String(isSelf
        ? ((profile && profile.nickname) || '珠宝商')
        : (s.nickname || s.name || (isBot ? '机器人' : '+'))).slice(0, 1),
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
    canStart: isHost && allSettled,
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
  const stats = U.statsOf();
  return {
    nickname: draft.nickname || '',
    avatarUrl: draft.avatarUrl || '',
    avatarName: draft.avatarUrl ? '微信头像' : R.avatarName(draft.avatar),
    avatars: avatars,
    nicknames: ['珠宝商', '宝石收藏家', '贸易行会', '威尼斯商人'],
    isWechat: !!p.isWechat,
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

  return {
    kind: d.kind,
    lv: d.lv,
    index: d.index,
    card: cardVM(state, card, s),
    costLines: costLines,
    summary: summary,
    canBuy: !!pay,
    // 只有轮到自己且不在退还筹码阶段，按钮才真正可点；否则仍可查看卡片明细
    canAct: state.current === s && !state.gameOver && state.pendingDiscard === 0,
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
  const actorName = p.nickname || p.name || ('玩家 ' + (actorSeat + 1));

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
      title: actorName + ' 购入了「' + card.name + '」',
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
        : (actorName + ' 预留了「' + card.name + '」'),
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
      title: actorName + ' 迎来贵族「' + noble.title + '」',
      subtitle: '声望 +3 · 贵族牌离开桌面',
      card: null,
      nobleVM: {
        title: noble.title,
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
    urgent: on && left <= 10
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
  const canNativeAvatar = !!(typeof wx !== 'undefined' && wx.canIUse &&
    wx.canIUse('button.open-type.chooseAvatar'));

  if (screen !== 'game' || !state) {
    return {
      stageScale: layout.scale,
      stageRotate: layout.rotate,
      topRightTop: layout.topRight || 10,
      screen: screen,
      home: lobbyVM(ui, profile),
      roomScreen: roomScreenVM(ui, room, profile, seat, avatars),
      profileDialog: profileVM(ui, profile),
      records: recordsVM(ui),
      showRecords: !!ui.showRecords,
      showProfile: !!ui.showProfile,
      showRules: !!ui.showRules,
      showReserved: false,
      showLobby: false,
      showPlayerDetail: false,
      playerDetail: null,
      canUseNativeAvatar: canNativeAvatar,
      toast: ui.toast || '',
      meName: (profile && profile.nickname) || '珠宝商',
      meAvatarHue: avatarHue((profile && profile.avatar) || 'a0'),
      playerCount: (room && room.playerCount) || ui.playerCount || 2,
      roomCode: room ? room.code : '',
      roomMode: !!(room && room.mode === 'room'),
      roomBackend: room && room.backend === 'cloud' ? '云端同步' : '本机房间',
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
      gameOver: false,
      isMyTurn: false,
      needDiscard: false,
      discardCount: 0,
      selectionCount: 0,
      canConfirm: false,
      canPass: false,
      pickHint: '',
      pick: {
        mode: 'take', kind: '拿取筹码', title: '', lines: [], items: [], gain: [],
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
      showcaseList: [],
      turnFlash: null,
      turnClock: { on: false, text: '', left: 0, total: 0, pct: 0, urgent: false },
      nobleChoice: null,
      meSeatNo: seat + 1,
      meSeatLabel: (seat + 1) + ' 号位',
      me: { name: '', points: 0, totalTokens: 0, reservedCount: 0, tokens: [], discounts: [], discountCells: [] },
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
      disabled: g === 'gold' || count <= 0 || !isMyTurn || needDiscard
    };
  });

  const isCompactNobles = state.nobles.length > 3;
  const nobles = state.nobles.map(function (n, i) {
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
      title: n.title,
      points: n.points,
      artClass: 'noble-art-' + (i % 3),
      photoClass: 'noble-photo-' + (i % 10),
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
    const pnSeat = pn.seat + 1;
    const pnActor = state.players[pn.seat] || {};
    const options = [];
    for (let oi = 0; oi < pn.options.length; oi++) {
      for (let ni = 0; ni < state.nobles.length; ni++) {
        const n = state.nobles[ni];
        if (n.id !== pn.options[oi]) continue;
        const slot = nobleSlot(n);
        options.push({
          id: n.id,
          title: n.title,
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
      name: pnActor.nickname || pnActor.name || ('玩家 ' + pnSeat),
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
    pickHint = '等待 ' + (state.current + 1) + ' 号位行动 · 可查看牌面与库存';
  } else if (needDiscard) {
    pickHint = '点击自己的筹码加入退还篮，攒够 ' + state.pendingDiscard + ' 枚再确认';
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
      text: last,
      // 系统消息（开局 / 结算 / 退还提示）与「上一手」用不同权重，避免混为一谈
      sys: /对局开始|对局结束|请退还|提前结算/.test(last)
    };
  }

  let statusText;
  if (state.gameOver) statusText = '对局结束';
  else if (state.pendingNoble) {
    statusText = state.pendingNoble.seat === seat
      ? '请挑选 1 张贵族'
      : (state.pendingNoble.seat + 1) + ' 号位 · 正在挑选贵族';
  } else if (needDiscard) statusText = '请退还筹码';
  else if (isMyTurn) statusText = '你的回合 · ' + (seat + 1) + ' 号位';
  else statusText = (state.current + 1) + ' 号位 · ' +
    (state.players[state.current].nickname || state.players[state.current].name) + ' 的回合';

  let resultTitle = '';
  let resultDetail = '';
  if (state.gameOver) {
    if (state.winner === -2) resultTitle = '平局';
    else if (state.winner === seat) resultTitle = '你赢了';
    else {
      const w = state.players[state.winner];
      resultTitle = w ? (w.nickname || w.name) + ' 获胜' : '对局结束';
    }
    const parts = [];
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      parts.push((p.nickname || p.name) + ' ' + p.points + ' 声望 / ' + p.cards.length + ' 卡');
    }
    resultDetail = parts.join('　|　') + '　·　共 ' + state.turnCount + ' 回合';
  }

  return {
    stageScale: layout.scale,
    stageRotate: layout.rotate,
    topRightTop: layout.topRight || 10,
    screen: 'game',
    home: lobbyVM(ui, profile),
    roomScreen: roomScreenVM(ui, room, profile, seat, avatars),
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
    // 对手卡定宽 200、间距 8：条宽由对手数算出，2 人局单卡不被拉满，
    // 3/4 人局 3 张刚好收在中央提示条（x=626）之前
    rivalStripWidth: rivals.length * 200 + Math.max(0, rivals.length - 1) * 8,
    seats: seats,
    playerCount: state.players.length,
    roomCode: room ? room.code : '',
    roomMode: !!(room && room.mode === 'room'),
    roomBackend: room && room.backend === 'cloud' ? '云端同步' : '本机房间',
    profileDialog: profileVM(ui, profile),
    playerDetail: ui.showPlayerDetail ? playerDetailVM(state, ui.detailSeat, room, seat, avatars) : null,
    showLobby: !!ui.showLobby,
    showPlayerDetail: !!ui.showPlayerDetail,
    showProfile: !!ui.showProfile,
    meName: (profile && profile.nickname) || me.nickname || me.name,
    meAvatarHue: avatarHue((profile && profile.avatar) || me.avatar || 'a0'),
    canUseNativeAvatar: canNativeAvatar,
    rival: {
      name: rival.name,
      points: rival.points,
      cardCount: rival.cards.length,
      reservedCount: rival.reserved.length,
      tokens: tokensVM(rival, GEMS)
    },
    me: {
      name: me.name,
      nameText: me.nickname || me.name,
      points: me.points,
      pointsText: String(me.points),
      // 声望达到终局线后不截断：显示真实值，只换成金色高亮
      pointsReached: me.points >= FINAL_POINTS,
      pointsDen: '/' + FINAL_POINTS,
      totalTokens: E.tokenTotal(me),
      tokenText: E.tokenTotal(me) + '/10',
      reservedCount: me.reserved.length,
      reservedText: me.reserved.length + '/3',
      tokens: tokensVM(me, ALL),
      discounts: discountsVM(state, seat),
      // 红利行固定 5 色，与筹码行逐列对齐
      discountCells: discountCellsVM(state, seat),
      // 工作台两行资源：同色同序（白蓝绿红黑 + 黄金末位），零值可读
      res: myResourceVM(state, seat)
    },
    reservedCards: reservedCards,
    emptyReservedSlots: emptyReservedSlots,
    mySeat: seat,
    statusText: statusText,
    // 铭牌宽度固定且右侧让位给计时块，长状态行（别人的昵称）降一档字号
    statusLong: statusText.length > 12,
    turnText: '第 ' + (Math.floor(state.turnCount / state.players.length) + 1) + ' 轮',
    logText: state.log.length ? state.log[state.log.length - 1] : '',
    // 上一手记录：单独一条，权重低于当前选择，不与确认区混排
    lastMove: lastMove,
    // 断线时用状态行提示重连进度，不额外占版面
    netNotice: ui.netNotice || '',
    hintText: hint,
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
    // 「跳过」是规则兜底，只在无合法动作时出现
    canPass: canPass,
    detail: detailVM(state, ui, seat),
    showRules: ui.showRules,
    showReserved: ui.showReserved,
    gameOver: state.gameOver,
    resultTitle: resultTitle,
    resultDetail: resultDetail,
    showcaseList: ui.showcase ? [ui.showcase] : [],
    // 回合切换的全屏提醒：进入 / 离开自己的回合各一次
    turnFlash: ui.turnFlash || null,
    turnClock: clockVM(state, ui),
    nobleChoice: nobleChoice,
    meSeatNo: seat + 1,
    meSeatLabel: (seat + 1) + ' 号位'
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
  return !!p && (p.isAI || (p.type === 'remote' && !p.joined));
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
    showRules: false,
    showReserved: false,
    // 大厅：选中的对局模式（当前只有 standard 可用）
    lobbyMode: 'standard',
    // 战绩弹层
    showRecords: false,
    recordsNotice: '',
    // 入口界面的两种模式人数
    soloCount: c.soloCount || 2,
    roomCount: c.roomCount || 3,
    // 回合计时（秒）：0 = 不限时；建房时选定
    turnLimit: R.normTurnLimit(c.turnLimit),
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
    turnFlash: null
  };
}

Page({
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
    this._resultRecorded = false;
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
    // 用户系统：确认本机身份（uid 持久化）；云端可用时把资料与战绩对齐一次
    U.ensureIdentity();
    if (R.hasCloud()) {
      const that = this;
      U.syncAll(this.profile).then(function (res) {
        // 云端补回了本机没有的战绩才重绘，否则这次刷新是多余的
        if (res && res.records && res.records.added > 0) that.refresh('');
      });
    }
    this.ui = freshUI({ screen: 'home' });

    // 微信分享卡片带 ?room=XXXXXX：有云端能力时直接入席，
    // 没有云端能力（浏览器预览）时留在首页并说明原因。
    const query = options || {};
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
    this._resultRecorded = false;
    this.resetTurnUI();
    this.refresh('');
    this.maybeRunAi({ ended: true });
  },

  /** 兼容旧调用：默认走人机对战 */
  startGame() { this.startLocalGame(); },

  onShow() {
    // 从后台切回时，若仍轮到托管席位则恢复其行动节奏
    if (this.state && !this.state.gameOver && needsAutoPlay(this.state, this.aiContext()) && !this._aiTimer) {
      this.scheduleAi();
    }
    this.startCloudPolling();
    if (this._cloudCode) {
      // 回前台立刻对齐一次版本，别等下一个轮询周期
      this.pollCloud(true);
    } else {
      // 冷启动 / 被系统回收后重进：按上次会话回到原房间原座位
      this.resumeSession();
    }
  },

  onHide() {
    this.clearTimer();
    this.stopClock();
    this.stopCloudPolling();
  },

  onUnload() {
    this.clearTimer();
    this.stopClock();
    this.stopCloudPolling();
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
  },

  /**
   * 结算时落一条战绩。
   * refresh() 在轮询（1.6s）与每次动作后都会调用，所以必须靠 _resultRecorded 幂等，
   * 否则结算弹层每重绘一次就会多记一条，胜率被自己刷歪。
   */
  maybeRecordResult() {
    const st = this.state;
    if (!st || !st.gameOver || this._resultRecorded) return;
    const players = st.players || [];
    if (!players.length) return;
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
      opponents.push((order[i].p.nickname || order[i].p.name) + ' ' + order[i].p.points);
    }
    this._resultRecorded = true;
    U.addRecord({
      mode: this.mode === 'room' ? 'room' : 'solo',
      playerCount: players.length,
      rank: rank,
      score: me.points,
      win: st.winner === seat,
      tie: st.winner === -2,
      turns: st.turnCount,
      at: Date.now(),
      roomCode: this._cloudCode || '',
      opponents: opponents
    }, this.profile);
  },

  refresh(toast) {
    // onLoad 期间的异步回调可能在 ui 初始化前返回
    if (!this.ui) return;
    // 先记账再渲染，保证回到大厅时战绩已是新的（addRecord 只写存储，不会递归）
    this.maybeRecordResult();
    // 换手检测要在渲染前做：全屏提醒与倒计时都由它重置
    this.syncTurnWatch();
    if (toast) this.ui.toast = toast;
    this.setData(buildViewModel(this.state, this.ui, this._layout, {
      room: this.room, profile: this.profile, mySeat: this.mySeat,
      avatars: this._avatars || {}
    }));
    // 席位里只有 uid：新面孔入席时补一次头像，能命中缓存就不发请求
    this.syncAvatars();
    this.startClock();
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
    const uids = [];
    function add(u) { if (u && uids.indexOf(u) < 0) uids.push(u); }
    ((this.room && this.room.seats) || []).forEach(function (s) { add(s && s.uid); });
    ((this.state && this.state.players) || []).forEach(function (p) { add(p && p.uid); });
    if (!uids.length) return;
    uids.sort();
    const sig = uids.join(',');
    if (sig === this._avatarSig) return;
    this._avatarSig = sig;
    U.fetchProfiles(uids).then(function (res) {
      if (!res || !res.map || !that.ui) return;
      let changed = false;
      Object.keys(res.map).forEach(function (uid) {
        const av = res.map[uid] && res.map[uid].avatarUrl;
        if (!av) return;
        if (that._avatars[uid] !== av) { that._avatars[uid] = av; changed = true; }
      });
      if (changed) that.refresh('');
    });
  },

  /* ---------- 回合：号位提醒 + 限时 ---------- */

  turnKeyOf(state) {
    if (!state) return '';
    return state.turnCount + ':' + state.current + ':' + (state.pendingDiscard > 0 ? 'd' : '');
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
    const seatNo = state.current + 1;
    const name = p.nickname || p.name || ('玩家 ' + seatNo);
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
    if (this._flashTimer) clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(function () {
      that._flashTimer = null;
      if (!that.ui) return;
      that.ui.turnFlash = null;
      that.refresh('');
    }, 1700);
  },

  /** 限时倒计时：每台设备按「自己看到换手的那一刻」起算，不依赖系统时钟对齐 */
  startClock() {
    if (this._clockTimer) return;
    if (this.ui.screen !== 'game') return;
    const st = this.state;
    if (!st || st.gameOver || !(Number(st.turnLimit) > 0)) return;
    const that = this;
    this._clockTimer = setInterval(function () { that.tickClock(); }, 500);
  },

  stopClock() {
    if (this._clockTimer) {
      clearInterval(this._clockTimer);
      this._clockTimer = null;
    }
  },

  /** 开新局 / 回大厅 / 离开房间：清掉上一局残留的计时与提醒 */
  resetTurnUI() {
    this.stopClock();
    this._turnKey = '';
    this._turnStartAt = 0;
    this._timeoutFired = false;
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
   * 超时托管。
   * 自己的回合：本机立刻代打，别让牌局卡在等一个人上。
   * 别人的回合：只有房主在宽限 12 秒后接管，避免两台设备同时替同一个人出牌。
   */
  onTurnTimeout() {
    if (this._timeoutFired) return;
    const st = this.state;
    if (!st || st.gameOver) return;
    const seat = this.mySeat || 0;
    const mine = st.current === seat;
    const actor = st.players[st.current] || {};
    if (!mine) {
      if (!R.hasCloud() || this.mySeat !== 0) return;
      if (actor.isAI) return;                        // AI 由房主正常托管，不走超时路径
      const over = Math.floor((Date.now() - (this._turnStartAt || Date.now())) / 1000) - (Number(st.turnLimit) || 0);
      if (over < 12) return;
    }
    this._timeoutFired = true;
    this.runAi(true, mine ? '超时 · 本回合已自动托管' : (actor.nickname || actor.name) + ' 超时 · 房主代为托管');
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
  handleRoomLost(reason) {
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
    this.ui.homeNotice = '房间已结束：' + (reason || '房主已解散或房间已过期');
    this.refresh('');
  },

  /* ---------- 云端牌局同步（浏览器预览下全部为空操作） ---------- */

  aiContext() {
    return { cloud: R.hasCloud(), isHost: this.mySeat === 0 };
  },

  createCloudRoom() {
    const that = this;
    // 大厅阶段不写牌局快照，等房主点「开始牌局」时再落 state，
    // 否则好友入席时会拿到一副还没开始的牌。
    return R.cloudCreateRoom(this.room, null).then(function (res) {
      if (res.ok) {
        that._roomVersion = res.version;
        that.saveSession();
        that.ui.roomNotice = '房间 ' + that.room.code + ' 已同步到云端，分享给好友即可跨设备加入';
        that.startCloudPolling();
      } else if (!res.offline) {
        that.ui.roomNotice = '云端同步不可用：' + res.error + '（本机房间仍可开局）';
      }
      that.refresh('');
    });
  },

  /** 好友通过分享卡片 / 房间号入席：进大厅准备，或接管进行中的牌局 */
  joinCloudRoom(code, opts) {
    const that = this;
    const silent = !!(opts && opts.silent);
    this._joining = true;
    this._resuming = !!(opts && opts.silent) || this._resuming;
    const tipText = (silent ? '正在重新连接房间 ' : '正在加入房间 ') + code + ' …';
    this.ui.roomNotice = tipText;
    this.ui.homeNotice = tipText;
    this.refresh('');
    return R.cloudJoinRoom(code, this.profile).then(function (res) {
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
        that.state = res.state;
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

  /** 房主开局后，其他设备轮询到 status=playing 时切入牌桌 */
  enterCloudGame() {
    if (this._enteringGame) return;
    this._enteringGame = true;
    const that = this;
    R.cloudPullGame(this._cloudCode).then(function (res) {
      that._enteringGame = false;
      if (!res.ok) return;         // 快照还没写完，下一轮轮询再试
      that.state = res.state;
      that._cloudVersion = res.version;
      // 进场不重放上一手：重连回来先看清牌面，再看别人下一步怎么走
      if (res.state && res.state.lastAction) that._seenActionId = res.state.lastAction.id;
      that.ui.screen = 'game';
      that.ui.playerCount = res.state.players.length;
      that.ui.detail = null;
      that.ui.selectedGems = [];
      that.ui.discardPlan = [];
      that._resultRecorded = false;
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
    const expected = this._cloudVersion;
    const snapshot = JSON.parse(JSON.stringify(this.state));
    this._syncing = true;
    R.cloudPushState(this._cloudCode, snapshot, expected).then(function (res) {
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

  /**
   * 云端没有实时订阅能力，用轮询 + version 比对实现同步：
   *   大厅 → 拉房间行（席位 / 准备 / status）
   *   牌桌 → 拉牌局快照（state / version）
   */
  pollCloud(force) {
    if (!R.hasCloud() || !this._cloudCode || this._polling) return;
    const that = this;

    if (this.ui.screen === 'room') {
      this._polling = true;
      R.cloudPullRoom(this._cloudCode).then(function (res) {
        that._polling = false;
        if (!res.ok) {
          // 房间行都不存在了：不是网络抖动，直接收摊
          if (/未找到/.test(res.error || '')) that.handleRoomLost(res.error);
          else that.noteNetFail(res);
          return;
        }
        that.noteNetOk();
        if (res.room.status === 'ended') { that.handleRoomLost('房主已解散房间'); return; }
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
      that.state = res.state;
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
    const s = this.state;
    if (!s || s.gameOver) return;
    if (!force && !needsAutoPlay(s, this.aiContext())) return;
    const actorSeat = s.current;
    const actor = s.players[actorSeat].nickname || s.players[actorSeat].name;
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
    const actorSeat = this.state ? this.state.current : 0;
    const card = this.actionCard(action, actorSeat);
    const nextSeq = (this._showcaseSeq = (this._showcaseSeq || 0) + 1);
    const preShowcase = buildActionShowcase(this.state, action, actorSeat, this.mySeat, nextSeq, card);
    const result = E.performAction(this.state, action);
    if (!result.ok) {
      this.refresh(result.error);
      return false;
    }
    if (preShowcase) this.ui.showcase = preShowcase;
    this.stampAction(action, card, actorSeat);
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
      this.refresh('黄金筹码只能通过「预留卡牌」获得');
      return;
    }
    if (s.bank[key] <= 0) {
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
      this.refresh('拿 2 枚同色筹码时，不能再拿其他颜色');
      return;
    } else if (sel.length === 0 || (sel.length === 1 && sel[0] === key)) {
      if (sel.length === 1 && s.bank[key] < 4) {
        this.refresh('该颜色剩余不足 4 枚，不能一次拿 2 枚');
        return;
      }
      sel.push(key);
    } else {
      if (sel.length >= 3) {
        this.refresh('一回合最多拿 3 枚筹码');
        return;
      }
      if (inSel > 0) {
        this.refresh('该色已在选篮里 · 点右侧「-」可放回 1 枚');
        return;
      }
      sel.push(key);
    }
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

  /** 退还流程：点自己的筹码把它加入「本次退还」，攒够再确认；满额后点已选的可撤回 */
  onTapDiscardPlan(event) {
    const s = this.state;
    if (!s || s.current !== this.mySeat || s.pendingDiscard <= 0) return;
    const key = event.currentTarget.dataset.key;
    const plan = this.ui.discardPlan || [];
    const at = plan.lastIndexOf(key);
    if (at >= 0) {
      plan.splice(at, 1);
      this.refresh('已撤回 1 枚' + (META[key] ? META[key].label : key));
      return;
    }
    if (plan.length >= s.pendingDiscard) {
      this.refresh('已选满 ' + s.pendingDiscard + ' 枚，点已选筹码可撤回');
      return;
    }
    if (s.players[this.mySeat].tokens[key] - countIn(plan, key) <= 0) {
      this.refresh('该颜色没有可退还的筹码');
      return;
    }
    plan.push(key);
    this.refresh('');
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
    if (s.current !== this.mySeat || s.gameOver || s.pendingDiscard > 0) {
      this.refresh('现在不是你的行动阶段');
      return;
    }
    const lv = Number(event.currentTarget.dataset.lv);
    const index = Number(event.currentTarget.dataset.index);
    if (!s.board[lv] || !s.board[lv][index]) return;
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
    this.ui = freshUI({
      screen: 'game',
      soloCount: solo,
      roomCount: roomCount,
      playerCount: this.ui.playerCount,
      bots: { 1: true, 2: true, 3: true }
    });
    this.startLocalGame();
  },

  /* ---------- 入口界面：人机对战 / 邀请好友 ---------- */

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

  /** 建房前选回合计时：60 / 90 / 120 秒，或不限时 */
  onSelectTurnLimit(event) {
    const raw = Number(event.currentTarget.dataset.value);
    if (!R.TURN_LIMITS.some(function (m) { return m.value === raw; })) return;
    this.ui.turnLimit = raw;
    this.refresh(raw > 0 ? '回合计时：' + raw + ' 秒' : '回合计时：不限时');
  },

  /* ---------- 大厅：模式选择 / 战绩 ---------- */

  /** 当前只开放标准模式，其余模式点一下给出明确说明，不做假入口 */
  onSelectMode(event) {
    const key = event.currentTarget.dataset.key;
    const mode = U.modeByKey(key);
    if (!mode.available) {
      this.ui.homeNotice = '「' + mode.name + '」还在筹备中，当前只开放标准模式';
      this.refresh('');
      return;
    }
    this.ui.lobbyMode = mode.key;
    this.ui.homeNotice = '';
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
    this.ui.playerCount = this.ui.soloCount || 2;
    this.ui.bots = { 1: true, 2: true, 3: true };
    this.startLocalGame();
  },
  /** 邀请好友：先开一间大厅，等好友入席并准备后再由房主开始 */
  onCreateRoom() {
    this.mode = 'room';
    this.ui.playerCount = this.ui.roomCount || 3;
    // 邀请模式默认所有外席位留给真人，房主可按需逐个改成机器人
    this.ui.bots = { 1: false, 2: false, 3: false };
    this.openRoom();
  },
  onJoinFromHome() {
    const code = String(this.ui.joinCode || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      this.ui.homeNotice = '房间号为 6 位字母数字';
      this.refresh('');
      return;
    }
    if (!R.hasCloud()) {
      this.ui.homeNotice = '当前设备未连接云端，无法跨设备加入房间';
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
      turnLimit: this.ui.turnLimit
    });
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
    return base;
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
    // 只接受 0 / 60 / 90 / 120：非法值直接忽略，不要静默降级成「不限时」
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
    this.room.seats[i] = Object.assign({}, seat, {
      index: i,
      isAI: next,
      type: next ? 'bot' : 'remote',
      joined: next,
      ready: next,
      uid: '',
      name: next ? '机器人 ' + (i + 1) : '等待加入',
      nickname: next ? ('机器人 ' + (i + 1)) : '',
      avatar: next ? R.PRESET_AVATARS[i % R.PRESET_AVATARS.length].key : '',
      avatarUrl: ''
    });
    this.refresh(next
      ? '席位 ' + (i + 1) + ' 已交给机器人'
      : '席位 ' + (i + 1) + ' 已释放给好友');
    if (!R.hasCloud()) return;
    const that = this;
    R.cloudSetSeat(this._cloudCode, i, this.room.seats[i]).then(function (res) {
      if (res.ok) { that._roomVersion = res.version; return; }
      if (res.conflict) { that.pollCloud(true); return; }
      if (!res.offline) { that.ui.roomNotice = res.error; that.refresh(''); }
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
    this.state = E.createGame({ playerCount: seats.length, seats: seats });
    // 回合计时随房间配置下发，所有设备看到同一份限时
    this.state.turnLimit = R.normTurnLimit(this.room.turnLimit);
    this.room.seats = seats;
    this.room.status = 'playing';
    this.room.playerCount = seats.length;
    this.ui.screen = 'game';
    this.ui.playerCount = seats.length;
    this.ui.detail = null;
    this.ui.selectedGems = [];
    this.ui.discardPlan = [];
    this.ui.showLobby = false;
    this.ui.roomNotice = '';
    this._resultRecorded = false;
    this.resetTurnUI();
    this.refresh('牌局开始 · ' + seats.length + ' 人');
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

  /** 离开房间 / 退出当前牌局，统一回到首页 */
  onLeaveRoom() {
    this.clearTimer();
    this.resetTurnUI();
    this.stopCloudPolling();
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
    this.ui.profileDraft.isWechat = true;
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
    const d = this.ui.profileDraft || {};
    const nickname = String(d.nickname || '').trim().slice(0, 12);
    if (!nickname) {
      this.ui.profileNotice = '请填写昵称';
      this.refresh('');
      return;
    }
    const hasNewAvatar = !!d.avatarUrl;
    // 换过头像才需要压缩：prepareAvatar 同时给出「本机文件路径」与「可上云的缩略图」，
    // 后者才是好友能看到的那个（本机路径发出去必然加载失败）。
    const ready = hasNewAvatar
      ? U.prepareAvatar(d.avatarUrl, this.profile.uid)
      : Promise.resolve({ avatarUrl: this.profile.avatarUrl || '', avatarData: this.profile.avatarData || '' });

    const that = this;
    ready.then(function (av) {
      that.profile = R.saveProfile({
        nickname: nickname,
        avatar: d.avatar || that.profile.avatar,
        avatarUrl: av.avatarUrl,
        avatarData: av.avatarData,
        isWechat: !!d.isWechat
      });
      // 自己的头像也进映射：席位条 / 工作台都从同一份数据取，避免两处不一致
      if (that.profile.uid) {
        that._avatars[that.profile.uid] = that.profile.avatarUrl || that.profile.avatarData || '';
      }
      // 资料上云：失败不影响本机使用，只影响换设备后的可恢复性
      U.syncProfile(that.profile);
      // 同步本机席位的显示资料，不改动规则状态（首页 / 大厅阶段可能还没有牌局）
      const si = that.mySeat;
      const me = that.state && that.state.players[si];
      if (me) {
        me.nickname = nickname;
        me.name = nickname;
        me.avatar = that.profile.avatar;
      }
      if (that.room && that.room.seats[si]) {
        that.room.seats[si] = Object.assign({}, that.room.seats[si], {
          name: nickname, nickname: nickname,
          avatar: that.profile.avatar
        });
        if (R.hasCloud() && that.ui.screen === 'room') {
          that.updateCloudRoom({ seats: that.room.seats });
        }
      }
      that.ui.showProfile = false;
      that.ui.profileDraft = null;
      that.refresh('资料已保存 · ' + nickname);
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
    this.onTapPlayer({ currentTarget: { dataset: { index: this.mySeat } } });
  },

  noop() {}
});
