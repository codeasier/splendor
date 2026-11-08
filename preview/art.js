'use strict';

/**
 * 卡面美术生成器
 * ------------------------------------------------------------------
 * 产出 pages/index/art.wxss：把程序化绘制的矢量插画编码为 base64 data URI，
 * 供小程序 WXSS 与 H5 预览共用。不引入任何图片文件（小程序包体无外部资源依赖），
 * 且每张卡都保留了 CSS 渐变兜底：即便客户端不渲染 SVG 背景，卡面仍完整可读。
 *
 * 运行：node preview/art.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'pages', 'index', 'art.wxss');

function bg(svg) {
  const b64 = Buffer.from(svg, 'utf8').toString('base64');
  return 'url("data:image/svg+xml;base64,' + b64 + '")';
}

/* 五套色系，与 GEMS 顺序一致：white / blue / green / red / black */
const PALETTES = [
  {
    sky0: '#7eaecb', sky1: '#c7e0ec', sky2: '#f0f3e8',
    far: '#8eaec0', near: '#5d8095', ground: '#3e5b6c',
    sil0: '#4d6a7d', sil1: '#213a4b', roof: '#e2eef4',
    gemHi: '#ffffff', gem: '#cfe6f5', gemDk: '#6f9ab9'
  },
  {
    sky0: '#264a80', sky1: '#6f9ec6', sky2: '#c7dbe4',
    far: '#4a76a4', near: '#2d557e', ground: '#1c3a60',
    sil0: '#2b5182', sil1: '#122a4c', roof: '#9fc6e6',
    gemHi: '#b6e2ff', gem: '#3b8fdb', gemDk: '#123f7a'
  },
  {
    sky0: '#7fa884', sky1: '#c9dbaa', sky2: '#efe9c4',
    far: '#74a281', near: '#41795a', ground: '#27543c',
    sil0: '#3d7155', sil1: '#173f2c', roof: '#cfe0b0',
    gemHi: '#d4ffe4', gem: '#57c98a', gemDk: '#166b42'
  },
  {
    sky0: '#9e4f55', sky1: '#dd9a7d', sky2: '#f2d2a4',
    far: '#a96564', near: '#7c3a43', ground: '#4d2530',
    sil0: '#7b3c42', sil1: '#3c1c26', roof: '#f0c39a',
    gemHi: '#ffd2c4', gem: '#e35b57', gemDk: '#8e2029'
  },
  {
    sky0: '#3d3257', sky1: '#806a94', sky2: '#c7a8a8',
    far: '#6a587f', near: '#433650', ground: '#251d34',
    sil0: '#4b3c60', sil1: '#1d1729', roof: '#b8a2c8',
    gemHi: '#e2cdff', gem: '#9274b4', gemDk: '#3d2a5c'
  }
];

