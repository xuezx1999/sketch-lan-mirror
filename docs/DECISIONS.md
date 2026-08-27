# Sketch LAN Mirror — 决策记录（DECISIONS）

> 格式：每条 = 背景 / 实测证据 / 决策。按时间追加。

---

## ADR-001 · `sketch.export(output:false)` 返回单 Buffer，而非文档所述数组

- **背景**：官方 API 文档描述 `output:false` 时返回 Buffer 数组。
- **实测**（Sketch 2026.2，经 sketchtool run-script 在真实进程内验证）：
  - 单图层入参 → 直接返回一个 `Buffer`（ctor 名为 Buffer，`typeof === 'object'`），
    `length` 即 PNG 字节数，`buffer[0..3] === [0x89,0x50,0x4E,0x47]`。
  - 环境内置 skpm/buffer polyfill（`typeof Buffer === 'function'`）。
- **决策**：插件对返回值做形态归一（数组取 `[0]`，非数组直接用），两种形态都兼容。

## ADR-002 · Buffer → NSData 使用官方 `Buffer.prototype.toNSData()`

- **实测**：Buffer 原型上存在 `toNSData` 方法，转换正确且快（~2–30ms，大 PNG 30ms）。
- **决策**：转换策略链保留多级兜底（isKindOfClass NSData → toNSData → nsdata →
  dataWithBytes_length → base64 兜底），但主路径为 `toNSData()`。
- **结果**：真实环境命中策略 2（`buffer.toNSData`）。

## ADR-003 · 出参容器：无 `Ref()`，使用 `MOPointer` + `.value()`

- **实测**：CocoaScript 的 `Ref()` 在 Sketch 2026.2 运行时未暴露；
  `MOPointer` 可用，但取值方法是 `.value()`（不是社区旧资料写的 `.heldObject()`）。
- **决策**：`NSURLConnection.sendSynchronousRequest_returningResponse_error` 的两个出参用
  `MOPointer.alloc().init()` 承接，`.value()` 读取。

## ADR-004 · 异步 HTTP 回调在当前插件环境不可用 → MVP 采用主线程同步 POST

- **实测证据**：
  1. `NSURLSession dataTaskWithRequest:completionHandler:` 传入 JS 函数即抛 Obj-C 异常
     `-[MOJavaScriptObject copyWithZone:]`——JS 函数桥接的 block 不支持 copy，回调风格全灭。
  2. 经典 CocoaScript block 字面量 `^{}` 语法报 `SyntaxError: Unexpected token '^'`。
  3. 动态 delegate 方案依赖的 `Mocha.sharedRuntime().defineClass` 已不存在（undefined）。
  - 三条异步路径全部封死。
- **决策**：MVP 用 `NSURLConnection.sendSynchronousRequest` 在主线程发 loopback POST。
  实测耗时 1–5ms（PNG ≤155KB），UI 卡顿不可感知；导出本身（18–307ms）远比 POST 更重。
- **遗留**：若未来帧率要求提高（M3+ 自动推送场景），需重新评估：
  a) 预生成 NSBlock 的桥接方案；b) server 端反向轮询拉取；c) 官方若恢复 defineClass 再切回异步。

## ADR-005 · 非 ASCII Artboard 名走 header 百分号编码

- **背景**：HTTP header 仅允许 ASCII；中文画板名（如「首页（打卡练习）」）不能直传。
- **决策**：插件侧逐字符编码（ASCII 直通、其余 encodeURIComponent）→
  `x-artboard-name`；server 侧 `decodeURIComponent` 解码，失败时原样回退。
  纯 ASCII 名称行为不变，完全向后兼容（M1 唯一协议层修改）。
- **验证**：server 日志显示 `"首页（打卡练习）"` 正确还原。

## ADR-006 · 「Sketch 无法连接 localhost」根因是测试期 server 进程被回收

- **现象**：Sketch 内请求 `127.0.0.1:9777` 报 `NSURLErrorDomain -1004 CannotConnectToHost`。
- **排查与排除**：
  - 非 ATS：错误码应为 -1022；且外部 HTTPS（apple.com）同栈成功。
  - 非系统代理拦截：连代理自身端口可建立 TCP（-1005 是代理断开畸形请求，属预期）。
  - 非本地网络 TCC：同上，60283 可达证明 loopback 未被整体封锁。
  - **真因**：探针期间 server 进程随前台 shell 命令退出被连带回收，端口无人监听。
