'use strict';

/**
 * 璀璨宝石（Splendor）数据层
 * ------------------------------------------------------------------
 * 牌组为**官方 90 张发展卡逐张对应**：一级 40 / 二级 30 / 三级 20，
 * 全库声望合计 140，五色各自 8 / 6 / 4 张、点数分布对称。
 * 五色宝石筹码 + 黄金万能筹码，贵族牌 3 声望点。
 * 说明：卡名与卡面插画是本工程的原创皮，数值与成本结构来自官方卡表，
 *      不再做规则化生成（旧版按等级随机生成本与分数，牌组强度与原作不同）。
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
// 牌库自上而下 III / II / I，卡背为深蓝 / 赭金 / 深绿，与同级市场行水平对应。
const DECK_META = [
  { level: 1, label: 'I',   main: '#2c7a4c', dark: '#103d25', edge: '#9ee0b2', name: '一级牌库' },
  { level: 2, label: 'II',  main: '#a9812c', dark: '#5b3c0a', edge: '#ffe6a0', name: '二级牌库' },
  { level: 3, label: 'III', main: '#24579d', dark: '#0d2b5c', edge: '#8ec0f5', name: '三级牌库' }
];

/**
 * 卡名：按「产出宝石 × 等级」分组，张数必须是 8 / 6 / 4。
 * 官方卡面没有卡名（只有点数、红利色与成本），这里是原创命名，
 * 按组索引一一对应，保证 90 张卡不会重名。
 */
const CARD_NAMES = {
  white: {
    1: ['雪原商路', '白石教堂', '霜港集市', '云顶修道院', '银盐矿场', '北境驿站', '晨雾码头', '石膏工坊'],
    2: ['冰湖采石场', '白垩悬崖', '素银车坊', '珍珠贡船', '苍鹭塔楼', '雪花石膏窖'],
    3: ['云杉货栈', '象牙雕坊', '月白纱行', '北岭铁匠铺']
  },
  blue: {
    1: ['深海航路', '蓝釉工坊', '潮汐港湾', '蔚蓝书院', '苍穹灯塔', '靛蓝染坊', '星夜水渠', '远洋船坞'],
    2: ['青金石巷', '海图绘制所', '蓝铜矿脉', '夜航船队', '潮声钟楼', '深湾灯塔'],
    3: ['天青石磨坊', '蓝帆会馆', '海盐梯田', '靛青货栈']
  },
  green: {
    1: ['翡翠梯田', '林间驿站', '苔石庭院', '青藤酒坊', '翠谷磨坊', '松风猎场', '碧潭水车', '香草园圃'],
    2: ['绿荫织坊', '孔雀石矿', '橄榄油坊', '藤架长廊', '青苔石桥', '翠鸟渡口'],
    3: ['常春藤书院', '松脂工坊', '碧玉雕楼', '林间蜂场']
  },
  red: {
    1: ['赤陶窑场', '朱砂市集', '熔炉长街', '绯红剧场', '丹霞驿站', '炭火铁铺', '石榴庭院', '晚霞钟楼'],
    2: ['胭脂染坊', '红铜铸造所', '火漆印章坊', '珊瑚商栈', '赤岩酒窖', '石榴石矿'],
    3: ['红绸织造所', '炭窑山口', '朱雀剧院', '铁锈渡桥']
  },
  black: {
    1: ['黑曜矿坑', '玄石高塔', '夜市商队', '墨玉工坊', '玄武岩门', '暮色酒馆', '乌木书库', '暗河渡口'],
    2: ['墨晶矿脉', '黑铁砧坊', '乌鸦钟楼', '夜枭货栈', '玄岩浴场', '沥青矿井'],
    3: ['黑檀雕刻室', '暗巷钱庄', '乌木船坞', '影子剧院']
  }
};

// 贵族牌池：官方 10 张 —— 5 张「双色各 4 张」+ 5 张「三色各 3 张」
// 双色组合：(白,蓝) (白,黑) (蓝,绿) (绿,红) (黑,红)
// 三色组合：(黑,蓝,白) (黑,绿,红) (黑,红,白) (蓝,绿,红) (蓝,绿,白)
// 注意：这不是「任取 5 组」，改动会直接改变贵族路线强度，回归里有指纹断言
const NOBLE_POOL = [
  { id: 'n1', req: { white: 4, blue: 4, green: 0, red: 0, black: 0 }, title: '霜港勋爵' },
  { id: 'n2', req: { white: 4, blue: 0, green: 0, red: 0, black: 4 }, title: '铸币大臣' },
  { id: 'n3', req: { white: 0, blue: 4, green: 4, red: 0, black: 0 }, title: '航海总会' },
  { id: 'n4', req: { white: 0, blue: 0, green: 4, red: 4, black: 0 }, title: '紫藤伯爵' },
  { id: 'n5', req: { white: 0, blue: 0, green: 0, red: 4, black: 4 }, title: '矿脉总督' },
  { id: 'n6', req: { white: 3, blue: 3, green: 0, red: 0, black: 3 }, title: '绸缎巨商' },
  { id: 'n7', req: { white: 0, blue: 0, green: 3, red: 3, black: 3 }, title: '香料领主' },
  { id: 'n8', req: { white: 3, blue: 0, green: 0, red: 3, black: 3 }, title: '枢密顾问' },
  { id: 'n9', req: { white: 0, blue: 3, green: 3, red: 3, black: 0 }, title: '宫廷建筑师' },
  { id: 'n10', req: { white: 3, blue: 3, green: 3, red: 0, black: 0 }, title: '远洋提督' }
];

