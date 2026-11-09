'use strict';

/**
 * 小程序端唯一的云服务客户端 —— 只在 app.js 里 require 一次。
 *
 * 边界说明：
 *  - H5 预览（preview/build.js）不执行 app.js，因此本文件不会被内联，
 *    utils/room.js 未收到 attachCloud 注入，自动保持本机房间模式。
 *  - 浏览器预览无法验证云端请求，真机验证需在微信体验版完成。
 *  - publicConfig 的值来自 workbuddy_cloud_service activate 的返回值，
 *    是可随前端下发的应用级公开配置；不允许凭空改写 endpoint，
 *    也不允许把任何服务端密钥写进这里。
 */

const { createMiniProgramWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram');
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics.js');
const room = require('./room.js');

const publicConfig = {
  endpoint: 'https://mp-api.app.workbuddy.host',
  publishableKey: 'wbpk_dMWuI8yncN03Dvu2hHuqAT_lhbqSu9Ko3bBptFKcj6cyOk7KHkCffId'
};

const cloud = createMiniProgramWorkBuddyCloud({
  endpoint: publicConfig.endpoint,
  publishableKey: publicConfig.publishableKey,
  wx: createDiagnosticWx(wx)
});

// 注入到 RoomAdapter，房间层不需要（也不应该）自己 require SDK。
room.attachCloud(cloud);

module.exports = {
  cloud: cloud,
  publicConfig: publicConfig
};