- **修正**：改由托管后台任务方式启动 server；重启后 Sketch → localhost 实测 200（2–4ms）。
- **教训**：网络类排错第一步先确认「对端是否真的活着」，再怀疑 ATS/代理/防火墙。

## ADR-007 · 测试基建事实（sketchtool run-script）

- `sketchtool run-script <代码字符串>`：参数是**代码字符串**而非文件路径。
- 该 argv 通道会**丢失 `?` 字符**（三元运算符全部损坏）→ 驱动脚本必须零问号，
  大段源码改由驱动内 `NSString.stringWithContentsOfFile` 读取后经工厂函数 eval。
- `eval` 内声明的函数不会覆盖包装环境的同名 handler → 用 `(function(){ ...source...;
  return { onRunRef: onRun } })()` 显式取出引用。
- 插件支持静默模式（`__SLM_SILENT=true`）：不弹窗、结果写入全局 `__SLM_LAST_RESULT`，
  供自动化断言；正常菜单调用不受影响。

## ADR-008 · Live Mirror 定时机制：运行时原生 `setInterval`（NSTimer 直用不可行）

- **实测证据（Sketch 2026.2）**：
  1. `NSTimer.scheduledTimerWithTimeInterval_target_selector_…` 以纯 JS 对象 / JS 函数为
     target 均抛 Obj-C exception（MOJavaScriptObject 不响应 selector 转发）。
  2. block 字面量、completionHandler、`Mocha.defineClass` 全部不可用（ADR-004），
     即 NSTimer 的三种回调形态全部封死。
  3. 运行时**原生提供 `setInterval` / `setTimeout` / `clearInterval`**——这是本环境
     官方支持的定时器入口。
- **决策**：M3-A 用 `setInterval(tick, 1000)` 实现 1s 轮询；Stop 用 `clearInterval(id)`。
- **已知风险（待真机菜单路径验证）**：跨命令上下文持久性。Start 与 Stop 若在不同
  脚本上下文求值，全局 `SLM.timerId` 是否共享需实测；若不共享，M3-B 需引入
  NSUserDefaults 桥接或改由单一常驻命令管理生命周期。
- **附带发现**：run-script 中创建不清除的 interval 会卡死 sketchtool（进程被 SIGKILL，
  后续所有 run-script 均 137 直至 Sketch 重启）。自动化测试时 interval 必须自清除。

## ADR-009 · Sketch 重启后 sketchtool 自动化通道失效（记录在案，未解决）

- **现象**：用户重启 Sketch 后，`sketchtool run-script` 不再附着到运行中的实例，
  而是自行拉起一个新 Sketch 实例执行脚本，随后等待其退出 60s 超时
  （"Timed out waiting for Sketch to quit"）。最小探针亦复现；指定
  `--application=` 无效。重启前同命令一直正常。
- **影响**：仅自动化测试通道不可用；不影响插件本体（菜单命令走 Sketch 自身运行时）。
- **决策**：M3-A 验收转人工真机路径（本就是完成标准要求），server 日志作为客观证据源。
  插件脚本已通过 `node --check`（经 .js 拷贝）与 manifest JSON 校验。
- **后续可选项**：授予终端「辅助功能」权限后可用 System Events UI 脚本点击真实菜单项；
  或排查 sketchtool 与新实例的 Apple Events 会话问题。

## ADR-010 · 定时器回调里的 `sketch.export` 返回陈旧渲染 → 导出前做无损刷新

> **v0.3.2 复盘**：v0.3.1 的三候选刷新未让用户观测到改善；进一步排查发现
> 更可能的根因是**目标解析盲区**（见 ADR-012）——用户编辑的是画板内部图层，
> 选区里没有 Artboard 本身，tick 直接跳过不推帧；点击外框使选区回到画板，
> 下一 tick 才推一帧新渲染，表象即「点完才更新」。
> **v0.3.2（ADR-012）上线后真机复验通过**，证实根因为目标解析盲区而非
> 渲染缓存；flush 机制保留作为双保险。

- **现象**（真机 M3-A 验收，主流程第 3 条）：Mirror 运行中修改 Artboard 内容，
  手机不更新；只有再次点击该 Artboard 后下一帧才反映修改。
