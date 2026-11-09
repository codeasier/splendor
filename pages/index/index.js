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

/** 把一张发展卡转换为视图数据；成本气泡显示扣除红利后的实付数量 */
function cardVM(state, card, seat, r, c) {
  const s = seat || 0;
  const disc = E.getDiscounts(state, s);
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
      ink: g === 'white' ? '#142030' : '#FFFFFF',
      gemClass: 'gem-' + g,
      style: gemStyle(g)
    });
  }
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
    affordable: E.canBuy(state, s, card)
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
      ink: META[g].ink,
      gemClass: 'gem-' + g,
      coinClass: 'coin-' + g,
      style: gemStyle(g),
      stack: stack
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
function seatVM(state, index, room, selfSeat) {
  const p = state.players[index];
  const s = (room && room.seats && room.seats[index]) || {};
  const avatar = p.avatar || s.avatar || 'a0';
  const isSelf = index === (selfSeat || 0);
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
function playerDetailVM(state, index, room, selfSeat) {
  const p = state.players[index];
  if (!p) return null;
  const seat = seatVM(state, index, room, selfSeat);
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
function roomScreenVM(ui, room, profile, mySeat) {
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
      avatarHue: avatarHue(isSelf
        ? ((profile && profile.avatar) || 'a0')
        : (s.avatar || R.PRESET_AVATARS[i % R.PRESET_AVATARS.length].key)),
      avatarUrl: isSelf ? ((profile && profile.avatarUrl) || '') : (s.avatarUrl || ''),
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
    canReserve: d.kind === 'board' && state.players[s].reserved.length < 3,
    reserveHint: state.decks[d.lv] ? '' : ''
  };
}

/**
 * 购买/预留卡牌、确认拿取筹码时的 3 段式桌面动作展演：
 *   1) 从桌面对应卡槽 / 牌库 / 筹码堆位置翻起升空；
 *   2) 在桌面中央向所有玩家悬停展示 ~1.2s；
 *   3) 飞入当前行动玩家的工作台（本机玩家飞入底部工作台，对手飞入左上席位铭牌）。
 */
function buildActionShowcase(state, action, actorSeat, mySeat, seq) {
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
    const card = isBoard
      ? (state.board[action.lv] && state.board[action.lv][action.index])
      : (p.reserved && p.reserved[action.index]);
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
    const card = fromDeck
      ? (deck && deck.length ? deck[deck.length - 1] : null)
      : (state.board[lv] && state.board[lv][action.index]);
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

function buildViewModel(state, ui, layout, ctx) {
  const context = ctx || {};
  const room = context.room || null;
  const profile = context.profile || null;
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
      screen: screen,
      home: lobbyVM(ui, profile),
      roomScreen: roomScreenVM(ui, room, profile, seat),
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
      detail: null,
      gameOver: false,
      isMyTurn: false,
      needDiscard: false,
      discardCount: 0,
      selectionCount: 0,
      canConfirm: false,
      confirmLabel: '确认拿取',
      statusText: '',
      turnText: '',
      logText: '',
      netNotice: (ui && ui.netNotice) || '',
      hintText: '',
      goldCount: 0,
      goldStyle: '',
      resultTitle: '',
      resultDetail: '',
      showcaseList: [],
      me: { name: '', points: 0, totalTokens: 0, reservedCount: 0, tokens: [], discounts: [] },
      rival: { name: '', points: 0, cardCount: 0, reservedCount: 0, tokens: [] }
    };
  }

  const me = state.players[seat] || state.players[0];
  const rival = state.players[seat === 0 ? 1 : 0] || me;
  const isMyTurn = state.current === seat && !state.gameOver;
  const needDiscard = isMyTurn && state.pendingDiscard > 0;
  const sel = ui.selectedGems;

  // 2 / 3 / 4 人统一由 state.players 驱动，席位条与详情弹层共用同一份视图模型
  const rivals = [];
  const seats = [];
  for (let si = 0; si < state.players.length; si++) {
    const vm = seatVM(state, si, room, seat);
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
      selected: countIn(sel, g) > 0,
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

  const reservedCards = me.reserved.map(function (c, i) {
    const vm = cardVM(state, c, seat);
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
    screen: 'game',
    home: lobbyVM(ui, profile),
    roomScreen: roomScreenVM(ui, room, profile, seat),
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
    seats: seats,
    playerCount: state.players.length,
    roomCode: room ? room.code : '',
    roomMode: !!(room && room.mode === 'room'),
    roomBackend: room && room.backend === 'cloud' ? '云端同步' : '本机房间',
    profileDialog: profileVM(ui, profile),
    playerDetail: ui.showPlayerDetail ? playerDetailVM(state, ui.detailSeat, room, seat) : null,
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
      points: me.points,
      totalTokens: E.tokenTotal(me),
      reservedCount: me.reserved.length,
      tokens: tokensVM(me, ALL),
      discounts: discountsVM(state, seat)
    },
    reservedCards: reservedCards,
    mySeat: seat,
    statusText: statusText,
    turnText: '第 ' + (Math.floor(state.turnCount / state.players.length) + 1) + ' 轮',
    logText: state.log.length ? state.log[state.log.length - 1] : '',
    // 断线时用状态行提示重连进度，不额外占版面
    netNotice: ui.netNotice || '',
    hintText: hint,
    isMyTurn: isMyTurn,
    needDiscard: needDiscard,
    discardCount: state.pendingDiscard,
    selectionCount: sel.length,
    confirmLabel: sel.length > 0 ? '确认拿取 (' + sel.length + ')' : '确认拿取',
    canConfirm: isMyTurn && !needDiscard && sel.length > 0,
    detail: detailVM(state, ui, seat),
    showRules: ui.showRules,
    showReserved: ui.showReserved,
    gameOver: state.gameOver,
    resultTitle: resultTitle,
    resultDetail: resultDetail,
    showcaseList: ui.showcase ? [ui.showcase] : []
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
    showcase: null
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
    this.room = R.createRoom({
      playerCount: this.ui.playerCount,
      seats: seats,
      profile: profile,
      status: 'playing'
    });
    this.room.mode = 'solo';
    this.ui.screen = 'game';
    this.ui.detail = null;
    this.ui.showReserved = false;
    this.ui.showPlayerDetail = false;
    this.ui.showLobby = false;
    this.ui.selectedGems = [];
    this.ui.showcase = null;
    // 上一屏（如「已离开房间」）的提示不该被带进新一局
    this.ui.toast = '';
    this._resultRecorded = false;
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
    this.stopCloudPolling();
  },

  onUnload() {
    this.clearTimer();
    this.stopCloudPolling();
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
    if (toast) this.ui.toast = toast;
    this.setData(buildViewModel(this.state, this.ui, this._layout, {
      room: this.room, profile: this.profile, mySeat: this.mySeat
    }));
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
      that._netFails = 0;
      that._netDown = false;
      that.ui.netNotice = '';

      if (res.status === 'playing' && res.state) {
        that.state = res.state;
        const p = that.state.players[that.mySeat];
        if (p) {
          p.nickname = that.profile.nickname;
          p.name = that.profile.nickname;
          p.avatar = that.profile.avatar;
          p.avatarUrl = that.profile.avatarUrl || '';
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
      that.ui.screen = 'game';
      that.ui.playerCount = res.state.players.length;
      that.ui.detail = null;
      that.ui.selectedGems = [];
      that._resultRecorded = false;
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
        that.ui.detail = null;
        that.refresh('房主已回到房间，等你重新准备');
        return;
      }
      that._cloudVersion = res.version;
      that.state = res.state;
      that.ui.detail = null;
      that.ui.selectedGems = [];
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

  runAi() {
    const s = this.state;
    if (s.gameOver || !needsAutoPlay(s, this.aiContext())) return;
    const actorSeat = s.current;
    const actor = s.players[actorSeat].nickname || s.players[actorSeat].name;
    const aiAction = AI.chooseAction(s);
    const nextSeq = (this._showcaseSeq = (this._showcaseSeq || 0) + 1);
    const preShowcase = buildActionShowcase(s, aiAction, actorSeat, this.mySeat, nextSeq);
    let result = E.performAction(s, aiAction);
    if (!result.ok) {
      result = E.performAction(s, { type: 'pass' });
    } else if (preShowcase) {
      this.ui.showcase = preShowcase;
    }
    this.refresh(result.ok ? actor + ' · ' + result.message : result.error);
    if (result.ok) this.pushCloudState();
    if (!s.gameOver && needsAutoPlay(s, this.aiContext())) this.scheduleAi();
  },

  applyPlayerAction(action, successMessage) {
    const actorSeat = this.state ? this.state.current : 0;
    const nextSeq = (this._showcaseSeq = (this._showcaseSeq || 0) + 1);
    const preShowcase = buildActionShowcase(this.state, action, actorSeat, this.mySeat, nextSeq);
    const result = E.performAction(this.state, action);
    if (!result.ok) {
      this.refresh(result.error);
      return false;
    }
    if (preShowcase) this.ui.showcase = preShowcase;
    this.ui.selectedGems = [];
    this.ui.detail = null;
    this.ui.showReserved = false;
    this.refresh(successMessage || result.message);
    this.pushCloudState();
    this.maybeRunAi(result);
    return true;
  },

  /** 点选宝石筹码：支持 1~3 枚不同色，或同色 2 枚 */
  onTapPile(event) {
    const s = this.state;
    const key = event.currentTarget.dataset.key;
    if (s.current !== this.mySeat || s.gameOver || s.pendingDiscard > 0) return;
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
    if (this.state.current !== this.mySeat || this.state.gameOver || this.state.pendingDiscard > 0) return;
    this.applyPlayerAction({ type: 'pass' }, '跳过本回合');
  },

  /** 退还模式下点击自己的筹码，逐枚退还 */
  onTapMyToken(event) {
    const s = this.state;
    if (s.current !== this.mySeat || s.pendingDiscard <= 0) return;
    const key = event.currentTarget.dataset.key;
    if (s.players[this.mySeat].tokens[key] <= 0) {
      this.refresh('该颜色没有可退还的筹码');
      return;
    }
    this.applyPlayerAction({ type: 'discard', gems: [key] });
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
    if (s.current !== this.mySeat || s.gameOver || s.pendingDiscard > 0) return;
    const index = Number(event.currentTarget.dataset.index);
    if (!s.players[this.mySeat].reserved[index]) return;
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
      status: 'lobby'
    });
    this.room.mode = 'room';
    this._cloudCode = this.room.code;
    this.state = null;
    this.ui.screen = 'room';
    this.ui.showLobby = false;
    this.ui.homeNotice = '';
    this.ui.roomNotice = '';
    this.ui.selectedGems = [];
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
    const vm = roomScreenVM(this.ui, this.room, this.profile, this.mySeat);
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
    this.room.seats = seats;
    this.room.status = 'playing';
    this.room.playerCount = seats.length;
    this.ui.screen = 'game';
    this.ui.playerCount = seats.length;
    this.ui.detail = null;
    this.ui.selectedGems = [];
    this.ui.showLobby = false;
    this.ui.roomNotice = '';
    this._resultRecorded = false;
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
    if (this.mySeat !== 0) {
      const vm = roomScreenVM(this.ui, this.room, this.profile, this.mySeat);
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
    // 微信头像是临时路径，先落成本地文件，否则重启后又变回预设头像
    const avatarUrl = d.avatarUrl ? U.persistAvatar(d.avatarUrl, this.profile.uid) : '';
    this.profile = R.saveProfile({
      nickname: nickname,
      avatar: d.avatar || this.profile.avatar,
      avatarUrl: avatarUrl,
      isWechat: !!d.isWechat
    });
    // 资料上云：失败不影响本机使用，只影响换设备后的可恢复性
    U.syncProfile(this.profile);
    // 同步本机席位的显示资料，不改动规则状态（首页 / 大厅阶段可能还没有牌局）
    const si = this.mySeat;
    const me = this.state && this.state.players[si];
    if (me) {
      me.nickname = nickname;
      me.name = nickname;
      me.avatar = this.profile.avatar;
      me.avatarUrl = this.profile.avatarUrl;
    }
    if (this.room && this.room.seats[si]) {
      this.room.seats[si] = Object.assign({}, this.room.seats[si], {
        name: nickname, nickname: nickname,
        avatar: this.profile.avatar, avatarUrl: this.profile.avatarUrl
      });
      if (R.hasCloud() && this.ui.screen === 'room') {
        this.updateCloudRoom({ seats: this.room.seats });
      }
    }
    this.ui.showProfile = false;
    this.ui.profileDraft = null;
    this.refresh('资料已保存 · ' + nickname);
    this.pushCloudState();
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
