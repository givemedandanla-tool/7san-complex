(async function () {
  "use strict";
  // Keep a single async entry so ClearScript waits for every player and retry.
  eval(file.readTextSync("lib/core.js"));
  eval(file.readTextSync("lib/ui.js"));
  eval(file.readTextSync("lib/engines.js"));
  eval(file.readTextSync("lib/legacy.js"));
  const T = globalThis.InvitationTrial;
  let ui = null, cfg = null, outcome = "error", cancellation = null;
  file.createDirectory("data");
  const events = [];
  const report = {
    event(type, data) {
      events.push({ at: new Date().toISOString(), type, data });
      if (!file.writeTextSync("data/last-run.json", JSON.stringify({ version: "0.1.0", outcome, events }, null, 2), false))
        throw new Error("无法写入测试记录 data/last-run.json");
    }
  };
  try {
    cfg = T.config(typeof settings === "undefined" ? {} : settings);
    const version = typeof getVersion === "function" ? String(getVersion()) : "unknown";
    if (version !== "unknown") {
      const parts = version.match(/^(\d+)\.(\d+)\.(\d+)/);
      if (!parts || Number(parts[1]) === 0 && Number(parts[2]) < 66) throw new T.TrialError("VERSION", "请使用 BetterGI 0.66.0 或更新版本");
    }
    if (Number(genshin.width) !== 1920 || Number(genshin.height) !== 1080)
      throw new T.TrialError("RESOLUTION", "此整合测试版仅支持游戏客户区 1920×1080，请修改分辨率并重启捕获器");
    setGameMetrics(1920, 1080, Number(genshin.screenDpiScale) || 1);
    cancellation = dispatcher.getLinkedCancellationToken();
    const host = { file, genshin, RecognitionObject, captureGameRegion, sleep, click, keyPress, cancellationToken: cancellation,
      keyDown, keyUp, moveMouseTo, leftButtonDown, leftButtonUp };
    ui = new T.UI(host, cfg, JSON.parse(file.readTextSync("ui-profile.json")), report);
    const engines = new T.Engines(file, cfg, ui, report);
    engines.validate(cfg.mode === T.MODES.opening ? cfg.queue.slice(0, 1) : cfg.queue);
    report.event("start", { mode: cfg.mode, target: cfg.targetName, difficulty: cfg.difficulty,
      strategies: cfg.queue.map(x => ({ id: x.id, deck: x.deck })), maxMatches: cfg.maxMatches, version });
    if (cfg.mode === T.MODES.opening) {
      const recipe = cfg.queue[0];
      if (!ui.isOpening(ui.read())) throw new T.TrialError("ENTRY", "请手动进入初始手牌、首次选人或首次重投页后再启动单局测试");
      log.info("[单局测试] 使用「" + recipe.title + "」，不换牌组、不重开下一局。");
      const result = await engines.run(recipe), visible = await ui.waitResult(8000);
      if (result !== visible) throw new T.TrialError("RESULT_MISMATCH", "牌手回报与结算画面不一致");
      outcome = result; report.event("finish", { result, matches: 1 });
      log.info("[单局测试结束] " + (result === "win" ? "对局胜利" : "对局失败") + "，保留结算画面。");
      return;
    }
    const context = { name: cfg.targetName, difficulty: cfg.difficulty, verified: false, difficultySelected: false };
    if (cfg.mode === T.MODES.legacy) await new T.Legacy(ui, cfg, report).start(context);
    else await ui.ensureReady(context);
    log.info("[邀约重试] " + context.name + " / " + context.difficulty + "；策略顺序：" + cfg.queue.map(x => x.title).join(" → "));
    const result = await T.runAttempts(cfg.queue, cfg.maxMatches, {
      async prepare(recipe) {
        log.info("[准备] 选择牌组「" + recipe.deck + "」，使用「" + recipe.title + "」");
        await ui.selectDeck(recipe, context);
      },
      async play(recipe) {
        await ui.startMatch(recipe, context);
        const reported = await engines.run(recipe), visible = await ui.waitResult(8000);
        if (reported !== visible) throw new T.TrialError("RESULT_MISMATCH", "牌手回报与结算画面不一致，停止重试");
        return visible;
      },
      async reopen() {
        log.info("[换策略] 已确认败北，重开同一对手与难度；本步骤不会购买邀请函。");
        await ui.reopen(context);
      },
      async record(entry) { report.event("attempt", entry); log.info("[结果] " + entry.strategy + "：" + entry.outcome); }
    });
    outcome = result.outcome; report.event("finish", result);
    log.info("[完成] 「" + context.name + "」本次难度已获胜，共打 " + result.played + " 场；保留胜利结算画面。");
  } catch (error) {
    const cancelled = cancellation && Boolean(cancellation.isCancellationRequested == null ? cancellation.IsCancellationRequested : cancellation.isCancellationRequested);
    outcome = cancelled ? "cancelled" : "error";
    try { report.event("stop", { code: error.code || "ERROR", message: String(error.message || error), details: error.details || null }); } catch (_) {}
    if (!cancelled && ui) {
      try { ui.diagnostics(error); } catch (diagnosticError) { log.warn("现场诊断保存失败：" + String(diagnosticError.message || diagnosticError)); }
    }
    log.error("[邀约测试停止] " + (cancelled ? "已停止任务" : String(error.message || error)));
    throw error;
  } finally { if (ui) ui.dispose(); }
})();
