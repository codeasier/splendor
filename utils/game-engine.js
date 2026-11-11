'use strict';

/**
 * 璀璨宝石规则引擎（纯 JS，无 wx API，可 Node 自测）
 * ------------------------------------------------------------------
 * 状态就地修改；页面持有 state，每次行动后由 buildViewModel 生成渲染数据。
 * 回合流程：行动 -> 若筹码 >10 需退还 -> 贵族结算 -> 终局判定 -> 切换玩家
 */

const D = require('./game-data.js');
const GEMS = D.GEMS;
const ALL_TOKENS = D.ALL_TOKENS;

function zeroTokens() {
  return { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 };
}

function newPlayer(name, isAI, seat) {
  const s = seat || {};
  return {
    name: name,
    isAI: !!isAI,
    // 席位身份：self=本机玩家 / bot=机器人托管 / remote=真人远程席位
    uid: s.uid || '',
    nickname: s.nickname || name,
    avatar: s.avatar || '',
    avatarUrl: s.avatarUrl || '',
    type: s.type || (isAI ? 'bot' : 'human'),
    joined: s.joined !== false,
    // 主动托管：真人临时交给 AI 代打，但**仍是真人席位**（可以随时收回）。
    // 与 isAI 区分开是必须的——isAI 是「这个席位天生就是机器人」，
    // 用它表达临时托管，玩家自己就再也拿不回操作权了。
    autoPlay: !!s.autoPlay,
    tokens: zeroTokens(),
    cards: [],
    reserved: [],
    nobles: [],
    points: 0
  };
}

function pushLog(state, text) {
  state.log.push(text);
  if (state.log.length > 30) state.log.shift();
}

/**
 * 2 人局：每色 4 枚，黄金 5 枚；3 人 5 枚 / 4 人 7 枚
 * rand 可选：传入自定义随机源可复现牌序，便于调试与复盘
 */
function createGame(playerCount, rand) {
  // 两种调用方式都支持：createGame(3, rand) 或
  // createGame({ playerCount: 3, seats: [...], rand })（多人房间用后者注入席位身份）
  const opt = (playerCount && typeof playerCount === 'object')
    ? playerCount : { playerCount: playerCount };
  const n = opt.playerCount || 2;
  const shuffleRand = rand || opt.rand || Math.random;
  const perGem = n === 2 ? 4 : n === 3 ? 5 : 7;
  const state = {
    players: [],
    bank: {
      white: perGem, blue: perGem, green: perGem, red: perGem,
      black: perGem, gold: 5
    },
    decks: D.buildDecks(shuffleRand),
    board: [[], [], []],
    nobles: [],
    current: 0,
    turnCount: 0,
    endAtTurn: -1,
    gameOver: false,
    winner: -1,
    pendingDiscard: 0,
    // 同时满足多张贵族时挂起等待该玩家挑选：{ seat, options: [nobleId...] }
    pendingNoble: null,
    // 连续无人购入发展卡的回合数；筹码池枯竭时用于提前结算，避免死局
    idleTurns: 0,
    boughtThisTurn: false,
    log: []
  };

  for (let i = 0; i < n; i++) {
    const seat = (opt.seats && opt.seats[i]) || {};
    const isAI = seat.isAI !== undefined ? !!seat.isAI : i !== 0;
    const fallback = i === 0 ? '你' : (isAI ? '机器人 ' + i : '玩家 ' + (i + 1));
    state.players.push(newPlayer(seat.name || fallback, isAI, seat));
  }
  state.nobles = D.buildNobles(n === 2 ? 3 : n === 3 ? 4 : 5, shuffleRand);

  for (let lv = 0; lv < 3; lv++) {
    for (let i = 0; i < 4; i++) state.board[lv].push(null);
  }
  for (let lv = 0; lv < 3; lv++) refill(state, lv);

  pushLog(state, '对局开始 · 先达到 15 声望点者胜');
  return state;
}

/** 补齐某级明牌至 4 张，保持槽位索引稳定 */
function refill(state, lv) {
  for (let i = 0; i < 4; i++) {
    if (!state.board[lv][i] && state.decks[lv].length > 0) {
      state.board[lv][i] = state.decks[lv].pop();
    }
  }
}

function tokenTotal(player) {
  let total = 0;
  for (let i = 0; i < ALL_TOKENS.length; i++) total += player.tokens[ALL_TOKENS[i]];
  return total;
}

