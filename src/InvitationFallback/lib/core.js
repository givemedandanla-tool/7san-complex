(function (root) {
  "use strict";
  const T = root.InvitationTrial = root.InvitationTrial || {};
  const RECIPES = [
    { id: "raiden", title: "雷柯刻", folder: "RaidenColleiKeqingPlayer", field: "raidenDeck", team: ["雷电将军", "柯莱", "刻晴"] },
    { id: "iansan", title: "伊嘉早", folder: "IansanGamingSayuPlayer", field: "iansanDeck", team: ["伊安珊", "嘉明", "早柚"] },
    { id: "moonbloom", title: "月绽放", folder: "MoonbloomPlayer", field: "moonbloomDeck", team: ["菈乌玛", "哥伦比娅", "奈芙尔"] },
    { id: "mozailu", title: "莫早卢", folder: "MonaSayuDilucPlayer", field: "mozailuDeck", team: ["莫娜", "早柚", "迪卢克"] },
    { id: "builtin", title: "原固定策略", field: "builtinDeck", team: null }
  ];
  class TrialError extends Error {
    constructor(code, message, details) {
      super(message); this.name = "TrialError"; this.code = code; this.details = details || null;
    }
  }
  function norm(value) {
    return String(value == null ? "" : value).replace(/[\s·:：,，。!！「」『』【】\[\]（）()]/g, "");
  }
  function list(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    const n = Number(value.count == null ? value.Count : value.count);
    if (Number.isInteger(n)) return Array.from({ length: n }, (_, i) => value[i]);
    return Array.from(value);
  }
  function integer(value, fallback, min, max, label) {
    if (value == null || value === "") return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new TrialError("CONFIG", label + "必须是 " + min + " 到 " + max + " 的整数");
    return n;
  }
  function config(raw) {
    const s = raw || {};
    const order = String(s.strategyOrder == null ? "雷柯刻,伊嘉早,月绽放,莫早卢" : s.strategyOrder).split(/[,，;；\n]+/).map(x => x.trim()).filter(Boolean);
    if (!order.length) throw new TrialError("CONFIG", "请填写至少一个策略");
    const seen = new Set(), queue = order.map(name => {
      const recipe = RECIPES.find(r => norm(r.title) === norm(name) || r.id === name);
      if (!recipe) throw new TrialError("CONFIG", "策略名称不支持：" + name);
      if (seen.has(recipe.id)) throw new TrialError("CONFIG", "策略顺序重复：" + recipe.title);
      seen.add(recipe.id);
      const deck = String(s[recipe.field] == null ? (recipe.id === "builtin" ? "原牌组" : recipe.title) : s[recipe.field]).trim();
      if (!deck) throw new TrialError("CONFIG", "请填写「" + recipe.title + "」的游戏牌组名");
      return Object.assign({}, recipe, { deck });
    });
    const maxMinutes = integer(s.maxMinutes, 15, 1, Math.floor(Number.MAX_SAFE_INTEGER / 60000), "单局超时分钟数");
    if (s.mulligan && !["全部保留", "优先装备与启动牌"].includes(s.mulligan)) throw new TrialError("CONFIG", "未知的起手处理选项");
    return {
      queue,
      challengeNumber: integer(s.challengeNumber, 1, 1, 99, "挑战人数"),
      maxMinutes,
      deckPages: integer(s.deckPages, 2, 1, 5, "牌组查找页数"),
      mulligan: s.mulligan || "全部保留",
      letterNumber: integer(s.letterNumber, 0, 0, 99, "现有邀请函数量"),
      diagnosticImages: s.diagnosticImages !== false
    };
  }
  function classifyResult(text) {
    const n = norm(text), win = n.includes("对局胜利"), lose = n.includes("对局失败");
    return win !== lose ? (win ? "win" : "lose") : null;
  }
  async function runAttempts(queue, maxMatches, driver) {
    const history = []; let played = 0, afterLoss = false;
    for (const recipe of queue) {
      if (played >= maxMatches) break;
      // A failed match stays attached to its opponent/difficulty; never invoke navigation or purchasing here.
      if (afterLoss) { await driver.reopen(); afterLoss = false; }
      try { await driver.prepare(recipe); }
      catch (error) {
        if (error.code !== "DECK_NOT_FOUND") throw error;
        const entry = { strategy: recipe.id, deck: recipe.deck, outcome: "skipped", reason: error.message };
        history.push(entry); await driver.record(entry); continue;
      }
      played++;
      const result = await driver.play(recipe);
      if (result !== "win" && result !== "lose") throw new TrialError("RESULT_UNKNOWN", "牌手结束但没有确认胜败；停止换策略");
      const entry = { strategy: recipe.id, deck: recipe.deck, outcome: result, match: played };
      history.push(entry); await driver.record(entry);
      if (result === "win") return { outcome: "win", played, history };
      afterLoss = true;
    }
    throw new TrialError("EXHAUSTED", "本次可用策略已用尽或达到对局上限，当前挑战未完成", { played, history });
  }
  function relativePath(prefix, path) {
    const p = String(path).replace(/\\/g, "/");
    if (!p || /^[\/]/.test(p) || /:/.test(p) || p.split("/").some(x => x === "..")) throw new TrialError("PATH", "牌手资源路径无效");
    return prefix + "/" + p.split("/").filter(x => x && x !== ".").join("/");
  }
  function scopedFile(file, prefix) {
    const proxy = {};
    for (const name of ["readTextSync", "readImageMatSync", "writeTextSync", "createDirectory", "isExists"]) {
      proxy[name] = function (path, ...args) { return file[name](relativePath(prefix, path), ...args); };
    }
    return proxy;
  }
  async function runPlayer(session, onResult) {
    const { Host, Player, options } = session;
    let result = null;
    class ResultPlayer extends Player {
      reportResult(p) {
        super.reportResult(p);
        if (p.result !== "win" && p.result !== "lose") throw new TrialError("RESULT_UNKNOWN", "牌手给出了未知结果");
        result = p.result;
        if (onResult) onResult(result);
      }
    }
    const host = new Host(options);
    let player;
    try { player = new ResultPlayer(host, options); }
    catch (e) { host.dispose(); throw e; }
    // Upstream Player.run owns host.dispose() in its finally block.
    await player.run();
    if (!result) throw new TrialError("RESULT_UNKNOWN", "牌手未确认胜败便结束（可能已在结算页或入口不正确）");
    return result;
  }
  Object.assign(T, { RECIPES, TrialError, norm, list, integer, config, classifyResult, runAttempts, relativePath, scopedFile, runPlayer });
})(globalThis);
