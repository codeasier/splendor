'use strict';

/**
 * 浏览器预览构建器
 *
 * 微信小程序工程（.wxml/.wxss/.json）无法被浏览器直接渲染，而 WorkBuddy 的
 * 应用预览卡是 Web 容器。本脚本把同一份源码编译成单文件自包含 index.html：
 *   - WXML -> JS render 函数（wx:for / wx:if / wx:else / {{}} / bindtap / data-*）
 *   - WXSS + app.wxss -> 内联 CSS（竖屏容器自动旋转为横屏）
 *   - utils/*.js + pages/index/index.js -> CommonJS shim 内的同一份逻辑
 * 因此预览页与小程序共用完全相同的规则引擎、视图模型和事件处理，不是另写一版。
 *
 * 用法：node preview/build.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const write = (p, s) => fs.writeFileSync(path.join(ROOT, p), s, 'utf8');

/* ---------------- WXML 解析 ---------------- */

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      if (i < src.length) out.push({ type: 'text', value: src.slice(i) });
      break;
    }
    if (lt > i) out.push({ type: 'text', value: src.slice(i, lt) });
    let j = lt + 1;
    let quote = null;
    while (j < src.length) {
      const c = src[j];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
      j += 1;
    }
    out.push({ type: 'tag', value: src.slice(lt, j + 1) });
    i = j + 1;
  }
  return out;
}

function parseTag(raw) {
  const inner = raw.slice(1, -1).trim();
  if (inner.charAt(0) === '/') return { closing: inner.slice(1).trim().toLowerCase() };
  const head = /^([A-Za-z][\w-]*)/.exec(inner);
  if (!head) return null;
  const rest = inner.slice(head[0].length);
  const attrs = [];
  const re = /([A-Za-z_:][-\w:.]*)\s*=\s*"([^"]*)"|([A-Za-z_:][-\w:.]*)/g;
  let a;
  while ((a = re.exec(rest)) !== null) {
    if (a[1] !== undefined) attrs.push([a[1], a[2]]);
    else attrs.push([a[3], '']);
  }
  return { tag: head[1], attrs: attrs, selfClose: /\/\s*$/.test(rest) };
}

function buildTree(src) {
  const clean = src.replace(/<!--[\s\S]*?-->/g, '');
  const root = { type: 'node', tag: '#root', attrs: [], children: [] };
  const stack = [root];
  tokenize(clean).forEach((t) => {
    if (t.type === 'text') {
      const v = t.value.trim();
      if (v) stack[stack.length - 1].children.push({ type: 'text', value: v });
      return;
    }
    const p = parseTag(t.value);
    if (!p) return;
    if (p.closing) {
      for (let k = stack.length - 1; k > 0; k -= 1) {
        if (stack[k].tag === p.closing) { stack.length = k; break; }
      }
      return;
    }
    const node = { type: 'node', tag: p.tag, attrs: p.attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!p.selfClose) stack.push(node);
  });
  return root;
}

/* ---------------- WXML -> JS ---------------- */

const EXPRS = [];
let uid = 0;
const exprIndex = new Map();
function exprId(text) {
  const key = text.trim();
  if (!exprIndex.has(key)) {
    exprIndex.set(key, EXPRS.length);
    EXPRS.push(key);
  }
  return exprIndex.get(key);
}

function unwrap(v) {
  const m = /^\s*\{\{([\s\S]*?)\}\}\s*$/.exec(v);
  return m ? m[1].trim() : v.trim();
}

/** 把含 {{}} 的属性值编译成字符串拼接表达式 */
function valueExpr(v, scope) {
  const parts = [];
  const re = /\{\{([\s\S]*?)\}\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(v)) !== null) {
    if (m.index > last) parts.push(JSON.stringify(v.slice(last, m.index)));
    parts.push('String(EV(' + exprId(m[1]) + ', ' + scope + '))');
    last = re.lastIndex;
  }
  if (last < v.length) parts.push(JSON.stringify(v.slice(last)));
  if (!parts.length) return JSON.stringify(v);
  return parts.length === 1 ? parts[0] : '(' + parts.join(' + ') + ')';
}

const TAGMAP = { view: 'div', text: 'span', image: 'img', block: 'span' };
const SKIP_ATTR = (name) => name.indexOf('wx:') === 0;

function attrsOf(node) {
  const a = {};
  node.attrs.forEach((kv) => { a[kv[0]] = kv[1]; });
  return a;
}