/* 8 种建筑剪影，按 (色系 * 3 + 变体) 轮换，避免 15 张卡面千篇一律 */
const BUILDINGS = [
  // 0 尖顶塔楼
  function (p) {
    return '<g>' +
      '<path d="M84 152V96l16-24 16 24v56z" fill="url(#sil)"/>' +
      '<path d="M82 96l18-26 18 26z" fill="' + p.roof + '" stroke="#f2d9a0" stroke-width="1" stroke-opacity=".75"/>' +
      '<rect x="97" y="108" width="6" height="12" rx="3" fill="#ffe9ae" opacity=".78"/>' +
      '<rect x="97" y="128" width="6" height="12" rx="3" fill="#ffe9ae" opacity=".55"/>' +
      '<rect x="72" y="130" width="14" height="22" fill="url(#sil)"/>' +
      '<rect x="114" y="130" width="14" height="22" fill="url(#sil)"/>' +
      '<path d="M84 152h32" stroke="#f2d9a0" stroke-width="1.2" stroke-opacity=".6"/>' +
      '</g>';
  },
  // 1 穹顶神殿
  function (p) {
    return '<g>' +
      '<path d="M68 152v-32a32 32 0 0 1 64 0v32z" fill="url(#sil)"/>' +
      '<path d="M68 120a32 32 0 0 1 64 0" fill="none" stroke="' + p.roof + '" stroke-width="1.6" stroke-opacity=".85"/>' +
      '<path d="M100 82V68m-7 6h14" stroke="#f2d9a0" stroke-width="1.4" stroke-opacity=".8"/>' +
      '<path d="M74 128h52" stroke="#f2d9a0" stroke-width="1" stroke-opacity=".55"/>' +
      '<rect x="76" y="130" width="5" height="22" fill="' + p.roof + '" opacity=".5"/>' +
      '<rect x="88" y="130" width="5" height="22" fill="' + p.roof + '" opacity=".5"/>' +
      '<rect x="107" y="130" width="5" height="22" fill="' + p.roof + '" opacity=".5"/>' +
      '<rect x="119" y="130" width="5" height="22" fill="' + p.roof + '" opacity=".5"/>' +
      '</g>';
  },
  // 2 三连拱廊
  function (p) {
    let s = '<g><path d="M56 152v-38h88v38" fill="none" stroke="' + p.roof + '" stroke-width="1.4" stroke-opacity=".65"/>';
    s += '<path d="M56 116h88v5H56z" fill="url(#sil)"/>';
    for (let i = 0; i < 3; i++) {
      const x = 66 + i * 27;
      s += '<path d="M' + x + ' 152v-20a9 9 0 0 1 18 0v20z" fill="' + p.sil1 + '" opacity=".82"/>';
      s += '<path d="M' + x + ' 152v-20a9 9 0 0 1 18 0" fill="none" stroke="' + p.roof + '" stroke-width="1" stroke-opacity=".7"/>';
    }
    s += '<rect x="60" y="121" width="4" height="31" fill="url(#sil)"/><rect x="136" y="121" width="4" height="31" fill="url(#sil)"/>';
    return s + '</g>';
  },
  // 3 柱廊
  function (p) {
    let s = '<g><path d="M58 104h84l-9-11H67z" fill="url(#sil)" stroke="' + p.roof + '" stroke-width="1.1" stroke-opacity=".7"/>';
    s += '<path d="M58 108h84v5H58z" fill="' + p.roof + '" opacity=".55"/>';
    for (let i = 0; i < 5; i++) {
      const x = 62 + i * 19;
      s += '<rect x="' + x + '" y="113" width="7" height="39" fill="url(#sil)"/>';
      s += '<rect x="' + (x - 2) + '" y="111" width="11" height="3" fill="' + p.roof + '" opacity=".5"/>';
    }
    s += '<path d="M56 152h88" stroke="' + p.roof + '" stroke-width="1.4" stroke-opacity=".65"/>';
    return s + '</g>';
  },
  // 4 矿洞与井架
  function (p) {
    return '<g>' +
      '<path d="M70 152v-22a24 24 0 0 1 48 0v22z" fill="' + p.sil1 + '" opacity=".9"/>' +
      '<path d="M70 130a24 24 0 0 1 48 0" fill="none" stroke="' + p.roof + '" stroke-width="1.5" stroke-opacity=".8"/>' +
      '<path d="M94 152v-16a10 10 0 0 1 12 0v16z" fill="#0d1520" opacity=".8"/>' +
      '<path d="M56 152l14-40m-14 40h28m-28 0l14-40" stroke="' + p.roof + '" stroke-width="1.6" stroke-opacity=".6" fill="none"/>' +
      '<path d="M126 152l12-34m-12 34h24m-24 0l12-34" stroke="' + p.roof + '" stroke-width="1.6" stroke-opacity=".6" fill="none"/>' +
      '<path d="M52 152h96" stroke="' + p.roof + '" stroke-width="1.2" stroke-opacity=".55"/>' +
      '</g>';
  },
  // 5 帆船港湾
  function (p) {
    return '<g>' +
      '<path d="M50 142h100l-16 14H66z" fill="url(#sil)"/>' +
      '<path d="M50 142h100" stroke="' + p.roof + '" stroke-width="1.3" stroke-opacity=".7"/>' +
      '<path d="M100 142V72" stroke="' + p.roof + '" stroke-width="1.6" stroke-opacity=".85"/>' +
      '<path d="M98 78l32 60H98z" fill="' + p.roof + '" opacity=".72"/>' +
      '<path d="M96 86L70 138h26z" fill="' + p.roof + '" opacity=".5"/>' +
      '<path d="M100 68l8 6h-8z" fill="#ffe9ae" opacity=".8"/>' +
      '<path d="M28 160q22-6 44 0t44 0t44 0t44 0" fill="none" stroke="#fff" stroke-width="1.2" stroke-opacity=".28"/>' +
      '</g>';
  },
  // 6 城门
  function (p) {
    let s = '<g><path d="M60 152V104h80v48z" fill="url(#sil)"/>';
    for (let i = 0; i < 7; i++) {
      s += '<rect x="' + (60 + i * 12) + '" y="98" width="7" height="8" fill="url(#sil)"/>';
    }
    s += '<path d="M60 106h80" stroke="' + p.roof + '" stroke-width="1.2" stroke-opacity=".65"/>';
    s += '<path d="M88 152v-24a12 12 0 0 1 24 0v24z" fill="' + p.sil1 + '"/>';
    s += '<path d="M88 128a12 12 0 0 1 24 0" fill="none" stroke="' + p.roof + '" stroke-width="1.3" stroke-opacity=".8"/>';
    s += '<circle cx="76" cy="120" r="2" fill="#ffe9ae" opacity=".65"/><circle cx="124" cy="120" r="2" fill="#ffe9ae" opacity=".65"/>';
    return s + '</g>';
  },
  // 7 山墙神庙
  function (p) {
    let s = '<g><path d="M56 106l44-32 44 32z" fill="url(#sil)" stroke="' + p.roof + '" stroke-width="1.2" stroke-opacity=".8"/>';
    s += '<circle cx="100" cy="94" r="5" fill="#ffe9ae" opacity=".55"/>';
    s += '<path d="M56 110h88v5H56z" fill="' + p.roof + '" opacity=".55"/>';
    for (let i = 0; i < 5; i++) {
      const x = 62 + i * 19;
      s += '<rect x="' + x + '" y="115" width="7" height="37" fill="url(#sil)"/>';
    }
    s += '<path d="M52 152h96" stroke="' + p.roof + '" stroke-width="1.5" stroke-opacity=".7"/>';
    return s + '</g>';
  }
];

