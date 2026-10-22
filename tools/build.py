#!/usr/bin/env python3
"""Offline, reproducible trial packaging. No dependency installation or remote code fetching."""
from pathlib import Path
import hashlib
import json
import re
import shutil
import zipfile

ROOT = Path(__file__).resolve().parent.parent
IDS = {"raiden": "RaidenColleiKeqingPlayer", "iansan": "IansanGamingSayuPlayer",
       "moonbloom": "MoonbloomPlayer", "mozailu": "MonaSayuDilucPlayer"}


def original_factory(code):
    """Keep the pinned route and outer loop, inserting only explicit integration hooks."""
    code = code.replace("\r\n", "\n")
    assert code.startswith("(async function () {") and code.rstrip().endswith("})();")
    body = code[len("(async function () {"):].rstrip()[:-len("})();")]
    declarations, main = body.split("//主流程\n")
    # Do not split the original invitation flow or assume it is already the deck preparation page.
    start = "click(1443, 875);//开始"
    assert declarations.count(start) == 1
    declarations = declarations.replace(start, "await hooks.beforeInviteStart();\n" + start, 1)
    confirm = "click(1175, 754);//确认"
    assert declarations.count(confirm) == 1
    declarations = declarations.replace(confirm, "await hooks.beforeInviteConfirm();\n" + confirm, 1)
    native = 'await dispatcher.runTask(new SoloTask("AutoGeniusInvokation"));'
    assert declarations.count(native) == 1
    declarations = declarations.replace(native, "const result = await hooks.play();", 1)
    cleanup = "await autoConversation();\n    }\n"
    assert declarations.count(cleanup) == 1
    declarations = declarations.replace(cleanup, "await autoConversation();\nreturn result;\n    }\n", 1)
    declarations = declarations.replace("async function BuyLetter(){", "async function BuyLetter(){\nawait hooks.canPurchase();", 1)
    submit = "click(1185,755 );//点击购买\nawait sleep(1000);"
    assert declarations.count(submit) == 1
    declarations = declarations.replace(submit, "await hooks.beforePurchase();\n" + submit + "\nawait hooks.afterPurchase();", 1)
    dialogue_loop = "while (talkTime < 30) {\n"
    assert declarations.count(dialogue_loop) == 1
    declarations = declarations.replace(dialogue_loop, dialogue_loop + "    if (await hooks.dialogueStep()) return;\n", 1)
    assert main.count("if (letterNumber <= i)") == 1
    pair = "await chooseCharacter();\n   await Playcards();"
    assert main.count(pair) == 2
    for leg in [1, 2]:
        main = main.replace(pair, f"await hooks.challenge(chooseCharacter, Playcards, {{round: i + 1, leg: {leg}}});", 1)
    finished = "log.info(`完成挑战第${i+1}次`);"
    assert main.count(finished) == 1
    main = main.replace(finished, finished + "\n   await hooks.roundFinished(i + 1);", 1)
    return '''// Generated from the pinned original invitation script; see upstream-invitation/main.js.
// Route coordinates, dialogue, result cleanup and outer-loop order are inherited from that source.
(function createOriginalNavigation(bindings) {
  "use strict";
  const {settings, hooks, genshin, log, captureGameRegion, keyPress, click, sleep} = bindings;
  const mats = new Map();
  const held = new Set();
  const keyDown = key => { held.add(key); bindings.keyDown(key); };
  const keyUp = key => { bindings.keyUp(key); held.delete(key); };
  const file = {ReadImageMatSync(path) {
    if (!mats.has(path)) mats.set(path, bindings.file.readImageMatSync(path));
    return mats.get(path);
  }};
  const RecognitionObject = {
    ocr: (...args) => bindings.RecognitionObject.ocr(...args),
    TemplateMatch: (...args) => bindings.RecognitionObject.templateMatch(...args)
  };
''' + declarations + '''
  return {
    async run() {
''' + main + '''
    },
    dispose() {
      for (const key of held) bindings.keyUp(key);
      held.clear();
      for (const mat of mats.values()) mat.dispose();
      mats.clear();
    }
  };
})
'''


