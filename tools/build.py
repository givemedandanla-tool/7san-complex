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
        const options = TCGPlayer.playerOptions(settings);
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
    archive = ROOT / "dist/InvitationFallback-0.1.0.zip"
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