function cardSVG(p, building, seed) {
  const gx = 96 + (seed % 3) * 4;
  const sunX = 148 + (seed % 2) * 8;
  let stars = '';
  const pts = [[22, 28], [44, 16], [172, 30], [128, 18], [36, 46], [184, 56]];
  for (let i = 0; i < pts.length; i++) {
    if ((i + seed) % 2 === 0) {
      stars += '<circle cx="' + pts[i][0] + '" cy="' + pts[i][1] + '" r="' + (i % 2 ? 1.3 : 1) + '" fill="#fff4d2" opacity=".62"/>';
    }
  }

  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 186" preserveAspectRatio="xMidYMid slice">' +
    '<defs>' +
      '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + p.sky0 + '"/><stop offset=".6" stop-color="' + p.sky1 + '"/><stop offset="1" stop-color="' + p.sky2 + '"/></linearGradient>' +
      '<radialGradient id="gl" cx="72%" cy="24%" r="66%"><stop offset="0" stop-color="#fff4d6" stop-opacity=".6"/><stop offset="1" stop-color="#fff4d6" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="gem" x1="0" y1="0" x2=".9" y2="1"><stop offset="0" stop-color="' + p.gemHi + '"/><stop offset=".4" stop-color="' + p.gem + '"/><stop offset="1" stop-color="' + p.gemDk + '"/></linearGradient>' +
      '<linearGradient id="sil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + p.sil0 + '"/><stop offset="1" stop-color="' + p.sil1 + '"/></linearGradient>' +
      '<linearGradient id="gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + p.near + '"/><stop offset="1" stop-color="' + p.ground + '"/></linearGradient>' +
    '</defs>' +
    '<rect width="200" height="186" fill="url(#sky)"/>' +
    '<rect width="200" height="186" fill="url(#gl)"/>' +
    '<circle cx="' + sunX + '" cy="42" r="13" fill="#fff2ce" opacity=".68"/>' +
    '<circle cx="' + sunX + '" cy="42" r="21" fill="none" stroke="#fff2ce" stroke-width=".8" opacity=".28"/>' +
    stars +
    '<path d="M-10 62Q32 54 74 62T158 60T210 66" fill="none" stroke="#fff" stroke-width="1.3" opacity=".14"/>' +
    '<path d="M-10 76Q44 68 94 76T210 72" fill="none" stroke="#fff" stroke-width="1" opacity=".1"/>' +
    '<path d="M0 118L28 88L54 108L88 74L122 110L152 84L182 108L200 94L200 186L0 186Z" fill="' + p.far + '" opacity=".72"/>' +
    '<path d="M0 140L36 116L72 136L110 110L146 138L178 118L200 132L200 186L0 186Z" fill="url(#gr)" opacity=".9"/>' +
    BUILDINGS[building](p) +
    '<path d="M0 146q50-9 100-4t100 4v40H0z" fill="' + p.ground + '" opacity=".92"/>' +
    // 前景宝石晶簇：上移到画面中景，避免被卡名条盖住
    '<g stroke="#fff" stroke-opacity=".3" stroke-width=".9">' +
      '<path d="M' + (gx - 32) + ' 126l11 11-11 23-11-23z" fill="url(#gem)"/>' +
      '<path d="M' + (gx + 30) + ' 122l10 11-10 25-10-25z" fill="url(#gem)"/>' +
      '<path d="M' + gx + ' 106l17 20-17 34-17-34z" fill="url(#gem)"/>' +
    '</g>' +
    '<path d="M' + gx + ' 106l-17 20 17 34 17-34z" fill="none" stroke="#ffe9b8" stroke-opacity=".68" stroke-width="1.1"/>' +
    '<path d="M' + gx + ' 106v54M' + (gx - 17) + ' 126h34M' + gx + ' 106l-9 20M' + gx + ' 106l9 20" fill="none" stroke="#fff" stroke-opacity=".34" stroke-width=".8"/>' +
    '<path d="M' + (gx - 10) + ' 118l9-11-5 19z" fill="#fff" opacity=".3"/>' +
    '<ellipse cx="' + gx + '" cy="162" rx="46" ry="7" fill="#000" opacity=".22"/>' +
    // 斜向光斑 + 双线金框 + 四角小钻
    '<path d="M-30 186L110 0h34L4 186z" fill="#fff" opacity=".045"/>' +
    '<rect x="2.5" y="2.5" width="195" height="181" fill="none" stroke="#f3d9a4" stroke-opacity=".5" stroke-width="1.5"/>' +
    '<rect x="6" y="6" width="188" height="174" fill="none" stroke="#f3d9a4" stroke-opacity=".2" stroke-width=".7"/>' +
    '<path d="M12 12l4 4-4 4-4-4zM188 12l4 4-4 4-4-4zM12 174l4 4-4 4-4-4zM188 174l4 4-4 4-4-4z" fill="#f3d9a4" opacity=".62"/>' +
    '</svg>';
}