- **server 日志取证**：定时器每 ~1s 正常触发、POST 连续不断，但同一画板的 PNG
  **字节数跨数十个 tick 完全恒定**（如 "阅读打卡：调整打卡进度条-获得奖励" 恒为
  365345B）——PNG 编码确定性 ⇒ 字节相同 ⇒ 渲染内容相同 ⇒ `sketch.export` 在
  纯定时器回调上下文里读到的是**渲染缓存**，UI 交互（选中事件）才会使其失效。
  定时器链路本身无问题。（注：恒定字节的时间段也可能对应「选区不在画板上、
  根本没推新帧」的空转期，与 ADR-012 假说兼容。）
- **决策**：`mirrorTick` 每次 `sketch.export` 前调用 `forceRenderFlush()`，
  候选刷新手段按风险从低到高：
  1. `doc.currentView().flushGraphics()`（画布视图刷帧）
  2. `view.setNeedsDisplay(true)`（NSView 标脏，selector 必然存在）
  3. `doc.reloadInspector()`（文档数据向 UI 同步）
  所有候选先 `respondsToSelector:` 探测再调用——避免未知 selector 抛 Obj-C
  异常导致 Sketch 崩溃；每个候选只在首个 tick 记录一次探测结果日志。
  刻意**不采用**：程序化切换选中态模拟「再次点击」（会打断用户正在进行的编辑）。
- **状态：待真机复验**。若字节仍恒定，下一档手段（记录在案未实施）：
  导出前临时 `artboard.hidden = true/false` 抖动强制失效缓存；
  或绕过 JS API 直接用 MSExportRequest 渲染 native 图层。

## ADR-011 · 删除 Artboard 的自动跳选不推帧（保持手机最后一帧）

- **现象**（真机验收第 6 条）：Mirror 运行中删除当前 Artboard，Sketch 会自动
  选中下一个 Artboard；旧逻辑把它当作正常切换立即推送，手机画面跳变。
- **决策**：删除检测启发式（只依赖 id 与页面图层清单，不引入事件监听）：
  - tick 中若选区 id ≠ 上次推送的 `currentArtboardId`，且后者已不在当前页面
    顶层图层中（`artboardExistsOnPage` 扫描 page.layers）⇒ 判定为「删除引发的
    自动跳选」，记入 `SLM.suppressedArtboardId` 并**跳过本帧**（保留最后一帧）；
  - 选区仍是被抑制的那个 id ⇒ 持续跳过；
  - 用户手动选中**另一个不同 id** 的画板 ⇒ 正常切换，恢复推送并清除抑制；
    v0.3.2 起「选中其他画板」包括选中其内部任意图层（见 ADR-012）；
  - 选区回到被跟踪的 id ⇒ 解除抑制；
  - Start / Stop Mirror 时重置 `suppressedArtboardId`。
- **边界说明**：「删除后用户手动点选了恰好同一个自动跳选目标」无法与自动跳选
  区分，会被多抑制一帧——用户再点任意其他画板即恢复，可接受。
- Send Current Frame（手动单帧）不受删除检测影响：手动命令永远直接发送。
- **真机复验：已通过（2026-08-26）。**

## ADR-012 · 目标解析升级：选中画板内部任意图层即可推送所属画板

- **背景 / 用户需求**：实际设计操作中用户编辑的是画板内部的图层/组，要求
  「选中的图层或其他元素，就自动推送相应的 Artboard」，不需要再点击一遍
  Artboard 外框去选中整体。
- **旧逻辑缺陷（很可能同时是主流程第 3 条的真正根因）**：
  `resolveTargetArtboard` 要求选区中直接包含 `type === 'Artboard'` 的对象；
  用户选中内层元素时 tick 解析失败直接跳过——期间所有编辑都不会被推送。
- **决策**：
  - 对每个选中图层沿 `.parent` 链向上查找（上限 64 层），命中第一个
    `type === 'Artboard'` 即归属该画板（与顶层判定同一 legacy 类型标记，
    Symbol Master 不会误认）；
  - 多个画板同时被命中（跨画板多选）时，优先保持上一次推送的画板 id（稳定性）；
  - 选区不在任何画板内（如页面空白处、页面级图层）⇒ 维持旧行为：保留最后一帧；
  - 删除检测、latest-frame-only、每 tick 全量重解析等既有规则不变。
