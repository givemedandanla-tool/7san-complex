(function (root) {
  "use strict";
  const T = root.InvitationTrial;
  class OriginalFlow {
    constructor(ui, config, engines, report, logger) {
      this.ui = ui; this.h = ui.h; this.config = config; this.engines = engines;
      this.report = report; this.log = logger; this.recipe = null; this.challenges = [];
      this.active = null; this.attempt = null;
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
    record(entry) {
      this.active.history.push(entry);
      this.report.event("attempt", Object.assign({}, this.active.location, entry));
    }
    async prepareDeckIfReady(screen) {
      if (!this.attempt || !this.attempt.preGame) return false;
      screen = screen || this.ui.read();
      const dialogue = Boolean(this.ui.isInvitationDialogue?.(screen));
      if (!this.ui.isReady(screen) && !dialogue) return false;
      if (this.attempt.prepared) return true;
      while (this.active.cursor < this.config.queue.length) {
        this.recipe = this.config.queue[this.active.cursor];
        try {
          if (dialogue) await this.ui.selectInvitationDeck(this.recipe, this.active.context);
          else await this.ui.selectDeck(this.recipe, this.active.context);
          this.attempt.prepared = true;
          this.attempt.entry = dialogue ? "invitation-dialogue" : "ready";
          this.log.info("[出战牌组] 「" + this.recipe.deck + "」，策略「" + this.recipe.title + "」");
          return true;
        } catch (error) {
          if (error.code !== "DECK_NOT_FOUND") throw error;
          this.record({ strategy: this.recipe.id, deck: this.recipe.deck, outcome: "skipped", reason: error.message });
          this.active.cursor++;
        }
      }
      throw new T.TrialError("EXHAUSTED", "没有找到本段可用牌组，停止开局", { played: this.active.played, history: this.active.history });
    }
    async beforeInviteStart() {
      const screen = this.ui.read("before-invite-start");
      // This is still the original invitation page in many game states, including a locked serious tab.
      // Observe it without requiring it to be the later deck preparation page.
      this.ui.verifyOriginalSelection(this.active.context, screen);
      if (this.ui.isInvitationDialogue?.(screen)) { await this.beginInvitationDialogue(screen); return true; }
      await this.prepareDeckIfReady(screen);
      return false;
    }
    async beforeInviteConfirm() {
      let screen = this.ui.read("before-invite-confirm");
      // The reported "confirmation" frame is an arrival transition, not a confirmed modal.
      // Do not send its old fixed click into the dialogue that appears during that transition.
      if (screen.has?.("受邀前来进行牌局")) {
        screen = await this.ui.wait(s => !s.has("受邀前来进行牌局") &&
          (this.ui.isInvitationDialogue(s) || this.ui.isReady(s) || this.ui.isOpening(s) ||
           s.matches(["确认"], this.ui.region("confirm"), false).length) ? s : false,
          "等待受邀角色进场后确认实际页面", 15000);
        this.ui.read("after-invite-arrival");
      }
      if (this.attempt.started && this.attempt.entry === "invitation-dialogue") return true;
      if (this.ui.isOpening?.(screen)) { this.requirePreparedDeck(); return true; }
      if (this.ui.isInvitationDialogue?.(screen)) { await this.beginInvitationDialogue(screen); return true; }
      await this.prepareDeckIfReady(screen);
      return false;
    }
    async beginInvitationDialogue(screen) {
      await this.prepareDeckIfReady(screen);
      this.requirePreparedDeck();
      if (!this.attempt.started) {
        await this.ui.startInvitationMatch(this.recipe, this.active.context);
        this.attempt.started = true;
      }
    }
    requirePreparedDeck() {
      if (!this.attempt || !this.attempt.prepared)
        throw new T.TrialError("DECK_SELECTION_TOO_LATE", "已识别到牌桌开局标记，但未确认选好牌组；已停止。请提供 data/before-invite-start.json、before-invite-confirm.json 与 last-error.json");
    }
    async dialogueStep(screen, stage) {
      // This hook must stay inactive during the original post-game dialogue.
      if (!this.attempt || !this.attempt.preGame) return false;
      screen = screen || this.ui.read(stage);
      if (!this.attempt.started && this.ui.isInvitationDialogue?.(screen)) {
        await this.beginInvitationDialogue(screen);
        screen = this.ui.read("after-invite-play");
      }
      if (this.ui.isReady(screen)) {
        await this.prepareDeckIfReady(screen);
        await this.ui.startMatch(this.recipe, this.active.context);
        return true;
      }
      if (this.ui.isOpening(screen)) { this.requirePreparedDeck(); return true; }
      return false;
    }
    async play() {
      // Original dialogue may finish just before the preparation page finishes loading.
      await this.ui.wait(async screen => {
        if (this.ui.result(screen)) throw new T.TrialError("STALE_RESULT", "尚未确认新对局，不能沿用上一局结果");
        return this.dialogueStep(screen);
      }, "选好牌组后进入初始手牌", 25000);
      this.requirePreparedDeck();
      this.attempt.preGame = false;
      const reported = await this.engines.run(this.recipe), visible = await this.ui.waitResult(8000);
      if (reported !== visible) throw new T.TrialError("RESULT_MISMATCH", "牌手回报与结算画面不一致，停止运行");
      return visible;
    }
    async challenge(chooseCharacter, playCards, location) {
      const context = Object.assign({ selectionSeen: false, originalRoute: true, verified: true, difficultySelected: true }, location);
      const state = this.active = { context, location, cursor: 0, played: 0, history: [] };
      let outcome = "lose";
      this.report.event("challenge-start", location);
      try {
        while (state.cursor < this.config.queue.length) {
          this.ui.checkCancelled();
          this.recipe = this.config.queue[state.cursor];
          this.attempt = { preGame: true, prepared: false, started: false };
          // Keep the original route; substitute only a positively observed invitation dialogue.
          await chooseCharacter();
          const result = await playCards();
          if (result !== "win" && result !== "lose") throw new T.TrialError("RESULT_UNKNOWN", "没有确认胜败，停止换策略");
          state.played++;
          this.record({ strategy: this.recipe.id, deck: this.recipe.deck, outcome: result, match: state.played });
          if (result === "win") { outcome = "win"; break; }
          state.cursor++;
          if (state.cursor < this.config.queue.length)
            this.log.info("[换策略] 已确认败北，原版退出与对话已结束；重新选本段，不传送或购函。");
        }
      } finally { this.attempt = null; this.active = null; }
      const result = { outcome, played: state.played, history: state.history };
      if (outcome === "lose") this.log.warn("[本段未获胜] 已记录失败，按原版继续下一段／轮。");
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
          beforeInviteStart: () => this.beforeInviteStart(), beforeInviteConfirm: () => this.beforeInviteConfirm(),
          dialogueStep: stage => this.dialogueStep(null, stage),
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