/* 贵族肖像：织锦底 + 椭圆像框 + 冠冕剪影，三张不同配色 */
function nobleSVG(tone, seed) {
  const T = [
    { a: '#6d2f3c', b: '#2a1420', robe: '#9c4250', gold: '#f0cf8d' },
    { a: '#2d4772', b: '#131f38', robe: '#41639c', gold: '#efd79c' },
    { a: '#356044', b: '#142c20', robe: '#4f8a60', gold: '#eed494' }
  ][tone];
  const crown = seed % 2 === 0
    ? '<path d="M58 52l6-16 10 11 9-19 9 19 10-11 6 16z" fill="' + T.gold + '"/>'
    : '<path d="M56 52l4-13 9 8 7-17 8 17 10-8 5 13z" fill="' + T.gold + '" opacity=".92"/>';

  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 116" preserveAspectRatio="xMidYMid slice">' +
    '<defs>' +
      '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + T.a + '"/><stop offset="1" stop-color="' + T.b + '"/></linearGradient>' +
      '<radialGradient id="halo" cx="50%" cy="34%" r="58%"><stop offset="0" stop-color="#ffe6b0" stop-opacity=".36"/><stop offset="1" stop-color="#ffe6b0" stop-opacity="0"/></radialGradient>' +
    '</defs>' +
    '<rect width="150" height="116" fill="url(#bg)"/>' +
    '<rect width="150" height="116" fill="url(#halo)"/>' +
    // 织锦放射纹
    '<g stroke="' + T.gold + '" stroke-opacity=".13" stroke-width=".8">' +
      '<path d="M75 46L0 0M75 46L50 0M75 46L100 0M75 46L150 0M75 46L0 60M75 46L150 60M75 46L0 116M75 46L150 116"/>' +
    '</g>' +
    '<rect x="3" y="3" width="144" height="110" fill="none" stroke="' + T.gold + '" stroke-opacity=".72" stroke-width="1.6"/>' +
    '<rect x="7" y="7" width="136" height="102" fill="none" stroke="' + T.gold + '" stroke-opacity=".3" stroke-width=".7"/>' +
    '<ellipse cx="75" cy="66" rx="34" ry="42" fill="#120b12" opacity=".42"/>' +
    '<ellipse cx="75" cy="66" rx="33" ry="41" fill="none" stroke="' + T.gold + '" stroke-opacity=".75" stroke-width="1.5"/>' +
    // 肩 / 颈 / 头
    '<path d="M36 116q4-30 39-32t39 32z" fill="' + T.robe + '"/>' +
    '<path d="M36 116q4-30 39-32t39 32" fill="none" stroke="' + T.gold + '" stroke-opacity=".55" stroke-width="1.2"/>' +
    '<path d="M66 78l9 14 9-14" fill="none" stroke="' + T.gold + '" stroke-opacity=".7" stroke-width="1.1"/>' +
    '<rect x="69" y="66" width="12" height="14" rx="5" fill="#e4bd97"/>' +
    '<ellipse cx="75" cy="55" rx="17" ry="21" fill="#efd0aa"/>' +
    '<path d="M58 52q2-24 17-24t17 24q-6-10-17-10t-17 10z" fill="#2b1a20" opacity=".88"/>' +
    crown +
    '<circle cx="75" cy="34" r="2.6" fill="#fff0c0"/>' +
    '<circle cx="64" cy="40" r="1.7" fill="' + T.gold + '"/><circle cx="86" cy="40" r="1.7" fill="' + T.gold + '"/>' +
    '<circle cx="67" cy="57" r="1.5" fill="#3a2620"/><circle cx="83" cy="57" r="1.5" fill="#3a2620"/>' +
    '<path d="M70 66q5 4 10 0" fill="none" stroke="#9a6a55" stroke-width="1.2"/>' +
    // 两侧卷草
    '<path d="M14 58q8-12 16 0t-8 12M136 58q-8-12-16 0t8 12" fill="none" stroke="' + T.gold + '" stroke-opacity=".5" stroke-width="1.1"/>' +
    '<path d="M20 20l3 3-3 3-3-3zM130 20l3 3-3 3-3-3zM20 96l3 3-3 3-3-3zM130 96l3 3-3 3-3-3z" fill="' + T.gold + '" opacity=".55"/>' +
    '</svg>';
}

