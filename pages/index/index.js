'use strict';

const D = require('../../utils/game-data.js');
const E = require('../../utils/game-engine.js');
const AI = require('../../utils/ai.js');

// 设计稿舞台尺寸（与参考截图比例一致），运行时等比缩放适配屏幕
const DESIGN_W = 1080;
const DESIGN_H = 560;
const GEMS = D.GEMS;
const ALL = D.ALL_TOKENS;
const META = D.GEM_META;

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

function countIn(list, key) {
  let n = 0;
  for (let i = 0; i < list.length; i++) if (list[i] === key) n += 1;
  return n;
}

/** 把一张发展卡转换为视图数据；成本气泡显示扣除红利后的实付数量 */
function cardVM(state, card) {
  const disc = E.getDiscounts(state, 0);
  const costs = [];
  for (let i = 0; i < GEMS.length; i++) {
    const g = GEMS[i];
    const raw = card.cost[g] || 0;
    if (raw <= 0) continue;
    const need = Math.max(0, raw - (disc[g] || 0));
    costs.push({
      key: g,
      display: need === 0 ? '✓' : String(need),
      covered: need === 0,
      ink: META[g].ink,
      style: gemStyle(g)
    });
  }
  return {
    id: card.id,
    empty: false,
    name: card.name,
    level: card.level,
    pointsText: card.points > 0 ? String(card.points) : '',
    pointsLabel: card.points + ' 声望',
    gemLabel: META[card.gem].label,
    gemStyle: gemStyle(card.gem),
    // 卡面插画按「产出宝石色系 × 场景变体」索引：15 张矢量插画，主色与红利色一致
    artClass: 'art-' + (GEMS.indexOf(card.gem) * 3 + (card.art % 3)),
    costs: costs,
    affordable: E.canBuy(state, 0, card)
  };
}

function emptyCardVM(lv, i) {
  return { id: 'empty-' + lv + '-' + i, empty: true };
}

function tokensVM(player, keys) {
  return keys.map(function (g) {
    return {
      key: g,
      count: player.tokens[g],
      zero: player.tokens[g] === 0,
      ink: META[g].ink,
      style: gemStyle(g)
    };
  });
}

function discountsVM(state, idx) {
  const disc = E.getDiscounts(state, idx);
  const list = [];
  for (let i = 0; i < GEMS.length; i++) {
    const g = GEMS[i];
    if (disc[g] > 0) list.push({ key: g, num: disc[g], style: gemStyle(g) });
  }
  return list;
}

function detailVM(state, ui) {
  if (!ui.detail) return null;
  const d = ui.detail;
  const card = d.kind === 'board'
    ? state.board[d.lv][d.index]
    : state.players[0].reserved[d.index];
  if (!card) return null;

  const disc = E.getDiscounts(state, 0);
  const pay = E.getPayment(state, 0, card);
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
    card: cardVM(state, card),
    costLines: costLines,
    summary: summary,
    canBuy: !!pay,
    canReserve: d.kind === 'board' && state.players[0].reserved.length < 3,
    reserveHint: state.decks[d.lv] ? '' : ''
  };
}

