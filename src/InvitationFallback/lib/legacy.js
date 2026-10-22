(function (root) {
  "use strict";
  const T = root.InvitationTrial;
  // Navigation follows the original author's 1080p recording. Only one selected opponent is tested here.
  class Legacy {
    constructor(ui, config, report) { this.ui = ui; this.h = ui.h; this.config = config; this.report = report; }
    async hold(key, milliseconds) {
      this.ui.checkCancelled();
      this.h.keyDown(key);
      try { await this.ui.pause(milliseconds); }
      finally { this.h.keyUp(key); }
    }
    async teleport() {
      await this.h.genshin.returnMainUi(); await this.ui.pause(1000);
      this.h.keyPress("m"); await this.ui.pause(1500);
      this.h.click(1841, 1015); await this.ui.pause(1000);
      this.h.click(1460, 140); await this.ui.pause(1200);
      await this.h.genshin.setBigMapZoomLevel(1.0); await this.ui.pause(400);
      this.h.click(1000, 645); await this.ui.pause(600);
      const mat = this.h.file.readImageMatSync("assets/tavern.png"), image = this.h.captureGameRegion();
      let point;
      try {
        const found = image.find(this.h.RecognitionObject.templateMatch(mat));
        if (found.isEmpty()) throw new T.TrialError("NAVIGATION", "未找到猫尾酒馆传送图标");
        point = T.rowData(found);
      } finally { image.dispose(); mat.dispose(); }
      await this.ui.tap(point, "猫尾酒馆传送图标");
      this.h.click(1707, 1010); await this.ui.pause(1000);
      await this.ui.wait(s => s.rows.some(r => r.x >= 1680 && r.y >= 200 && r.y < 650), "原导航：传送完成", 30000);
      await this.ui.pause(1200);
    }
    async buyLetter() {
      if (this.config.letterNumber > 0) return;
      if (!this.config.autoBuy) throw new T.TrialError("LETTER", "现有邀请函数量为 0，且未启用购函；请手动准备或修改设置");
      if (this.h.file.isExists("data/purchase-pending.json")) {
        const old = JSON.parse(this.h.file.readTextSync("data/purchase-pending.json"));
        if (old.pending) throw new T.TrialError("PURCHASE_PENDING", "上次购函结果未确认；请检查游戏库存，并把现有邀请函数量填为实际值后再试");
      }
      await this.ui.pause(700); await this.hold("w", 1400); await this.ui.pause(2000);
      this.h.keyPress("F"); await this.ui.pause(2000);
      for (let i = 0; i < 3; i++) { this.h.click(900, 1000); await this.ui.pause(500); }
      this.h.click(1355, 650); await this.ui.pause(1000);
      this.h.click(160, 245); await this.ui.pause(1000);
      this.h.click(610, 360); await this.ui.pause(1000);
      this.h.click(747, 628); await this.ui.pause(1000);
      const before = this.ui.read();
      if (!before.has("邀请函") || !before.has("购买")) throw new T.TrialError("PURCHASE_UNVERIFIED", "未确认邀请函购买窗口，停止购买");
      if (before.matches(["1"], this.ui.region("purchaseQuantity"), false).length !== 1)
        throw new T.TrialError("PURCHASE_QUANTITY", "未确认邀请函购买数量为 1，停止购买；请手动购买或按截图调整数量区域");
      if (!this.h.file.writeTextSync("data/purchase-pending.json", JSON.stringify({ pending: true, at: new Date().toISOString() }), false))
        throw new T.TrialError("PURCHASE_JOURNAL", "无法保存待确认购函记录，停止购买");
      this.report.event("purchase-submitted", { quantity: 1 });
      // One purchase submission only. An unknown result never leads to an automatic second click.
      this.h.click(1185, 755); await this.ui.pause(1000);
      await this.ui.wait(s => s.has("邀请函") && (s.has("获得") || s.has("购买成功")), "确认购得一张邀请函", 6000);
      if (!this.h.file.writeTextSync("data/purchase-pending.json", JSON.stringify({ pending: false, at: new Date().toISOString() }), false))
        throw new T.TrialError("PURCHASE_JOURNAL", "已确认购函但无法更新记录，请手动检查数量后再试");
      this.h.click(960, 1000); await this.ui.pause(800);
      this.h.keyPress("ESCAPE"); await this.ui.pause(3000);
      this.h.click(1355, 800); await this.ui.pause(3000);
      this.report.event("purchase-confirmed", { quantity: 1 });
    }
    async board(context) {
      await this.ui.pause(1000); await this.hold("a", 2000); await this.ui.pause(600);
      await this.hold("w", 600); await this.ui.pause(500);
      this.h.keyPress("F"); await this.ui.pause(1500);
      await this.hold("s", 300); await this.ui.pause(1000);
      this.h.keyPress("F"); await this.ui.pause(1500);
      // Select the requested visible character, never an unverified "first slot".
      let screen = this.ui.read();
      const choices = screen.matches([context.name], null, false);
      if (choices.length === 1) await this.ui.tap(choices[0], "原导航：选择指定邀约角色");
      screen = this.ui.read(); this.ui.verifyOpponent(context, screen, true);
      if (!await this.ui.chooseDifficulty(context, screen)) throw new T.TrialError("DIFFICULTY_UNVERIFIED", "原导航未找到所选难度，不邀请或开始挑战");
      screen = this.ui.read();
      const invite = this.ui.unique(screen, ["邀请角色", "邀请"], "start", false);
      if (invite) {
        await this.ui.tap(invite, "首次邀请指定角色（不在重试循环内）");
        screen = this.ui.read();
        const confirm = this.ui.unique(screen, ["确认"], "confirm", false);
        if (confirm && (screen.has("邀请") || screen.has("邀请函"))) await this.ui.tap(confirm, "确认首次邀请指定角色");
        await this.ui.advanceToReady(context, true);
      } else { await this.ui.ensureReady(context); }
    }
    async start(context) { await this.teleport(); await this.buyLetter(); await this.board(context); }
  }
  T.Legacy = Legacy;
})(globalThis);