/** 宝石红利 = 已购入发展卡按颜色累计 */
function getDiscounts(state, idx) {
  const disc = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
  const cards = state.players[idx].cards;
  for (let i = 0; i < cards.length; i++) disc[cards[i].gem] += 1;
  return disc;
}

/**
 * 计算购买某卡的实际支付方案：先用本色筹码，缺口用黄金补。
 * 返回 null 表示买不起。
 */
function getPayment(state, idx, card) {
  if (!card) return null;
  const p = state.players[idx];
  const disc = getDiscounts(state, idx);
  const pay = zeroTokens();
  let goldNeed = 0;

  for (let i = 0; i < GEMS.length; i++) {
    const g = GEMS[i];
    const rest = Math.max(0, (card.cost[g] || 0) - (disc[g] || 0));
    const use = Math.min(rest, p.tokens[g]);
    pay[g] = use;
    goldNeed += rest - use;
  }
  if (goldNeed > p.tokens.gold) return null;
  pay.gold = goldNeed;
  return pay;
}

function canBuy(state, idx, card) {
  return getPayment(state, idx, card) !== null;
}

function computePoints(state, idx) {
  const p = state.players[idx];
  let pts = 0;
  for (let i = 0; i < p.cards.length; i++) pts += p.cards[i].points;
  for (let i = 0; i < p.nobles.length; i++) pts += p.nobles[i].points;
  p.points = pts;
}

/** 当前玩家满足需求的所有贵族牌（官方规则：一回合最多得 1 张） */
function eligibleNobles(state, idx) {
  const disc = getDiscounts(state, idx);
  const out = [];
  for (let i = 0; i < state.nobles.length; i++) {
    const noble = state.nobles[i];
    let ok = true;
    for (let j = 0; j < GEMS.length; j++) {
      const g = GEMS[j];
      if ((noble.req[g] || 0) > (disc[g] || 0)) { ok = false; break; }
    }
    if (ok) out.push(noble);
  }
  return out;
}

function grantNoble(state, idx, noble) {
  const at = state.nobles.indexOf(noble);
  if (at >= 0) state.nobles.splice(at, 1);
  state.players[idx].nobles.push(noble);
  pushLog(state, state.players[idx].name + ' 获得贵族「' + noble.title + '」 +3 声望');
}

/** 旧接口：自动获得第一张满足需求的贵族（保留给既有调用方） */
function applyNobles(state, idx) {
  const choices = eligibleNobles(state, idx);
  if (choices.length === 0) return null;
  grantNoble(state, idx, choices[0]);
  return choices[0];
}

function computeWinner(state) {
  let best = -1;
  let bestPoints = -1;
  let fewestCards = Infinity;
  let tie = false;
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    if (p.points > bestPoints) {
      best = i; bestPoints = p.points; fewestCards = p.cards.length; tie = false;
    } else if (p.points === bestPoints) {
      // 同分时发展卡少者胜
      if (p.cards.length < fewestCards) {
        best = i; fewestCards = p.cards.length; tie = false;
      } else if (p.cards.length === fewestCards) {
        tie = true;
      }
    }
  }
  return tie ? -2 : best;
}

function finishGame(state) {
  state.gameOver = true;
  state.winner = computeWinner(state);
  const w = state.winner;
  pushLog(state, w === -2 ? '对局结束 · 平局' : '对局结束 · ' + state.players[w].name + ' 获胜');
}

/** 结束当前回合并切换到下一位玩家 */
function endTurn(state) {
  const idx = state.current;
  const choices = eligibleNobles(state, idx);
  if (choices.length > 1) {
    // 同时满足多张：机器人自动挑第一张；真人席位挂起，等他的设备上报选择
    if (!state.players[idx].isAI) {
      state.pendingNoble = {
        seat: idx,
        options: choices.map(function (n) { return n.id; })
      };
      return { ended: false, waitingNoble: true, gameOver: false };
    }
    grantNoble(state, idx, choices[0]);
  } else if (choices.length === 1) {
    grantNoble(state, idx, choices[0]);
  }
  return finishTurn(state);
}

