# LAN — Brand / Logo 设计记录

> 产品名：**LAN**（技术名 Sketch LAN Mirror 保留于仓库/代码/ADR/package identifier）。
> 一句话：Preview your Sketch Artboards on your phone, in real time, over your local network.

---

## 1. 设计语义

核心隐喻：**「窗台 / window sill」**。

从 Sketch 打开一扇窗，让手机看到里面的画面。

Logo 需要同时暗示（不必全部显式表达）：

| 语义 | 来自「窗台」的哪个部分 |
|---|---|
| Window / Frame / Canvas | 窗框 |
| Preview / Looking through | 透过窗看到内容 |
| Sill（承托、放置） | 窗下沿的台板 |
| Second screen / Opening | 窗的「打开」状态 |

**排除方向**（明确不做）：

- 窗户 + 房子 / 窗户 + Wi-Fi / 窗户 + 手机 / 窗户 + 网络节点（传统 SaaS 拼贴）
- 建筑插画、3D、渐变、阴影、照片

**必须**：极简、几何、克制、工具感、设计软件感；单色可用、黑白反转可用、16×16 可辨识。

---

## 2. 概念探索（3–5 个方向）

### Concept A · 单线窗台（Line Sill）

```
┌────────┐
│        │
│        │
└────────┘
▔▔▔▔▔▔▔▔▔▔▔▔   ← sill 左右挑出
```

圆角方框（窗）+ 底部一条更宽的水平粗线（台板挑出窗两侧）。
最直白的「窗 + 台」几何抽象。

- 优点：语义最清晰；线条工具感强。
- 风险：上框下线是「通用符号」（像「图片带标题」），辨识度中等。

### Concept B · 负形窗台（Cut Sill）✅ **选定**

```
████████████
████████████
████████████
████████████
────────────   ← 负形水平缝
████████████   ← sill（略窄于上半，仍为实心）
```

一个实心圆角方块，靠近底部被一条水平窄缝（负空间）切开，
形成「上：窗 / 下：台」的两段剪影；下半略短，负空间即窗台线。

- 优点：纯剪影，最少元素；黑白反转天然成立；16×16 时只是一条缝，
  辨识度反而最高；负空间最有「设计软件」气质（如 Figma/Sketch 系工具标记）。
- 风险：语义比 A 含蓄——由「缝 = 窗台」的联想承担。

### Concept C · L / A / N 字母几何

L 的底横延长成 sill，A 简化为无横梁三角（窗的山墙），N 的斜线连接两个面。
字母识别 + 台面语义双关。

- 风险：16px 时字母细节糊掉；更像 wordmark 而非 mark；组合构图复杂，违反「克制」。

### Concept D · Frame + Sill（画框与台）

```
┌──────────┐
│          │   ← 横长 viewport（描边）
│          │
└──────────┘
▔▔▔▔▔▔▔▔▔▔▔▔▔▔   ← 更宽的 sill 实心条
```

「画面放在窗台上」：横长矩形（preview frame）+ 下方更宽实心横条。

- 优点：最贴近「Artboard 预览放在台面上」的产品语义。
- 风险：两个元素 + 缝隙，16px 下缝隙易糊成两根横线。

### Concept E · 打开的窗（Open State）

两个错位矩形暗示「窗正在被推开」，外层即台。

- 风险：错位/透视在 16px 完全丢失；偏离极简几何，接近插画。放弃。

---

## 3. 选型决策

**Concept B（负形窗台）为主 mark，融合 Concept A 的「sill 挑出」特征**：

- 主体：实心圆角方块（窗体，负空间承担内容）
- 底部：水平缝（窗台线）
- sill 段左右**略挑出**上半方块边缘（台板最独特的特征，保持几何克制）

这样 16×16 退化为「方块 + 底缝」仍可辨识（Concept B 的鲁棒性），
32×32 以上可见 sill 挑出（Concept A 的语义）。

### 最终几何（viewBox 0 0 32 32）

| 元素 | 形状 | 几何 |
|---|---|---|
| 窗体（上段） | 实心圆角矩形 | x=6, y=5, w=20, h=17, r=3 |
| 窗台线 | 负空间水平缝 | 高 3，全宽 |
| sill（下段） | 实心圆角矩形，左右挑出 | x=2, y=25, w=28, h=3.5, r=1.75 |

单色（currentColor），无渐变无阴影。

### 反色 / 应用

- 深底（PWA icon / GitHub）：`#111214` 底 + 白 mark
- 浅底（文档 / 黑白打印）：白底 + 黑 mark
- favicon.svg：mark 直接输出（浏览器底色自适应）

---

## 4. 技术要求核对（brief §八）

- [x] 单色可用（纯剪影，currentColor）
- [x] 黑白反转可用（对称剪影）
- [x] 16×16 辨识（退化为「方块+底缝」）
- [x] 32×32 清晰
- [x] PWA icon 可用（180/192/512 + maskable）
- [x] GitHub README 可用（logo.svg）
- [x] Sketch 插件图标可用（icon.png）
- [x] 无渐变/阴影/细线/照片/3D

---

## 5. 产出文件（brand/）

```
brand/
├── logo.svg            # 完整 logo（mark，currentColor）
├── logo-mark.svg       # 同构最小 mark（等价别名，供不同场景引用）
├── icon-16.png         # 16×16（favicon 级）
├── icon-32.png         # 32×32
├── icon-180.png        # apple-touch-icon
├── icon-192.png        # PWA
├── icon-512.png        # PWA / GitHub
├── icon-maskable-512.png # maskable（mark 居中，留 20% 安全区）
└── favicon.svg         # 浏览器标签页图标
```

server 端引用副本位于 `server/public/icons/`（静态白名单路由）。