function buildViewModel(state, ui, layout) {
  const me = state.players[0];
  const rival = state.players[1];
  const isMyTurn = state.current === 0 && !state.gameOver;
  const needDiscard = isMyTurn && state.pendingDiscard > 0;
  const sel = ui.selectedGems;

  // 明牌区：参考截图从上到下为三级 / 二级 / 一级
  const rows = [];
  for (let r = 0; r < 3; r++) {
    const lv = 2 - r;
    const cards = [];
    for (let i = 0; i < 4; i++) {
      const card = state.board[lv][i];
      cards.push(card ? cardVM(state, card) : emptyCardVM(lv, i));
    }
    rows.push({ lv: lv, label: ['I', 'II', 'III'][lv], cards: cards });
  }

  const decks = [];
  for (let lv = 0; lv < 3; lv++) {
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

  const bankPiles = ALL.map(function (g) {
    const count = state.bank[g];
    return {
      key: g,
      label: META[g].label,
      count: count,
      style: gemStyle(g),
      selected: countIn(sel, g) > 0,
      isGold: g === 'gold',
      disabled: g === 'gold' || count <= 0 || !isMyTurn || needDiscard
    };
  });

  const nobles = state.nobles.map(function (n, i) {
    const reqs = [];
    for (let i = 0; i < GEMS.length; i++) {
      const g = GEMS[i];
      if ((n.req[g] || 0) > 0) reqs.push({ key: g, num: n.req[g], style: gemStyle(g) });
    }
    return { id: n.id, title: n.title, points: n.points, artClass: 'noble-art-' + (i % 3), reqs: reqs };
  });

  const reservedCards = me.reserved.map(function (c, i) {
    const vm = cardVM(state, c);
    vm.index = i;
    return vm;
  });

  let selectedText = '';
  for (let i = 0; i < sel.length; i++) {
    selectedText += (i > 0 ? ' + ' : '') + META[sel[i]].label;
  }

  let hint;
  if (needDiscard) {
    hint = '筹码超过 10 枚 · 点击底部自己的筹码，退还 ' + state.pendingDiscard + ' 枚';
  } else if (sel.length > 0) {
    hint = '已选 ' + selectedText + ' · 点「确认拿取」完成行动';
  } else if (ui.toast) {
    hint = ui.toast;
  } else {
    hint = '点选右侧宝石筹码后确认拿取，或点击卡牌购买 / 预留';
  }

  let statusText;
  if (state.gameOver) statusText = '对局结束';
  else if (needDiscard) statusText = '请退还筹码';
  else if (isMyTurn) statusText = '你的回合';
  else statusText = '对手回合';

  let resultTitle = '';
  let resultDetail = '';
  if (state.gameOver) {
    resultTitle = state.winner === 0 ? '你赢了' : state.winner === 1 ? '对手获胜' : '平局';
    resultDetail = '你 ' + me.points + ' 声望 · 对手 ' + rival.points + ' 声望　|　发展卡 ' +
      me.cards.length + ' : ' + rival.cards.length;
  }

  return {
    stageScale: layout.scale,
    stageRotate: layout.rotate,
    rows: rows,
    decks: decks,
    bankPiles: bankPiles,
    nobles: nobles,
    goldCount: state.bank.gold,
    goldStyle: gemStyle('gold'),
    rival: {
      name: rival.name,
      points: rival.points,
      cardCount: rival.cards.length,
      reservedCount: rival.reserved.length,
      tokens: tokensVM(rival, GEMS)
    },
    me: {
      name: me.name,
      points: me.points,
      totalTokens: E.tokenTotal(me),
      reservedCount: me.reserved.length,
      tokens: tokensVM(me, ALL),
      discounts: discountsVM(state, 0)
    },
    reservedCards: reservedCards,
    statusText: statusText,
    turnText: '第 ' + (Math.floor(state.turnCount / state.players.length) + 1) + ' 轮',
    logText: state.log.length ? state.log[state.log.length - 1] : '',
    hintText: hint,
    isMyTurn: isMyTurn,
    needDiscard: needDiscard,
    discardCount: state.pendingDiscard,
    selectionCount: sel.length,
    confirmLabel: sel.length > 0 ? '确认拿取 (' + sel.length + ')' : '确认拿取',
    canConfirm: isMyTurn && !needDiscard && sel.length > 0,
    detail: detailVM(state, ui),
    showRules: ui.showRules,
    showReserved: ui.showReserved,
    gameOver: state.gameOver,
    resultTitle: resultTitle,
    resultDetail: resultDetail
  };
}

function freshUI() {
  return {
    selectedGems: [],
    toast: '',
    detail: null,
    showRules: false,
    showReserved: false
  };
}

Page({
  data: {
    stageScale: 1,
    stageRotate: 0
  },

  onLoad() {
    const size = readWindowSize();
    this._layout = calcLayout(size.w, size.h);
    this.state = E.createGame(2);
    this.ui = freshUI();
    this._aiTimer = null;
    this.setData(buildViewModel(this.state, this.ui, this._layout));
  },

  onShow() {
    // 从后台切回时，若仍轮到 AI 则恢复其行动节奏
    if (this.state && !this.state.gameOver &&
        this.state.players[this.state.current].isAI && !this._aiTimer) {
      this.scheduleAi();
    }
  },

  onHide() {
    this.clearTimer();
  },

  onUnload() {
    this.clearTimer();
  },

  onResize() {
    const size = readWindowSize();
    this._layout = calcLayout(size.w, size.h);
    this.setData({
      stageScale: this._layout.scale,
      stageRotate: this._layout.rotate
    });
  },

  clearTimer() {
    if (this._aiTimer) {
      clearTimeout(this._aiTimer);
      this._aiTimer = null;
    }
  },

  refresh(toast) {
    if (toast) this.ui.toast = toast;
    this.setData(buildViewModel(this.state, this.ui, this._layout));
  },

  /** 玩家行动结束后，若轮到 AI 则驱动其回合 */
  maybeRunAi(result) {
    if (!result || !result.ended || this.state.gameOver) return;
    if (!this.state.players[this.state.current].isAI) return;
    this.scheduleAi();
  },

  scheduleAi() {
    this.clearTimer();
    const that = this;
    this._aiTimer = setTimeout(function () {
      that._aiTimer = null;
      that.runAi();
    }, 780);
  },

  runAi() {
    const s = this.state;
    if (s.gameOver || !s.players[s.current].isAI) return;
    let result = E.performAction(s, AI.chooseAction(s));
    if (!result.ok) result = E.performAction(s, { type: 'pass' });
    this.refresh(result.ok ? '对手 · ' + result.message : result.error);
    if (!s.gameOver && s.players[s.current].isAI) this.scheduleAi();
  },

  applyPlayerAction(action, successMessage) {
    const result = E.performAction(this.state, action);
    if (!result.ok) {
      this.refresh(result.error);
      return false;
    }
    this.ui.selectedGems = [];
    this.ui.detail = null;
    this.ui.showReserved = false;
    this.refresh(successMessage || result.message);
    this.maybeRunAi(result);
    return true;
  },

  /** 点选宝石筹码：支持 1~3 枚不同色，或同色 2 枚 */
  onTapPile(event) {
    const s = this.state;
    const key = event.currentTarget.dataset.key;
    if (s.current !== 0 || s.gameOver || s.pendingDiscard > 0) return;
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
      sel.splice(sel.lastIndexOf(key), 1);
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
        this.refresh('拿 2 枚同色筹码时，不能再拿其他颜色');
        return;
      }
      sel.push(key);
    }
    this.refresh('');
  },

  onConfirmTake() {
    if (!this.data.canConfirm) return;
    this.applyPlayerAction({ type: 'take', gems: this.ui.selectedGems.slice() });
  },

  onCancelSelection() {
    this.ui.selectedGems = [];
    this.refresh('已清除所选筹码');
  },

  onPass() {
    if (this.state.current !== 0 || this.state.gameOver || this.state.pendingDiscard > 0) return;
    this.applyPlayerAction({ type: 'pass' }, '跳过本回合');
  },

  /** 退还模式下点击自己的筹码，逐枚退还 */
  onTapMyToken(event) {
    const s = this.state;
    if (s.current !== 0 || s.pendingDiscard <= 0) return;
    const key = event.currentTarget.dataset.key;
    if (s.players[0].tokens[key] <= 0) {
      this.refresh('该颜色没有可退还的筹码');
      return;
    }
    this.applyPlayerAction({ type: 'discard', gems: [key] });
  },

  onTapCard(event) {
    const s = this.state;
    if (s.current !== 0 || s.gameOver || s.pendingDiscard > 0) {
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
    if (s.current !== 0 || s.gameOver || s.pendingDiscard > 0) return;
    const index = Number(event.currentTarget.dataset.index);
    if (!s.players[0].reserved[index]) return;
    this.ui.detail = { kind: 'reserved', lv: -1, index: index, key: '' };
    this.ui.showReserved = false;
    this.refresh('');
  },

  onBuyFromDetail() {
    const d = this.ui.detail;
    if (!d || !this.data.detail || !this.data.detail.canBuy) return;
    const action = d.kind === 'board'
      ? { type: 'buyBoard', lv: d.lv, index: d.index }
      : { type: 'buyReserved', index: d.index };
    this.applyPlayerAction(action);
  },

  onReserveFromDetail() {
    const d = this.ui.detail;
    if (!d || d.kind !== 'board' || !this.data.detail || !this.data.detail.canReserve) return;
    this.applyPlayerAction({ type: 'reserveBoard', lv: d.lv, index: d.index });
  },

  onCloseDetail() {
    this.ui.detail = null;
    this.refresh('');
  },

  onTapDeck(event) {
    const s = this.state;
    if (s.current !== 0 || s.gameOver || s.pendingDiscard > 0) {
      this.refresh('现在不是你的行动阶段');
      return;
    }
    const lv = Number(event.currentTarget.dataset.lv);
    if (!s.decks[lv] || s.decks[lv].length === 0) {
      this.refresh('该级牌库已空');
      return;
    }
    if (s.players[0].reserved.length >= 3) {
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
  onShowReserved() {
    this.ui.showReserved = true;
    this.refresh('');
  },
  onCloseReserved() {
    this.ui.showReserved = false;
    this.refresh('');
  },

  onRestart() {
    this.clearTimer();
    this.state = E.createGame(2);
    this.ui = freshUI();
    this.setData(buildViewModel(this.state, this.ui, this._layout));
  },

  noop() {}
});