- **验证方式**：Start Mirror 后仅选中内层图层并直接拖动/改文案，观察手机 ~1s
  内更新、server 日志同画板 PNG 字节数随编辑变化。
- **真机复验：已通过（2026-08-26，v0.3.2）。** 主流程第 3 条 + 交互需求一并达成；
  同时反证 ADR-010 渲染缓存假说非主因。

## ADR-013 · Mobile Viewer（M3-B）：状态模型、iOS 兼容与画板切换判定

- **范围**：仅改 `server/public/index.html`（单文件、零依赖）。插件/协议/1s 轮询
  全部冻结不动。
- **状态模型**：`{scale, tx, ty, mode}`，`mode ∈ {'fit','custom'}`；
  100% 不是独立模式（只是 `scale=1` 的 custom）。变换走 CSS
  `translate3d(tx,ty,0) scale(s)`（transform-origin: 0 0，GPU compositing），
  锚点换算 `imagePoint = (screenPoint − t)/s`；不做 canvas 重绘/像素处理。
- **缩放上下限**：`min = min(fitScale, 1)`——正常画板不允许缩到比 Fit 更小；
  极小画板（fitScale>1）仍可到达 100%。上限 5。
- **Pinch**：Pointer Events（iOS 13+ 支持）+ `touch-action:none` +
  `gesturestart/change/end preventDefault()` 三重屏蔽页面级缩放。
  以两指中点为缩放中心：先算中点下的图像点，再反解新 translate，
  中点移动同时带动平移（内容跟手）。
- **Pan 边界**：内容某轴 ≤ 视口时该轴锁定居中；大于视口时允许 ±48px
  edge overscroll，不可无限拖出。
- **新帧到达**：
  - 同画板（尺寸不变 且 名称未变）⇒ 完全保留 scale/tx/ty（100% 看细节时
    Sketch 改颜色不跳回 Fit）；
  - 画板切换 ⇒ 自动 Fit。**切换判定受协议冻结限制**：meta 无 artboard id，
    采用「尺寸变化 或 双方名称已知且不同」启发式。已知妥协：
    重连补帧（/current 只有二进制）无名称，此时同尺寸的不同画板会被视为
    同画板而保留视口（低频场景，可接受）；尺寸从 PNG IHDR 解析兜底
    （bytes 16–24，大端），兼容无 `Blob.arrayBuffer` 的旧 Safari（FileReader 回退）。
- **横竖屏**：resize/orientationchange/visualViewport.resize 三监听；
  fit 模式重算 fitScale 并居中，custom 模式保持 zoom 仅重新约束 translate；
  orientationchange 后延迟 250ms 再取尺寸（iOS 更新滞后）。
- **Blob URL 泄漏**：每帧创建新 objectURL 前必 revoke 上一个（沿用 M1 模式）。
- **双击**：tap 判定（<10px 位移 + <250ms + 间隔 <350ms）→ Fit ↔ 100%
  （放大锚定点击处）；pinch 过程自动取消 tap。
- **附带发现**：`server/index.js:39` 启动时缓存 INDEX_HTML，改页面后必须重启
  server 才生效（本次实测踩坑：curl 拿到旧页）。

## ADR-014 · iOS PWA standalone 视口「说谎」：布局视口比物理屏矮，缺条带在屏幕底部不可达

- **现象**（iPhone，iOS PWA/添加到主屏幕模式实测）：初次启动时
  `window.innerHeight = 812`、`screen.height = 874`，差值 62px 恰为
  `env(safe-area-inset-top)`（WebKit bug 313800 的双重 inset）；所有 vh 类单位
  （100vh/100dvh/100lvh/svh）、`-webkit-fill-available`、`visualViewport.height`
  同样解析到这个砍短的布局视口。**被砍掉的条带落在屏幕物理底部，网页内容
  无法渲染进去**——body 撑不满 → 底部出现大段黑底。
- **多轮实测排除的方案**：`height: 852px` / `screen.height` 直接设值、`100lvh`、
  `position:fixed; inset:0`、`position:absolute` 相对 body——渲染高度全部被
  布局视口锁死（超出部分不可见）。
