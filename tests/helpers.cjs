const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
function load(modules = ['core', 'ui'], extras = {}) {
  const context = vm.createContext({ ...extras });
  for (const name of modules) vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/InvitationFallback/lib', name + '.js'), 'utf8'), context);
  return { T: context.InvitationTrial, context };
}
function row(text, x = 1100, y = 200, width = 180, height = 40) { return { text, x, y, width, height }; }
function screen(T, rows) { return new T.Screen(rows); }
function profile() { return JSON.parse(fs.readFileSync(path.join(ROOT, 'src/InvitationFallback/ui-profile.json'))); }
module.exports = { ROOT, load, row, screen, profile };
