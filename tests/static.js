'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function fail(msg) { console.error('FAIL: ' + msg); process.exitCode = 1; }
function ok(msg) { console.log('OK  ' + msg); }

// 1. 严格 JSON
const jsonFiles = ['app.json', 'project.config.json', 'sitemap.json', 'pages/index/index.json', '.workbuddy/miniprogram-scaffold.json'];
jsonFiles.forEach(function (f) {
  try { JSON.parse(read(f)); ok('JSON ' + f); }
  catch (e) { fail('JSON ' + f + ' -> ' + e.message); }
});
const appJson = JSON.parse(read('app.json'));
if (!appJson.pages || !appJson.pages.length) fail('app.json pages 为空');
if (appJson.lazyCodeLoading !== 'requiredComponents') fail('缺少 lazyCodeLoading');
appJson.pages.forEach(function (p) {
  ['js', 'wxml'].forEach(function (ext) {
    if (!fs.existsSync(path.join(ROOT, p + '.' + ext))) fail('缺少页面文件 ' + p + '.' + ext);
  });
});
ok('app.json pages / lazyCodeLoading / 页面文件齐全');

// 2. JS 语法
const jsFiles = ['app.js', 'pages/index/index.js', 'utils/game-data.js', 'utils/game-engine.js', 'utils/ai.js'];
jsFiles.forEach(function (f) {
  const src = read(f);
  try { new Function(src); ok('JS 语法 ' + f); }
  catch (e) { fail('JS 语法 ' + f + ' -> ' + e.message); }
});