- **有效机制（gueridon 实测复证）**：**body 内容溢出会触发 iOS 把布局视口重算
  为真实全屏高**（docking 行为）。本项目实证：Immersive 模式（可滚动 body）
  退回 Normal 后 `innerHeight` 从 812 变为 870 ≈ 全屏。
- **决策**：不与视口对抗，接受「视口有两种可能状态」并由 JS 每秒轮询
  `gap = screen.height - innerHeight` 动态适配（见 ADR-016 两态方案）。

## ADR-015 · iOS PWA 中 `display-mode: standalone` 媒体查询谎报 browser

- **现象**：页面以 `apple-mobile-web-app-capable` 添加到主屏幕独立运行，
  但 `@media (display-mode: standalone)` **不匹配**，`@media not (display-mode:
  standalone)` 反而命中（gueridon 实测一致）。
- **本项目实证**：PWA 中 body 实际 padding-bottom = 44px——正是
  `@media not (standalone)` 分支的 `env(34)+10px`，而非 standalone 分支的
  `env+2px`，导致 docInfo 下方 44px 双重留白。
- **决策**：PWA 专属布局分支一律用 JS 门控
  （`window.navigator.standalone === true` 或 matchMedia 任一命中，运行时判定），
  **不依赖 CSS display-mode 媒体查询**；媒体查询仅用于浏览器模式的常规适配。

## ADR-016 · PWA 底部布局两态方案：bootViewportRecalc + pwa-strip/pwa-tight

- **背景**：PWA 下 docInfo 距 Home Indicator 过远，且进出 Immersive 后黑底
  不一致（9 轮真机迭代，含一次 className 覆写 bug 的修复）。
- **两态定义**（`gap = round(screen.height - innerHeight)`，阈值 15px）：
  - `gap > 15`（视口被砍短，缺条带在底部不可达）→ `body.pwa-strip`：
    padding-bottom 收到 0，docInfo 贴住视口底（黑底 = 砍掉的 62px，无法再小）；
  - `gap ≤ 15`（视口已含 home indicator 区，env 正确）→ `body.pwa-tight`：
    padding-bottom = `env(safe-area-inset-bottom) + 2px`，docInfo 贴安全区上沿。
- **bootViewportRecalc**：启动时若 gap > 15，临时加 `body.pwa-boot`
  （`height: calc(100dvh + 2px); overflow-y: auto; opacity: 0`），复刻
  Immersive 溢出触发视口重算的机制把视口撑到全屏；重算期间 opacity 隐藏
  内容避免视口变化位移可见（此前 `calc(100dvh+1px)` 方案的用户可见
  「加高→收回」动画即此重算过程，故必须遮盖）。50ms 轮询，成功或 1s 超时
  移除 pwa-boot，由 syncStandaloneBottom 落到正确状态；失败自动回退 pwa-strip。
- **配套**：`setInterval(syncStandaloneBottom, 1000)` 低频轮询兜底 iOS 静默
  视口变化；enter/exitImmersive 一律 classList 增删（禁止 `body.className =`
  覆写，会抹掉 pwa-strip/pwa-tight 状态类）。
- **真机验收：已通过（2026-08-27）**——初次进入即 ih:870/pwa-tight，
  Immersive 进出黑底一致，docInfo 紧贴 Home Indicator 安全区。

## ADR-017 · M4-A 帧变化检测：PNG SHA-256 相同且 artboard 身份一致则跳过 POST

- **背景**：M3-A 基线每 1s tick 全量 `sketch.export()` + POST——画板静止时
  100 ticks 产生 100 次 export（小画板 ~20ms、大画板 300ms+）+ 100 次 POST，
  全部是无变化冗余。目标：内容没变就不 POST，手机端行为完全一致。
- **哈希环境研究结论**（Sketch 2025.3.4 JavaScriptCore，手写 bundle 无构建链）：
  - 无 Node `crypto`；skpm `Buffer` 原型无 hash 方法；
  - CommonCrypto `CC_SHA256` 等纯 C 函数无法从 CocoaScript 桥接调用；
  - `NSData.hash` 不可靠——现代实现只采样首尾字节，同长度中间改动会漏检；
  - **可用**：CloudKit 框架的 `CKSHA256` Obj-C 类（`ObjC.import('CloudKit')` 后
    `CKSHA256.digestWithData(nsdata)` 原生速度返回 NSData 摘要）；
  - 兜底：纯 JS SHA-256（Uint8Array 输入，int32 轮函数 + DataView 写 64 位大端
    长度字段；与 node crypto 17 种边界长度对拍全通过，含 55/56/57/63/64 分块
    边界与空向量）。