/** 贵族归属落定后的回合收尾：计分 / 回合推进 / 终局判定 */
function finishTurn(state) {
  const idx = state.current;
  computePoints(state, idx);
  state.turnCount += 1;

  // 僵局保护：买卡会让筹码回流银行，长期无人买卡说明局面已锁死
  if (state.boughtThisTurn) state.idleTurns = 0;
  else state.idleTurns += 1;
  state.boughtThisTurn = false;
  if (state.idleTurns >= 24) {
    pushLog(state, '长时间无人购入发展卡，按当前声望提前结算');
    finishGame(state);
    return { ended: true, gameOver: true };
  }

  if (state.endAtTurn < 0 && state.players[idx].points >= 15) {
    // 官方规则：有人达到 15 声望后，打完「本轮」再结算，让所有人的回合数相同。
    // 本轮还剩几席 = 总人数 - 1 - 达标者的席位下标。
    // 达标者若已是最后一号位，本轮已打完（rest=0），必须立即结算 —— 旧实现无条件
    // 加 players.length-1 个回合，会轮转回 1 号位凭空多打一整轮。
    const rest = state.players.length - 1 - idx;
    state.endAtTurn = state.turnCount + rest;
    pushLog(state, rest > 0
      ? '有人达到 15 声望 · 本轮剩余 ' + rest + ' 席后结算'
      : '末位达到 15 声望 · 本轮已打完，立即结算');
  }
  if (state.endAtTurn >= 0 && state.turnCount >= state.endAtTurn) {
    finishGame(state);
    return { ended: true, gameOver: true };
  }
  state.current = (state.current + 1) % state.players.length;
  return { ended: true, gameOver: false };
}

/** 行动执行后统一处理：筹码超 10 需退还，否则直接结束回合 */
function afterAction(state, message) {
  const p = state.players[state.current];
  pushLog(state, message);
  const over = tokenTotal(p) - 10;
  if (over > 0) {
    state.pendingDiscard = over;
    pushLog(state, '筹码超过 10 枚，请退还 ' + over + ' 枚');
    return { ok: true, message: message, needDiscard: true, discardCount: over, ended: false };
  }
  const r = endTurn(state);
  return {
    ok: true,
    message: message,
    needDiscard: false,
    discardCount: 0,
    ended: !r.waitingNoble,
    waitingNoble: !!r.waitingNoble,
    gameOver: !!r.gameOver
  };
}

function fail(error) {
  return { ok: false, error: error, needDiscard: false, ended: false };
}

/**
 * 校验一次「拿筹码」是否可提交。合法组合只有三种：
 *   A) 同色 2 枚，且该色库存 ≥ 4；
 *   B) 3 种不同色各 1 枚；
 *   C) 缺货降级：桌面可拿颜色不足 3 种时，把剩余颜色各拿 1 枚（官方规则允许少拿，
 *      否则残局里谁都凑不出 3 色、也没有 ≥4 的单色，会直接卡死）。
 *
 * 旧实现允许「1 枚 / 2 个不同色」在库存充足时也提交，导致玩家误触「确认拿取」
 * 就白丢一回合。现在页面 canConfirm 门禁、onConfirmTake 二次校验、AI 候选取舍
 * 全部复用这一份判定，避免 UI 与规则引擎各写一套而漂移。
 *
 * 返回 null 表示可以提交，否则返回可直接展示给玩家的引导文案。
 */
function validateTake(state, gems) {
  if (!gems || gems.length === 0) return '请先点选要拿取的宝石筹码';
  if (gems.length > 3) return '一回合最多拿 3 枚筹码';
  const counts = {};
  for (let i = 0; i < gems.length; i++) {
    const g = gems[i];
    if (GEMS.indexOf(g) < 0) return '黄金筹码只能通过预留卡牌获得';
    counts[g] = (counts[g] || 0) + 1;
  }
  const keys = Object.keys(counts);
  const avail = availableGems(state).length;
  if (keys.length === 1) {
    const g = keys[0];
    if (gems.length === 2 && state.bank[g] < 4) return '该颜色剩余不足 4 枚，不能拿 2 枚';
    if (state.bank[g] < gems.length) return '该宝石已无剩余';
    if (gems.length === 2) return null;
    if (gems.length === 3) return '拿同色筹码必须一次拿 2 枚';
    if (avail <= 1) return null; // C：全桌只剩这一种颜色
    return '再选 1 枚同色，或另选 2 种不同色';
  }
  for (let i = 0; i < keys.length; i++) {
    if (counts[keys[i]] !== 1) return '拿不同颜色筹码时，每种只能拿 1 枚';
    if (state.bank[keys[i]] < 1) return '所选宝石已无剩余';
  }
  if (gems.length === 3) return null;
  if (avail < 3 && gems.length === avail) return null; // C：剩余颜色已全部选入
  return gems.length === 2 ? '再选 1 种不同色' : '还需选满 3 种不同色，或改选同色 2 枚';
}

