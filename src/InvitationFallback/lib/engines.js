(function (root) {
  "use strict";
  const T = root.InvitationTrial;
  class Engines {
    constructor(file, configuration, ui, report) {
      this.file = file; this.configuration = configuration; this.ui = ui; this.report = report;
      this.factories = new Map();
    }
    load(recipe) {
      if (recipe.id === "builtin") return null;
      if (!this.factories.has(recipe.id)) {
        // All evaluated code is bundled, pinned upstream code; no HTTP or downloaded runtime code.
        const factory = eval(this.file.readTextSync("engines/" + recipe.id + "/engine.js"));
        if (typeof factory !== "function") throw new T.TrialError("PACKAGE", "牌手包入口损坏：" + recipe.title);
        this.factories.set(recipe.id, factory);
      }
      return this.factories.get(recipe.id)({
        file: T.scopedFile(this.file, "engines/" + recipe.id),
        settings: { maxMinutes: String(this.configuration.maxMinutes), mulligan: this.configuration.mulligan,
          actionEntry: "禁止从行动页启动" }
      });
    }
    validate(queue) {
      for (const recipe of queue) {
        if (recipe.id === "builtin") continue;
        const runtime = this.load(recipe), description = runtime.describe();
        if (description.team.join("/") !== recipe.team.join("/")) throw new T.TrialError("PACKAGE", "牌手角色顺序与整合包不一致：" + recipe.title);
        // Validate the actual hand banks against this deck's catalog before touching game input.
        runtime.session();
      }
    }
    async run(recipe) {
      if (recipe.id === "builtin") {
        await dispatcher.runTask(new SoloTask("AutoGeniusInvokation"));
        return this.ui.waitResult(8000);
      }
      const runtime = this.load(recipe);
      return T.runPlayer(runtime.session(), result => this.report.event("player-result", { strategy: recipe.id, result }));
    }
  }
  T.Engines = Engines;
})(globalThis);
