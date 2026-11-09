'use strict';

const D = require('../../utils/game-data.js');
const E = require('../../utils/game-engine.js');
const AI = require('../../utils/ai.js');
const R = require('../../utils/room.js');

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
      ink: '#FFF1D5',
      gemClass: 'gem-' + g,
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
    gemClass: 'gem-' + card.gem,
    gemStyle: gemStyle(card.gem),
    // 写实油画按「红利宝石色系 × 画面序号」索引，与规则数据解耦、可整组替换
    photoClass: 'photo-' + (GEMS.indexOf(card.gem) * 18 + (card.art % 18)),
    // 程序化矢量插画作为无照片素材时的兜底
    artClass: 'art-' + (GEMS.indexOf(card.gem) * 3 + (card.art % 3)),
    // 统一俯视透视 + 极轻微歪斜；抬升/选中由外层卡槽承担，避免 transform 互相覆盖
    tiltStyle: 'transform:perspective(900px) rotateX(6deg) rotate(' +
      (((card.art % 5) - 2) * 0.2).toFixed(2) + 'deg);',
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
      label: META[g].label,
      count: player.tokens[g],
      zero: player.tokens[g] === 0,
      ink: META[g].ink,
      gemClass: 'gem-' + g,
      coinClass: 'coin-' + g,
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

/* ---------- 多人房间 / 玩家详情视图模型 ---------- */

function avatarHue(key) {
  const list = R.PRESET_AVATARS;
  for (let i = 0; i < list.length; i++) if (list[i].key === key) return list[i].hue;
  return '#8a6bb0';
}

