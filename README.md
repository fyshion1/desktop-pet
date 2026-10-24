# 桌宠 / Desktop Pet

通用 Electron 桌面聊天插件，与 Shionarium 共用助手、会话和记忆。支持用户自行选择本地 Live2D 与 VRM 模型。
插件 ID 为 `desktop_pet`，目录为 `desktop-pet`，Python 启动模块为 `pet`。

本目录由组合仓库维护，内核位于 `core/`。首次安装和 Python 路径以仓库根 README 为准。

## 安装与启动

在插件目录执行：

```powershell
npm ci
npm run build
python -m pet doctor
python -m pet run
```

Python 需要使用本体已配置的解释器；也可在本体的插件设置中启动。
默认后端为 `http://127.0.0.1:8000`，可用 `PET_BRAIN_URL` 指定其他本机端口。

## 模型由用户自行准备

本插件与默认构建不包含任何模型、贴图、动作包或 Cubism Core，不自动下载模型，也没有预设人物模型清单。
请自行从作者或合法渠道取得模型，核对使用许可，然后在桌宠底部点击 **添加模型**：

- Live2D：选择 `.model3.json`，保留其原始贴图、moc3、物理和表情文件的相对目录结构。
- VRM：选择 `.vrm` 文件，支持 VRM 0 / 1 的标准 humanoid 骨骼。
- Live2D 另需用户自行准备 Cubism Core，并确认运行时许可；将官方运行时放入本体 `frontend/public/vendor/live2dcubismcore.min.js`。

只登记用户明确选择的文件，不复制、搬动或修改模型原件，不扫描磁盘；模型目录、选择状态只存 Electron 用户数据目录的 `models.json`，不发送到后端或云端。
`PET_USER_DATA_DIR` 可覆盖用户数据目录，`PET_MODEL_CATALOG` 可单独指定本地模型登记文件。
未添加模型时仍可打开聊天面板；缺少 Live2D Core 不妨碍 VRM 或纯聊天模式启动。
清空本地登记不会删除模型文件。自行下载不代表自动获得商用或再分发权。

## 交互

- 点击人物或拖动底部把手，打开聊天与移动窗口。
- Enter 发送，Shift+Enter 换行；Escape 收起，Ctrl+Shift+Space 打开。
- 可切换助手私聊与群聊，按需启用朗读、语音识别与本地唤醒。
- 触屏只跟随主触点，使用平滑拖动。触屏设备保持窗口可交互，透明区域可能遮挡下方桌面点击。
- 复杂 Live2D 模型超过打包遮罩容量时自动启用高精度遮罩；不改动模型设计或贴图。
- VRM 提供自然站姿、呼吸、轻摆、头部光标跟随、口型与触摸回应；尚不支持摄像头动捕、VRMA/BVH 或舞蹈动作。

## 验证与边界

```powershell
npm test
npm run build
```

默认测试使用合成模型描述与临时目录，不下载第三方模型、不调用付费模型、不连接真实账号。
可选 GUI 测试需自行安装 Playwright；目标设备上的触屏手感与高精度渲染性能仍需验收。
用户模型、运行时 SDK、构建产物及本机配置应保持 Git 忽略，不要提交到公开仓库。

## 许可

原创代码、测试与原创文档采用 Apache-2.0，见 LICENSE 和 NOTICE。
依赖、Cubism SDK/Core、用户模型保留原许可；Live2D 分支存在独立的商用发行条件。
详见 [第三方声明](THIRD_PARTY_NOTICES.md)。
