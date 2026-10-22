(function (root) {
  "use strict";
  const T = root.InvitationTrial;
  function rowData(r) {
    return { text: String(r.text == null ? r.Text || "" : r.text),
      x: Number(r.x == null ? r.X : r.x), y: Number(r.y == null ? r.Y : r.y),
      width: Number(r.width == null ? r.Width : r.width), height: Number(r.height == null ? r.Height : r.height) };
  }
  function inRect(row, rect) {
    if (!rect) return true;
    const x = row.x + row.width / 2, y = row.y + row.height / 2;
    return x >= rect[0] && y >= rect[1] && x < rect[0] + rect[2] && y < rect[1] + rect[3];
  }
  class Screen {
    constructor(rows) { this.rows = rows; this.text = rows.map(x => x.text).join(" "); this.compact = T.norm(this.text); }
    has(text) { return this.compact.includes(T.norm(text)); }
    rowsAt(rect) { return this.rows.filter(r => inRect(r, rect)); }
    matches(texts, rect, contains) {
      const names = texts.map(T.norm);
      return this.rowsAt(rect).filter(r => names.some(n => contains ? T.norm(r.text).includes(n) : T.norm(r.text) === n));
    }
  }
  class UI {
    constructor(host, configuration, profile, report) {
      this.h = host; this.config = configuration; this.profile = profile; this.report = report;
      this.lastScreen = null; this.held = new Set(); this.talkTemplate = null;
    }
    checkCancelled() {
      const token = this.h.cancellationToken;
      if (token && Boolean(token.isCancellationRequested == null ? token.IsCancellationRequested : token.isCancellationRequested))
        throw new T.TrialError("CANCELLED", "已停止当前任务");
    }
    async pause(ms) { this.checkCancelled(); await this.h.sleep(ms); this.checkCancelled(); }
    read() {
      this.checkCancelled();
      const image = this.h.captureGameRegion();
      try {
        const ro = this.h.RecognitionObject.ocr(0, 0, Number(image.width), Number(image.height));
        const rows = T.list(image.findMulti(ro)).map(rowData).filter(r => r.text && Number.isFinite(r.x) && Number.isFinite(r.y));
        this.lastScreen = new Screen(rows); return this.lastScreen;
      } finally { image.dispose(); }
    }
    region(key) { return this.profile.regions[key]; }
    async tap(row, reason) {
      this.checkCancelled();
      if (!row || ![row.x, row.y, row.width, row.height].every(Number.isFinite)) throw new T.TrialError("UI", "没有可点击的已识别元素");
      this.report.event("click", { reason, text: row.text, x: row.x, y: row.y });
      this.h.click(Math.round(row.x + row.width / 2), Math.round(row.y + row.height / 2));
      await this.pause(700);
    }
    unique(screen, texts, region, contains) {
      const rows = screen.matches(texts, this.region(region), contains);
      if (rows.length > 1) throw new T.TrialError("UI_AMBIGUOUS", "同一区域出现多个候选按钮：" + texts.join("/"));
      return rows[0] || null;
    }
    result(screen) { return T.classifyResult(screen.rowsAt(this.region("result")).map(r => r.text).join(" ")); }
    isReady(screen) { return this.profile.texts.prepare.some(x => screen.has(x)) && !screen.has("更改牌组外观"); }
    isInvitation(screen) {
      return !this.isReady(screen) && !this.isDeckChooser(screen) &&
        (screen.has("邀约对局") || screen.has("邀请对局")) &&
        (screen.has("友好对局") || screen.has("认真胜负"));
    }
    isDeckChooser(screen) { return !this.isReady(screen) && (screen.has("编辑牌组") || screen.has("选择牌组")) && !screen.has("更改牌组外观"); }
    isOpening(screen) {
      return !this.isReady(screen) && !this.isDeckChooser(screen) &&
        (screen.has("请选择要替换的手牌") || screen.has("初始手牌") ||
         screen.matches(["出战角色", "重投", "重投骰子", "确认重投"], null, false).length > 0);
    }
    verifyOpponent(context, screen, requireVisible) {
      // Original mode owns character/tab selection. Its panel is checked once after each selection.
      if (context.originalRoute && context.verified) return;
      const found = screen.matches([context.name], this.region("opponent"), true);
      if (found.length) {
        context.verified = true;
        this.report.event("opponent-verified", { name: context.name, difficulty: context.difficulty, rows: found.map(x => x.text) });
        return;
      }
      // A preparation page can omit the NPC name; accept it only after this same session observed that NPC.
      if (!requireVisible && context.verified) return;
      throw new T.TrialError("OPPONENT_UNVERIFIED", "未在画面中确认对手「" + context.name + "」。请从显示该角色名称的邀约详情页启动，或调整 ui-profile.json 的 opponent 区域");
    }
    verifyOriginalSelection(context, screen) {
      screen = screen || this.read();
      // Invitation/difficulty selection precedes deck preparation. Locked tabs are valid here.
      if (!this.isReady(screen) && !this.isInvitation(screen)) {
        if (context.selectionSeen) throw new T.TrialError("OPPONENT_UNVERIFIED", "败北重开后无法确认原邀约详情，停止重试");
        return false;
      }
      const signature = screen.rowsAt(this.region("invitationIdentity")).map(r => T.norm(r.text)).filter(Boolean).sort().join("|");
      if (context.selectionSeen && (!signature || signature !== context.signature))
        throw new T.TrialError("OPPONENT_UNVERIFIED", "败北重开后邀约详情与上一局不一致或无法辨识，停止换策略");
      context.signature = signature;
      context.selectionSeen = true;
      context.originalRoute = true;
      context.verified = true;
      context.difficultySelected = true;
      this.report.event("original-selection", { round: context.round, leg: context.leg, signature });
      return true;
    }
    async wait(check, label, timeout) {
      const end = Date.now() + (timeout || this.profile.timeoutMs);
      while (Date.now() < end) {
        const screen = this.read(), value = await check(screen);
        if (value) return value;
        await this.pause(this.profile.pollMs);
      }
      throw new T.TrialError("UI_TIMEOUT", "等待超时：" + label);
    }
    async waitResult(timeout) {
      return this.wait(s => this.result(s), "确认对局胜败", timeout || 8000);
    }
    async chooseDifficulty(context, screen) {
      const row = this.unique(screen, [context.difficulty], "difficulty", false);
      if (!row) return false;
      // Idempotent tab selection is allowed; never infer a selected tab from both labels merely being visible.
      await this.tap(row, "选择本次难度"); context.difficultySelected = true; return true;
    }
    async ensureReady(context) {
      let screen = this.read();
      if (this.result(screen)) throw new T.TrialError("STALE_RESULT", "当前已在结算页，请先退出并进入指定对手的邀约详情或对局准备页");
      this.verifyOpponent(context, screen, true);
      if (this.isReady(screen)) {
        // User chose the difficulty before entering this page; lock that selection for this session.
        context.difficultySelected = true;
        this.report.event("difficulty-user-selected", { difficulty: context.difficulty });
        return;
      }
      if (!await this.chooseDifficulty(context, screen)) throw new T.TrialError("DIFFICULTY_UNVERIFIED", "邀约详情页未找到所选难度，不开始挑战");
      screen = this.read();
      const begin = this.unique(screen, this.profile.texts.start, "start", false);
      if (begin) await this.tap(begin, "进入当前邀约的对局准备");
      await this.advanceToReady(context, false);
    }
    async talkVisible() {
      if (!this.talkTemplate) this.talkTemplate = this.h.file.readImageMatSync("assets/talkSymbol.png");
      const image = this.h.captureGameRegion();
      try {
        const found = image.find(this.h.RecognitionObject.templateMatch(this.talkTemplate));
        return !found.isEmpty();
      } finally { image.dispose(); }
    }
    async advanceToReady(context, afterResult) {
      const end = Date.now() + this.profile.timeoutMs;
      let interacted = false, confirmationSent = false, selectedTab = false;
      while (Date.now() < end) {
        const screen = this.read();
        if (this.isReady(screen)) {
          this.verifyOpponent(context, screen, false);
          if (!context.difficultySelected && screen.matches([context.difficulty], this.region("difficulty"), false).length === 1)
            context.difficultySelected = true;
          if (!context.difficultySelected) throw new T.TrialError("DIFFICULTY_UNVERIFIED", "重开后未确认原难度，停止换策略");
          return;
        }
        if (this.isOpening(screen)) throw new T.TrialError("PREPARE_BYPASSED", "已进入牌局但未经过换牌组确认；停止，请使用初始手牌模式测试当前牌组");
        if (this.result(screen)) throw new T.TrialError("UI", "尚未退出上一局结算页");
        if (!selectedTab && screen.matches([context.name], this.region("opponent"), true).length &&
            screen.matches([context.difficulty], this.region("difficulty"), false).length) {
          this.verifyOpponent(context, screen, true);
          selectedTab = await this.chooseDifficulty(context, screen);
          continue;
        }
        const start = this.unique(screen, this.profile.texts.start, "start", false);
        if (start && context.verified && context.difficultySelected) { await this.tap(start, "同一对手：打开准备页"); continue; }
        const option = this.unique(screen, [context.difficulty].concat(this.profile.texts.dialogue), "dialogueOptions", false);
        if (option) {
          if (T.norm(option.text) === T.norm(context.difficulty) || ["再来一局", "再来一场", "再次对局"].includes(option.text))
            context.difficultySelected = true;
          await this.tap(option, "同一对手：进入对局选项"); continue;
        }
        // An invitation-consuming confirmation must never be re-submitted by the retry loop.
        if (screen.has("邀请函") || screen.has("邀请角色"))
          throw new T.TrialError("INVITATION_REQUIRED", "当前操作需要邀请角色或消耗邀请函；本次重试不重复邀请。请先手动邀请，再从已选对手开始");
        const confirm = this.unique(screen, ["确认"], "confirm", false);
        if (confirm && !confirmationSent && context.verified && (screen.has("对局") || screen.has("挑战"))) {
          confirmationSent = true; await this.tap(confirm, "确认已选择的对局"); continue;
        }
        if (await this.talkVisible()) {
          this.h.keyPress("VK_SPACE"); await this.pause(600); continue;
        }
        // One F only, after returning from a known completed match and seeing that NPC's name.
        if (afterResult && !interacted && screen.has(context.name)) {
          interacted = true; this.h.keyPress("F"); await this.pause(1200); continue;
        }
        await this.pause(this.profile.pollMs);
      }
      throw new T.TrialError("REOPEN_TIMEOUT", "无法回到同一对手的对局准备页；已停止，未购买或邀请其他角色。请查看 data/last-error.png 与 last-error.json");
    }
    async drag(points) {
      this.checkCancelled();
      const [fromX, fromY, toX, toY] = points;
      this.h.moveMouseTo(fromX, fromY); this.h.leftButtonDown();
      try {
        for (let step = 1; step <= 12; step++) {
          await this.pause(40);
          this.h.moveMouseTo(Math.round(fromX + (toX - fromX) * step / 12), Math.round(fromY + (toY - fromY) * step / 12));
        }
      } finally { this.h.leftButtonUp(); }
      await this.pause(1000);
    }
    async selectDeck(recipe, context) {
      let screen = this.read();
      if (!this.isReady(screen)) throw new T.TrialError("UI", "切换牌组前未识别到对局准备页");
      this.verifyOpponent(context, screen, false);
      if (screen.matches([recipe.deck], this.region("deckBadge"), false).length) return;
      // This coordinate is inherited from the weekly script and used only after preparation-page recognition.
      this.h.click(...this.profile.points.openDeck); await this.pause(900);
      await this.wait(s => this.isDeckChooser(s), "打开牌组选择页", 6000);
      for (let i = 1; i < this.config.deckPages; i++) await this.drag(this.profile.points.deckDragFirst);
      let previous = null;
      for (let page = 0; page < this.config.deckPages; page++) {
        screen = this.read();
        if (!this.isDeckChooser(screen)) throw new T.TrialError("UI", "牌组查找时离开了牌组选择页");
        const found = screen.matches([recipe.deck], this.region("deckNames"), false);
        if (found.length > 1) throw new T.TrialError("DECK_AMBIGUOUS", "存在同名牌组，请给牌组使用不同名称：" + recipe.deck);
        if (found.length === 1) {
          await this.tap(found[0], "选择牌组「" + recipe.deck + "」");
          screen = this.read();
          if (!this.isReady(screen)) {
            const select = this.unique(screen, this.profile.texts.select, "select", false);
            if (!select) throw new T.TrialError("UI", "选中牌组后找不到选择按钮");
            await this.tap(select, "确认出战牌组");
          }
          await this.wait(s => this.isReady(s) && s.matches([recipe.deck], this.region("deckBadge"), false).length, "确认已切换至「" + recipe.deck + "」", 8000);
          return;
        }
        const signature = screen.rowsAt(this.region("deckNames")).map(r => r.text).join("|");
        if (signature === previous || page + 1 === this.config.deckPages) break;
        previous = signature; await this.drag(this.profile.points.deckDragNext);
      }
      this.h.keyPress("ESCAPE");
      await this.wait(s => this.isReady(s), "找不到牌组后返回准备页", 6000);
      throw new T.TrialError("DECK_NOT_FOUND", "找不到游戏牌组「" + recipe.deck + "」，跳过「" + recipe.title + "」");
    }
    async startMatch(recipe, context) {
      const screen = this.read();
      if (!this.isReady(screen)) throw new T.TrialError("UI", "开局前不在对局准备页");
      this.verifyOpponent(context, screen, false);
      if (!context.difficultySelected) throw new T.TrialError("DIFFICULTY_UNVERIFIED", "没有确认本次难度");
      if (!screen.matches([recipe.deck], this.region("deckBadge"), false).length)
        throw new T.TrialError("DECK_UNVERIFIED", "开局前未确认出战牌组名称，不开始对局");
      const start = this.unique(screen, this.profile.texts.start, "start", false);
      if (!start) throw new T.TrialError("UI", "找不到开始挑战按钮；请查看现场诊断");
      await this.tap(start, "开始「" + recipe.title + "」");
      let confirmed = false;
      await this.wait(async s => {
        if (this.isOpening(s)) return true;
        if (this.result(s)) throw new T.TrialError("STALE_RESULT", "开始后仍在结算页，未确认新对局");
        if (s.has("邀请函") || s.has("邀请角色")) throw new T.TrialError("INVITATION_REQUIRED", "开局出现邀请消耗确认，停止以避免重复邀请");
        const confirm = this.unique(s, ["确认"], "confirm", false);
        if (!confirmed && confirm && (s.has("对局") || s.has("挑战"))) {
          confirmed = true; await this.tap(confirm, "确认开始当前对局");
        }
        return false;
      }, "进入初始手牌、首次选人或首次重投", 25000);
    }
    async reopen(context) {
      let screen = this.read();
      if (this.result(screen) !== "lose") throw new T.TrialError("RESULT_UNKNOWN", "没有确认败北结算，禁止重开");
      const exit = this.unique(screen, this.profile.texts.exit, "exit", false);
      if (!exit) throw new T.TrialError("UI", "败北后未找到退出挑战按钮");
      context.difficultySelected = false;
      await this.tap(exit, "败北后退出，准备换牌组");
      await this.pause(1500);
      await this.advanceToReady(context, true);
    }
    async leaveResult() {
      const screen = this.read(), result = this.result(screen);
      if (!result) return;
      const exit = this.unique(screen, this.profile.texts.exit, "exit", false);
      if (exit) await this.tap(exit, "退出已结束对局");
    }
    diagnostics(error) {
      const details = { at: new Date().toISOString(), code: error.code || "ERROR", message: String(error.message || error),
        rows: this.lastScreen ? this.lastScreen.rows : [] };
      this.h.file.writeTextSync("data/last-error.json", JSON.stringify(details, null, 2), false);
      if (this.config.diagnosticImages && typeof this.h.file.writeImageSync === "function") {
        const image = this.h.captureGameRegion();
        try { this.h.file.writeImageSync("data/last-error.png", image.srcMat); }
        finally { image.dispose(); }
      }
    }
    dispose() {
      if (this.talkTemplate) { this.talkTemplate.dispose(); this.talkTemplate = null; }
    }
  }
  Object.assign(T, { Screen, UI, inRect, rowData });
})(globalThis);