function doTake(state, gems) {
  const err = validateTake(state, gems);
  if (err) return fail(err);
  const p = state.players[state.current];
  for (let i = 0; i < gems.length; i++) {
    state.bank[gems[i]] -= 1;
    p.tokens[gems[i]] += 1;
  }
  return afterAction(state, '拿取 ' + gems.length + ' 枚筹码');
}

function doReserve(state, card, fromDeck, lv, slot) {
  const p = state.players[state.current];
  if (!card) return fail('该位置没有可预留的卡牌');
  if (p.reserved.length >= 3) return fail('最多只能预留 3 张卡牌');

  if (!fromDeck) {
    state.board[lv][slot] = null;
    refill(state, lv);
  }
  p.reserved.push(card);
  if (state.bank.gold > 0) {
    state.bank.gold -= 1;
    p.tokens.gold += 1;
  }
  return afterAction(state, '预留「' + card.name + '」');
}

function doBuy(state, card, removeFn) {
  const idx = state.current;
  const p = state.players[idx];
  if (!card) return fail('该位置没有卡牌');
  const pay = getPayment(state, idx, card);
  if (!pay) return fail('筹码不足，暂时买不起这张卡');

  for (let i = 0; i < ALL_TOKENS.length; i++) {
    const g = ALL_TOKENS[i];
    p.tokens[g] -= pay[g];
    state.bank[g] += pay[g];
  }
  p.cards.push(card);
  removeFn();
  computePoints(state, idx);
  state.boughtThisTurn = true;
  return afterAction(state, '购入「' + card.name + '」 +' + card.points + ' 声望');
}

/**
 * 统一行动入口
 * action:
 *   { type:'take', gems:[] }
 *   { type:'reserveBoard', lv:0..2, index:0..3 }
 *   { type:'reserveDeck',  lv:0..2 }
 *   { type:'buyBoard',     lv:0..2, index:0..3 }
 *   { type:'buyReserved',  index }
 *   { type:'discard', gems:[] }
 */
