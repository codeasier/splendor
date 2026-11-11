'use strict';

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
  ai: ['GPT · 策略师', 'Claude · 写作者', 'Gemini · 探索者', 'DeepSeek · 研究员', 'Qwen · 语言学者', 'Grok · 工程师', 'Llama · 发明家', 'GLM · 晶核学者', '豆包 · 创作者']
};

function caption(id, index) { return CAPTIONS[id] ? CAPTIONS[id][index % 9] : ''; }

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
  resolve: resolve, list: list, fromSeats: fromSeats, withRoomTheme: withRoomTheme, roomId: roomId, forView: forView };
