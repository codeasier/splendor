'use strict';

// 云服务客户端只在此初始化一次。未执行「构建 npm」或 SDK 不可用时，
// 捕获异常并登记原因，降级为本地房间，避免整个小程序白屏；
// 界面据此提示「云服务未就绪」，而不是把它说成「设备离线」。
try {
  require('./utils/cloud.js');
} catch (err) {
  const reason = (err && err.message) || '云服务初始化失败';
  try { require('./utils/room.js').attachCloudFailure(reason); } catch (e) { /* 房间层也不可用时只能记日志 */ }
  console.warn('[splendor] 云端能力未就绪，使用本机房间：' + reason);
}

App({
  globalData: {
    appName: '璀璨宝石',
  },
});
