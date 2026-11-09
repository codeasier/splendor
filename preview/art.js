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

/* 牌库牌背：双层金框 + 中央菱形宝石 + 卷草角花 + 放射星芒 */
function deckSVG(tone) {
  // tone 即牌库等级下标：I=绿、II=赭金、III=深蓝。
  // 牌库自上而下为 III / II / I，因而在视觉上呈现「上蓝、中金、下绿」，与市场行一一对应。
  const T = [
    { a: '#1e6b43', m: '#13472c', b: '#092316', g: '#a8f0c0', g2: '#1f7a4c', rim: '#f3d79b' },
    { a: '#b88728', m: '#7d5310', b: '#382205', g: '#fff0b8', g2: '#b37e18', rim: '#ffe2a6' },
    { a: '#1f5299', m: '#133366', b: '#081836', g: '#a6d4ff', g2: '#255da8', rim: '#f3d9a4' }
  ][tone];
  let rays = '';
  for (let i = 0; i < 16; i++) {
    const ang = (i * 22.5 * Math.PI) / 180;
    const r1 = i % 2 === 0 ? 14 : 20;
    const r2 = i % 2 === 0 ? 42 : 34;
    const x1 = 54 + Math.cos(ang) * r1;
    const y1 = 96 + Math.sin(ang) * r1;
    const x2 = 54 + Math.cos(ang) * r2;
    const y2 = 96 + Math.sin(ang) * r2;
    rays += '<path d="M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + 'L' + x2.toFixed(1) + ' ' + y2.toFixed(1) + '" stroke="' + T.rim + '" stroke-opacity="' + (i % 2 === 0 ? '.24' : '.14') + '" stroke-width="1.1"/>';
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 192" preserveAspectRatio="xMidYMid slice">' +
    '<defs>' +
      '<radialGradient id="bg" cx="38%" cy="28%" r="82%"><stop offset="0" stop-color="' + T.a + '"/><stop offset=".55" stop-color="' + T.m + '"/><stop offset="1" stop-color="' + T.b + '"/></radialGradient>' +
      '<linearGradient id="gm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + T.g + '"/><stop offset=".5" stop-color="' + T.g2 + '"/><stop offset="1" stop-color="' + T.b + '"/></linearGradient>' +
    '</defs>' +
    '<rect width="108" height="192" fill="url(#bg)"/>' +
    '<circle cx="54" cy="96" r="38" fill="none" stroke="' + T.rim + '" stroke-opacity=".22" stroke-width="1"/>' +
    '<circle cx="54" cy="96" r="28" fill="none" stroke="' + T.rim + '" stroke-opacity=".3" stroke-width=".9" stroke-dasharray="3 2"/>' +
    '<g>' + rays + '</g>' +
    '<rect x="3.5" y="3.5" width="101" height="185" rx="3" fill="none" stroke="' + T.rim + '" stroke-opacity=".9" stroke-width="2.2"/>' +
    '<rect x="8" y="8" width="92" height="176" rx="2" fill="none" stroke="' + T.rim + '" stroke-opacity=".42" stroke-width="1"/>' +
    '<rect x="12" y="12" width="84" height="168" fill="none" stroke="' + T.rim + '" stroke-opacity=".18" stroke-width=".8"/>' +
    '<path d="M12 28h84M12 164h84" stroke="' + T.rim + '" stroke-opacity=".48" stroke-width="1"/>' +
    '<path d="M54 54l32 42-32 42-32-42z" fill="url(#gm)" stroke="#fff2c8" stroke-opacity=".86" stroke-width="1.6"/>' +
    '<path d="M54 62l25 34-25 34-25-34z" fill="none" stroke="#fff6db" stroke-opacity=".4" stroke-width=".9"/>' +
    '<path d="M54 54v84M22 96h64M54 54l-16 42M54 54l16 42" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="1"/>' +
    '<path d="M38 76l16-22-8 28z" fill="#fff" opacity=".25"/>' +
    '<path d="M54 14l5 7-5 7-5-7zM54 164l5 7-5 7-5-7z" fill="' + T.rim + '" opacity=".88"/>' +
    '<path d="M14 14h12v3H17v9h-3zM94 14H82v3h9v9h3zM14 178h12v-3H17v-9h-3zM94 178H82v-3h9v-9h3z" fill="' + T.rim + '" opacity=".72"/>' +
    '<circle cx="15" cy="96" r="2.4" fill="' + T.rim + '" opacity=".8"/><circle cx="93" cy="96" r="2.4" fill="' + T.rim + '" opacity=".8"/>' +
    '</svg>';
}

/* 顶部横幅装饰：古典双翼金线 + 菱形宝石花结，用于回合标题 */
function bannerSVG() {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 14" preserveAspectRatio="none">' +
    '<defs><linearGradient id="bl" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0" stop-color="#f3d48b" stop-opacity="0"/>' +
      '<stop offset=".2" stop-color="#f3d48b" stop-opacity=".65"/>' +
      '<stop offset=".5" stop-color="#fff1c8" stop-opacity=".95"/>' +
      '<stop offset=".8" stop-color="#f3d48b" stop-opacity=".65"/>' +
      '<stop offset="1" stop-color="#f3d48b" stop-opacity="0"/>' +
    '</linearGradient></defs>' +
    '<path d="M8 7h172M240 7h172" stroke="url(#bl)" stroke-width="1.3"/>' +
    '<path d="M48 4h118M254 4h118" stroke="#f3d48b" stroke-opacity=".28" stroke-width=".8"/>' +
    '<path d="M210 1l7 6-7 6-7-6z" fill="#ffe8aa" stroke="#9c6c1e" stroke-width=".8"/>' +
    '<path d="M194 4l3 3-3 3-3-3zM226 4l3 3-3 3-3-3z" fill="#f3d48b" opacity=".85"/>' +
    '<circle cx="180" cy="7" r="1.8" fill="#ffe8aa" opacity=".75"/><circle cx="240" cy="7" r="1.8" fill="#ffe8aa" opacity=".75"/>' +
    '</svg>';
}

/* 牌桌中央的佛罗伦萨星盘织金纹章，模拟皇家丝绒桌垫压印 */
function emblemSVG() {
  let rays = '';
  for (let i = 0; i < 24; i++) {
    const a = (i * 15 * Math.PI) / 180;
    const inner = i % 2 === 0 ? 44 : 64;
    const outer = i % 2 === 0 ? 128 : 112;
    const x1 = (150 + Math.cos(a) * inner).toFixed(1);
    const y1 = (150 + Math.sin(a) * inner).toFixed(1);
    const x2 = (150 + Math.cos(a) * outer).toFixed(1);
    const y2 = (150 + Math.sin(a) * outer).toFixed(1);
    rays += '<path d="M' + x1 + ' ' + y1 + 'L' + x2 + ' ' + y2 + '"/>';
  }
  let dots = '';
  for (let i = 0; i < 12; i++) {
    const a = (i * 30 * Math.PI) / 180;
    const x = (150 + Math.cos(a) * 134).toFixed(1);
    const y = (150 + Math.sin(a) * 134).toFixed(1);
    dots += '<path d="M' + x + ' ' + (Number(y) - 4.5).toFixed(1) + 'l4.5 4.5-4.5 4.5-4.5-4.5z"/>';
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">' +
    '<g fill="none" stroke="#f3d48b" stroke-width="1.2" opacity=".9">' +
      '<circle cx="150" cy="150" r="144"/><circle cx="150" cy="150" r="138" stroke-dasharray="4 3"/>' +
      '<circle cx="150" cy="150" r="126"/><circle cx="150" cy="150" r="92" stroke-dasharray="2 3"/>' +
      '<circle cx="150" cy="150" r="62"/><circle cx="150" cy="150" r="42"/>' +
      '<path d="M150 12L288 150 150 288 12 150z"/>' +
      '<path d="M52 52h196v196H52z"/>' +
      '<path d="M150 44L256 150 150 256 44 150z"/>' +
      '<path d="M150 78L222 150 150 222 78 150z"/>' +
      rays +
    '</g>' +
    '<g fill="#f3d48b" opacity=".85">' + dots + '</g>' +
    '<path d="M150 104l46 46-46 46-46-46z" fill="none" stroke="#ffe7ad" stroke-width="1.8"/>' +
    '<circle cx="150" cy="150" r="14" fill="none" stroke="#ffe7ad" stroke-width="1.6"/>' +
    '</svg>';
}

/* 牌桌四角黄铜雕花包角（带红宝石铆钉） */
function cornerMountSVG() {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">' +
    '<defs>' +
      '<linearGradient id="br" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#fff2c6"/><stop offset=".45" stop-color="#d9a650"/><stop offset="1" stop-color="#6e4414"/>' +
      '</linearGradient>' +
      '<radialGradient id="rb" cx="35%" cy="30%" r="70%">' +
        '<stop offset="0" stop-color="#ffd0c8"/><stop offset=".45" stop-color="#d9383a"/><stop offset="1" stop-color="#590d16"/>' +
      '</radialGradient>' +
    '</defs>' +
    '<path d="M2 2h38l-6 7H14v25l-7 6V2z" fill="url(#br)" stroke="#3b2008" stroke-width="1"/>' +
    '<path d="M5 5h29l-3 3H11v23l-3 3V5z" fill="none" stroke="#fff6d6" stroke-opacity=".65" stroke-width=".9"/>' +
    '<path d="M14 14q12 0 18 6t6 18q-8-10-14-14t-10-10z" fill="url(#br)" opacity=".88"/>' +
    '<circle cx="11" cy="11" r="4.5" fill="url(#rb)" stroke="#fff0c0" stroke-width="1"/>' +
    '<circle cx="28" cy="6" r="1.6" fill="#fff2c6"/><circle cx="6" cy="28" r="1.6" fill="#fff2c6"/>' +
    '</svg>';
}

/* 首页皇家珠宝行会徽章：八芒星 + 金桂冠 + 宝石镶座 */
function brandCrestSVG() {
  let pts = '';
  for (let i = 0; i < 16; i++) {
    const a = (i * 22.5 * Math.PI) / 180;
    const r = i % 2 === 0 ? 44 : 31;
    const x = (48 + Math.cos(a) * r).toFixed(1);
    const y = (48 + Math.sin(a) * r).toFixed(1);
    pts += (i === 0 ? 'M' : 'L') + x + ' ' + y;
  }
  pts += 'Z';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">' +
    '<defs>' +
      '<radialGradient id="cg" cx="34%" cy="24%" r="76%">' +
        '<stop offset="0" stop-color="#fff6d8"/><stop offset=".38" stop-color="#eab862"/>' +
        '<stop offset=".75" stop-color="#9e681c"/><stop offset="1" stop-color="#452409"/>' +
      '</radialGradient>' +
      '<radialGradient id="in" cx="50%" cy="40%" r="60%">' +
        '<stop offset="0" stop-color="#381c2c"/><stop offset="1" stop-color="#130811"/>' +
      '</radialGradient>' +
    '</defs>' +
    '<path d="' + pts + '" fill="url(#cg)" stroke="#fff1c2" stroke-opacity=".75" stroke-width="1.2"/>' +
    '<circle cx="48" cy="48" r="32" fill="url(#cg)" stroke="#522c0a" stroke-width="1.4"/>' +
    '<circle cx="48" cy="48" r="29" fill="none" stroke="#fff5d6" stroke-opacity=".75" stroke-width="1"/>' +
    '<circle cx="48" cy="48" r="24" fill="url(#in)" stroke="#eab862" stroke-width="1.5"/>' +
    '<circle cx="48" cy="48" r="20" fill="none" stroke="#f3d48b" stroke-opacity=".45" stroke-width=".9" stroke-dasharray="2.5 2"/>' +
    '<circle cx="48" cy="19" r="2" fill="#fff5d6"/><circle cx="48" cy="77" r="2" fill="#fff5d6"/>' +
    '<circle cx="19" cy="48" r="2" fill="#fff5d6"/><circle cx="77" cy="48" r="2" fill="#fff5d6"/>' +
    '</svg>';
}

/* ------------------------------------------------------------------
 * 伪 3D 桌面素材
 * ------------------------------------------------------------------ */

/** 底部用户工作台：S 形拱起的皇家乌木镶金托盘（四边全包金框 + 左右雕花翼板） */
function trayRimSVG() {
  const outer = 'M4 124 L4 66 Q4 54 16 54 L196 54 C222 54 220 5 264 5 L686 5 C730 5 728 54 754 54 L934 54 Q946 54 946 66 L946 124 Q946 128 942 128 L8 128 Q4 128 4 124 Z';
  const topRim = 'M6 64 Q6 54 16 54 L196 54 C222 54 220 5 264 5 L686 5 C730 5 728 54 754 54 L934 54 Q944 54 944 64';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 950 130" preserveAspectRatio="none">' +
    '<defs>' +
      '<linearGradient id="well" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#26111e" stop-opacity=".97"/>' +
        '<stop offset=".42" stop-color="#311626" stop-opacity=".97"/>' +
        '<stop offset="1" stop-color="#12070e" stop-opacity=".99"/>' +
      '</linearGradient>' +
      '<linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#fff6d6"/><stop offset=".35" stop-color="#f0c372"/>' +
        '<stop offset=".72" stop-color="#a87224"/><stop offset="1" stop-color="#5c370c"/>' +
      '</linearGradient>' +
      '<linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0" stop-color="#fff0c0" stop-opacity=".22"/>' +
        '<stop offset=".25" stop-color="#fff5d6" stop-opacity=".68"/>' +
        '<stop offset=".5" stop-color="#ffffff" stop-opacity=".88"/>' +
        '<stop offset=".75" stop-color="#fff5d6" stop-opacity=".68"/>' +
        '<stop offset="1" stop-color="#fff0c0" stop-opacity=".22"/>' +
      '</linearGradient>' +
    '</defs>' +
    // 上缘外侧的桌布投影：让金边看起来是"压"在绒布上
    '<path d="' + topRim + '" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="10" transform="translate(0,-4)"/>' +
    // 凹陷主体：完整包边闭合，不再在左右两侧露出直角黑边
    '<path d="' + outer + '" fill="url(#well)" stroke="url(#rim)" stroke-width="3.2"/>' +
    // 凹槽内壁阴影：金线下方一道暗边，产生深度
    '<path d="' + topRim + '" fill="none" stroke="#000" stroke-opacity=".68" stroke-width="4.5" transform="translate(0,4.5)"/>' +
    // 顶部高光细线 + 内嵌细金线
    '<path d="' + topRim + '" fill="none" stroke="url(#sheen)" stroke-width="1.2" transform="translate(0,-1.4)"/>' +
    '<path d="' + topRim + '" fill="none" stroke="#f3d48b" stroke-opacity=".26" stroke-width=".9" transform="translate(0,7)"/>' +
    // 左右分区雕花立柱与中拱装饰线
    '<path d="M236 56 V122 M714 56 V122" stroke="#f3d48b" stroke-opacity=".26" stroke-width="1.2"/>' +
    '<path d="M236 52l4 4-4 4-4-4zM714 52l4 4-4 4-4-4zM475 1l5 4-5 4-5-4z" fill="#ffe7ad" opacity=".86"/>' +
    '<path d="M276 52 H674" stroke="#f0cf8d" stroke-opacity=".16" stroke-width=".9"/>' +
    '<path d="M16 123 H934" stroke="#e8bd72" stroke-opacity=".24" stroke-width="1"/>' +
    '</svg>';
}

/** 玩家肖像：方形金框古典半身像，用于工作台左下角 */
function portraitSVG() {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 140" preserveAspectRatio="xMidYMid slice">' +
    '<defs>' +
      '<radialGradient id="pb" cx="46%" cy="28%" r="82%"><stop offset="0" stop-color="#8a5546"/><stop offset="1" stop-color="#1a0f18"/></radialGradient>' +
      '<linearGradient id="robe" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#74403f"/><stop offset="1" stop-color="#21121b"/></linearGradient>' +
    '</defs>' +
    '<rect width="120" height="140" fill="url(#pb)"/>' +
    '<path d="M16 140V58a44 44 0 0 1 88 0v82" fill="none" stroke="#e0b878" stroke-opacity=".26" stroke-width="1.4"/>' +
    '<path d="M6 140q8-44 54-46t54 46z" fill="url(#robe)"/>' +
    '<path d="M6 140q8-44 54-46t54 46" fill="none" stroke="#e0b878" stroke-opacity=".48" stroke-width="1.2"/>' +
    '<path d="M31 68q-3-40 29-40t29 40q5 32-2 48l-11-36H44l-11 36q-7-16-2-48z" fill="#2a1a1e"/>' +
    '<ellipse cx="60" cy="58" rx="22" ry="27" fill="#dcb087"/>' +
    '<path d="M38 52q2-27 22-27t22 27q-8-12-22-12t-22 12z" fill="#2a1a1e"/>' +
    '<path d="M47 54h9M64 54h9" stroke="#3a241c" stroke-width="2" stroke-linecap="round"/>' +
    '<circle cx="52" cy="60" r="1.9" fill="#2b1a16"/><circle cx="68" cy="60" r="1.9" fill="#2b1a16"/>' +
    '<path d="M60 62v9" stroke="#a9775a" stroke-width="1.4"/>' +
    '<path d="M45 72q7-6 15 0t15 0q-2 19-15 23t-15-23z" fill="#33201e" opacity=".93"/>' +
    '<path d="M52 77q8 5 16 0" fill="none" stroke="#825a45" stroke-width="1.2"/>' +
    '<path d="M0 0h46L18 140H0z" fill="#fff" opacity=".055"/>' +
    '<rect x="2.5" y="2.5" width="115" height="135" fill="none" stroke="#f0cf8d" stroke-opacity=".88" stroke-width="2"/>' +
    '<rect x="6" y="6" width="108" height="128" fill="none" stroke="#f0cf8d" stroke-opacity=".28" stroke-width=".8"/>' +
    '</svg>';
}

/** 对手徽章的椭圆金环织纹，强化"实体徽章"而非平面色块 */
function rivalPlaqueSVG() {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 76" preserveAspectRatio="none">' +
    '<defs><linearGradient id="rp" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#5c3346"/><stop offset="1" stop-color="#160b14"/>' +
    '</linearGradient></defs>' +
    '<path d="M8 8h194v60H8z" fill="url(#rp)"/>' +
    '<path d="M8 8h194v60H8z" fill="none" stroke="#e6bd78" stroke-opacity=".8" stroke-width="2"/>' +
    '<path d="M13 13h184v50H13z" fill="none" stroke="#e6bd78" stroke-opacity=".28" stroke-width=".8"/>' +
    '<path d="M8 14h194" stroke="#fff0c8" stroke-opacity=".14" stroke-width="3"/>' +
    '</svg>';
}

/* ==================================================================
 * 素材分层（同一套视觉体系，按用途命名，供 WXML 组件按需组合）
 *   photo-*   卡面 / 肖像：CC0 文艺复兴油画缩略图（preview/thumbs，已入库）
 *   deck-*    牌背包框：程序化矢量，上蓝 / 中金 / 下绿
 *   gem-*     宝石图标：6 色各异的切面轮廓，卡面、费用、筹码、资源栏同源
 *   coin-*    筹码顶面：象牙白内盘 + 资源色外圈 + 金属倒角
 *   tray-*    金属 HUD：S 形托盘、纹章、徽记
 * 数字与文字一律由 WXML 实时渲染，不烘焙进任何图片。
 * ================================================================== */

/* ---------- 宝石：高饱和度五色 + 黄金体系（白钻纯白、蓝宝亮蓝、祖母翠绿、红宝绯红、黑曜深褐黑，一眼可辨） ---------- */
const GEM_META = {
  white: {
    hi: '#ffffff', mid: '#edf3fa', dark: '#9fb2c7',
    table0: '#ffffff', table1: '#d4e0ed', rim: '#4a5d70',
    badge0: '#ffffff', badge1: '#e6eff8', badge2: '#b2c4d8', badgeRim: '#ffffff',
    shape: 'diamond'
  },
  blue: {
    hi: '#a8e6ff', mid: '#1882f5', dark: '#06398a',
    table0: '#3399ff', table1: '#0b4eb8', rim: '#052254',
    badge0: '#6bc8ff', badge1: '#1478eb', badge2: '#073b8a', badgeRim: '#bfeaff',
    shape: 'oval'
  },
  green: {
    hi: '#a8ffc4', mid: '#15bd52', dark: '#055422',
    table0: '#24d464', table1: '#097530', rim: '#043816',
    badge0: '#68f296', badge1: '#12ad4a', badge2: '#065723', badgeRim: '#c4ffd8',
    shape: 'rect'
  },
  red: {
    hi: '#ffb8b3', mid: '#eb2128', dark: '#75060c',
    table0: '#ff3b38', table1: '#a80b12', rim: '#4d0408',
    badge0: '#ff7873', badge1: '#e01b22', badge2: '#7d070d', badgeRim: '#ffd0cc',
    shape: 'cushion'
  },
  black: {
    hi: '#c4aea2', mid: '#42332e', dark: '#120c0a',
    table0: '#52403a', table1: '#1c1412', rim: '#080504',
    badge0: '#735d54', badge1: '#2e2320', badge2: '#110c0a', badgeRim: '#d8be98',
    shape: 'octagon'
  },
  gold: {
    hi: '#fff9db', mid: '#f2b830', dark: '#784806',
    table0: '#ffcc44', table1: '#9c620c', rim: '#3d2204',
    badge0: '#fff0a8', badge1: '#e0a224', badge2: '#7a4b06', badgeRim: '#fff8d6',
    shape: 'coin'
  }
};

function gemSVG(key) {
  const m = GEM_META[key];
  let outline;
  let table;
  let facets;
  if (m.shape === 'diamond') {
    outline = 'M32 4L57 25 32 60 7 25Z';
    table = 'M32 14L46 26 32 48 18 26Z';
    facets = 'M7 25h50M32 4v56M18 26L32 4l14 22-14 22zM7 25l11 1M57 25l-11 1';
  } else if (m.shape === 'oval') {
    outline = 'M32 6c15 0 25 11.5 25 26S47 58 32 58 7 46.5 7 32 17 6 32 6Z';
    table = 'M32 15c9.5 0 16 7.5 16 17s-6.5 17-16 17-16-7.5-16-17 6.5-17 16-17Z';
    facets = 'M32 6v52M7 32h50M13 15l19 17 19-17M13 49l19-17 19 17';
  } else if (m.shape === 'rect') {
    outline = 'M14 10h36l9 9v26l-9 9H14l-9-9V19Z';
    table = 'M19 17h26l5 5v20l-5 5H19l-5-5V22Z';
    facets = 'M14 10l5 7M50 10l-5 7M14 54l5-7M50 54l-5-7M5 19l9 3M59 19l-9 3M5 45l9-3M59 45l-9-3';
  } else if (m.shape === 'cushion') {
    outline = 'M20 8h24l14 14v20L44 56H20L6 42V22Z';
    table = 'M23 16h18l8 8v16l-8 8H23l-8-8V24Z';
    facets = 'M6 22l9 2M58 22l-9 2M6 42l9-2M58 42l-9-2M20 8l3 8M44 8l-3 8M20 56l3-8M44 56l-3-8';
  } else if (m.shape === 'octagon') {
    outline = 'M21 6h22l15 15v22L43 58H21L6 43V21Z';
    table = 'M24 15h16l10 10v14L40 49H24L14 39V25Z';
    facets = 'M6 21l8 4M58 21l-8 4M6 43l8-4M58 43l-8-4M21 6l3 9M43 6l-3 9M21 58l3-9M43 58l-3-9';
  } else {
    outline = 'M32 5a27 27 0 1 0 0 54a27 27 0 1 0 0-54Z';
    table = 'M32 14a18 18 0 1 0 0 36a18 18 0 1 0 0-36Z';
    facets = 'M32 5v54M5 32h54M13 13l38 38M51 13L13 51';
  }
  const strokeCol = key === 'white' ? '#6e849c' : '#ffffff';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" preserveAspectRatio="xMidYMid meet">' +
    '<defs>' +
      '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="' + m.hi + '"/><stop offset=".42" stop-color="' + m.mid + '"/>' +
        '<stop offset="1" stop-color="' + m.dark + '"/></linearGradient>' +
      '<radialGradient id="tb" cx="36%" cy="30%" r="72%">' +
        '<stop offset="0" stop-color="' + m.table0 + '"/><stop offset="1" stop-color="' + m.table1 + '"/></radialGradient>' +
    '</defs>' +
    '<path d="' + outline + '" fill="url(#g)" stroke="' + m.rim + '" stroke-width="2.2"/>' +
    '<path d="' + facets + '" fill="none" stroke="' + strokeCol + '" stroke-opacity=".5" stroke-width="1.2"/>' +
    '<path d="' + table + '" fill="url(#tb)" stroke="' + strokeCol + '" stroke-opacity=".65" stroke-width="1.2"/>' +
    '<path d="M32 5L9 25l23 10z" fill="#fff" opacity=".24"/>' +
    '<ellipse cx="22" cy="16" rx="7.5" ry="3.5" transform="rotate(-28 22 16)" fill="#fff" opacity=".75"/>' +
    '<circle cx="42" cy="44" r="2.2" fill="' + m.hi + '" opacity=".6"/>' +
    '</svg>';
}

/**
 * 专用于卡牌左下角费用气泡（.cost-bubble）、贵族需求（.noble-req）与永久红利（.disc-chip）的满铺高饱和度珐琅底章：
 * 100% 填满整个徽章（不露出黑底死角），白钻纯白、蓝宝亮蓝、祖母翠绿、红宝绯红、黑曜深褐黑一眼可辨。
 */
function costBadgeSVG(key) {
  const m = GEM_META[key];
  const facetCol = key === 'white' ? '#7b92ab' : '#ffffff';
  const facetOp = key === 'white' ? '.32' : '.26';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" preserveAspectRatio="none">' +
    '<defs>' +
      '<radialGradient id="cb" cx="32%" cy="26%" r="78%">' +
        '<stop offset="0" stop-color="' + m.badge0 + '"/>' +
        '<stop offset=".48" stop-color="' + m.badge1 + '"/>' +
        '<stop offset="1" stop-color="' + m.badge2 + '"/>' +
      '</radialGradient>' +
    '</defs>' +
    '<rect width="64" height="64" fill="url(#cb)"/>' +
    '<path d="M32 4L58 32 32 60 6 32Z" fill="none" stroke="' + facetCol + '" stroke-opacity="' + facetOp + '" stroke-width="1.5"/>' +
    '<circle cx="32" cy="32" r="24" fill="none" stroke="' + m.badgeRim + '" stroke-opacity=".42" stroke-width="1.4"/>' +
    '<ellipse cx="22" cy="15" rx="14" ry="7" transform="rotate(-22 22 15)" fill="#ffffff" opacity="' + (key === 'white' ? '.72' : '.38') + '"/>' +
    '</svg>';
}

/* ---------- 筹码顶面：加宽的高饱和宝石外环 + 象牙羊皮内盘 + 珠边金圈 ---------- */
function coinFaceSVG(key) {
  const m = GEM_META[key];
  let lugs = '';
  for (let i = 0; i < 8; i++) {
    const a = (i * 45 * Math.PI) / 180;
    const x1 = (60 + Math.cos(a) * 42).toFixed(1);
    const y1 = (60 + Math.sin(a) * 42).toFixed(1);
    const x2 = (60 + Math.cos(a) * 57).toFixed(1);
    const y2 = (60 + Math.sin(a) * 57).toFixed(1);
    lugs += '<path d="M' + x1 + ' ' + y1 + 'L' + x2 + ' ' + y2 + '" stroke="' + (key === 'white' ? '#6a8099' : '#fff5d6') + '" stroke-opacity=".68" stroke-width="2.8" stroke-linecap="round"/>';
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">' +
    '<defs>' +
      '<linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + m.badge0 + '"/>' +
        '<stop offset=".45" stop-color="' + m.badge1 + '"/><stop offset="1" stop-color="' + m.badge2 + '"/></linearGradient>' +
      '<radialGradient id="face" cx="35%" cy="28%" r="76%"><stop offset="0" stop-color="#fffaf0"/>' +
        '<stop offset=".58" stop-color="#f3e4c6"/><stop offset="1" stop-color="#c4a678"/></radialGradient>' +
      '<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff4cc"/>' +
        '<stop offset=".5" stop-color="#d8a44c"/><stop offset="1" stop-color="#694210"/></linearGradient>' +
    '</defs>' +
    '<circle cx="60" cy="60" r="58" fill="url(#ring)" stroke="url(#gold)" stroke-width="2.2"/>' +
    '<circle cx="60" cy="60" r="54" fill="none" stroke="' + (key === 'white' ? '#7b92ab' : '#fff5d6') + '" stroke-opacity=".55" stroke-width="1.4" stroke-dasharray="4 3"/>' +
    '<g>' + lugs + '</g>' +
    '<circle cx="60" cy="60" r="41" fill="url(#face)" stroke="url(#gold)" stroke-width="2.4"/>' +
    '<circle cx="60" cy="60" r="36" fill="none" stroke="#8c6430" stroke-opacity=".42" stroke-width="1" stroke-dasharray="2.5 2"/>' +
    '<circle cx="60" cy="60" r="29" fill="#2b1d24" opacity=".14"/>' +
    '<circle cx="60" cy="60" r="29" fill="none" stroke="url(#gold)" stroke-width="1.6"/>' +
    '<path d="M22 42a43 43 0 0 1 76 0" fill="none" stroke="#fff" stroke-opacity=".62" stroke-width="2.6"/>' +
    '<path d="M24 88a43 43 0 0 0 72 0" fill="none" stroke="#3a2214" stroke-opacity=".28" stroke-width="2.6"/>' +
    '</svg>';
}

/* ---------- 工程内缩略图（不依赖外部图床 / 不依赖本机图像工具） ---------- */
function jpegBg(file) {
  return 'url("data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64') + '")';
}

function collectThumbs(lines) {
  const base = path.join(__dirname, 'thumbs');
  const cardDir = path.join(base, 'cards');
  const nobleDir = path.join(base, 'nobles');
  let photoCount = 0;

  if (fs.existsSync(cardDir)) {
    lines.push('');
    lines.push('/* --- 卡面插画：CC0 文艺复兴油画，按 (宝石色序 × 18 + 序号) 索引 --- */');
    fs.readdirSync(cardDir).filter((f) => /\.jpg$/.test(f)).sort().forEach(function (f) {
      const m = /^c(\d+)_(\d+)\.jpg$/.exec(f);
      if (!m) return;
      const idx = Number(m[1]) * 18 + Number(m[2]);
      lines.push('.card-photo.photo-' + idx + ' { background-image: ' + jpegBg(path.join(cardDir, f)) + '; }');
      photoCount += 1;
    });
  } else {
    console.log('WARN 缺少 preview/thumbs/cards，卡面回退到程序化矢量插画');
  }

  if (fs.existsSync(nobleDir)) {
    lines.push('');
    lines.push('/* --- 贵族肖像：文艺复兴人物油画 --- */');
    fs.readdirSync(nobleDir).filter((f) => /\.jpg$/.test(f)).sort().forEach(function (f) {
      const m = /^n(\d+)\.jpg$/.exec(f);
      if (!m) return;
      lines.push('.noble-photo.noble-photo-' + m[1] + ' { background-image: ' + jpegBg(path.join(nobleDir, f)) + '; }');
    });
  }
  const portrait = path.join(base, 'portrait.jpg');
  if (fs.existsSync(portrait)) {
    lines.push('.portrait { background-image: ' + jpegBg(portrait) + '; }');
    lines.push('.rival-avatar.portrait-small { background-image: ' + jpegBg(portrait) + '; }');
  }
  return photoCount;
}

const lines = [];
lines.push('/* 由 preview/art.js 生成，请勿手工编辑；运行 node preview/art.js 重建 */');
lines.push('/* 素材分层：卡面油画 / 贵族肖像 / 牌背 / 宝石切面 / 筹码顶面 / 金属 HUD */');
lines.push('');

for (let c = 0; c < PALETTES.length; c++) {
  for (let v = 0; v < 3; v++) {
    const idx = c * 3 + v;
    const building = (c * 3 + v) % BUILDINGS.length;
    // 双类选择器优先级高于 index.wxss 里的兜底渐变，避免被后面的同名规则覆盖
    lines.push('.card-photo.art-' + idx + ' { background-image: ' + bg(cardSVG(PALETTES[c], building, idx)) + '; }');
  }
}
lines.push('');
// 用显式类名而非 :nth-child：小程序 WXSS 对伪类选择器支持有限
for (let i = 0; i < 3; i++) {
  lines.push('.noble-photo.noble-art-' + i + ' { background-image: ' + bg(nobleSVG(i, i)) + '; }');
}
lines.push('');
for (let i = 0; i < 3; i++) {
  // 牌背贴在 .deck-face 上：牌叠侧边 / 纸层 / 覆膜高光由 WXSS 分层渲染
  lines.push('.deck-stack.deck-art-' + i + ' .deck-face { background-image: ' + bg(deckSVG(i)) + '; }');
}
lines.push('');
lines.push('.turn-banner::after { background-image: ' + bg(bannerSVG()) + '; }');
lines.push('.table-emblem { background-image: ' + bg(emblemSVG()) + '; }');
lines.push('.corner { background-image: ' + bg(cornerMountSVG()) + '; }');
lines.push('.home-brand .brand-crest { background-image: ' + bg(brandCrestSVG()) + '; }');
lines.push('');
// 伪 3D 桌面素材。rival-plaque 用双类提权：art.wxss 由 @import 置于最前，
// 否则会被 index.wxss 里同名的 background 简写反向覆盖。
lines.push('.tray-rim { background-image: ' + bg(trayRimSVG()) + '; }');
if (!fs.existsSync(path.join(__dirname, 'thumbs', 'portrait.jpg'))) {
  lines.push('.portrait { background-image: ' + bg(portraitSVG()) + '; }');
}
lines.push('.rival-badge.rival-plaque { background-image: ' + bg(rivalPlaqueSVG()) + '; }');
lines.push('');

lines.push('/* --- 宝石切面图标：卡面右上 / 筹码中央 --- */');
Object.keys(GEM_META).forEach(function (k) {
  lines.push('.gem-icon.gem-' + k + ' { background-image: ' + bg(gemSVG(k)) + '; }');
});
lines.push('');
lines.push('/* --- 费用气泡 / 贵族需求 / 永久红利：100% 满铺高饱和度珐琅底章，五色立辨 --- */');
Object.keys(GEM_META).forEach(function (k) {
  const badgeUri = bg(costBadgeSVG(k));
  lines.push('.cost-bubble.gem-icon.gem-' + k + ', .noble-req.gem-icon.gem-' + k + ', .disc-chip.gem-icon.gem-' + k + ', .cost-line-dot.gem-icon.gem-' + k + ' { background-image: ' + badgeUri + '; }');
});
lines.push('');
lines.push('/* --- 筹码顶面：象牙白内盘 + 资源色外圈，侧壁厚度由 CSS 叠加 --- */');
Object.keys(GEM_META).forEach(function (k) {
  lines.push('.coin-face.coin-' + k + ' { background-image: ' + bg(coinFaceSVG(k)) + '; }');
});

const photoCount = collectThumbs(lines);
lines.push('');

fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log('已生成 pages/index/art.wxss（' + (Buffer.byteLength(lines.join('\n')) / 1024).toFixed(1) +
  ' KB，写实卡面 ' + photoCount + ' 张）');
