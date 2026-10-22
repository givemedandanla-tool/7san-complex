# BetterGI 七聖邀約換策略測試套件

試跑範圍：指定一位邀約對手與一種難度，保留原固定策略及四套既有辨識牌手，在確認敗北後自動換牌組重打。

使用方式見 [套件說明](src/InvitationFallback/README.md)。離線測試不等同遊戲會話驗證；目前沒有原神／BetterGI 真實畫面實測。

## 下載測試版

[下載 InvitationFallback-0.1.0.zip](downloads/InvitationFallback-0.1.0.zip?raw=true)（約 4.7 MB）。在檔案頁可按「Download raw file」下載。

解壓後將 `InvitationFallback` 資料夾放到 BetterGI 的 `User/JsScript/`。第一次試跑請依[套件說明](src/InvitationFallback/README.md#第一次測試換牌組與敗北重打)設定牌組、對手及策略順序。

此試跑版只處理同一位對手與一種難度，確認敗北後才換策略；21 項離線測試已通過，遊戲內流程尚待實測。[ZIP SHA-256](downloads/SHA256SUMS)。

## 開發與打包

需求：Node.js 22+、Python 3.10+。沒有 npm 外部依賴，不需要 npm install。

```sh
npm run build
npm test
npm run check
```

產物：`dist/InvitationFallback-0.1.0.zip`。解壓後的 `InvitationFallback` 放到 BetterGI `User/JsScript/` 即可。

`vendor/` 保存固定版本的原始牌手、圖集、辨識庫、牌表及邀約腳本；`vendor/lock.json` 保存來源與雜湊。打包會校驗原始檔案，不經網路抓取或執行遠端程式。

`src/InvitationFallback/` 是整合程式；`tools/build.py` 產生保留原模組內容的牌手工廠，僅改變啟動與主機綁定。所有來源、作者與授權留在成品中。

研究資料另存於本環境 `/workspace/shared/bettergi-knowledge/`；本專案的建置與測試不依賴該目錄。