- **性能实测**（node/V8 量级，JSC 同数量级参考；`plugin/tools/test-sha256.js`）：

  | PNG 大小 | JS SHA-256 耗时 | 吞吐 |
  |---|---|---|
  | 50 KB | 3.6 ms | 13.6 MB/s |
  | 200 KB | 14.4 ms | 13.6 MB/s |
  | 500 KB | 36.2 ms | 13.5 MB/s |
  | 1 MB | 73.0 ms | 13.7 MB/s |

  hash 远小于 export（小画板 20ms、大画板 300ms+），不满足「比 export 慢」
  的风险条件；主路径 CKSHA256 更快。export 仍每 tick 执行（渲染缓存刷新 +
  内容检测依赖最新导出），优化的是 POST 次数与 sending 占用。
- **决策**（`script.cocoascript`，策略链 `pngDigest()`）：
  1. 每 tick 正常 export → 计算整帧 PNG SHA-256（`pngDigest`：CKSHA256 主路径，
     失败自动降级纯 JS 并记日志，此后不再重试 CK）；
  2. 跳过条件三要素：`hash === lastSentHash` **且** `artboardKey ===
     lastSentArtboardKey` **且** 上次确实成功发送过。artboardKey =
     `id|name|W×H`（协议无 artboard id，用最小安全身份，防两个不同画板恰好
     导出相同 PNG 被误跳过）；
  3. **只有 POST 200 之后**才更新 `lastSentHash/lastSentArtboardKey`——失败帧
     下个 tick 必然重发，server 恢复后不会「永远认为已发送」；
  4. Start Mirror 前清空基线（重新 Start 必发首帧）；Stop Mirror 清理基线并
     输出本次会话 `sent/skipped/avgExport/avgHash/avgPost` 统计（每 30 ticks
     亦输出一次）；
  5. 手动 Send Current Frame 不走跳过逻辑（永远发送并刷新基线）；
  6. 不改协议/WebSocket/Viewer/scale——server 完全未动。
- **预期效果**（静止画板，100 ticks）：Before 100 exports + 100 POST →
  After 100 exports（含 hash）+ 1 POST + 99 skipped；修改文字/颜色/移动图层
  → 下个 tick hash 变化即推送，行为与 M3-C 完全一致。

## ADR-018 · M4-B 事件驱动镜像：事件加速 + 1s 轮询兜底

- **背景**：M4-A 后静止帧不再 POST，但内容变化的响应延迟仍受 1s 轮询限制。
  目标：普通编辑 < 200–500ms，且绝不牺牲 M3-A 已验证的可靠性。
- **架构（event-driven acceleration + polling fallback）**：

  ```
  Action（SelectionChanged / ArtboardChanged / TextChanged / LayersMoved / LayersResized）
     ↓ 统一入口（不直接 export）
  scheduleFrameCheck()  ←── 80ms debounce 合并窗口（事件风暴 → 一次检查）
     ↓
  runFrameCheck('event') ── 与 1s mirrorTick → runFrameCheck('poll') 完全同一条链路
     ↓
  resolveTarget（parent chain，ADR-012）→ 删除抑制（ADR-011）→ export →
  hash（ADR-017）→ 只有 hash 变化才 POST
  ```

- **注册的 Actions**（manifest `handlers.actions`）：`SelectionChanged` /
  `ArtboardChanged` / `TextChanged` / `LayersMoved` / `LayersResized`。
  依据 ARCHITECTURE.md §3.1 的官方 Actions Reference（2026.2）调研（`ContentsChanged`
  确认不存在，不注册）；因 sketchtool 通道失效（ADR-009），各 action 的真实触发
  由插件内探针日志验证——每种 action 前 3 次逐条 log、之后每 50 次 log 一次，
  Stop 时统计行输出 `events=<总数> eventChecks=<事件检查次数>`。