function emitText(node, scope, depth, lines) {
  const pad = '  '.repeat(depth);
  const parts = [];
  const re = /\{\{([\s\S]*?)\}\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(node.value)) !== null) {
    if (m.index > last) parts.push(JSON.stringify(node.value.slice(last, m.index)));
    parts.push('ESC(EV(' + exprId(m[1]) + ', ' + scope + '))');
    last = re.lastIndex;
  }
  if (last < node.value.length) parts.push(JSON.stringify(node.value.slice(last)));
  parts.forEach((p) => lines.push(pad + '$h.push(' + p + ');'));
}

function emitTag(node, A, scope, depth, lines) {
  const pad = '  '.repeat(depth);
  const tag = TAGMAP[node.tag] || node.tag;
  lines.push(pad + '$h.push(' + JSON.stringify('<' + tag) + ');');
  node.attrs.forEach((kv) => {
    const name = kv[0];
    const val = kv[1];
    if (SKIP_ATTR(name)) return;
    if (name === 'bindtap' || name === 'catchtap') {
      const key = name === 'bindtap' ? 'data-tap' : 'data-catchtap';
      lines.push(pad + '$h.push(' + JSON.stringify(' ' + key + '="' + val + '"') + ');');
      return;
    }
    // 表单与原生头像选择：H5 预览里用等价的 DOM 事件委托模拟，
    // 小程序端仍使用原来的 bindinput / bindblur / bindchooseavatar。
    if (name === 'bindinput' || name === 'bindblur' || name === 'bindchange') {
      const key = name === 'bindinput' ? 'data-input'
        : (name === 'bindblur' ? 'data-blur' : 'data-change');
      lines.push(pad + '$h.push(' + JSON.stringify(' ' + key + '="' + val + '"') + ');');
      return;
    }
    if (name === 'bindchooseavatar') {
      lines.push(pad + '$h.push(' + JSON.stringify(' data-avatar="' + val + '"') + ');');
      return;
    }
    lines.push(pad + '$h.push(' + JSON.stringify(' ' + name + '="') + ');');
    lines.push(pad + '$h.push(ESC(' + valueExpr(val, scope) + '));');
    lines.push(pad + '$h.push(' + JSON.stringify('"') + ');');
  });
  lines.push(pad + '$h.push(">");');
  emitChildren(node.children, scope, depth, lines);
  lines.push(pad + '$h.push(' + JSON.stringify('</' + tag + '>') + ');');
}

function emitNode(node, scope, depth, lines) {
  const pad = '  '.repeat(depth);
  if (node.type === 'text') { emitText(node, scope, depth, lines); return; }
  const A = attrsOf(node);
  if (A['wx:for']) {
    const id = ++uid;
    const childScope = '$s' + id;
    const list = '$list' + id;
    const idx = '$i' + id;
    lines.push(pad + 'var ' + list + ' = EV(' + exprId(unwrap(A['wx:for'])) + ', ' + scope + ') || [];');
    lines.push(pad + 'for (var ' + idx + ' = 0; ' + idx + ' < ' + list + '.length; ' + idx + '++) {');
    lines.push(pad + '  var ' + childScope + ' = Object.create(' + scope + ');');
    lines.push(pad + '  ' + childScope + '.item = ' + list + '[' + idx + '];');
    lines.push(pad + '  ' + childScope + '.index = ' + idx + ';');
    if (A['wx:for-item'] && A['wx:for-item'] !== 'item') {
      lines.push(pad + '  ' + childScope + '.' + A['wx:for-item'] + ' = ' + list + '[' + idx + '];');
    }
    if (A['wx:for-index'] && A['wx:for-index'] !== 'index') {
      lines.push(pad + '  ' + childScope + '.' + A['wx:for-index'] + ' = ' + idx + ';');
    }
    emitTag(node, A, childScope, depth + 1, lines);
    lines.push(pad + '}');
  } else {
    emitTag(node, A, scope, depth, lines);
  }
}

function emitChildren(children, scope, depth, lines) {
  const pad = '  '.repeat(depth);
  for (let i = 0; i < children.length; i += 1) {
    const c = children[i];
    if (c.type === 'text') { emitNode(c, scope, depth, lines); continue; }
    const A = attrsOf(c);
    if (A['wx:if']) {
      lines.push(pad + 'if (EV(' + exprId(unwrap(A['wx:if'])) + ', ' + scope + ')) {');
      emitNode(c, scope, depth + 1, lines);
      const next = children[i + 1];
      if (next && next.type === 'node' && attrsOf(next)['wx:else'] !== undefined) {
        lines.push(pad + '} else {');
        emitNode(next, scope, depth + 1, lines);
        i += 1;
      }
      lines.push(pad + '}');
    } else if (A['wx:else'] !== undefined) {
      // 已由前一个 wx:if 消费
    } else {
      emitNode(c, scope, depth, lines);
    }
  }
}

