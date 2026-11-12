'use strict';

const D = require('./game-data.js');
const DEFAULT_ID = 'royal';
const THEMES = [
  { id: 'royal', name: '皇家商会', tag: 'RENAISSANCE', description: '酒红丝绒 · 鎏金画框 · 古典油画' },
  { id: 'pokemon', name: '宝可梦', tag: 'POKEMON', description: '伙伴冒险 · 明亮草地 · 训练师卡册' },
  { id: 'cyberpunk', name: '赛博朋克', tag: 'NIGHT CITY', description: '雨夜街区 · 霓虹线路 · 铬金属' },
  { id: 'ai', name: 'AI 大模型拟人', tag: 'MODEL PERSONAS', description: '模型化身 · 角色档案 · 晶白实验室' }
];
const CAPTIONS = {
  pokemon: ['皮卡丘', '妙蛙种子', '杰尼龟', '小火龙', '伊布', '可达鸭', '卡比兽', '快龙', '耿鬼'],
  cyberpunk: ['雨夜集市', '义体信使', '高架航线', '服务器圣殿', '红区黑客', '城市蜂群', '疾速骑手', '生态穹顶', '信号乌鸦'],
  ai: ['GPT', 'Claude', 'Gemini', 'DeepSeek', 'Qwen', 'Grok', 'Llama', 'GLM', '豆包']
};
const CARD_VARIANTS = {
  pokemon: ['初遇', '同行', '野营', '特训', '羁绊', '冠军', '探险', '远行', '协作', '进阶', '巅峰', '传说'],
  cyberpunk: ['信标', '中继', '潜入', '网关', '矩阵', '觉醒', '暗线', '脉冲', '协议', '零日', '超频', '奇点'],
  ai: ['提示', '检索', '推理', '编排', '校准', '涌现', '对话', '记忆', '协作', '规划', '对齐', '智核']
};
const NOBLE_RANKS = { pokemon: ['徽章', '殿堂'], cyberpunk: ['董事', '议长'], ai: ['导师', '首席'] };
let catalog;

function getCatalog() {
  if (catalog) return catalog;
  catalog = { cards: Object.create(null), names: Object.create(null), nobles: Object.create(null), titles: Object.create(null) };
  D.buildDecks(function () { return 0.5; }).forEach(function (deck) {
    deck.forEach(function (card) { catalog.cards[card.id] = card; catalog.names[card.name] = card; });
  });
  D.NOBLE_POOL.forEach(function (noble, index) {
    const entry = { noble: noble, index: index };
    catalog.nobles[noble.id] = entry;
    catalog.titles[noble.title] = entry;
  });
  return catalog;
}

function caption(id, index) { return CAPTIONS[id] ? CAPTIONS[id][index % 9] : ''; }

function cardName(id, card) {
  const theme = normalize(id);
  const original = card && card.name || '';
  if (theme === DEFAULT_ID || !card) return original;
  const source = getCatalog().cards[card.id];
  if (!source) return original;
  const gem = D.GEMS.indexOf(source.gem);
  const slot = gem * 3 + source.art % 3;
  // Match the nine atlas portraits; disambiguate repeated portraits across all 90 cards.
  const variant = Math.floor(gem / 3) * 6 + Math.floor(source.art / 3);
  return caption(theme, slot) + '·' + CARD_VARIANTS[theme][variant];
}

function nobleTitle(id, noble) {
  const theme = normalize(id);
  const original = noble && noble.title || '';
  if (theme === DEFAULT_ID || !noble) return original;
  const entry = getCatalog().nobles[noble.id];
  if (!entry) return original;
  return caption(theme, (entry.index + 3) % 9) + '·' + NOBLE_RANKS[theme][entry.index < 9 ? 0 : 1];
}

// Translate canonical action text at the view boundary, including old/remote snapshots.
function text(id, value) {
  if (!value || normalize(id) === DEFAULT_ID) return value;
  return value.replace(/(预留|购入|获得贵族)「([^」]+)」/g, function (match, verb, name) {
    const entries = getCatalog();
    if (entries.names[name]) return verb + '「' + cardName(id, entries.names[name]) + '」';
    if (entries.titles[name]) return verb + '「' + nobleTitle(id, entries.titles[name].noble) + '」';
    return match;
  });
}

function has(id) { return THEMES.some(function (theme) { return theme.id === id; }); }
function normalize(id) { return has(id) ? id : DEFAULT_ID; }

// Preserve unknown room IDs for explicit fallback notices on older clients.
function requestedId(id) {
  return typeof id === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(id) ? id : DEFAULT_ID;
}

function resolve(id) {
  const requested = requestedId(id);
  const actual = normalize(requested);
  const entry = THEMES.filter(function (theme) { return theme.id === actual; })[0];
  return Object.assign({}, entry, { requestedId: requested, fallback: requested !== actual });
}

function list(active) {
  return THEMES.map(function (theme) {
    return Object.assign({}, theme, { active: theme.id === normalize(active) });
  });
}

function fromSeats(seats) {
  return requestedId(seats && seats[0] && seats[0].roomThemeId);
}

// The fixed host seat carries room presentation metadata in existing JSONB.
// This keeps theme transport compatible with the deployed room-table schema.
function withRoomTheme(seats, id) {
  return (seats || []).map(function (seat, index) {
    return index === 0 ? Object.assign({}, seat, { roomThemeId: requestedId(id) }) : Object.assign({}, seat);
  });
}

function roomId(room) {
  return requestedId(room && room.themeId !== undefined ? room.themeId : fromSeats(room && room.seats));
}

function forView(screen, state, room) {
  if (screen === 'game' && state && state.themeId !== undefined) return resolve(state.themeId);
  return resolve(screen === 'home' ? DEFAULT_ID : roomId(room));
}

module.exports = { DEFAULT_ID: DEFAULT_ID, has: has, normalize: normalize, requestedId: requestedId, caption: caption,
  cardName: cardName, nobleTitle: nobleTitle, text: text, resolve: resolve, list: list,
  fromSeats: fromSeats, withRoomTheme: withRoomTheme, roomId: roomId, forView: forView };
