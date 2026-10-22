# BetterGI 角色邀約全自動・四智能策略

沿用原版「角色邀約全自動」的傳送、購函、兩段對局與繼續挑戰流程，加入四套智慧牌手、遊戲牌組名稱及策略排序。確認敗北才換下一套；獲勝後退出並繼續原版下一段、下一輪。

## 下載與使用

**[下載 InvitationFallback-0.2.0.zip](downloads/InvitationFallback-0.2.0.zip?raw=true)**（約 4.7 MB）。在檔案頁也可按「Download raw file」。[ZIP SHA-256](downloads/SHA256SUMS)。

解壓後將 `InvitationFallback` 放到 BetterGI `User/JsScript/`，在調度器設定原版「挑戰人數、持有邀請函數量」，再填各牌組名稱與排序即可。**不用填對手姓名、難度或先進準備頁。**

例如排序 `雷柯刻,伊嘉早`：每段先打雷柯刻，輸了換伊嘉早；獲勝後繼續下一段，重新從雷柯刻開始。全部策略仍輸則記錄該段失敗，再按原版繼續。技術錯誤或結果不明會停止。

完整環境要求、牌表及運行步驟見[套件說明](src/InvitationFallback/README.md)。遊戲使用簡體中文及 1920×1080，BetterGI 0.66.0+。目前通過離線測試與原版操作軌跡比對，尚未在遊戲內實測。

0.2.0 取代上一版需手動指定對手的入口，恢復原版外層流程；0.1.0 僅保留作歷史下載。

## 開發與打包

需求：Node.js 22+、Python 3.10+，沒有 npm 外部依賴。

```sh
npm run build
npm test
npm run check
```

產物：`dist/InvitationFallback-0.2.0.zip`。`downloads/` 保存對應可安裝成品及校驗碼。

`vendor/` 保存固定版本的原邀約腳本、四套牌手及素材，依 `vendor/lock.json` 校驗。`tools/build.py` 由原版產生導航接入層和牌手工廠，保留原有主流程與牌手決策；建置及執行均無需下載遠端程式。

`tests/original-flow.test.cjs` 對照原版實際原始碼，驗證多輪、不同邀請函數量下的按鍵、點擊與等待序列，並測試四策略重試、兩段與下一輪續跑。另有牌手載入、UI 選牌及購函確認測試。離線模擬不等同遊戲實測。