- **事件合并（不风暴）**：
  1. 80ms debounce 窗口（`setTimeout` 运行时原生提供，ADR-008 实测）：窗口内的
     多个 Action 合并为一次检查——拖动图层产生的事件流每 80ms 至多触发一次 export；
  2. 检查进行中（`sending=true`）到达的事件不排队，只置 `pendingAfterSend`，
     当前发送完成后经同一 debounce 窗口补一次检查（仍然 latest-frame-only）；
  3. 事件**不是发送条件**：是否 POST 仍由 M4-A hash 决定（如选中变化但画板
     内容没变 → export+hash 后 skip，不产生网络流量）。
- **1s 轮询保留为兜底**：`mirrorTick` 语义不变，仅内部转调
  `runFrameCheck('poll')`。事件机制整体失效（未知 action 缺失/不触发）时，
  行为完全退化为 M4-A，最迟 ~1s 更新。
- **保持不变的关键语义**（事件路径与轮询路径共用同一条 runFrameCheck）：
  - parent chain 目标归属（ADR-012）：选 Text/Rect/Image/Group 均向上找 Artboard；
  - 删除抑制（ADR-011）：事件触发同样走 `artboardExistsOnPage` 检测，删除画板
    后的自动跳选不推送（回归测试 G）；
  - 跨 Page 检测（M3-C）、latest-frame-only、hash 门控与「仅 POST 200 更新基线」（ADR-017）；
  - Start 重置事件状态、Stop 清理 debounce 定时器（`clearTimeout`）。
- **未采用**：EventBus / 复杂队列 / 高频同步 POST——`running/sending/lastSentHash/
  currentArtboardId` 状态模型不变（§九）。
- **延迟观测**：事件路径 POST 成功时 log 追加 `[event→post XXXms]`
  （debounce 延迟 + export/hash/POST 总耗时），供真机验收对照 < 200–500ms 目标。

## ADR-019 · M4-C 自动 Server 生命周期：runtime.json + PID 精确停止

- **背景**：M3 前 server 由用户/AI 手动 `node server/index.js` 启动，不符合
  产品化目标。要求：`Start LAN` 自动启动（已运行则复用）、`Stop LAN` 精确
  停止（绝不误杀用户其他 Node 进程：Vite/Next/AI 工具等）。
- **生命周期状态**（Server 与 Mirror 解耦，`Server Running ≠ Mirror Running`）：

  ```
  Start LAN:  probeRunningServer(/health) ─ok→ 复用
              └─fail→ findNode() → NSTask spawn → 轮询 /health（≤5s）→ ready
  Stop LAN:   停 Mirror → stopManagedServer()（仅停自己启动的 server）
  ```

- **实现要点**：
  1. **复用探测优先于启动**：`GET localhost:<port>/health` 检查
     `service === 'sketch-lan-mirror'`（从默认端口 9777 起最多探测 20 个
     端口，匹配 server 的端口递增逻辑）；命中即复用，不重复 spawn。
  2. **runtime.json**：server 启动成功后写
     `~/.sketch-lan-mirror/runtime.json`（`{pid, port, startedAt}`）；
     SIGTERM/SIGINT 时清理该文件并优雅退出（终止 WS 连接、关闭
     httpServer）。插件重启 Sketch 后可据此快速恢复。
  3. **PID 精确停止（三重身份验证，禁止 killall/pkill node）**：
     - 无 runtime.json → 不干预（可能是用户手动启动的 server）；
     - 验证 1：runtime.json 的 port 上 `/health` 返回本服务；
     - 验证 2：`ps -p <pid> -o command=` 命令行含 `index.js`；
     - 全部通过才 `kill -TERM <pid>` 并等待退出（≤3s）；
     - 任一验证失败 → 视为 stale runtime 记录，仅清理文件不杀进程。
  4. **Node 发现链**：`NSTask` 环境 PATH（继承登录 shell）→ `/usr/local/bin`
     → `/opt/homebrew/bin` → nvm/volta/fnm 常见路径逐一探测
     （`file -b` 或 spawn `--version` 验证）；全部失败 → 弹窗明确提示
     "LAN requires Node.js"，不静默失败。
  5. **启动确认**：spawn 后不假设成功，轮询 `/health` 最多 ~5s；超时 →
     读取 `~/.sketch-lan-mirror/server.log` 尾部作为错误信息展示。
  6. **不影响 Sketch 启动**：插件加载时不做任何事（无 Action handler
     触发 server），只有用户主动执行 Start LAN 才 spawn。
