'use strict';

const D = require('./game-data.js');
const DEFAULT_ID = 'royal';
const DEFAULT_ROOM_ID = 'pixel';
const THEMES = [
  { id: 'genshin', name: '原神', tag: 'TEYVAT', description: '提瓦特冒险 · 星海鎏金 · 元素之旅' },
  // 皇家商会只作为首页大厅与未知主题回退，不再出现在房间主题选择中。
  { id: 'royal', name: '皇家商会', tag: 'RENAISSANCE', description: '酒红丝绒 · 鎏金画框 · 古典油画', selectable: false },
  { id: 'pokemon', name: '宝可梦', tag: 'POKEMON', description: '伙伴冒险 · 明亮草地 · 训练师卡册' },
  { id: 'pixel', name: '红白机像素', tag: '8-BIT FAMICOM', description: '轻快像素 · 经典红白机 · 卡带冒险' },
  // { id: 'cyberpunk', name: '赛博朋克', tag: 'NIGHT CITY', description: '雨夜街区 · 霓虹线路 · 铬金属' }, // 暂时停用
  // { id: 'ai', name: 'AI 大模型拟人', tag: 'MODEL PERSONAS', description: '模型化身 · 角色档案 · 晶白实验室' }, // 暂时停用
  { id: 'immortal', name: '凡人修仙传', tag: 'MORTAL JOURNEY', description: '云海青绿 · 慕兰烽烟 · 元婴问道' }
];
const CAPTIONS = {
  genshin: ['温迪', '钟离', '雷电影', '纳西妲', '芙宁娜', '玛薇卡', '空', '荧', '派蒙'],
  pokemon: ['皮卡丘', '妙蛙种子', '杰尼龟', '小火龙', '伊布', '可达鸭', '卡比兽', '快龙', '耿鬼'],
  pixel: ['跳跳勇者', '蘑菇草坡', '星际战机', '彩砖工坊', '史莱姆', '坦克堡垒', '天空飞艇', '像素骑士', '红白主机', '森林猎手', '迷宫法师', '机械飞龙'],
  cyberpunk: ['雨夜集市', '义体信使', '高架航线', '服务器圣殿', '红区黑客', '城市蜂群', '疾速骑手', '生态穹顶', '信号乌鸦'],
  ai: ['GPT', 'Claude', 'Gemini', 'DeepSeek', 'Qwen', 'Grok', 'Llama', 'GLM', '豆包'],
  immortal: ['韩立', '南宫婉', '紫灵', '银月', '乐上师', '仲神师', '元瑶', '啼魂', '慕沛灵', '宋玉', '梅凝', '董萱儿']
};
const CARD_VARIANTS = {
  genshin: ['启程', '相遇', '探索', '秘境', '共鸣', '命座', '远行', '祈愿', '协奏', '突破', '星辉', '传说'],
  pokemon: ['初遇', '同行', '野营', '特训', '羁绊', '冠军', '探险', '远行', '协作', '进阶', '巅峰', '传说'],
  pixel: ['关卡', '金币', '加命', '跳台', '秘道', '宝箱', '道具', '连击', '通关', '隐藏', '星币', '无敌'],
  cyberpunk: ['信标', '中继', '潜入', '网关', '矩阵', '觉醒', '暗线', '脉冲', '协议', '零日', '超频', '奇点'],
  ai: ['提示', '检索', '推理', '编排', '校准', '涌现', '对话', '记忆', '协作', '规划', '对齐', '智核'],
  immortal: ['练气', '筑基', '结丹', '元婴', '化神', '炼虚', '合体', '大乘', '渡劫', '灵界', '飞升', '真仙']
};
const NOBLE_RANKS = {
  genshin: ['引路人', '守望者'],
  pokemon: ['徽章', '殿堂'],
  pixel: ['达人', '冠军'],
  cyberpunk: ['董事', '议长'],
  ai: ['导师', '首席'],
  immortal: ['真人', '道祖']
};
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

function caption(id, index) {
  const names = CAPTIONS[id];
  return names ? names[index % names.length] : '';
}

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
  const names = CAPTIONS[theme];
  if (!names) return original;
  return caption(theme, (entry.index + 3) % names.length) + '·' + NOBLE_RANKS[theme][entry.index < 9 ? 0 : 1];
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
function selectable(id) {
  return THEMES.some(function (theme) { return theme.id === id && theme.selectable !== false; });
}
function normalize(id) { return has(id) ? id : DEFAULT_ID; }
function normalizeRoom(id) { return selectable(id) ? id : DEFAULT_ROOM_ID; }

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
  return THEMES.filter(function (theme) { return theme.selectable !== false; }).map(function (theme) {
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

module.exports = { DEFAULT_ID: DEFAULT_ID, DEFAULT_ROOM_ID: DEFAULT_ROOM_ID, has: has, selectable: selectable,
  normalize: normalize, normalizeRoom: normalizeRoom, requestedId: requestedId, caption: caption,
  cardName: cardName, nobleTitle: nobleTitle, text: text, resolve: resolve, list: list,
  fromSeats: fromSeats, withRoomTheme: withRoomTheme, roomId: roomId, forView: forView };
