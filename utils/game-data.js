'use strict';

/**
 * 璀璨宝石（Splendor）数据层
 * ------------------------------------------------------------------
 * 牌组按官方结构规则化生成：一级 40 张 / 二级 30 张 / 三级 20 张，
 * 五种宝石筹码 + 黄金万能筹码，贵族牌 3 声望点。
 * 说明：成本与卡名为规则化生成，非官方逐张卡面复刻；数值分布贴近原作节奏。
 *      本文件为纯数据，不含任何 wx API，可在 Node 下直接测试。
 */

// 五种宝石（黄金为万能筹码，单独处理）
const GEMS = ['white', 'blue', 'green', 'red', 'black'];
const ALL_TOKENS = ['white', 'blue', 'green', 'red', 'black', 'gold'];

// 宝石视觉元数据：main 主色 / dark 暗部 / edge 高光 / ink 文字色
const GEM_META = {
  white: { key: 'white', label: '钻石',   main: '#d9e2ec', dark: '#7f8fa4', edge: '#ffffff', ink: '#28323e' },
  blue:  { key: 'blue',  label: '蓝宝石', main: '#2f6fb5', dark: '#154373', edge: '#8cc2f5', ink: '#ffffff' },
  green: { key: 'green', label: '祖母绿', main: '#2f9a5f', dark: '#125b36', edge: '#89e3aa', ink: '#ffffff' },
  red:   { key: 'red',   label: '红宝石', main: '#c8323c', dark: '#7c1b23', edge: '#ff9aa0', ink: '#ffffff' },
  black: { key: 'black', label: '玛瑙',   main: '#4b3d48', dark: '#1d161d', edge: '#a08d9b', ink: '#ffffff' },
  gold:  { key: 'gold',  label: '黄金',   main: '#f0c341', dark: '#a2740f', edge: '#ffe79b', ink: '#483108' }
};

// 牌背配色：参考截图中左侧自上而下为蓝 / 金 / 绿
const DECK_META = [
  { level: 1, label: 'I',   main: '#1f5aa6', dark: '#0d2f63', edge: '#6fa8ee', name: '一级牌库' },
  { level: 2, label: 'II',  main: '#c99a34', dark: '#6d4a0b', edge: '#f7dc8c', name: '二级牌库' },
  { level: 3, label: 'III', main: '#2b7a4b', dark: '#0f3d24', edge: '#8ad9a5', name: '三级牌库' }
];

// 卡名（按产出宝石分组，循环取用）
const CARD_NAMES = {
  white: ['雪原商路', '白石教堂', '霜港集市', '云顶修道院', '银盐矿场', '北境驿站', '晨雾码头', '石膏工坊'],
  blue:  ['深海航路', '蓝釉工坊', '潮汐港湾', '蔚蓝书院', '苍穹灯塔', '靛蓝染坊', '星夜水渠', '远洋船坞'],
  green: ['翡翠梯田', '林间驿站', '苔石庭院', '青藤酒坊', '翠谷磨坊', '松风猎场', '碧潭水车', '香草园圃'],
  red:   ['赤陶窑场', '朱砂市集', '熔炉长街', '绯红剧场', '丹霞驿站', '炭火铁铺', '石榴庭院', '晚霞钟楼'],
  black: ['黑曜矿坑', '玄石高塔', '夜市商队', '墨玉工坊', '玄武岩门', '暮色酒馆', '乌木书库', '暗河渡口']
};

// 贵族牌池：需求为三种宝石红利各 3 或 4 张
const NOBLE_POOL = [
  { id: 'n1', req: { white: 3, blue: 3, black: 3 }, title: '绸缎巨商' },
  { id: 'n2', req: { blue: 3, green: 3, red: 3 },  title: '香料领主' },
  { id: 'n3', req: { white: 4, red: 4, black: 0 },  title: '铸币大臣' },
  { id: 'n4', req: { green: 4, black: 4, blue: 0 }, title: '矿脉总督' },
  { id: 'n5', req: { white: 3, green: 3, red: 3 },  title: '宫廷建筑师' },
  { id: 'n6', req: { blue: 4, green: 4, red: 0 },   title: '航海总会' }
];

// 确定性伪随机，保证牌组数值分布固定、可复现
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function emptyCost() {
  return { white: 0, blue: 0, green: 0, red: 0, black: 0 };
}

// 依据等级生成成本：成本颜色不含该卡自身产出的宝石（与原作一致）
function makeCost(level, gemIndex, rand) {
  const cost = emptyCost();
  const others = GEMS.slice();
  others.splice(gemIndex, 1);
  shuffle(others, rand);

  // 一级偶尔出现单色高价卡，增加节奏变化
  if (level === 1 && rand() < 0.18) {
    cost[others[0]] = 3 + (rand() < 0.35 ? 1 : 0);
    return cost;
  }

  const colorCount = level === 1
    ? (rand() < 0.45 ? 3 : 2)
    : level === 2
      ? (rand() < 0.55 ? 3 : 2)
      : (rand() < 0.28 ? 3 : 2);
  const base = level === 1 ? 1 : level === 2 ? 2 : 3;
  const spread = level === 1 ? 2 : level === 2 ? 2 : 3;

  for (let i = 0; i < colorCount; i++) {
    cost[others[i]] = base + Math.floor(rand() * spread);
  }
  return cost;
}

function pointsFor(level, i) {
  if (level === 1) return i % 10 < 7 ? 0 : 1;
  if (level === 2) return [1, 1, 2, 2, 2, 3, 1, 2, 3, 1][i % 10];
  return [3, 3, 4, 4, 5, 3, 4, 5, 4, 3][i % 10];
}

/** 生成三副牌库：数值分布固定（可复现），牌序每局随机 */
function buildDecks(shuffleRand) {
  // 固定种子只用于生成成本/分数等数值，保证牌组强度稳定
  const gen = mulberry32(20261108);
  // 洗牌使用外部随机源，默认 Math.random，让每局牌序不同
  const shuff = shuffleRand || Math.random;
  const sizes = [40, 30, 20];
  const decks = [[], [], []];

  for (let level = 1; level <= 3; level++) {
    const list = decks[level - 1];
    for (let i = 0; i < sizes[level - 1]; i++) {
      const gemIndex = (i * 3 + level) % 5;
      const gem = GEMS[gemIndex];
      list.push({
        id: 'L' + level + '-' + (i + 1),
        level: level,
        points: pointsFor(level, i),
        gem: gem,
        cost: makeCost(level, gemIndex, gen),
        name: CARD_NAMES[gem][i % CARD_NAMES[gem].length],
        art: (i * 5 + level * 3) % 12
      });
    }
    shuffle(list, shuff);
  }
  return decks;
}

/** 抽取本局贵族牌（2 人局 3 张） */
function buildNobles(count, rand) {
  const pool = NOBLE_POOL.slice();
  shuffle(pool, rand);
  return pool.slice(0, count).map(function (n) {
    return { id: n.id, title: n.title, points: 3, req: n.req, claimedBy: -1 };
  });
}

module.exports = {
  GEMS: GEMS,
  ALL_TOKENS: ALL_TOKENS,
  GEM_META: GEM_META,
  DECK_META: DECK_META,
  CARD_NAMES: CARD_NAMES,
  NOBLE_POOL: NOBLE_POOL,
  emptyCost: emptyCost,
  mulberry32: mulberry32,
  shuffle: shuffle,
  buildDecks: buildDecks,
  buildNobles: buildNobles
};
