(function (root) {
  "use strict";
  const T = root.InvitationTrial;
  class OriginalFlow {
    constructor(ui, config, engines, report, logger) {
      this.ui = ui; this.h = ui.h; this.config = config; this.engines = engines;
      this.report = report; this.log = logger; this.recipe = null; this.challenges = [];
    }
    async canPurchase() {
      this.ui.checkCancelled();
      if (this.h.file.isExists("data/purchase-pending.json") &&
          JSON.parse(this.h.file.readTextSync("data/purchase-pending.json")).pending)
        throw new T.TrialError("PURCHASE_PENDING", "上次购函结果未确认；请先检查库存，更新持有邀请函数量，确认记录后再试");
    }
    async beforePurchase() {
      const before = this.ui.read();
      if (!before.has("邀请函") || !before.has("购买"))
        throw new T.TrialError("PURCHASE_UNVERIFIED", "未确认邀请函购买窗口，停止购买");
      if (before.matches(["1"], this.ui.region("purchaseQuantity"), false).length !== 1)
        throw new T.TrialError("PURCHASE_QUANTITY", "未确认邀请函购买数量为 1，停止购买；请先手动购买");
      if (!this.h.file.writeTextSync("data/purchase-pending.json", JSON.stringify({ pending: true, at: new Date().toISOString() }), false))
        throw new T.TrialError("PURCHASE_JOURNAL", "无法保存待确认购函记录，停止购买");
      this.report.event("purchase-submitted", { quantity: 1 });
    }
    async afterPurchase() {
      await this.ui.wait(s => s.has("邀请函") && (s.has("获得") || s.has("购买成功")), "确认购得一张邀请函", 6000);
      if (!this.h.file.writeTextSync("data/purchase-pending.json", JSON.stringify({ pending: false, at: new Date().toISOString() }), false))
        throw new T.TrialError("PURCHASE_JOURNAL", "已确认购函但无法更新记录，请检查库存后再试");
      this.report.event("purchase-confirmed", { quantity: 1 });
    }
    async play() {
      const reported = await this.engines.run(this.recipe), visible = await this.ui.waitResult(8000);
      if (reported !== visible) throw new T.TrialError("RESULT_MISMATCH", "牌手回报与结算画面不一致，停止运行");
      return visible;
    }
    async challenge(selectCharacter, startChallenge, playCards, location) {
      const context = Object.assign({ selectionSeen: false }, location);
      let selected = false, result;
      this.report.event("challenge-start", location);
      try {
        result = await T.runAttempts(this.config.queue, this.config.queue.length, {
          prepare: async recipe => {
            this.recipe = recipe;
            if (!selected) {
              await selectCharacter();
              this.ui.verifyOriginalSelection(context);
              selected = true;
            }
            this.log.info("[原版邀约] 第 " + location.round + " 轮／第 " + location.leg + " 段：" + recipe.title + "，牌组「" + recipe.deck + "」");
            await this.ui.selectDeck(recipe, context);
          },
          play: async () => {
            this.ui.checkCancelled();
            await startChallenge();
            selected = false;
            // Original Playcards owns pre-game dialogue, result exit and post-game dialogue.
            return playCards();
          },
          reopen: async () => {
            this.log.info("[换策略] 已确认败北，沿原版选角步骤重开本段；不重跑传送、购函或走位。");
          },
          record: async entry => this.report.event("attempt", Object.assign({}, location, entry))
        });
      } catch (error) {
        if (error.code !== "EXHAUSTED" || !error.details || !error.details.played) throw error;
        // The original script continues to its next leg/round after a completed game.
        // Preserve that behavior after all requested strategies lose; record failure, never claim victory.
        result = { outcome: "lose", played: error.details.played, history: error.details.history };
        this.log.warn("[本段未获胜] 所有可用策略已尝试，按原版流程继续下一段／轮；失败已记录。");
      }
      this.challenges.push(Object.assign({}, location, result));
      this.report.event("challenge-finish", Object.assign({}, location, result));
      return result;
    }
    async run() {
      const factory = eval(this.h.file.readTextSync("lib/original-navigation.js"));
      const navigation = factory(Object.assign({}, this.h, {
        log: this.log,
        sleep: milliseconds => this.ui.pause(milliseconds),
        file: T.scopedFile(this.h.file, "upstream-invitation"),
        settings: { challengeNumber: this.config.challengeNumber, letterNumber: this.config.letterNumber },
        hooks: {
          canPurchase: () => this.canPurchase(), beforePurchase: () => this.beforePurchase(), afterPurchase: () => this.afterPurchase(),
          play: () => this.play(),
          challenge: (...args) => this.challenge(...args),
          roundFinished: async round => this.report.event("round-finish", { round })
        }
      }));
      try { await navigation.run(); }
      finally { navigation.dispose(); }
      const wins = this.challenges.filter(x => x.outcome === "win").length;
      return { outcome: wins === this.challenges.length ? "win" : "completed_with_losses",
        rounds: this.config.challengeNumber, wins, losses: this.challenges.length - wins,
        played: this.challenges.reduce((n, x) => n + x.played, 0), challenges: this.challenges };
    }
  }
  T.OriginalFlow = OriginalFlow;
})(globalThis);