/**
 * 官方 90 张发展卡，逐张对应，顺序即分组顺序（等级 → 产出宝石）。
 * 元组：[等级, 产出宝石, 声望, 白, 蓝, 绿, 红, 黑]
 * 成本列顺序与 GEMS 一致；成本中可能出现该卡自身的红利色（原作如此）。
 * 分组必须保持「每色一级 8 张 → 二级 6 张 → 三级 4 张」，
 * 卡面插画与卡名都按这个顺序取槽位（5 色 × 18 = 90 个插画位）。
 */
const OFFICIAL_CARDS = [
  // ===== 一级：40 张（每色 8 张，其中 1 张 1 声望）=====
  [1, 'white', 0, 0, 1, 1, 1, 1],
  [1, 'white', 0, 0, 1, 2, 1, 1],
  [1, 'white', 0, 0, 2, 2, 0, 1],
  [1, 'white', 0, 3, 1, 0, 0, 1],
  [1, 'white', 0, 0, 0, 0, 2, 1],
  [1, 'white', 0, 0, 2, 0, 0, 2],
  [1, 'white', 0, 0, 3, 0, 0, 0],
  [1, 'white', 1, 0, 0, 4, 0, 0],
  [1, 'blue', 0, 1, 0, 1, 1, 1],
  [1, 'blue', 0, 1, 0, 1, 2, 1],
  [1, 'blue', 0, 1, 0, 2, 2, 0],
  [1, 'blue', 0, 0, 1, 3, 1, 0],
  [1, 'blue', 0, 1, 0, 0, 0, 2],
  [1, 'blue', 0, 0, 0, 2, 0, 2],
  [1, 'blue', 0, 0, 0, 0, 0, 3],
  [1, 'blue', 1, 0, 0, 0, 4, 0],
  [1, 'green', 0, 1, 1, 0, 1, 1],
  [1, 'green', 0, 1, 1, 0, 1, 2],
  [1, 'green', 0, 0, 1, 0, 2, 2],
  [1, 'green', 0, 1, 3, 1, 0, 0],
  [1, 'green', 0, 2, 1, 0, 0, 0],
  [1, 'green', 0, 0, 2, 0, 2, 0],
  [1, 'green', 0, 0, 0, 0, 3, 0],
  [1, 'green', 1, 0, 0, 0, 0, 4],
  [1, 'red', 0, 1, 1, 1, 0, 1],
  [1, 'red', 0, 2, 1, 1, 0, 1],
  [1, 'red', 0, 2, 0, 1, 0, 2],
  [1, 'red', 0, 1, 0, 0, 1, 3],
  [1, 'red', 0, 0, 2, 1, 0, 0],
  [1, 'red', 0, 2, 0, 0, 2, 0],
  [1, 'red', 0, 3, 0, 0, 0, 0],
  [1, 'red', 1, 4, 0, 0, 0, 0],
  [1, 'black', 0, 1, 1, 1, 1, 0],
  [1, 'black', 0, 1, 2, 1, 1, 0],
  [1, 'black', 0, 2, 2, 0, 1, 0],
  [1, 'black', 0, 0, 0, 1, 3, 1],
  [1, 'black', 0, 0, 0, 2, 1, 0],
  [1, 'black', 0, 2, 0, 2, 0, 0],
  [1, 'black', 0, 0, 0, 3, 0, 0],
  [1, 'black', 1, 0, 4, 0, 0, 0],

  // ===== 二级：30 张（每色 6 张，2×1 分 / 3×2 分 / 1×3 分）=====
  [2, 'white', 1, 0, 0, 3, 2, 2],
  [2, 'white', 1, 2, 3, 0, 3, 0],
  [2, 'white', 2, 0, 0, 1, 4, 2],
  [2, 'white', 2, 0, 0, 0, 5, 3],
  [2, 'white', 2, 0, 0, 0, 5, 0],
  [2, 'white', 3, 6, 0, 0, 0, 0],
  [2, 'blue', 1, 0, 2, 2, 3, 0],
  [2, 'blue', 1, 0, 2, 3, 0, 3],
  [2, 'blue', 2, 5, 3, 0, 0, 0],
  [2, 'blue', 2, 2, 0, 0, 1, 4],
  [2, 'blue', 2, 0, 5, 0, 0, 0],
  [2, 'blue', 3, 0, 6, 0, 0, 0],
  [2, 'green', 1, 3, 0, 2, 3, 0],
  [2, 'green', 1, 2, 3, 0, 0, 2],
  [2, 'green', 2, 4, 2, 0, 0, 1],
  [2, 'green', 2, 0, 5, 3, 0, 0],
  [2, 'green', 2, 0, 0, 5, 0, 0],
  [2, 'green', 3, 0, 0, 6, 0, 0],
  [2, 'red', 1, 2, 0, 0, 2, 3],
  [2, 'red', 1, 0, 3, 0, 2, 3],
  [2, 'red', 2, 1, 4, 2, 0, 0],
  [2, 'red', 2, 3, 0, 0, 0, 5],
  [2, 'red', 2, 0, 0, 0, 0, 5],
  [2, 'red', 3, 0, 0, 0, 6, 0],
  [2, 'black', 1, 3, 2, 2, 0, 0],
  [2, 'black', 1, 3, 0, 3, 0, 2],
  [2, 'black', 2, 0, 1, 4, 2, 0],
  [2, 'black', 2, 0, 0, 5, 3, 0],
  [2, 'black', 2, 5, 0, 0, 0, 0],
  [2, 'black', 3, 0, 0, 0, 0, 6],

  // ===== 三级：20 张（每色 4 张，3 / 4 / 4 / 5 分）=====
  [3, 'white', 3, 0, 3, 3, 5, 3],
  [3, 'white', 4, 0, 0, 0, 0, 7],
  [3, 'white', 4, 3, 0, 0, 3, 6],
  [3, 'white', 5, 3, 0, 0, 0, 7],
  [3, 'blue', 3, 3, 0, 3, 3, 5],
  [3, 'blue', 4, 7, 0, 0, 0, 0],
  [3, 'blue', 4, 6, 3, 0, 0, 3],
  [3, 'blue', 5, 7, 3, 0, 0, 0],
  [3, 'green', 3, 5, 3, 0, 3, 3],
  [3, 'green', 4, 0, 7, 0, 0, 0],
  [3, 'green', 4, 3, 6, 3, 0, 0],
  [3, 'green', 5, 0, 7, 3, 0, 0],
  [3, 'red', 3, 3, 5, 3, 0, 3],
  [3, 'red', 4, 0, 0, 7, 0, 0],
  [3, 'red', 4, 0, 3, 6, 3, 0],
  [3, 'red', 5, 0, 0, 7, 3, 0],
  [3, 'black', 3, 3, 3, 5, 3, 0],
  [3, 'black', 4, 0, 0, 0, 7, 0],
  [3, 'black', 4, 0, 0, 3, 6, 3],
  [3, 'black', 5, 0, 0, 0, 7, 3]
];

