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
  // The same narrow OCR corrections used by the pinned weekly script's switchCardTeam.
  function deckText(value) {
    return T.norm(value).replace(/监/g, "盐").replace(/卵/g, "卯").replace(/刻睛/g, "刻晴");
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
      this.lastScreen = null; this.held = new Set(); this.talkTemplate = null; this.deckListExpected = false;
    }
    checkCancelled() {
      const token = this.h.cancellationToken;
      if (token && Boolean(token.isCancellationRequested == null ? token.IsCancellationRequested : token.isCancellationRequested))
        throw new T.TrialError("CANCELLED", "已停止当前任务");
    }
    async pause(ms) { this.checkCancelled(); await this.h.sleep(ms); this.checkCancelled(); }
    read(stage) {
      this.checkCancelled();
      const image = this.h.captureGameRegion();
      try {
        const ro = this.h.RecognitionObject.ocr(0, 0, Number(image.width), Number(image.height));
        const rows = T.list(image.findMulti(ro)).map(rowData).filter(r => r.text && Number.isFinite(r.x) && Number.isFinite(r.y));
        this.lastScreen = new Screen(rows);
        this.lastScreen.probes = {};
        if (!this.openingMarker(this.lastScreen) && !this.result(this.lastScreen)) {
          // Prefer small, source-verified OCR regions for card-group text. Whole-screen OCR can miss it.
          const probes = this.lastScreen.probes;
          probes.prepare = this.probe(image, this.region("deckBadge"));
          probes.deck = this.probe(image, this.region("deckNameProbe") || [1305, 793, 206, 46]);
          probes.invitationDeck = this.probe(image, this.region("invitationDeckName") || [1740, 20, 175, 65]);
          if (this.deckListExpected || this.lastScreen.has("编辑牌组") || this.lastScreen.has("选择牌组") ||
              this.lastScreen.matches(["选择"], this.region("select"), false).length) {
            probes.slots = (this.profile.deckNameSlots || [0, 1, 2, 3].map(i => [135 + 463 * i, 762, 230, 46]))
              .map(rect => this.probe(image, rect));
          }
        }
        if (stage) this.checkpoint(stage, this.lastScreen, image);
        return this.lastScreen;
      } finally { image.dispose(); }
    }
    probe(image, rect) {
      if (!rect || typeof image.find !== "function") return null;
      const found = image.find(this.h.RecognitionObject.ocr(...rect));
      if (!found) return null;
      const text = String(found.text == null ? found.Text || "" : found.text).trim();
      if (!text) return null;
      const row = rowData(found);
      return { text, x: Number.isFinite(row.x) ? row.x : rect[0], y: Number.isFinite(row.y) ? row.y : rect[1],
        width: Number.isFinite(row.width) ? row.width : rect[2], height: Number.isFinite(row.height) ? row.height : rect[3] };
    }
    checkpoint(stage, screen, image) {
      const safe = String(stage).replace(/[^a-z0-9_-]/gi, "");
      if (!safe) return;
      const details = { at: new Date().toISOString(), stage: safe,
        page: { ready: this.isReady(screen), invitation: this.isInvitation(screen),
          deckChooser: this.isDeckChooser(screen), invitationDialogue: this.isInvitationDialogue(screen),
          opening: this.isOpening(screen) }, rows: screen.rows,
        probes: screen.probes || {} };
      this.report.event("ui-stage", details);
      const file = this.h.file;
      // Checkpoints are diagnostic evidence; an optional image failure must not change the game route.
      try {
        if (typeof file.writeTextSync === "function") {
          if (!file.writeTextSync("data/" + safe + ".json", JSON.stringify(details, null, 2), false))
            this.report.event("checkpoint-error", { stage: safe, message: "无法写入阶段 JSON" });
        }
        if (this.config.diagnosticImages && typeof file.writeImageSync === "function")
          file.writeImageSync("data/" + safe + ".png", image.srcMat);
      } catch (error) {
        this.report.event("checkpoint-error", { stage: safe, message: String(error.message || error) });
      }
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
    knownDeck(value) {
      return (this.config.queue || []).some(recipe => deckText(recipe.deck) === deckText(value));
    }
    deckRows(screen, name, region) {
      const probes = screen.probes || {};
      if (region === "deckBadge" && probes.deck)
        return deckText(probes.deck.text) === deckText(name) ? [probes.deck] : [];
      if (region === "deckNames") {
        const found = this.chooserNames(screen).filter(r => deckText(r.text) === deckText(name));
        return found.length ? found : (probes.slots || []).filter(r => r && deckText(r.text) === deckText(name));
      }
      return screen.rowsAt(this.region(region)).filter(r => deckText(r.text) === deckText(name));
    }
    invitationOption(screen, kind) {
      const pattern = kind === "adjust" ? /^先(?:调整|調整)一下(?:卡组|卡組|牌组|牌組)/ :
        /(?:进行|進行).*七[圣聖]召[唤喚].*(?:对局|對局)/;
      const rows = screen.rowsAt(this.region("invitationDialogue") || this.region("dialogueOptions"))
        .filter(r => pattern.test(T.norm(r.text)));
      if (rows.length > 1) throw new T.TrialError("UI_AMBIGUOUS", "邀约对话出现多个相同选项，停止点击");
      return rows[0] || null;
    }
    isInvitationDialogue(screen) {
      if (this.openingMarker(screen) || this.result(screen) || screen.has("编辑牌组") || screen.has("更改牌组外观")) return false;
      return Boolean(this.invitationOption(screen, "adjust") || this.invitationOption(screen, "play") ||
        screen.rowsAt(this.region("invitationDeckHeader") || [1620, 20, 290, 70])
          .some(r => /(?:当前|當前)(?:牌组|牌組|卡组|卡組)/.test(T.norm(r.text))));
    }
    invitationDeckRows(screen, name) {
      const clean = text => deckText(String(text).replace(/(?:当前|當前)(?:牌组|牌組|卡组|卡組)\s*[:：]?/, ""));
      if (screen.probes?.invitationDeck)
        return clean(screen.probes.invitationDeck.text) === deckText(name) ? [screen.probes.invitationDeck] : [];
      return screen.rowsAt(this.region("invitationDeckHeader") || [1620, 20, 290, 70])
        .filter(r => clean(r.text) === deckText(name));
    }
    chooserNames(screen) {
      const valid = r => r && deckText(r.text) && !/^(编辑牌组|选择牌组|选择|确认|出战牌组|牌组预览)$/.test(T.norm(r.text));
      // Whole-screen positions follow partially scrolled cards. Fixed slot rectangles are a fallback,
      // not extra duplicate cards when both recognizers see the same name at different offsets.
      const full = screen.rowsAt(this.region("deckNames")).filter(valid);
      const candidates = full.length ? full : (screen.probes?.slots || []).filter(valid);
      const names = [];
      for (const r of candidates) {
        if (!names.some(old => deckText(old.text) === deckText(r.text) &&
            Math.abs(old.x + old.width / 2 - r.x - r.width / 2) < 230)) names.push(r);
      }
      return names.sort((a, b) => a.x - b.x);
    }
    isReady(screen) {
      if (screen.has("更改牌组外观") || this.result(screen)) return false;
      if (this.profile.texts.prepare.some(x => screen.has(x))) return true;
      if (screen.has("编辑牌组") || screen.has("选择牌组") || this.openingMarker(screen)) return false;
      if (screen.probes?.prepare && this.profile.texts.prepare.some(x =>
          T.norm(screen.probes.prepare.text).includes(T.norm(x)))) return true;
      // A named deck in the upstream's exact badge ROI plus a start/confirm control is independent evidence.
      // Do not treat arbitrary text at that coordinate as a deck.
      const badge = screen.probes?.deck;
      return Boolean(badge && this.knownDeck(badge.text) &&
        (screen.matches(this.profile.texts.start, this.region("start"), false).length ||
         screen.matches(["确认"], this.region("confirm"), false).length));
    }
    isInvitation(screen) {
      return !this.isReady(screen) && !this.isDeckChooser(screen) &&
        (screen.has("邀约对局") || screen.has("邀请对局")) &&
        (screen.has("友好对局") || screen.has("认真胜负"));
    }
    isDeckChooser(screen) {
      return !this.isReady(screen) && !screen.has("更改牌组外观") &&
        (screen.has("编辑牌组") || screen.has("选择牌组") ||
         screen.probes?.slots?.some(r => r && this.knownDeck(r.text)) && screen.matches(["选择"], this.region("select"), false).length > 0 ||
         this.deckListExpected && !this.isInvitationDialogue(screen) && !this.openingMarker(screen) && this.chooserNames(screen).length >= 2);
    }
    openingMarker(screen) {
      // Use the original players' scene locations, not short labels anywhere on an invitation/preview.
      // Older saved profiles may lack these keys; never let an absent ROI mean the whole screen.
      const region = (name, fallback) => this.region(name) || fallback;
      const openingHeader = region("openingHeader", [844, 167, 232, 65]);
      const openingPrompt = region("openingPrompt", [740, 215, 450, 75]);
      const rollHeader = region("rollHeader", [844, 167, 232, 65]);
      const pickPrompt = region("pickPrompt", [138, 1020, 280, 48]);
      const pickLabel = region("pickLabel", [1730, 820, 190, 100]);
      return screen.matches(["初始手牌"], openingHeader, true).length > 0 ||
        screen.matches(["请选择要替换的手牌"], openingPrompt, true).length > 0 ||
        screen.matches(["重投骰子"], rollHeader, true).length > 0 ||
        screen.rowsAt(pickPrompt).some(r => /^(请选择|选择)出战角色/.test(T.norm(r.text))) ||
        screen.matches(["出战角色"], pickLabel, false).length > 0;
    }
    isOpening(screen) {
      return !this.isReady(screen) && !this.isInvitation(screen) && !this.isDeckChooser(screen) &&
        !screen.has("更改牌组外观") && this.openingMarker(screen);
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
      if (this.deckRows(screen, recipe.deck, "deckBadge").length) return;
      // This coordinate is inherited from the weekly script and used only after preparation-page recognition.
      this.deckListExpected = true;
      this.h.click(...this.profile.points.openDeck); await this.pause(900);
      await this.wait(s => this.isDeckChooser(s), "打开牌组选择页", 6000);
      if (await this.pickDeck(recipe)) {
        await this.wait(s => this.isReady(s) && this.deckRows(s, recipe.deck, "deckBadge").length, "确认已切换至「" + recipe.deck + "」", 8000);
        return;
      }
      this.h.keyPress("ESCAPE");
      await this.wait(s => this.isReady(s), "找不到牌组后返回准备页", 6000);
      this.deckListExpected = false;
      throw new T.TrialError("DECK_NOT_FOUND", "找不到游戏牌组「" + recipe.deck + "」，跳过「" + recipe.title + "」");
    }
    async stableDeckList() {
      const end = Date.now() + (this.profile.deckSettleTimeoutMs || 20000), began = Date.now();
      let previous = null, count = 0;
      while (Date.now() < end) {
        const screen = this.read();
        if (!this.isDeckChooser(screen)) throw new T.TrialError("DECK_LIST_LOST", "拖动或查找时离开了卡组一览，停止开局");
        const names = this.chooserNames(screen), signature = names.map(r => deckText(r.text)).join("|");
        if (names.length && previous && this.sameDeckList(previous, names)) count++; else count = names.length ? 1 : 0;
        if (count >= 3 && Date.now() - began >= (this.profile.deckSettleMs ?? 1200)) return { screen, names, signature };
        previous = names;
        await this.pause(300);
      }
      throw new T.TrialError("DECK_NAMES_UNREADABLE", "卡组名称未稳定或无法辨识；停止，不把空白OCR当成边界");
    }
    sameDeckList(before, after) {
      return before.length === after.length && before.every((r, i) => deckText(r.text) === deckText(after[i].text) &&
        Math.abs(r.x + r.width / 2 - after[i].x - after[i].width / 2) <= 24);
    }
    async leftmostDeckList() {
      let before = await this.stableDeckList(), unchanged = 0;
      for (let step = 0; step < (this.profile.deckResetMaxDrags || 30); step++) {
        await this.drag(this.profile.points.deckDragFirst);
        const after = await this.stableDeckList();
        unchanged = this.sameDeckList(before.names, after.names) ? unchanged + 1 : 0;
        this.report.event("deck-reset", { step: step + 1, first: after.names[0].text, names: after.names.map(r => r.text), unchanged });
        if (unchanged >= 2) { this.read("deck-list-left"); return after; }
        before = after;
      }
      throw new T.TrialError("DECK_BOUNDARY_UNVERIFIED", "向右拖动后仍无法确认卡组一览最左端，停止查找");
    }
    async pickDeck(recipe) {
      let page = await this.leftmostDeckList(), unchanged = 0;
      // Six overlapping small movements cover approximately one former four-deck page.
      const limit = (Math.max(1, this.config.deckPages || 1) - 1) * 6;
      for (let step = 0; step <= limit; step++) {
        this.report.event("deck-search", { step, target: recipe.deck, names: page.names.map(r => r.text) });
        const found = this.deckRows(page.screen, recipe.deck, "deckNames");
        if (found.length > 1) throw new T.TrialError("DECK_AMBIGUOUS", "存在同名牌组，请给牌组使用不同名称：" + recipe.deck);
        if (found.length === 1) {
          await this.tap(found[0], "选择牌组「" + recipe.deck + "」");
          const screen = this.read("deck-list-selected");
          if (this.isDeckChooser(screen)) {
            const select = this.unique(screen, this.profile.texts.select, "select", false);
            if (!select) throw new T.TrialError("UI", "选中牌组后找不到选择按钮");
            await this.tap(select, "确认出战牌组");
          } else if (!this.isReady(screen) && !this.isInvitationDialogue(screen))
            throw new T.TrialError("UI", "选择牌组后出现未知页面，停止开局");
          this.deckListExpected = false;
          await this.pause(this.profile.deckSelectDelayMs ?? 4000);
          return true;
        }
        if (unchanged >= 2 || step === limit) break;
        // A saved 0.4.2 profile has a page-wide deckDragNext; never reuse that to skip over names.
        await this.drag(this.profile.points.deckSearchDrag || [1450, 200, 1130, 200]);
        const after = await this.stableDeckList();
        unchanged = this.sameDeckList(page.names, after.names) ? unchanged + 1 : 0;
        page = after;
      }
      this.report.event("deck-not-found", { target: recipe.deck, reason: unchanged >= 2 ? "right-edge" : "search-range" });
      return false;
    }
    async selectInvitationDeck(recipe, context) {
      this.verifyOpponent(context, this.read(), false);
      // An unprepared dialogue never falls through to the original default SPACE/F selection.
      const screen = await this.wait(s => this.invitationOption(s, "adjust") ? s : false,
        "等待「先调整一下卡组」选项（尚未选择牌组，禁止默认开始）", 45000);
      await this.tap(this.invitationOption(screen, "adjust"), "先调整一下卡组");
      this.deckListExpected = true;
      await this.wait(s => this.isDeckChooser(s), "进入角色邀约卡组一览", 10000);
      this.read("invite-deck-list");
      if (!await this.pickDeck(recipe)) {
        this.h.keyPress("ESCAPE");
        await this.wait(s => this.isInvitationDialogue(s), "找不到牌组后返回邀约对话", 8000);
        this.deckListExpected = false;
        throw new T.TrialError("DECK_NOT_FOUND", "查找范围内没有游戏牌组「" + recipe.deck + "」，跳过此策略");
      }
      await this.wait(s => this.isInvitationDialogue(s) && this.invitationDeckRows(s, recipe.deck).length,
        "返回邀约对话并确认当前牌组「" + recipe.deck + "」", 10000);
      this.read("invite-deck-confirmed");
    }
    async startInvitationMatch(recipe, context) {
      const screen = await this.wait(s => this.invitationOption(s, "play") ? s : false, "等待进行七圣召唤对局选项", 15000);
      if (!context.difficultySelected || !this.invitationDeckRows(screen, recipe.deck).length)
        throw new T.TrialError("DECK_UNVERIFIED", "邀约对话中未确认当前牌组和原难度，不开始对局");
      await this.tap(this.invitationOption(screen, "play"), "已确认牌组，进行七圣召唤的对局");
      await this.wait(s => !this.invitationOption(s, "play") && !this.invitationOption(s, "adjust"), "确认已离开邀约选项", 8000);
    }
    async startMatch(recipe, context) {
      const screen = this.read();
      if (!this.isReady(screen)) throw new T.TrialError("UI", "开局前不在对局准备页");
      this.verifyOpponent(context, screen, false);
      if (!context.difficultySelected) throw new T.TrialError("DIFFICULTY_UNVERIFIED", "没有确认本次难度");
      if (!this.deckRows(screen, recipe.deck, "deckBadge").length)
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
        rows: this.lastScreen ? this.lastScreen.rows : [], probes: this.lastScreen?.probes || {} };
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