function performAction(state, action) {
  if (state.gameOver) return fail('对局已结束');
  if (!action || !action.type) return fail('无效操作');

  if (state.pendingDiscard > 0) {
    if (action.type !== 'discard') return fail('筹码超过 10 枚，请先退还');
    const gems = action.gems || [];
    // 官方规则：回合结束时筹码不得超过 10 枚，超出部分「可退还任意颜色、
    // 任意组合的筹码，包含黄金」，只要退到 ≤10 即可，不限制颜色种类。
    // 因此 gems 数组允许重复同色；下面按颜色累加校验持有量，退完才结束回合。
    if (gems.length === 0 || gems.length > state.pendingDiscard) {
      return fail('需退还 ' + state.pendingDiscard + ' 枚筹码');
    }
    const p = state.players[state.current];
    const counts = {};
    for (let i = 0; i < gems.length; i++) {
      const g = gems[i];
      if (ALL_TOKENS.indexOf(g) < 0) return fail('无效的筹码');
      counts[g] = (counts[g] || 0) + 1;
    }
    const keys = Object.keys(counts);
    for (let i = 0; i < keys.length; i++) {
      if (p.tokens[keys[i]] < counts[keys[i]]) return fail('退还数量超过持有量');
    }
    for (let i = 0; i < gems.length; i++) {
      p.tokens[gems[i]] -= 1;
      state.bank[gems[i]] += 1;
    }
    state.pendingDiscard -= gems.length;
    if (state.pendingDiscard > 0) {
      return {
        ok: true, message: '已退还 ' + gems.length + ' 枚，还需退还 ' + state.pendingDiscard + ' 枚',
        needDiscard: true, discardCount: state.pendingDiscard, ended: false
      };
    }
    const r = endTurn(state);
    return {
      ok: true, message: '已退还筹码', needDiscard: false,
      ended: !r.waitingNoble, waitingNoble: !!r.waitingNoble, gameOver: !!r.gameOver
    };
  }

  if (state.pendingNoble) {
    if (action.type !== 'chooseNoble') return fail('同时满足多张贵族，请先挑选 1 张');
  }

  switch (action.type) {
    case 'take':
      return doTake(state, action.gems);

    // 无筹码可拿、无卡可买且无法预留时的合法行动，避免死局
    case 'pass':
      return afterAction(state, '跳过本回合');

    // 多贵族同时满足时，由该玩家在其设备上挑选 1 张
    case 'chooseNoble': {
      const pn = state.pendingNoble;
      if (!pn) return fail('当前没有待挑选的贵族');
      if (pn.seat !== state.current) return fail('尚未轮到挑选贵族的席位');
      let noble = null;
      for (let i = 0; i < state.nobles.length; i++) {
        if (state.nobles[i].id === action.id && pn.options.indexOf(action.id) >= 0) {
          noble = state.nobles[i];
          break;
        }
      }
      if (!noble) return fail('请从可选的贵族中挑选一张');
      state.pendingNoble = null;
      grantNoble(state, state.current, noble);
      const r = finishTurn(state);
      return {
        ok: true, message: '获得贵族「' + noble.title + '」 +3 声望',
        needDiscard: false, ended: true, gameOver: !!r.gameOver
      };
    }

    case 'reserveBoard': {
      const lv = action.lv;
      if (!state.board[lv]) return fail('无效的牌库等级');
      const card = state.board[lv][action.index];
      if (!card) return fail('该位置没有卡牌');
      return doReserve(state, card, false, lv, action.index);
    }

    case 'reserveDeck': {
      const lv = action.lv;
      const p = state.players[state.current];
      if (p.reserved.length >= 3) return fail('最多只能预留 3 张卡牌');
      if (!state.decks[lv] || state.decks[lv].length === 0) return fail('该级牌库已空');
      const card = state.decks[lv].pop();
      return doReserve(state, card, true, lv, -1);
    }

    case 'buyBoard': {
      const lv = action.lv;
      if (!state.board[lv]) return fail('无效的牌库等级');
      const card = state.board[lv][action.index];
      if (!card) return fail('该位置没有卡牌');
      return doBuy(state, card, function () {
        state.board[lv][action.index] = null;
        refill(state, lv);
      });
    }

    case 'buyReserved': {
      const idx = action.index;
      const p = state.players[state.current];
      const card = p.reserved[idx];
      if (!card) return fail('没有这张预留卡');
      return doBuy(state, card, function () {
        p.reserved.splice(idx, 1);
      });
    }

    default:
      return fail('未知操作');
  }
}

/** 供 AI 使用：当前可拿的宝石（不同色各 1，或库存 ≥4 的单色 2 枚） */
function availableGems(state) {
  const list = [];
  for (let i = 0; i < GEMS.length; i++) {
    if (state.bank[GEMS[i]] > 0) list.push(GEMS[i]);
  }
  return list;
}

/**
 * 当前席位是否还有任何合法动作。
 * 「跳过本回合」是规则兜底（无筹码可拿、无卡可买、也无法预留时才出现），
 * 不是常驻按钮——常驻会让玩家误以为跳过是常规选择。
 */
function hasAnyAction(state) {
  const idx = state.current;
  if (!state.players[idx]) return false;
  if (state.pendingDiscard > 0) return true;
  if (availableGems(state).length > 0) return true;
  const p = state.players[idx];
  if (p.reserved.length < 3) {
    for (let lv = 0; lv < 3; lv++) if (state.decks[lv] && state.decks[lv].length) return true;
  }
  for (let lv = 0; lv < 3; lv++) {
    for (let i = 0; i < state.board[lv].length; i++) {
      const c = state.board[lv][i];
      if (!c) continue;
      if (canBuy(state, idx, c)) return true;
      if (p.reserved.length < 3) return true;
    }
  }
  for (let i = 0; i < p.reserved.length; i++) {
    if (canBuy(state, idx, p.reserved[i])) return true;
  }
  return false;
}

module.exports = {
  createGame: createGame,
  refill: refill,
  tokenTotal: tokenTotal,
  getDiscounts: getDiscounts,
  getPayment: getPayment,
  canBuy: canBuy,
  computePoints: computePoints,
  eligibleNobles: eligibleNobles,
  applyNobles: applyNobles,
  computeWinner: computeWinner,
  endTurn: endTurn,
  performAction: performAction,
  validateTake: validateTake,
  availableGems: availableGems,
  hasAnyAction: hasAnyAction,
  pushLog: pushLog
};