def player_factory(code, identity):
    marker = "// @tcg-entry"
    if code.count(marker) != 1:
        raise ValueError("Unexpected upstream entry layout: " + identity)
    body, entry = code.split(marker)
    if "TCGHandRecognition.classes(globalThis" not in entry or "new Player(new Host(options), options).run()" not in entry:
        raise ValueError("Unexpected upstream invocation: " + identity)
    exports = sorted(set(re.findall(r"\b(?:root|globalThis)\.([A-Za-z_$][\w$]*)\s*=", body)))
    if not {"TCG", "TCGBetterGI", "TCGPlayer", "TCGHandRecognition"}.issubset(exports):
        raise ValueError("Missing player exports: " + identity)
    # Preserve the complete upstream module body. Only the auto-run entry is replaced.
    # Accessor-backed lexical aliases also isolate unqualified TCG references inside upstream code.
    aliases = ", ".join(exports)
    descriptors = ",\n".join(f"{json.dumps(name)}: {{get(){{return {name};}}, set(value){{{name}=value;}}}}" for name in exports)
    return f'''// Generated adapter for {identity}; source and license are included alongside this file.
// Original decision/recognition modules below are unmodified. Only the invocation and host binding change.
(function (realGlobal) {{
  "use strict";
  return function createRuntime(bindings) {{
    const file = bindings.file, settings = bindings.settings;
    const globalThis = Object.create(realGlobal);
    let {aliases};
    Object.defineProperties(globalThis, {{
      file: {{value:file}}, settings: {{value:settings}},
      {descriptors}
    }});
{body}
    return {{
      describe() {{return {{team: TCG.team.map(c=>c.name), version: TCG.version, sharedVersion: TCG.sharedVersion}};}},
      session() {{
        const maxMinutes = Number(settings?.maxMinutes == null || settings.maxMinutes === "" ? 15 : settings.maxMinutes);
        if (!Number.isSafeInteger(maxMinutes) || maxMinutes < 1 || maxMinutes > Math.floor(Number.MAX_SAFE_INTEGER / 60000))
          throw new Error("单局时间必须是可安全换算为毫秒的正整数分钟");
        // Keep upstream validation for all other settings; its menu-only minute whitelist is adapted here.
        const options = TCGPlayer.playerOptions(Object.assign({{}}, settings, {{maxMinutes: "15"}}));
        options.maxMinutes = maxMinutes;
        const {{Host, Player}} = TCGHandRecognition.classes(globalThis,
          JSON.parse(file.readTextSync("hand-bank.json")), JSON.parse(file.readTextSync("opening-bank.json")));
        return {{Host, Player, options}};
      }}
    }};
  }};
}})(globalThis)
'''


def main():
    lock = json.loads((ROOT / "vendor/lock.json").read_text())
    for name, expected in lock["files"].items():
        path = ROOT / "vendor" / name
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError("Vendor integrity mismatch: " + name)
    manifest = json.loads((ROOT / "vendor/release-manifest.json").read_text())
    for rel, expected in manifest["files"].items():
        if rel.startswith("repo/js/"):
            local = ROOT / "vendor/players" / rel.removeprefix("repo/js/")
            if hashlib.sha256(local.read_bytes()).hexdigest() != expected:
                raise ValueError("Published manifest mismatch: " + rel)
    output = ROOT / "dist/InvitationFallback"
    if output.exists():
        shutil.rmtree(output)
    shutil.copytree(ROOT / "src/InvitationFallback", output)
    instructions = (output / "README.md").read_text(encoding="utf-8")
    for identity, folder in IDS.items():
        instructions = instructions.replace(f"../../vendor/players/{folder}/README.md", f"engines/{identity}/README.md")
    instructions = instructions.replace("../../docs/UPSTREAM_LINE_REVIEW.md", "UPSTREAM_LINE_REVIEW.md")
    (output / "README.md").write_text(instructions, encoding="utf-8")
    shutil.copy2(ROOT / "docs/UPSTREAM_LINE_REVIEW.md", output / "UPSTREAM_LINE_REVIEW.md")
    original = (ROOT / "vendor/invitation/main.js").read_text(encoding="utf-8")
    (output / "lib/original-navigation.js").write_text(original_factory(original), encoding="utf-8")
    shutil.copy2(ROOT / "LICENSE", output / "LICENSE-GPL-3.0.txt")
    shutil.copytree(ROOT / "vendor/invitation/assets", output / "assets")
    shutil.copytree(ROOT / "vendor/invitation", output / "upstream-invitation")
    for identity, folder in IDS.items():
        target = output / "engines" / identity
        shutil.copytree(ROOT / "vendor/players" / folder, target)
        raw = (target / "main.js").read_text(encoding="utf-8")
        (target / "engine.js").write_text(player_factory(raw, identity), encoding="utf-8")
    shutil.copy2(ROOT / "vendor/lock.json", output / "UPSTREAM_LOCK.json")
    files = {}
    for path in sorted(output.rglob("*")):
        if path.is_file():
            files[path.relative_to(output).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    (output / "PACKAGE_SHA256.json").write_text(json.dumps(files, ensure_ascii=False, indent=2) + "\n")
    version = json.loads((output / "manifest.json").read_text())["version"]
    archive = ROOT / f"dist/InvitationFallback-{version}.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for path in sorted(output.rglob("*")):
            if not path.is_file():
                continue
            info = zipfile.ZipInfo(path.relative_to(output.parent).as_posix(), date_time=(2026, 10, 22, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info, path.read_bytes())
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix(".zip.sha256").write_text(digest + "  " + archive.name + "\n")
    print(json.dumps({"zip": str(archive), "bytes": archive.stat().st_size, "files": len(files) + 1, "sha256": digest}))


if __name__ == "__main__":
    main()