// 确定性伪随机，保证同一种子的牌序可复现（回归测试用）
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

/**
 * 生成三副牌库：牌面数值固定（官方卡表），牌序每局随机。
 * 牌序随机使用外部随机源，默认 Math.random。
 */
function buildDecks(shuffleRand) {
  const shuff = shuffleRand || Math.random;
  const decks = [[], [], []];
  // 每色 18 张卡对应 18 个插画槽位（5 色 × 18 = 90），保证 90 张卡面各用一次
  const artCursor = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
  // 卡名按「宝石 + 等级」组内顺序取，组内张数与 CARD_NAMES 一一对应
  const nameCursor = {};
  const levelCursor = [0, 0, 0];

  for (let i = 0; i < OFFICIAL_CARDS.length; i++) {
    const row = OFFICIAL_CARDS[i];
    const level = row[0];
    const gem = row[1];
    const cost = emptyCost();
    for (let g = 0; g < GEMS.length; g++) {
      cost[GEMS[g]] = row[3 + g];
    }

    const nameKey = gem + '-' + level;
    const nameIdx = nameCursor[nameKey] || 0;
    nameCursor[nameKey] = nameIdx + 1;
    const names = CARD_NAMES[gem][level];

    levelCursor[level - 1] += 1;
    decks[level - 1].push({
      id: 'L' + level + '-' + (levelCursor[level - 1] < 10 ? '0' : '') + levelCursor[level - 1],
      level: level,
      points: row[2],
      gem: gem,
      cost: cost,
      name: names[nameIdx],
      art: artCursor[gem]++
    });
  }

  decks.forEach(function (list) { shuffle(list, shuff); });
  return decks;
}

/** 抽取本局贵族牌（人数 + 1 张，2 人局 3 张） */
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
  OFFICIAL_CARDS: OFFICIAL_CARDS,
  emptyCost: emptyCost,
  mulberry32: mulberry32,
  shuffle: shuffle,
  buildDecks: buildDecks,
  buildNobles: buildNobles
};
