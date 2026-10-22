(async function () {
  "use strict";
  eval(file.readTextSync("lib/core.js"));
  eval(file.readTextSync("lib/ui.js"));
  eval(file.readTextSync("lib/engines.js"));
  eval(file.readTextSync("lib/original-flow.js"));
  const T = globalThis.InvitationTrial;
  let ui = null, outcome = "error", cancellation = null;
  file.createDirectory("data");
  const events = [];
  const report = {
    event(type, data) {
      events.push({ at: new Date().toISOString(), type, data });
      if (!file.writeTextSync("data/last-run.json", JSON.stringify({ version: "0.4.1", outcome, events }, null, 2), false))
        throw new Error("无法写入运行记录 data/last-run.json");
    }
  };
  try {
    const cfg = T.config(typeof settings === "undefined" ? {} : settings);
    const version = typeof getVersion === "function" ? String(getVersion()) : "unknown";
    if (version !== "unknown") {
      const parts = version.match(/^(\d+)\.(\d+)\.(\d+)/);
      if (!parts || Number(parts[1]) === 0 && Number(parts[2]) < 66) throw new T.TrialError("VERSION", "请使用 BetterGI 0.66.0 或更新版本");
    }
    if (Number(genshin.width) !== 1920 || Number(genshin.height) !== 1080)
      throw new T.TrialError("RESOLUTION", "此整合版仅支持游戏客户区 1920×1080，请修改分辨率并重启捕获器");
    setGameMetrics(1920, 1080, Number(genshin.screenDpiScale) || 1);
    cancellation = dispatcher.getLinkedCancellationToken();
    const host = { file, genshin, RecognitionObject, captureGameRegion, sleep, click, keyPress, cancellationToken: cancellation,
      keyDown, keyUp, moveMouseTo, leftButtonDown, leftButtonUp };
    ui = new T.UI(host, cfg, JSON.parse(file.readTextSync("ui-profile.json")), report);
    const engines = new T.Engines(file, cfg, ui, report);
    engines.validate(cfg.queue);
    report.event("start", { mode: "original", challengeNumber: cfg.challengeNumber, letterNumber: cfg.letterNumber, maxMinutes: cfg.maxMinutes,
      strategies: cfg.queue.map(x => ({ id: x.id, deck: x.deck })), version });
    log.info("[原版邀约流程] 挑战人数 " + cfg.challengeNumber + "；策略顺序：" + cfg.queue.map(x => x.title).join(" → "));
    log.info("[购函设置] 持有邀请函数量（已邀请角色也算）：" + cfg.letterNumber + "；按原版条件不足时购买。");
    log.info("[智能牌手] 单局超时上限 " + cfg.maxMinutes + " 分钟。");
    const result = await new T.OriginalFlow(ui, cfg, engines, report, log).run();
    outcome = result.outcome;
    report.event("finish", result);
    log.info("[原版流程结束] " + result.rounds + " 轮，获胜 " + result.wins + " 段，未获胜 " + result.losses + " 段，共打 " + result.played + " 场。");
  } catch (error) {
    const cancelled = cancellation && Boolean(cancellation.isCancellationRequested == null ? cancellation.IsCancellationRequested : cancellation.isCancellationRequested);
    outcome = cancelled ? "cancelled" : "error";
    try { report.event("stop", { code: error.code || "ERROR", message: String(error.message || error), details: error.details || null }); } catch (_) {}
    if (!cancelled && ui) {
      try { ui.diagnostics(error); } catch (diagnosticError) { log.warn("现场诊断保存失败：" + String(diagnosticError.message || diagnosticError)); }
    }
    log.error("[邀约停止] " + (cancelled ? "已停止任务" : String(error.message || error)));
    throw error;
  } finally { if (ui) ui.dispose(); }
})();