function compileWxml(wxml) {
  const tree = buildTree(wxml);
  const lines = [];
  emitChildren(tree.children, '$s', 1, lines);
  const body = '  var $h = [];\n  var $s = data;\n' + lines.join('\n') + '\n  return $h.join("");';
  // 用 new Function 在构建期做一次语法校验，确保生成的渲染函数可执行
  try { new Function('data', 'EV', 'ESC', body); }
  catch (err) { throw new Error('编译后的 render 函数语法错误: ' + err.message + '\n' + body); }
  return {
    exprs: EXPRS.slice(),
    body: body
  };
}

/* ---------------- 组装单文件 HTML ---------------- */

const wxml = read('pages/index/index.wxml');
const compiled = compileWxml(wxml);

const moduleFiles = [
  ['game-data', 'utils/game-data.js'],
  ['game-engine', 'utils/game-engine.js'],
  ['ai', 'utils/ai.js'],
  ['room', 'utils/room.js']
];

const moduleDefs = moduleFiles.map(([name, file]) => (
  '__def(' + JSON.stringify(name) + ', function (module, exports, require) {\n' +
  read(file).replace(/^'use strict';?\s*/, '') + '\n});'
)).join('\n');

const pageCode = read('pages/index/index.js').replace(/^'use strict';?\s*/, '');

const renderRuntime = `
var EXPR_TEXTS = ${JSON.stringify(compiled.exprs)};
var EXPR_CACHE = {};
function EV(id, scope) {
  var fn = EXPR_CACHE[id] || (EXPR_CACHE[id] = new Function('$s', 'with ($s) { return (' + EXPR_TEXTS[id] + '); }'));
  return fn(scope);
}
function ESC(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
window.renderStage = function (data) {
${compiled.body}
};
`;

const bundle = `
(function () {
  var __modules = {};
  function __resolve(p) { return p.split('/').pop().replace(/\\.js$/, ''); }
  function __require(p) {
    var k = __resolve(p);
    if (!__modules[k]) throw new Error('module not found: ' + p);
    return __modules[k];
  }
  function __def(name, fn) {
    var m = { exports: {} };
    fn(m, m.exports, __require);
    __modules[name] = m.exports;
  }

${moduleDefs}

${renderRuntime}

  window.__pageConfig = null;
  function Page(cfg) { window.__pageConfig = cfg; }
  (function (module, exports, require) {
${pageCode}
  })({ exports: {} }, {}, __require);
})();
`.replace(/<\/script/gi, '<\\/script');

