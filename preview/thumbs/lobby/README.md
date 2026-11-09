# 商会大厅美术

来源：用户提供的《璀璨宝石商会大厅.png》视觉参考，不属于原有 CC0 油画卡面素材集。

- `scene.jpg`：去除固定头像、名字、标题、操作面板及底栏后的装饰场景。
- `panel.jpg`：保留雕花金框与青绿皮革，移除所有按钮和文字。
- `merchant.jpg`：仅作为未设置头像时的商人肖像。

可选重制：`python3 preview/prepare-lobby-art.py /path/to/璀璨宝石商会大厅.png`（需要 Pillow）。原始参考图留在工程外；运行 `node preview/art.js` 将这些轻量 JPEG 内嵌进 WXSS，常规构建不依赖 Python 或原图。操作文字、玩家资料、按钮和配置表单均由 WXML 实时渲染。
