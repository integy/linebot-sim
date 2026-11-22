# 循線機械人模擬器 · Line Following Robot Simulator

🔗 **線上版：https://integy.github.io/linebot-sim/**

用積木程式控制一部有 **7 個紅外線感測器** 的循線機械人，在 3D 場景中完成 10 條由淺入深的賽道。

- 純前端、不用 build：`git push origin main` 即部署到 GitHub Pages
- three.js（3D）＋ Blockly（積木程式）
- 物理：差速驅動運動學 ＋ 7 個感測器的類比反射值（0 = 白，100 = 黑）

## 玩法

1. 左邊揀關卡（01 大橢圓 → 10 總決賽）
2. 右邊用積木砌程式，按「▶ 執行」
3. 機械人跑完指定圈數即完成，最佳時間存 localStorage

「示範程式」會載入一個 P 控制器：`馬達 = base ± 16 × 線位置`，可以直接跑第 1 關。
難的關卡要自己加微分（D）項或者按曲率減速。

## 積木

| 分類 | 積木 |
|---|---|
| 動作 | 馬達 左/右、左馬達、右馬達、停車、等待 |
| 感測 | 感測器 n 讀值、感測器 n 見到黑線、黑線位置、失去黑線?、已完成圈數、已用時間 |
| 控制 | if / repeat / while-until |
| 邏輯 | 比較、and/or/not、true/false |
| 數學 | 數值、四則、餘數、絕對值／平方根 |
| 變數 | 建立／設定／讀取 |

`黑線位置` 回傳 −3…+3：負 = 線在機械人左邊，正 = 在右邊，0 = 正中。
感測器編號 1 在最左、7 在最右。

## 難度

| # | 關卡 | 難度 | 特點 |
|---|---|---|---|
| 1 | 大橢圓 | EASY | 半徑 22 cm，熱身 |
| 2 | 圓角矩形 | EASY | 四隻直角彎 |
| 3 | 雙波浪 | NORMAL | 曲率連續變化 |
| 4 | S 彎走廊 | NORMAL | 大 S 彎 |
| 5 | 窄彎方框 | HARD | 半徑 18 cm |
| 6 | 雙髮夾 | HARD | 長直路 ＋ 兩個髮夾 |
| 7 | 連續減速彎 | HARD | 三段 chicane |
| 8 | 曲別針 | EXPERT | 半徑 11.5 cm 死彎 |
| 9 | 8 字交叉 | EXPERT | 賽道自交，2 圈 |
| 10 | 總決賽 | EXPERT | 全部元素，2 圈 |

## 專案結構

```
index.html          版面 + import map（three.js from unpkg）
css/app.css         全部樣式（深色）
js/track.js         賽道幾何：向心 Catmull-Rom → 等距重採樣、最近點、曲率
js/robot.js         7 感測器差速機械人（運動學 + 感測器模型）
js/blocks.js        Blockly 積木定義 + 非同步 JS 產生器
js/app.js           場景、賽道網格、機械人網格、模擬迴圈、UI
test/levels.mjs     Node 測試：P 控制器能否跑完 10 關
```

## 測試

```bash
node test/levels.mjs        # 10/10 pass = 每關都可以用簡單 P 控制完成
```

模擬器在瀏覽器暴露 `window.__sim`（`state()`、`run()`、`demo()`、`shot()`）方便無頭驗證。

## 本機執行

```bash
python3 -m http.server 8771
# http://127.0.0.1:8771/
```
（需要 HTTP 伺服器，`file://` 會因 ES module CORS 失敗）