const boot = `
(function () {
  // 竖屏容器由 CSS 旋转 #frame 承担，逻辑窗口恒为横屏，舞台因此始终按横屏比例缩放。
  function logicalSize() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    return w >= h
      ? { windowWidth: w, windowHeight: h }
      : { windowWidth: h, windowHeight: w };
  }
  window.wx = {
    getWindowInfo: logicalSize,
    getSystemInfoSync: logicalSize,
    showModal: function (o) {
      var ok = window.confirm((o.title || '') + '\\n\\n' + (o.content || ''));
      if (o.success) o.success({ confirm: ok, cancel: !ok });
      if (o.complete) o.complete();
    },
    showToast: function () {},
    vibrateShort: function () {}
  };

  var cfg = window.__pageConfig;
  if (!cfg) { document.body.innerHTML = '<p style="color:#f6ead8;padding:24px">页面初始化失败：未捕获到 Page 配置</p>'; return; }
  var page = {};
  Object.keys(cfg).forEach(function (k) { page[k] = cfg[k]; });
  page.data = Object.assign({}, cfg.data);

  var host = document.getElementById('host');
  function draw() {
    try { host.innerHTML = window.renderStage(page.data); }
    catch (err) { console.error('[splendor] render failed:', err); }
  }
  page.setData = function (patch) {
    Object.keys(patch).forEach(function (k) { this.data[k] = patch[k]; }, this);
    draw();
  };

  // 事件委托：模拟 bindtap（冒泡）与 catchtap（阻断冒泡）
  host.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== host) {
      var fn = el.getAttribute && el.getAttribute('data-tap');
      var isCatch = false;
      if (!fn && el.getAttribute) {
        fn = el.getAttribute('data-catchtap');
        isCatch = !!fn;
      }
      if (fn && typeof page[fn] === 'function') {
        var ds = {};
        for (var i = 0; i < el.attributes.length; i += 1) {
          var a = el.attributes[i];
          if (a.name.indexOf('data-') === 0 && a.name !== 'data-tap' && a.name !== 'data-catchtap') {
            var key = a.name.slice(5).replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
            ds[key] = a.value;
          }
        }
        page[fn]({ type: 'tap', currentTarget: { dataset: ds }, target: { dataset: ds } });
        if (isCatch) break;
      }
      el = el.parentNode;
    }
  });

  // 表单事件委托：模拟 bindinput / bindchange（小程序端仍用原生绑定）
  function formEvent(type, attr) {
    host.addEventListener(type, function (e) {
      var el = e.target;
      while (el && el !== host) {
        var fn = el.getAttribute && el.getAttribute(attr);
        if (fn && typeof page[fn] === 'function') {
          page[fn]({
            type: type,
            detail: { value: el.value },
            currentTarget: { dataset: {} },
            target: { dataset: {} }
          });
          break;
        }
        el = el.parentNode;
      }
    });
  }
  formEvent('input', 'data-input');
  formEvent('change', 'data-change');

  // chooseAvatar 是微信原生能力；预览回传空 detail，由页面提示改用预设头像
  host.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== host) {
      var fn = el.getAttribute && el.getAttribute('data-avatar');
      if (fn && typeof page[fn] === 'function') {
        page[fn]({ type: 'chooseavatar', detail: {}, currentTarget: { dataset: {} } });
        break;
      }
      el = el.parentNode;
    }
  });

  if (page.onLoad) page.onLoad();
  if (page.onShow) page.onShow();
  window.addEventListener('resize', function () { if (page.onResize) page.onResize(); });
  window.addEventListener('orientationchange', function () { if (page.onResize) page.onResize(); });
  window.__splendorPage = page;
})();
`.replace(/<\/script/gi, '<\\/script');

// WXSS 支持 @import：把相对导入展开成内联 CSS，让预览页与小程序读到同一份样式
function readWxss(rel, depth) {
  const src = read(rel);
  if (depth > 4) return src;
  return src.replace(/@import\s+["']([^"']+)["']\s*;/g, function (_, f) {
    const child = path.posix.join(path.posix.dirname(rel), f);
    return '\n/* ' + child + ' */\n' + readWxss(child, depth + 1) + '\n';
  });
}

const wxss = readWxss('app.wxss', 0) + '\n' + readWxss('pages/index/index.wxss', 0);

const css = `
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #1c0e16;
  color: #f6ead8;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif;
}
#frame {
  position: absolute;
  left: 0;
  top: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}
#host, #host * { box-sizing: border-box; }
#host { width: 100%; height: 100%; }
/* 竖屏手机框：把整个横屏画布顺时针旋转 90° 并交换宽高，精确铺满容器。
   用 transform-origin: top left + rotate/translate 组合，避免 translate(-50%,-50%)
   的百分比基准在旋转坐标系下产生偏移。 */
@media (orientation: portrait) {
  #frame {
    width: 100vh;
    height: 100vw;
    left: 0;
    top: 0;
    transform-origin: top left;
    transform: rotate(90deg) translate(0, -100%);
  }
}
`;
// 必须放在 WXSS 之后：原始 .viewport 是 height:100vh，竖屏旋转后容器高度只有 100vw，
// 若不覆盖，舞台会按 100vh 居中而整体下移，底部资产栏被裁到容器外。
const cssOverride = `
#host .viewport { width: 100%; height: 100%; }
`;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>璀璨宝石 · 横屏牌桌预览</title>
<style>
${css}
${wxss}
${cssOverride}
</style>
</head>
<body>
<div id="frame"><div id="host"></div></div>
<script>${bundle}</script>
<script>${boot}</script>
</body>
</html>
`;

write('index.html', html);

// 同时输出一份可独立检查的渲染函数，便于排错
write('preview/render.generated.js', renderRuntime);

console.log('已生成 index.html（' + (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB）');
console.log('WXML 表达式 ' + compiled.exprs.length + ' 个，render 函数 ' + compiled.body.split('\n').length + ' 行');