/** 单个席位的紧凑状态，供顶部席位条与详情弹层共用 */
function seatVM(state, index, room) {
  const p = state.players[index];
  const s = (room && room.seats && room.seats[index]) || {};
  const avatar = p.avatar || s.avatar || 'a0';
  const isSelf = index === 0;
  const type = p.type || (p.isAI ? 'bot' : 'human');
  return {
    index: index,
    name: p.nickname || p.name,
    subtitle: isSelf ? '本机玩家' : (type === 'bot' ? '机器人托管' : (p.joined ? '真人席位' : '等待加入')),
    type: type,
    isSelf: isSelf,
    isBot: !!p.isAI,
    isCurrent: state.current === index && !state.gameOver,
    joined: p.joined,
    empty: !p.joined && !p.isAI,
    points: p.points,
    cardCount: p.cards.length,
    reservedCount: p.reserved.length,
    nobleCount: p.nobles.length,
    avatar: avatar,
    avatarUrl: p.avatarUrl || s.avatarUrl || '',
    avatarHue: avatarHue(avatar),
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

/** 点击玩家头像后的详情：预留卡 / 贵族到访 / 永久红利 / 持有筹码 / 声望构成 */
function playerDetailVM(state, index, room) {
  const p = state.players[index];
  if (!p) return null;
  const seat = seatVM(state, index, room);
  let cardPoints = 0;
  for (let i = 0; i < p.cards.length; i++) cardPoints += p.cards[i].points;
  let noblePoints = 0;
  const nobles = p.nobles.map(function (n) {
    noblePoints += n.points;
    return { id: n.id, title: n.title, points: n.points, reqs: nobleReqs(n) };
  });
  const reserved = p.reserved.map(function (c) {
    return {
      id: c.id,
      name: c.name,
      level: c.level,
      pointsText: c.points > 0 ? String(c.points) : '0',
      gemLabel: META[c.gem].label,
      gemClass: 'gem-' + c.gem,
      photoClass: 'photo-' + (GEMS.indexOf(c.gem) * 18 + (c.art % 18)),
      artClass: 'art-' + (GEMS.indexOf(c.gem) * 3 + (c.art % 3))
    };
  });
  return {
    index: index,
    title: seat.name + ' · 玩家详情',
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
    discounts: discountsVM(state, index),
    tokens: tokensVM(p, ALL),
    reservedCards: reserved,
    nobles: nobles,
    emptyReserved: reserved.length === 0,
    emptyNobles: nobles.length === 0
  };
}

function lobbyVM(ui, room, profile) {
  const counts = [2, 3, 4].map(function (n) {
    return { n: n, label: n + ' 人', active: ui.playerCount === n };
  });
  const seats = [];
  for (let i = 0; i < ui.playerCount; i++) {
    const isBot = i > 0 ? !!ui.bots[i] : false;
    seats.push({
      index: i,
      label: i === 0 ? '房主 · 你' : '席位 ' + (i + 1),
      name: i === 0 ? (profile ? profile.nickname : '珠宝商') : (isBot ? '机器人托管' : '等待好友加入'),
      isBot: isBot,
      canToggle: i > 0,
      type: i === 0 ? 'self' : (isBot ? 'bot' : 'remote'),
      avatarHue: avatarHue(i === 0
        ? ((profile && profile.avatar) || 'a0')
        : R.PRESET_AVATARS[i % R.PRESET_AVATARS.length].key)
    });
  }
  const cloud = !!(room && room.backend === 'cloud');
  return {
    counts: counts,
    seats: seats,
    playerCount: ui.playerCount,
    roomCode: room ? room.code : '',
    backend: cloud ? '云端同步' : '本机房间',
    backendHint: cloud
      ? '房间状态已云端同步，好友可跨设备加入。'
      : '当前为本机房间：分享可带出房间号，跨设备同步需要开启云服务。',
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
  return {
    nickname: draft.nickname || '',
    avatarUrl: draft.avatarUrl || '',
    avatarName: draft.avatarUrl ? '微信头像' : R.avatarName(draft.avatar),
    avatars: avatars,
    nicknames: ['珠宝商', '宝石收藏家', '贸易行会', '威尼斯商人'],
    isWechat: !!p.isWechat,
    notice: ui.profileNotice || ''
  };
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
      gemClass: 'gem-' + g,
      missing: Math.max(0, raw - (disc[g] || 0)) > (state.players[0].tokens[g] || 0),
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

function buildViewModel(state, ui, layout, ctx) {
  const context = ctx || {};
  const room = context.room || null;
  const profile = context.profile || null;
  const me = state.players[0];
  const rival = state.players[1] || me;
  const isMyTurn = state.current === 0 && !state.gameOver;
  const needDiscard = isMyTurn && state.pendingDiscard > 0;
  const sel = ui.selectedGems;

  // 2 / 3 / 4 人统一由 state.players 驱动，席位条与详情弹层共用同一份视图模型
  const rivals = [];
  const seats = [];
  for (let si = 0; si < state.players.length; si++) {
    const vm = seatVM(state, si, room);
    seats.push(vm);
    if (si > 0) rivals.push(vm);
  }

  // 常规牌桌排布：自上而下 III / II / I，即自下而上 I、II、III。
  // 左侧牌库与右侧明牌行使用同一组 y 坐标，保证同级一一水平对齐。
  const rows = [];
  for (let r = 0; r < 3; r++) {
    const lv = 2 - r;
    const cards = [];
    for (let i = 0; i < 4; i++) {
      const card = state.board[lv][i];
      const vm = card ? cardVM(state, card) : emptyCardVM(lv, i);
      vm.selected = !!(ui.detail && ui.detail.kind === 'board' &&
        ui.detail.lv === lv && ui.detail.index === i);
      cards.push(vm);
    }
    rows.push({
      lv: lv,
      label: ['I', 'II', 'III'][lv],
      rowClass: ['row-near', 'row-mid', 'row-far'][r],
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
    return {
      key: g,
      slot: i,
      slotClass: 'pile-slot-' + i,
      label: META[g].label,
      count: count,
      gemClass: 'gem-' + g,
      coinClass: 'coin-' + g,
      style: gemStyle(g),
      selected: countIn(sel, g) > 0,
      isGold: g === 'gold',
      disabled: g === 'gold' || count <= 0 || !isMyTurn || needDiscard
    };
  });

  const nobles = state.nobles.map(function (n, i) {
    const reqs = [];
    for (let k = 0; k < GEMS.length; k++) {
      const g = GEMS[k];
      if ((n.req[g] || 0) > 0) {
        reqs.push({ key: g, num: n.req[g], gemClass: 'gem-' + g, style: gemStyle(g) });
      }
    }
    return {
      id: n.id,
      title: n.title,
      points: n.points,
      artClass: 'noble-art-' + (i % 3),
      photoClass: 'noble-photo-' + (i % 10),
      reqs: reqs
    };
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
    hint = '选筹码后确认拿取，或点击卡牌购买 / 预留';
  }

  let statusText;
  if (state.gameOver) statusText = '对局结束';
  else if (needDiscard) statusText = '请退还筹码';
  else if (isMyTurn) statusText = '你的回合';
  else statusText = (state.players[state.current].nickname || state.players[state.current].name) + ' 的回合';

  let resultTitle = '';
  let resultDetail = '';
  if (state.gameOver) {
    if (state.winner === -2) resultTitle = '平局';
    else if (state.winner === 0) resultTitle = '你赢了';
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
    rows: rows,
    decks: decks,
    bankPiles: bankPiles,
    nobles: nobles,
    goldCount: state.bank.gold,
    goldStyle: gemStyle('gold'),
    rivals: rivals,
    seats: seats,
    playerCount: state.players.length,
    roomCode: room ? room.code : '',
    roomBackend: room && room.backend === 'cloud' ? '云端同步' : '本机房间',
    lobby: lobbyVM(ui, room, profile),
    profileDialog: profileVM(ui, profile),
    playerDetail: ui.showPlayerDetail ? playerDetailVM(state, ui.detailSeat, room) : null,
    showLobby: !!ui.showLobby,
    showPlayerDetail: !!ui.showPlayerDetail,
    showProfile: !!ui.showProfile,
    meName: (profile && profile.nickname) || me.nickname || me.name,
    meAvatarHue: avatarHue((profile && profile.avatar) || me.avatar || 'a0'),
    canUseNativeAvatar: !!(typeof wx !== 'undefined' && wx.canIUse &&
      wx.canIUse('button.open-type.chooseAvatar')),
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

/** 需要自动托管的席位：机器人，或真人尚未入席的空位（本机适配器下不卡回合） */
function needsAutoPlay(state) {
  const p = state.players[state.current];
  return !!p && (p.isAI || (p.type === 'remote' && !p.joined));
}

function freshUI(config) {
  const c = config || {};
  return {
    selectedGems: [],
    toast: '',
    detail: null,
    showRules: false,
    showReserved: false,
    // 房间配置：重开一局时保留人数与机器人席位
    playerCount: c.playerCount || 2,
    bots: c.bots || { 1: true, 2: true, 3: true },
    showLobby: false,
    showPlayerDetail: false,
    detailSeat: -1,
    showProfile: false,
    profileDraft: null,
    profileNotice: '',
    joinCode: '',
    roomNotice: ''
  };
}

Page({
  data: {
    stageScale: 1,
    stageRotate: 0
  },

  onLoad(options) {
    const size = readWindowSize();
    this._layout = calcLayout(size.w, size.h);
    this._aiTimer = null;
    this.profile = R.getProfile();
    this.ui = freshUI();
    this.startGame();

    // 微信分享卡片带 ?room=XXXXXX；本机适配器只能同设备读取，
    // 换成云端 RoomAdapter 后同一段代码即可跨设备入席。
    const query = options || {};
    if (query.room) {
      this.ui.joinCode = String(query.room).toUpperCase();
      this.ui.showLobby = true;
      this.ui.roomNotice = '收到房间邀请 ' + this.ui.joinCode + '，点击「加入房间」入席';
      this.refresh('');
    }
  },

  /** 按当前人数与机器人配置重开一局，并同步创建 / 刷新房间 */
  startGame() {
    this.clearTimer();
    const profile = this.profile || R.getProfile();
    const seats = R.makeSeats(this.ui.playerCount, this.ui.bots, profile);
    this.state = E.createGame({ playerCount: this.ui.playerCount, seats: seats });
    this.room = R.createRoom({
      playerCount: this.ui.playerCount,
      seats: seats,
      profile: profile
    });
    this.ui.detail = null;
    this.ui.showReserved = false;
    this.ui.showPlayerDetail = false;
    this.setData(buildViewModel(this.state, this.ui, this._layout, {
      room: this.room, profile: this.profile
    }));
    this.maybeRunAi({ ended: true });
  },

  onShow() {
    // 从后台切回时，若仍轮到托管席位则恢复其行动节奏
    if (this.state && !this.state.gameOver && needsAutoPlay(this.state) && !this._aiTimer) {
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
    this.setData(buildViewModel(this.state, this.ui, this._layout, {
      room: this.room, profile: this.profile
    }));
  },

  /** 行动结束后驱动非本机席位：机器人，或尚未有真人加入的席位（本机适配器下由 AI 代打） */
  maybeRunAi(result) {
    if (!result || !result.ended || this.state.gameOver) return;
    if (!needsAutoPlay(this.state)) return;
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
    if (s.gameOver || !needsAutoPlay(s)) return;
    const actor = s.players[s.current].nickname || s.players[s.current].name;
    let result = E.performAction(s, AI.chooseAction(s));
    if (!result.ok) result = E.performAction(s, { type: 'pass' });
    this.refresh(result.ok ? actor + ' · ' + result.message : result.error);
    if (!s.gameOver && needsAutoPlay(s)) this.scheduleAi();
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
    this.ui = freshUI({ playerCount: this.ui.playerCount, bots: this.ui.bots });
    this.startGame();
  },

  /* ---------- 房间大厅 / 微信邀请 ---------- */

  onOpenLobby() {
    this.ui.showLobby = true;
    this.ui.roomNotice = '';
    this.refresh('');
  },
  onCloseLobby() {
    this.ui.showLobby = false;
    this.refresh('');
  },
  onSelectPlayerCount(event) {
    const n = Number(event.currentTarget.dataset.n);
    if (n < 2 || n > 4) return;
    this.ui.playerCount = n;
    this.ui.roomNotice = '人数已改为 ' + n + ' 人，点「开始牌局」生效';
    this.refresh('');
  },
  onToggleBot(event) {
    const i = Number(event.currentTarget.dataset.index);
    if (i <= 0) return;
    this.ui.bots[i] = !this.ui.bots[i];
    this.ui.roomNotice = this.ui.bots[i]
      ? '席位 ' + (i + 1) + ' 将由机器人托管'
      : '席位 ' + (i + 1) + ' 留给好友加入（本机适配器下由机器人代打）';
    this.refresh('');
  },
  onStartRoom() {
    const count = this.ui.playerCount;
    const bots = this.ui.bots;
    this.ui = freshUI({ playerCount: count, bots: bots });
    this.startGame();
    this.refresh(count + ' 人牌局已开始 · 房间 ' + this.room.code);
  },
  onJoinCodeInput(event) {
    this.ui.joinCode = String((event.detail && event.detail.value) || '').toUpperCase();
  },
  onJoinRoom() {
    const r = R.joinRoom(this.ui.joinCode, this.profile);
    if (!r.ok) {
      this.ui.roomNotice = r.error;
      this.refresh('');
      return;
    }
    this.room = r.room;
    this.ui.showLobby = false;
    this.ui.roomNotice = '';
    this.refresh('已加入房间 ' + r.room.code + '（本机席位）');
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
    this.profile = R.saveProfile({
      nickname: nickname,
      avatar: d.avatar || this.profile.avatar,
      avatarUrl: d.avatarUrl || '',
      isWechat: !!d.isWechat
    });
    // 同步本机席位的显示资料，不改动规则状态
    const me = this.state.players[0];
    me.nickname = nickname;
    me.name = nickname;
    me.avatar = this.profile.avatar;
    me.avatarUrl = this.profile.avatarUrl;
    if (this.room && this.room.seats[0]) {
      this.room.seats[0] = Object.assign({}, this.room.seats[0], {
        name: nickname, nickname: nickname,
        avatar: this.profile.avatar, avatarUrl: this.profile.avatarUrl
      });
    }
    this.ui.showProfile = false;
    this.ui.profileDraft = null;
    this.refresh('资料已保存 · ' + nickname);
  },

  /* ---------- 点击玩家头像查看详情 ---------- */

  onTapPlayer(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!this.state.players[index]) return;
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
    this.onTapPlayer({ currentTarget: { dataset: { index: 0 } } });
  },

  noop() {}
});