/* 牌库牌背：双层金框 + 中央菱形宝石 + 卷草角花 */
function deckSVG(tone) {
  const T = [
    { a: '#24579d', b: '#0d2b5c', g: '#8ec0f5', g2: '#204f95' },
    { a: '#a9812c', b: '#5b3c0a', g: '#ffe6a0', g2: '#9c6c14' },
    { a: '#2c7a4c', b: '#103d25', g: '#9ee0b2', g2: '#1d6740' }
  ][tone];
  let rays = '';
  for (let i = 0; i < 12; i++) {
    const ang = (i * 30 * Math.PI) / 180;
    const x1 = 54 + Math.cos(ang) * 18;
    const y1 = 96 + Math.sin(ang) * 18;
    const x2 = 54 + Math.cos(ang) * 34;
    const y2 = 96 + Math.sin(ang) * 34;
    rays += '<path d="M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + 'L' + x2.toFixed(1) + ' ' + y2.toFixed(1) + '" stroke="' + T.g + '" stroke-opacity=".14" stroke-width="1"/>';
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 192" preserveAspectRatio="xMidYMid slice">' +
    '<defs>' +
      '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + T.a + '"/><stop offset="1" stop-color="' + T.b + '"/></linearGradient>' +
      '<linearGradient id="gm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + T.g + '"/><stop offset=".5" stop-color="' + T.g2 + '"/><stop offset="1" stop-color="' + T.b + '"/></linearGradient>' +
    '</defs>' +
    '<rect width="108" height="192" fill="url(#bg)"/>' +
    '<g>' + rays + '</g>' +
    '<rect x="4" y="4" width="100" height="184" fill="none" stroke="#f0d293" stroke-opacity=".85" stroke-width="2"/>' +
    '<rect x="9" y="9" width="90" height="174" fill="none" stroke="#f0d293" stroke-opacity=".36" stroke-width=".9"/>' +
    '<path d="M12 30h84M12 162h84" stroke="#f0d293" stroke-opacity=".45" stroke-width="1"/>' +
    '<path d="M54 60l30 36-30 36-30-36z" fill="url(#gm)" stroke="#fff0c4" stroke-opacity=".8" stroke-width="1.6"/>' +
    '<path d="M54 60v72M24 96h60M54 60l-15 36M54 60l15 36" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="1"/>' +
    '<path d="M39 78l15-18-7 24z" fill="#fff" opacity=".22"/>' +
    '<path d="M54 16l4 6-4 6-4-6zM54 164l4 6-4 6-4-6z" fill="#f0d293" opacity=".8"/>' +
    '<path d="M16 16q10 2 10 12M92 16q-10 2-10 12M16 176q10-2 10-12M92 176q-10-2-10-12" fill="none" stroke="#f0d293" stroke-opacity=".55" stroke-width="1.1"/>' +
    '<circle cx="16" cy="96" r="2" fill="#f0d293" opacity=".7"/><circle cx="92" cy="96" r="2" fill="#f0d293" opacity=".7"/>' +
    '</svg>';
}

/* 顶部横幅装饰：细金线 + 菱纹，用于回合标题 */
function bannerSVG() {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 12" preserveAspectRatio="none">' +
    '<path d="M0 6h150M270 6h150" stroke="#e8c684" stroke-opacity=".55" stroke-width="1"/>' +
    '<path d="M210 1l5 5-5 5-5-5z" fill="#e8c684" opacity=".8"/>' +
    '<circle cx="164" cy="6" r="1.6" fill="#e8c684" opacity=".6"/><circle cx="256" cy="6" r="1.6" fill="#e8c684" opacity=".6"/>' +
    '</svg>';
}

/* 牌桌中央的低对比度织金纹章，模拟实体桌垫压印 */
function emblemSVG() {
  let rays = '';
  for (let i = 0; i < 16; i++) {
    const a = (i * 22.5 * Math.PI) / 180;
    const x1 = (150 + Math.cos(a) * 62).toFixed(1);
    const y1 = (150 + Math.sin(a) * 62).toFixed(1);
    const x2 = (150 + Math.cos(a) * 116).toFixed(1);
    const y2 = (150 + Math.sin(a) * 116).toFixed(1);
    rays += '<path d="M' + x1 + ' ' + y1 + 'L' + x2 + ' ' + y2 + '"/>';
  }
  let dots = '';
  for (let i = 0; i < 8; i++) {
    const a = (i * 45 * Math.PI) / 180;
    const x = (150 + Math.cos(a) * 132).toFixed(1);
    const y = (150 + Math.sin(a) * 132).toFixed(1);
    dots += '<path d="M' + x + ' ' + (Number(y) - 5).toFixed(1) + 'l5 5-5 5-5-5z"/>';
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">' +
    '<g fill="none" stroke="#f0cf8d" stroke-width="1.2" opacity=".85">' +
      '<circle cx="150" cy="150" r="138"/><circle cx="150" cy="150" r="126"/><circle cx="150" cy="150" r="58"/>' +
      '<path d="M150 18L282 150 150 282 18 150z"/>' +
      '<path d="M150 48L252 150 150 252 48 150z"/>' +
      '<path d="M150 84L216 150 150 216 84 150z"/>' +
      rays +
    '</g>' +
    '<g fill="#f0cf8d" opacity=".8">' + dots + '</g>' +
    '<path d="M150 108l34 42-34 42-34-42z" fill="none" stroke="#f0cf8d" stroke-width="1.6"/>' +
    '</svg>';
}

const lines = [];
lines.push('/* 由 preview/art.js 生成，请勿手工编辑；运行 node preview/art.js 重建 */');
lines.push('/* 程序化矢量插画（base64 内联）：15 张发展卡 / 3 张贵族肖像 / 3 张牌库牌背 */');
lines.push('');

for (let c = 0; c < PALETTES.length; c++) {
  for (let v = 0; v < 3; v++) {
    const idx = c * 3 + v;
    const building = (c * 3 + v) % BUILDINGS.length;
    // 双类选择器优先级高于 index.wxss 里的兜底渐变，避免被后面的同名规则覆盖
    lines.push('.card-art.art-' + idx + ' { background-image: ' + bg(cardSVG(PALETTES[c], building, idx)) + '; }');
  }
}
lines.push('');
// 用显式类名而非 :nth-child：小程序 WXSS 对伪类选择器支持有限
for (let i = 0; i < 3; i++) {
  lines.push('.noble-face.noble-art-' + i + ' { background-image: ' + bg(nobleSVG(i, i)) + '; }');
}
lines.push('');
for (let i = 0; i < 3; i++) {
  lines.push('.deck.deck-art-' + i + '::before { background-image: ' + bg(deckSVG(i)) + '; }');
}
lines.push('');
lines.push('.turn-banner::after { background-image: ' + bg(bannerSVG()) + '; }');
lines.push('.table-emblem { background-image: ' + bg(emblemSVG()) + '; }');
lines.push('');

fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log('已生成 pages/index/art.wxss（' + (Buffer.byteLength(lines.join('\n')) / 1024).toFixed(1) + ' KB）');