// 3. WXML 标签平衡
const wxml = read('pages/index/index.wxml');
const tagRe = /<\/?([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
const stack = [];
let m;
const VOID = [];
while ((m = tagRe.exec(wxml)) !== null) {
  const full = m[0];
  const name = m[1];
  const selfClose = m[3] === '/' || /\/\s*$/.test(full);
  if (full.startsWith('</')) {
    if (stack.length === 0 || stack[stack.length - 1] !== name) {
      fail('WXML 标签闭合不匹配，遇到 </' + name + '>，栈顶=' + (stack[stack.length - 1] || '空'));
      break;
    }
    stack.pop();
  } else if (!selfClose) {
    stack.push(name);
  }
}
if (stack.length) fail('WXML 存在未闭合标签: ' + stack.join(','));
else ok('WXML 标签闭合平衡');

// 3.1 舞台必须包住全部屏幕层与弹层。
// 顶层只有 [viewport] 一个节点、其次是 [stage]。任何一个 </view> 写多了，
// 后面的 room-screen / 所有 overlay 就会掉出 .stage —— 它们不再被
// transform:scale() 缩放，按 1080px 逻辑坐标 1:1 渲染，手机屏宽 844px，
// 弹窗右边直接出屏（2026-11-10 好友弹窗事故）。标签仍然「平衡」，上面的
// 检查抓不到，必须单独断言结构。
(function () {
  const tagRe2 = /<\/?view\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  const stack2 = [];
  let m2;
  let rootCount = 0;
  let stageDepth = -1;
  const stray = [];
  while ((m2 = tagRe2.exec(wxml)) !== null) {
    const attrs = m2[1];
    const full = m2[0];
    if (full.startsWith('</')) {
      if (!stack2.length) break;
      stack2.pop();
      continue;
    }
    if (!stack2.length) {
      rootCount += 1;
      if (!/class="viewport(?:\s[^"]*)?"/.test(attrs)) stray.push('根节点不是 .viewport');
    } else if (stack2.length === 1 && /\bclass="stage\b/.test(attrs)) {
      stageDepth = 2;
    }
    stack2.push(attrs);
  }
  if (rootCount !== 1) stray.push('根节点数量=' + rootCount + '，应为 1');
  if (stageDepth < 0) stray.push('.stage 不是 .viewport 的第二层');
  // 每个屏幕层 / 弹层都必须在 .stage 内，即深度 ≥ 3
  const deepRe = /<view\b((?:[^>"']|"[^"]*"|'[^']*')*?class="(?:screen-layer|overlay)[^"]*"(?:[^>"']|"[^"]*"|'[^']*')*?)>/g;
  let dm2;
  const depths = [];
  while ((dm2 = deepRe.exec(wxml)) !== null) {
    // 统计该位置之前未闭合的 view 数
    let d = 0;
    const before = wxml.slice(0, dm2.index);
    const re3 = /<\/?view\b(?:[^>"']|"[^"]*"|'[^']*')*?>/g;
    let m3;
    while ((m3 = re3.exec(before)) !== null) {
      if (m3[0].startsWith('</')) d -= 1; else if (!/\/>$/.test(m3[0])) d += 1;
    }
    depths.push({ cls: (dm2[1].match(/class="([^"]*)"/) || [])[1], depth: d });
  }
  const out = depths.filter(function (x) { return x.depth < 2; });
  if (stray.length) fail('WXML 舞台结构异常: ' + stray.join('; '));
  else if (out.length) fail('有屏幕层/弹层掉出 .stage（不再随舞台缩放，会 1:1 出屏）: ' + out.map(function (x) { return x.cls; }).join(', '));
  else ok('WXML 舞台完整包住屏幕层与弹层 (' + depths.length + ' 个)');
})();

// 3.2 新增 utils 模块必须同时注册进 H5 预览编译器：只改页面 require 而漏了
// moduleFiles，预览里拿到的会是空对象，真机正常、H5 白屏，极难排查。
(function () {
  const buildJs = read('preview/build.js');
  ['chat', 'leaderboard', 'entertainment'].forEach(function (name) {
    const decl = "['" + name + "', 'utils/" + name + ".js']";
    if (buildJs.indexOf(decl) < 0) fail('preview/build.js 未注册模块: ' + name);
  });
  ok('H5 预览模块注册表覆盖新增 utils');
})();

// 3.3 昵称脱敏：展示层不得直接读 .nickname 拼进视图模型。
// 第四十六轮只覆盖了 3 个出口，实测还漏了 8 处（大厅 / 回合提示 / 结算标题 /
// 终局提示 / 贵族等待 / 对手卡 / 设置页首字 / 分享卡片）。逐处改完后，
// 这里锁住「不许再出现裸读」，新增展示位时会被立刻拦下。
(function () {
  const pageSrc = read('pages/index/index.js');
  // 允许的例外：写入 state / 上云 / 建好友关系时保留原值（展示层统一出口负责过滤）、
  // 设置页输入框按设计显示原字、profileDraft 编辑态、注释行。
  const allowed = [
    /const src = \(p && \(p\.nickname \|\| p\.name\)\)/,   // displayName 本体
    /nickname: draft\.nickname \|\| ''/,                    // 设置页输入框
    /nickname: nickname,/,                                  // saveProfile 写入
    /name: that\.profile\.nickname, nickname: that\.profile\.nickname/,  // 登录后写席位
    /p\.nickname = that\.profile\.nickname/,                // 同上
    /p\.name = that\.profile\.nickname/,                    // 同上
    /me\.nickname = name;/,                                 // applySelfProfileToState
    /seat\.nickname = name;/,                               // 同上
    /const name = p\.nickname \|\| '珠宝商';/,               // 同上：写入 state 用原值，
                                                            // 所有展示位在 VM 出口统一过滤
    /L\.entryOf\(p\.uid, p\.nickname/,                      // 榜单上云：存原值，展示层过滤
    /F\.addFriend\(me, found\.uid, found\.nickname\)/,       // 好友关系存原值，列表出口过滤
    /^\s*\*/,                                               // 注释行
    /profileDraft\.nickname/,                               // 编辑草稿
    /const nickname = String\(d\.nickname/                  // 保存前清洗
  ];
  const bad = [];
  pageSrc.split('\n').forEach(function (line, i) {
    if (!/\.nickname\b/.test(line)) return;
    if (allowed.some(function (re) { return re.test(line); })) return;
    // 已经走 displayName / Nick.maskName 的行是安全的
    if (/displayName\(|maskName\(/.test(line)) return;
    bad.push((i + 1) + ': ' + line.trim().slice(0, 90));
  });
  if (bad.length) fail('展示层存在未脱敏的昵称直读（请改用 displayName()）:\n    ' + bad.join('\n    '));
  else ok('昵称脱敏 · 展示层无裸读 .nickname');

  // 分享卡片 desc 会直接展示给别人，也必须过滤
  const roomSrc = read('utils/room.js');
  if (!/desc: Nick\.maskName\(p\.nickname\)/.test(roomSrc)) {
    fail('分享卡片 desc 未脱敏 —— 会把自己的敏感字昵称发给所有人');
  } else ok('昵称脱敏 · 分享卡片 desc');
})();

// 4. 事件绑定必须存在对应 JS 方法
const pageJs = read('pages/index/index.js');
const handlers = new Set();
let hm;
const bindRe = /\b(?:bind|catch)(?:tap|touch|longpress|input|change)="([A-Za-z_$][\w$]*)"/g;
while ((hm = bindRe.exec(wxml)) !== null) handlers.add(hm[1]);
handlers.forEach(function (name) {
  const re = new RegExp('(^|\\n)\\s*' + name + '\\s*\\(', 'm');
  if (!re.test(pageJs)) fail('WXML 绑定了不存在的处理函数: ' + name);
});
ok('WXML 事件处理函数全部存在 (' + handlers.size + ' 个)');

// 5. WXML 顶层数据字段必须在 buildViewModel 返回值 / data 中
const vm = read('pages/index/index.js');
const vmSection = vm.slice(vm.indexOf('function buildViewModel'));
const returnSection = vmSection.slice(vmSection.indexOf('return {'));
const declaredFields = new Set(['item', 'index', 'card', 'cost', 'row', 'req', 'cell', 'ri', 'ci', 'true', 'false']);
let dm;
const fieldRe = /^\s{4}([A-Za-z_$][\w$]*)\s*:/gm;
while ((dm = fieldRe.exec(returnSection)) !== null) declaredFields.add(dm[1]);
// 页面初始 data
['stageScale'].forEach(function (f) { declaredFields.add(f); });

const roots = new Set();
let rm;
const mustacheRe = /\{\{([\s\S]*?)\}\}/g;
while ((rm = mustacheRe.exec(wxml)) !== null) {
  // 去掉字符串字面量和属性访问，只保留根变量
  const expr = rm[1].replace(/'[^']*'|"[^"]*"/g, ' ').replace(/\.\s*[A-Za-z_$][\w$]*/g, ' ');
  const idRe = /[A-Za-z_$][\w$]*/g;
  let im;
  while ((im = idRe.exec(expr)) !== null) roots.add(im[0]);
}
const missing = [];
roots.forEach(function (r) { if (!declaredFields.has(r)) missing.push(r); });
if (missing.length) fail('WXML 引用了未在视图模型中声明的根变量: ' + missing.join(', '));
else ok('WXML 根变量均有对应视图模型声明 (' + roots.size + ' 个)');

// 6. WXSS 括号平衡
const wxss = read('pages/index/index.wxss');
let depth = 0;
for (let i = 0; i < wxss.length; i++) {
  if (wxss[i] === '{') depth += 1;
  if (wxss[i] === '}') depth -= 1;
  if (depth < 0) { fail('WXSS 多余的 }'); break; }
}
if (depth !== 0) fail('WXSS 大括号不平衡，剩余 ' + depth);
else ok('WXSS 大括号平衡');

// 7. 天梯榜布局守卫：这几条约束是反复调试后才稳定的，改坏会导致
//    表格压住公式文字、说明文字被裁、或提示条与半截行重叠。
{
  const rules = [
    // 提示条必须在 body 里作为独立行，不能在 wrap 内绝对定位覆盖
    [/\.leaderboard-scroll-hint\s*\{[^}]*position:\s*static/, '提示条应为独立行（position: static），不能覆盖表格'],
    // wrap 必须与表格同高写死，否则塌陷后提示条上提到表格内部
    [/\.leaderboard-table-wrap\s*\{[^}]*height:\s*\d+px/, 'wrap 必须写死高度，否则塌陷导致提示条错位'],
    // body 必须允许滚动，写 hidden 会静默裁掉说明文字
    // body 的滚动约束由下方「overflow: hidden」独立检查负责（正则跨行匹配不稳）
    // 表格高度上限要留出三行文字的空间
    [/\.leaderboard-table\s*\{[^}]*max-height:\s*\d+px/, '表格需有 max-height 上限'],
  ];
  let bad = [];
  rules.forEach(function (pair) {
    if (!pair[0].test(wxss)) bad.push(pair[1]);
  });
  if (bad.length) fail('天梯榜布局守卫: ' + bad.join('；'));
  else ok('天梯榜布局守卫（提示条独立行 / wrap 定高 / body 可滚 / 表格限高）');

  // 同一条规则里不能同时出现 overflow: hidden 与 overflow-y: auto（后者会被覆盖）
  const bodyRule = /\.leaderboard-body\s*\{([^}]*)\}/.exec(wxss);
  if (bodyRule && /overflow:\s*hidden/.test(bodyRule[1])) {
    fail('leaderboard-body 内不得写 overflow: hidden（会覆盖 overflow-y: auto 并裁掉文字）');
  }
}

// 7.5 房主移出按钮：必须 catchtap，否则冒泡触发整张席位卡的 onRoomSeatTap
if (/bindtap="onRoomKick"/.test(wxml)) {
  fail('移出按钮必须用 catchtap，bindtap 会冒泡到席位卡触发准备 / 机器人切换');
} else if (!/catchtap="onRoomKick"/.test(wxml)) {
  fail('房间席位卡缺少房主「移出」按钮');
} else {
  ok('房主移出按钮使用 catchtap（不冒泡触发整卡）');
}

// 7.6 超时「立即」：旧实现让倒计时归 0 后房主还要再等 12 秒才代打，
// 代码与规则文案必须同时把这段宽限去掉，否则又会变成「算对了但没生效」。
if (/over\s*<\s*12/.test(pageJs)) {
  fail('超时路径不得再保留 12 秒二次宽限，倒计时归 0 必须立即代打');
} else if (/宽限\s*12\s*秒/.test(wxml)) {
  fail('规则文案仍在描述「宽限 12 秒后接管」，与代码不一致');
} else {
  ok('超时立即代打 · 无 12 秒宽限 / 规则文案同步');
}

// 7.6 聊天面板防误触：三态（快捷语 / 表情 / 选目标）必须共用定高容器，
// 否则切换瞬间面板骤缩骤长，手指还停在原位时新条目就长到指尖下，
// 抬手误触到别的条目甚至下面的牌桌。
(function () {
  const wxss = read('pages/index/index.wxss');
  if (!/\.chat-body\s*\{[^}]*height:\s*\d+px/.test(wxss)) {
    fail('聊天面板缺少定高容器 .chat-body —— 三个 tab 高度不一致会导致切换误触');
  } else if (!/animation:\s*chatPanelIn/.test(wxss) || /animation:\s*dialogIn/.test(wxss.split('.chat-panel {')[1].split('}')[0] || '')) {
    fail('聊天面板不得再用带位移的 dialogIn —— 入场时元素自己还在移动，抬手会落到邻居上');
  } else {
    ok('聊天面板 · 定高容器 + 无位移入场');
  }
  const chatWxml = wxml;
  const bodyOpen = chatWxml.indexOf('class="chat-body"');
  if (bodyOpen < 0) {
    fail('WXML 未使用 .chat-body 包裹三种面板状态');
  } else {
    // 三个状态的 wx:if 都必须在 .chat-body 之后、其闭合之前
    const after = chatWxml.slice(bodyOpen);
    const okAll = after.indexOf('chat-grid is-text') > 0 &&
      after.indexOf('chat-grid is-emoji') > 0 &&
      after.indexOf('chat-target"') > 0;
    if (!okAll) fail('三态内容未全部放进 .chat-body');
    else ok('聊天面板 · 三态共用定高容器');
  }
})();

// 7.6.1 防误触时间戳必须同时被页面写入与 VM 消费，缺一边等于没锁
(function () {
  const pageSrc2 = read('pages/index/index.js');
  const chatSrc = read('utils/chat.js');
  if (!/tabSwitchAt:\s*ui\.chatTabSwitchAt/.test(pageSrc2) || !/pendingAt:\s*ui\.chatPendingAt/.test(pageSrc2)) {
    fail('页面未把防误触时间戳传给 chatVM');
  } else if (!/TAB_DWELL_MS/.test(chatSrc) || !/TARGET_DWELL_MS/.test(chatSrc)) {
    fail('utils/chat.js 缺少防误触窗口常量');
  } else if (!/Date\.now\(\) - \(this\.ui\.chatTabSwitchAt/.test(pageSrc2) ||
             !/Date\.now\(\) - \(this\.ui\.chatPendingAt/.test(pageSrc2)) {
    fail('页面事件未按防误触窗口短路 —— 常量定义了但没人用');
  } else {
    ok('聊天防误触 · 常量 / VM 判定 / 事件短路三处齐全');
  }
})();

// 7.7 重开投票：弹层按钮必须 catchtap，且预览构建必须注册这个新模块
// （__def 是立即执行，漏注册会在浏览器预览里直接报 module not found）。
if (!/wx:if="\{\{resetVote/.test(wxml)) fail('WXML 缺少重开投票弹层');
['onResetVoteAgree', 'onResetVoteReject', 'onResetVoteRestart', 'onCloseResetVote']
  .forEach(function (name) {
    if (!new RegExp('catchtap="' + name + '"').test(wxml)) {
      fail('投票弹层缺少 ' + name + ' 的 catchtap 绑定');
    }
  });
if (!/catchtap="onMenuRestart"/.test(wxml) && !/onMenuRestart/.test(wxml)) {
  fail('对局菜单缺少「重新开始」入口');
}
const buildJs = read('preview/build.js');
if (!/\['reset-vote',\s*'utils\/reset-vote\.js'\]/.test(buildJs)) {
  fail('preview/build.js 未注册 reset-vote 模块（预览会报 module not found）');
}
ok('重开投票 · 弹层渲染 / catchtap 绑定 / 预览模块已注册');

// 7.9 娱乐模式：模式入口 / 事件处理器 / 技能走引擎分支 / buff 弹层渲染。
// 这类功能最容易漏的是「WXML 加了按钮但 JS 没处理器」和「技能只改数据不结束回合」，
// 这里把两条链路都锁住。
(function () {
  const userSrc = read('utils/user.js');
  const entSrc = read('utils/entertainment.js');
  const engineSrc = read('utils/game-engine.js');
  const wxml = read('pages/index/index.wxml');
  // 模式目录必须注册娱乐模式且可用
  if (!/key:\s*'entertainment'[^}]*available:\s*true/.test(userSrc)) {
    fail('utils/user.js 必须注册可用的 entertainment 模式');
  }
  // 引擎必须有 skill 分支，且调用 endTurn（技能消耗整回合）
  if (!/case\s*'skill'/.test(engineSrc) || !/Ent\.isEntertainment\(state\)/.test(engineSrc)) {
    fail('game-engine 缺少娱乐模式 skill 分支');
  }
  // 娱乐数据层必须拦截「满 10 枚仍窃取」，否则 endTurn 会带 11 枚破坏守恒
  if (!/tokenTotal\(me\)\s*>=\s*10/.test(entSrc)) {
    fail('entertainment.js 缺少「满 10 枚禁止窃取」的守恒保护');
  }
  // WXML 弹层与事件处理器齐全
  ['onPickBuff', 'onOpenSkillPanel', 'onSelectSkill', 'onPickSkillTarget', 'onDismissSkillResult'].forEach(function (fn) {
    if (wxml.indexOf(fn) < 0) fail('娱乐模式 WXML 缺少事件: ' + fn);
    if (pageJs.indexOf(fn + '(') < 0) fail('页面缺少娱乐模式处理器: ' + fn);
  });
  if (wxml.indexOf('buffPick.open') < 0 || wxml.indexOf('skill.open') < 0) {
    fail('娱乐模式弹层未渲染');
  }
  ok('娱乐模式 · 模式注册 / 引擎分支 / 守恒保护 / 事件与弹层齐全');
})();

// 7.10 大厅常驻模式入口：模式选择必须在首页主界面直接可见、可点，
//      而不是只藏在「对局设置」弹层里。与弹层共用 onSelectMode / home.modes。
(function () {
  const wxml = read('pages/index/index.wxml');
  const wxss = read('pages/index/index.wxss');
  // 大厅主界面（screen === 'home'，非弹层）需有 guild-modes 常驻卡片
  const homeBlock = wxml.slice(
    wxml.indexOf("screen === 'home'"),
    wxml.indexOf("screen === 'room'")
  );
  if (homeBlock.indexOf('guild-modes') < 0) {
    fail('大厅主界面缺少常驻模式选择卡片 guild-modes');
  }
  if (homeBlock.indexOf('onSelectMode') < 0 || homeBlock.indexOf('home.modes') < 0) {
    fail('大厅常驻模式卡片必须绑定 onSelectMode 并渲染 home.modes');
  }
  if (!/\.guild-modes\b/.test(wxss)) {
    fail('index.wxss 缺少 .guild-modes 样式');
  }
  ok('大厅常驻模式入口 · 首屏可见 / 绑定 onSelectMode / 样式齐全');
})();

// 7.11 REMOTE_ART 开关：默认必须关闭（内联），且只在 HTTPS 基址下才允许生成外链。
//      开关做错的后果是「H5 正常、真机全白」，所以把默认值与协议校验都锁住。
(function () {
  const artSrc = read('preview/art.js');
  // 默认基址必须为空：保证不设环境变量时行为与历史完全一致（全内联）
  if (!/const REMOTE_ART_BASE = '';/.test(artSrc)) {
    fail('art.js 的 REMOTE_ART_BASE 默认值必须为空字符串（默认走内联）');
  }
  // 非 HTTPS 基址必须拒绝，避免 http 外链在真机被拦
  if (!/\^https:\\\/\\\//.test(artSrc) && artSrc.indexOf('^https:\\/\\/') < 0) {
    fail('art.js 缺少 REMOTE_ART 的 HTTPS 协议校验');
  }
  // 当前产物应当是内联的：一旦误提交远程产物，主包与真机都会出问题
  const artWxss = read('pages/index/art.wxss');
  if (/url\("https:\/\//.test(artWxss)) {
    fail('art.wxss 含网络图片外链：REMOTE_ART 未正式启用前不应提交远程产物');
  }
  if (artWxss.indexOf('data:image/webp;base64,') < 0) {
    fail('art.wxss 缺少内联 webp：默认模式应保持内联');
  }
  ok('美术资源 · REMOTE_ART 默认关闭 / HTTPS 校验 / 产物为内联');
})();

// 7.12 音效引擎：必须零音频文件、必须有生命周期释放、必须有降级。
//      用代码合成就意味着绝不能偷偷塞 mp3 进包 —— 一旦有人改成音频文件，
//      138KB 的余量会直接触顶，这条守卫负责拦住。
(function () {
  const soundSrc = read('utils/sound.js');
  const pageSrc = read('pages/index/index.js');

  // 合成方案的前提：用 WebAudio，不是 InnerAudioContext + 音频文件
  if (soundSrc.indexOf('createWebAudioContext') < 0) {
    fail('sound.js 必须用 wx.createWebAudioContext 合成音效（零包体）');
  }
  // 不能引入音频文件路径
  if (/\.(mp3|m4a|wav|aac|ogg)['"]/i.test(soundSrc)) {
    fail('sound.js 不应引用音频文件（会吃掉包体余量）');
  }
  // 静音开关必须持久化
  if (soundSrc.indexOf('setStorageSync') < 0) {
    fail('sound.js 必须持久化静音偏好');
  }
  // 包络：没有 exponentialRampToValueAtTime 会有爆音
  if (soundSrc.indexOf('exponentialRampToValueAtTime') < 0) {
    fail('sound.js 缺少包络（会导致爆音）');
  }
  // 页面必须接入初始化与释放，否则音频上下文泄漏
  if (pageSrc.indexOf('Sound.init()') < 0) {
    fail('index.js 必须在 onLoad 调 Sound.init()');
  }
  const unloadIdx = pageSrc.indexOf('onUnload()');
  if (unloadIdx < 0 || pageSrc.indexOf('Sound.destroy()', unloadIdx) < 0) {
    fail('index.js 必须在 onUnload 调 Sound.destroy()（官方要求显式释放）');
  }
  const hideIdx = pageSrc.indexOf('onHide()');
  if (hideIdx < 0 || pageSrc.indexOf('Sound.destroy()', hideIdx) < 0) {
    fail('index.js 必须在 onHide 释放音频（后台不该继续占用）');
  }
  // 预览构建必须注册 sound 模块，否则 H5 预览 require 失败
  const buildSrc = read('preview/build.js');
  if (buildSrc.indexOf("['sound', 'utils/sound.js']") < 0) {
    fail('preview/build.js 未注册 sound 模块');
  }

  // 音效名必须存在：ACTION_SOUND / TAP_SOUND 里引用的名字一旦写错，
  // Sound.play 会静默跳过 —— 玩家听到的是「某些操作没声音」，很难定位。
  // 这条守卫把引用完整性钉死（第七十轮就是因为删 tap 定义导致 discard/pass 失声）。
  const defined = (soundSrc.match(/^\s{2}([a-zA-Z]+):\s*\{\s*steps:/gm) || [])
    .map(function (line) { return line.trim().replace(/:.*$/, ''); });
  if (defined.length < 15) fail('sound.js 音效定义少于 15 个，实际 ' + defined.length);
  const definedSet = {};
  defined.forEach(function (k) { definedSet[k] = true; });

  function checkRefs(tableName) {
    const m = new RegExp('const ' + tableName + ' = \\{([\\s\\S]*?)\\n\\};').exec(pageSrc);
    if (!m) { fail('index.js 缺少 ' + tableName + ' 映射表'); return 0; }
    const names = (m[1].match(/:\s*'([a-zA-Z]+)'/g) || [])
      .map(function (s) { return s.replace(/:\s*'/, '').replace(/'$/, ''); });
    names.forEach(function (n) {
      if (!definedSet[n]) fail(tableName + ' 引用了未定义的音效: ' + n);
    });
    return names.length;
  }
  const actionCount = checkRefs('ACTION_SOUND');
  const tapCount = checkRefs('TAP_SOUND');
  if (tapCount < 60) fail('TAP_SOUND 覆盖过少（' + tapCount + ' 个），应覆盖主要交互入口');

  // BGM 音量必须「单层控制」，且实际振幅落在合理区间。
  //
  // 早期守卫只检查 level ≤ 0.08，结果漏掉了一个真实 bug：level=0.045 与
  // 每音 gain=0.028 相乘后实际只有 0.00126（-58dB），真机上完全听不见，
  // 而 level 本身看起来「很合规」。所以这里必须校验乘积，而不是单看一层。
  const levelMatch = /level:\s*([0-9.]+)/.exec(soundSrc);
  if (!levelMatch) { fail('sound.js 缺少 BGM.level'); }
  const bgmLevel = Number(levelMatch[1]);
  if (bgmLevel > 1) fail('BGM.level 不应超过 1.0（它是 bgmGain 系数，不是绝对音量）');

  const gainsMatch = /gains:\s*\{\s*bass:\s*([0-9.]+),\s*arp:\s*([0-9.]+),\s*sparkle:\s*([0-9.]+)/.exec(soundSrc);
  if (!gainsMatch) { fail('sound.js 缺少 BGM.gains（bass/arp/sparkle 三个绝对增益）'); }
  const ampArp = bgmLevel * Number(gainsMatch[2]);
  const ampBass = bgmLevel * Number(gainsMatch[1]);
  // 下限：<0.01（-40dB）在手机上基本听不见
  if (ampArp < 0.01) {
    fail('BGM 实际振幅 ' + ampArp.toFixed(4) + ' 过低（<0.01 真机听不到，检查是否被双层衰减）');
  }
  // 上限：琶音不超过音效主音量（0.14），否则会盖住操作反馈
  if (ampBass > 0.14) {
    fail('BGM 低音振幅 ' + ampBass.toFixed(3) + ' 过高（不应超过音效主音量 0.14）');
  }
  // 和弦必须有多个，单和弦循环听起来像卡带
  const progMatch = /progression:\s*\[([\s\S]*?)\n  \]/.exec(soundSrc);
  if (!progMatch || (progMatch[1].match(/bass:/g) || []).length < 4) {
    fail('BGM 和弦进行至少 4 个，否则循环周期太短');
  }
  // 音效与音乐开关必须分开持久化
  if (soundSrc.indexOf('sfx_muted') < 0 || soundSrc.indexOf('bgm_muted') < 0) {
    fail('音效与音乐开关必须分开持久化（sfx_muted / bgm_muted）');
  }
  // BGM 必须真的被页面调用，否则开关点了没声音
  if (pageSrc.indexOf('Sound.startBgm') < 0) {
    fail('index.js 未调用 Sound.startBgm（BGM 不会响）');
  }

  ok('音效引擎 · WebAudio 合成 / 无音频文件 / 双开关 / 音效名引用完整（' +
    actionCount + ' 动作 + ' + tapCount + ' 交互）/ BGM 实际振幅 ' + ampArp.toFixed(3) + ' 合规（单层控制）');
})();

// 7.13 席位超时回收：心跳必须密于判定窗口，否则正常玩家会被误踢。
//      这是最容易在调参时搞反的一对数字，锁死两者关系。
(function () {
  const roomSrc = read('utils/room.js');
  const userSrc = read('utils/user.js');
  const pageSrc = read('pages/index/index.js');

  const staleMatch = /HEARTBEAT_STALE_MS = (\d+) \* 1000/.exec(roomSrc);
  if (!staleMatch) fail('room.js 缺少 HEARTBEAT_STALE_MS 定义');
  const staleMs = Number(staleMatch[1]) * 1000;

  const hbMatch = /HEARTBEAT_MS = (\d+) \* 1000/.exec(userSrc);
  if (!hbMatch) fail('user.js 缺少 HEARTBEAT_MS 定义');
  const hbMs = Number(hbMatch[1]) * 1000;

  // 核心不变量：心跳间隔必须明显小于回收窗口。
  // 若心跳 45s / 窗口 30s，正常玩家必然在两次心跳之间被误判掉线。
  if (hbMs >= staleMs) {
    fail('心跳间隔 ' + (hbMs / 1000) + 's 必须小于回收窗口 ' + (staleMs / 1000) + 's（否则会误踢正常玩家）');
  }
  if (staleMs / hbMs < 2) {
    fail('回收窗口应至少容纳 2 个心跳周期才能容忍偶发丢包（当前 ' + (staleMs / hbMs).toFixed(1) + ' 倍）');
  }

  // 三个环节必须都在：判定 → 回收顺延 → 页面接线
  if (roomSrc.indexOf('function isSeatStale') < 0) fail('room.js 缺少 isSeatStale');
  if (roomSrc.indexOf('function reapStaleSeats') < 0) fail('room.js 缺少 reapStaleSeats');
  if (roomSrc.indexOf('function stampSeatActivity') < 0) fail('room.js 缺少 stampSeatActivity');
  if (pageSrc.indexOf('reapSeatsIfNeeded(') < 0) fail('index.js 未接线房主席位回收');
  if (pageSrc.indexOf('releaseMySeat()') < 0) fail('index.js 未实现主动离房清席位');

  // 主动离房必须真的清席位，而不是只做本机状态清理
  const leaveIdx = pageSrc.indexOf('onLeaveRoom()');
  if (leaveIdx < 0 || pageSrc.indexOf('this.releaseMySeat()', leaveIdx) < 0) {
    fail('onLeaveRoom 必须在离房时调用 releaseMySeat（否则席位会一直占着）');
  }
  // 席位回收只能房主执行，否则多端并发写房间行会互相冲突
  if (!/mySeat === 0[^\n]*reapSeatsIfNeeded|reapSeatsIfNeeded[\s\S]{0,400}mySeat === 0/.test(pageSrc)) {
    // 反向检查：调用点附近必须有房主判断
    const callIdx = pageSrc.indexOf('that.reapSeatsIfNeeded(');
    if (callIdx < 0) fail('index.js 未调用 reapSeatsIfNeeded');
    const around = pageSrc.slice(Math.max(0, callIdx - 400), callIdx);
    if (around.indexOf('mySeat === 0') < 0) {
      fail('reapSeatsIfNeeded 必须在房主端调用（避免多端并发写冲突）');
    }
  }

  ok('席位回收 · 心跳 ' + (hbMs / 1000) + 's < 窗口 ' + (staleMs / 1000) + 's（' +
    (staleMs / hbMs).toFixed(1) + ' 个周期）/ 房主顺延 / 主动离房即刻清席位');
})();

// 8. 本地引用检查（require 路径）
const reqRe = /require\(['"]([^'"]+)['"]\)/g;
let qm;
while ((qm = reqRe.exec(pageJs)) !== null) {
  const target = path.join(ROOT, 'pages/index', qm[1]);
  if (!fs.existsSync(target)) fail('页面 require 路径不存在: ' + qm[1]);
}
ok('页面 require 路径有效');

if (!process.exitCode) console.log('ALL STATIC CHECKS PASSED');