- **分发（方案 B 内嵌）**：Release 包内 `LAN.sketchplugin/Contents/Resources/server/`
  自带 `node_modules`（ws + qrcode-generator，均无必需依赖，omit optional 后
  极小）。插件运行时优先找 Resources/server；开发环境（软链安装）回退到
  仓库 `server/`——同一份代码两种安装形态。用户无需 clone / npm install。
  选择 B 而非 A（仓库 + 用户 npm install）的理由：目标用户是设计师，
  「双击安装即用」是 M4-C 核心验收路径；体积代价 <1MB 可接受。

## ADR-020 · M4-C LAN URL 发现 + QR 扫码入口

- **背景**：手机端入口原来是手动输入 `http://<IP>:9777`——IP 因电脑/网络
  而变，端口可能因占用递增，输入成本高且易错。
- **LAN URL 发现**（动态，不硬编码任何 IP/网卡名）：
  - 沿用 M1 已验证的 `os.networkInterfaces()` 全量枚举；
  - 只保留 IPv4 私有网段（10./172.16-31./192.168.），过滤 loopback 与公网；
  - **网段排序**：192.168（家庭/办公 Wi-Fi）> 172.16-31 > 10.x（后者更常
    是 VPN/Tailscale）——排序第一作为 primary，其余作为备选如实展示；
  - `GET /info` 返回 `{port, urls[], primary}`，插件据此弹窗展示访问入口。
- **QR Code**：
  - 依赖选择：`qrcode-generator`（~10KB 纯 JS、零依赖、可在 Node 直接生成
    SVG 与终端 ASCII）——唯一新增 server 依赖，理由：手写 QR 编码器不可
    维护，而主流 `qrcode` 包（~100KB+ 依赖 canvas）面向浏览器场景过重。
  - **两个入口**：
    1. server 启动时终端直接渲染半块字符 QR（`▀▄█ `）+ primary URL——
       手动 `node index.js` 的用户立即能扫；
    2. `GET /qr` 独立页面：primary URL 大 QR + 全部候选地址列表（多网卡
       场景手机可点选对应网段）——插件菜单 `Open LAN Viewer` 打开此页，
       为后续「插件面板内嵌 QR」预留扩展点（页面即组件化 SVG）。
- **安全边界不变**：仍是 Local network only，无鉴权；README 明确声明
  同一局域网内的任何人都可能访问 Viewer。

## ADR-021 · M4-C 产品标识：LAN + 窗台 Logo

- **背景**：M4-C 从功能原型进入 Productized MVP，需要统一用户可见名称与
  视觉标识。完整设计过程见 docs/BRAND.md。
- **命名**：产品名 **LAN**（用户可见：菜单/manifest/README/PWA）；技术名
  Sketch LAN Mirror 保留于 repository / source / ADR / bundle identifier
  （`com.xuezx.sketch-lan-mirror`）。
- **Logo 选型**：5 个「窗台」探索方向中选定 **Concept B 负形窗台**（实心
  圆角方块 + 底部负空间水平缝 = 窗台线），融合 Concept A 的「sill 左右
  挑出」特征（下段矩形略宽于上半窗体）。
  - 选型理由：纯剪影最少元素，黑白反转天然成立；16×16 退化为「方块 +
    底缝」仍可辨识；负空间最有设计工具气质（区别于传统 SaaS 拼贴）。
- **实现**：`brand/generate-icons.js` 零依赖程序化绘制（4×4 超采样抗锯齿，
  圆角矩形覆盖度检测），一次生成全尺寸图标保证几何一致性；输出
  logo.svg / icon-16~512.png / maskable / favicon.svg。server 引用副本在
  `server/public/icons/`（白名单静态路由）。
- **PWA**：manifest name/short_name 均为 `LAN`；icons 指向窗台 mark；
  普通 Safari URL 与 Add to Home Screen 两条路径均不强制安装。

## 待验证 / 遗留

- dom Shape 的 `.points` 访问器在 2026.2 JS API 中返回 undefined，圆角设置暂缺
  （不影响链路，E 用例降级通过）；后续走 native 层补。
- 图片图层（ImageData 构造路径）未验证。
- Case A「无任何打开文档」因用户有文档打开无法安全自动模拟，需人工点验。
