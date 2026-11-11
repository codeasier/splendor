'use strict';

/**
 * 本地 AI 对手（启发式，无网络请求）
 * 优先级：可买高分卡 > 补齐目标卡缺口去拿筹码 > 预留目标卡 > 跳过
 * 超过 10 枚筹码时先退还持有量最多的颜色（黄金最后退）。
 */

const D = require('./game-data.js');
const E = require('./game-engine.js');
const GEMS = D.GEMS;

function pickDiscard(player, count) {
  const order = GEMS.slice().sort(function (a, b) {
    return player.tokens[b] - player.tokens[a];
  });
  order.push('gold'); // 黄金万能，最后才退
  const result = [];
  let left = count;
  while (left > 0) {
    let moved = false;
    for (let i = 0; i < order.length && left > 0; i++) {
      if (player.tokens[order[i]] > 0) {
        result.push(order[i]);
        left -= 1;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return result;
}

/** 计算一张卡当前还差哪些颜色、差多少（不考虑黄金抵扣缺口） */
function gapOf(state, idx, card, disc) {
  const p = state.players[idx];
  const need = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
  let total = 0;
  for (let i = 0; i < GEMS.length; i++) {
    const g = GEMS[i];
    const rest = Math.max(0, (card.cost[g] || 0) - (disc[g] || 0));
    const short = Math.max(0, rest - p.tokens[g]);
    need[g] = short;
    total += short;
  }
  return { need: need, total: total };
}

function collectBoard(state) {
  const list = [];
  for (let lv = 0; lv < 3; lv++) {
    for (let i = 0; i < 4; i++) {
      const card = state.board[lv][i];
      if (card) list.push({ card: card, lv: lv, index: i, source: 'board' });
    }
  }
  const p = state.players[state.current];
  for (let i = 0; i < p.reserved.length; i++) {
    list.push({ card: p.reserved[i], lv: -1, index: i, source: 'reserved' });
  }
  return list;
}

/** 为「下一步想买的卡」计算各色筹码的加权需求 */
function colorWeights(state, idx, entries) {
  const disc = E.getDiscounts(state, idx);
  const weights = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
  for (let i = 0; i < entries.length; i++) {
    const card = entries[i].card;
    const gap = gapOf(state, idx, card, disc);
    if (gap.total === 0) continue;
    // 分数高、缺口小、等级低的卡更值得为其攒筹码
    const appeal = (card.points + 1) * 7 - gap.total * 3 - card.level * 2;
    if (appeal <= 0) continue;
    for (let j = 0; j < GEMS.length; j++) {
      const g = GEMS[j];
      weights[g] += gap.need[g] * appeal;
    }
  }
  return weights;
}

function chooseAction(state) {
  const idx = state.current;
  const p = state.players[idx];

  // 同时满足多张贵族：引擎只在真人席位挂起，这里兜底（超时托管也会走到）
  if (state.pendingNoble && state.pendingNoble.seat === idx) {
    const nobleId = state.pendingNoble.options[0];
    let picked = null;
    for (let i = 0; i < state.nobles.length; i++) {
      if (state.nobles[i].id === nobleId) { picked = state.nobles[i]; break; }
    }
    return {
      type: 'chooseNoble',
      id: nobleId,
      noble: picked ? { id: picked.id, title: picked.title, points: picked.points, req: picked.req } : null
    };
  }

  if (state.pendingDiscard > 0) {
    // 引擎支持逐次退还：凑不够整批也要先退一部分把回合往前推。
    // 旧实现凑不齐就返回 pass，而 pendingDiscard>0 时引擎必定拒绝 pass，
    // 超时托管循环因此再也走不动，牌局永久卡在退还阶段。
    const gems = pickDiscard(p, state.pendingDiscard);
    if (gems.length) return { type: 'discard', gems: gems };
    return { type: 'pass' };
  }

  const entries = collectBoard(state);

  // 1) 能买就买：优先声望高、成本低的卡
  //    0 分卡提供永久宝石红利，是攒引擎的关键，必须给基础价值，
  //    否则 AI 只攒筹码不买卡，筹码无法回流银行，会形成死局。
  let bestBuy = null;
  let bestScore = -Infinity;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!E.canBuy(state, idx, e.card)) continue;
    const costTotal = GEMS.reduce(function (s, g) { return s + (e.card.cost[g] || 0); }, 0);
    const score = e.card.points * 100
      + (e.card.points === 0 ? 30 : 0)
      - costTotal * 2
      + (e.source === 'reserved' ? 5 : 0);
    if (score > bestScore) { bestScore = score; bestBuy = e; }
  }
  if (bestBuy) {
    return bestBuy.source === 'reserved'
      ? { type: 'buyReserved', index: bestBuy.index }
      : { type: 'buyBoard', lv: bestBuy.lv, index: bestBuy.index };
  }

  // 2) 拿筹码补齐目标卡缺口（已满 10 枚时不再拿，避免反复拿取/退还）
  const avail = E.availableGems(state);
  if (avail.length > 0 && E.tokenTotal(p) < 10) {
    const weights = colorWeights(state, idx, entries);
    avail.sort(function (a, b) { return weights[b] - weights[a]; });
    // 同色 2 枚：该色库存充足且需求明显更高时更划算
    const top = avail[0];
    let gems;
    if (top && state.bank[top] >= 4 && weights[top] > 0 && avail.length === 1) {
      gems = [top, top];
    } else {
      gems = avail.slice(0, 3);
    }
    if (!E.validateTake(state, gems)) return { type: 'take', gems: gems };
    // 校验失败时退化为逐个单色尝试
    for (let i = 0; i < avail.length; i++) {
      if (!E.validateTake(state, [avail[i]])) return { type: 'take', gems: [avail[i]] };
    }
  }

  // 3) 预留一张性价比高的卡（顺带拿黄金）
  if (p.reserved.length < 3 && entries.length > 0) {
    let best = null;
    let bestVal = -Infinity;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.source !== 'board') continue;
      const val = e.card.points * 10 + (e.lv === 2 ? 3 : 0);
      if (val > bestVal) { bestVal = val; best = e; }
    }
    if (best) return { type: 'reserveBoard', lv: best.lv, index: best.index };
    for (let lv = 0; lv < 3; lv++) {
      if (state.decks[lv] && state.decks[lv].length > 0) {
        return { type: 'reserveDeck', lv: lv };
      }
    }
  }

  // 4) 无合法动作则跳过，避免死局
  return { type: 'pass' };
}

module.exports = { chooseAction: chooseAction };
