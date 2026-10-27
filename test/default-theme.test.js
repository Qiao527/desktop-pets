const { describe, it, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const themeLoader = require("../src/theme-loader");

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), "dp-theme-"));
themeLoader.init(path.join(ROOT, "src"), tmpUserData);

after(() => fs.rmSync(tmpUserData, { recursive: true, force: true }));

describe("default theme (Pip)", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "themes", "pip", "theme.json"), "utf8"));

  it("is the loader's default and passes schema validation", () => {
    assert.strictEqual(themeLoader.DEFAULT_THEME_ID, "pip");
    assert.deepStrictEqual(themeLoader.validateTheme(raw), []);
  });

  it("references only files that exist", () => {
    const referenced = new Set();
    for (const files of Object.values(raw.states)) files.forEach((f) => referenced.add(f));
    for (const t of [...raw.workingTiers, ...raw.jugglingTiers]) referenced.add(t.file);
    for (const a of raw.idleAnimations) referenced.add(a.file);
    for (const f of Object.values(raw.displayHintMap)) referenced.add(f);
    for (const r of Object.values(raw.reactions)) {
      if (r.file) referenced.add(r.file);
      (r.files || []).forEach((f) => referenced.add(f));
    }
    for (const f of referenced) {
      assert.ok(fs.existsSync(path.join(ROOT, "themes", "pip", "assets", f)), `missing asset ${f}`);
    }
    for (const f of Object.values(raw.sounds)) {
      assert.ok(fs.existsSync(path.join(ROOT, "assets", "sounds", f)), `missing sound ${f}`);
    }
  });

  it("exposes eye-tracking ids in the idle SVG", () => {
    const svg = fs.readFileSync(path.join(ROOT, "themes", "pip", "assets", raw.states.idle[0]), "utf8");
    for (const id of ["eyes-js", "body-js", "shadow-js"]) assert.ok(svg.includes(`id="${id}"`), id);
  });

  it("falls back to Pip when a saved theme is missing (e.g. a removed local-only theme)", () => {
    const theme = themeLoader.loadTheme("pochacco-test-not-installed");
    assert.strictEqual(theme._id, "pip");
  });

  it("resolves default sounds to bundled files", () => {
    themeLoader.loadTheme("pip");
    const url = themeLoader.getSoundUrl("complete");
    assert.ok(url && url.endsWith("pip-complete.wav"), url);
  });
});

describe("packaged build contents", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const files = pkg.build.files;

  it("does not bundle third-party or all-rights-reserved artwork", () => {
    const forbidden = ["assets/svg", "themes/clawd", "themes/calico", "themes/pochacco", "themes/**", ".mp3"];
    for (const entry of files) {
      for (const bad of forbidden) {
        assert.ok(!entry.includes(bad), `build.files entry "${entry}" includes ${bad}`);
      }
    }
  });

  it("bundles the default theme and license notices", () => {
    assert.ok(files.includes("themes/pip/**/*"));
    assert.ok(files.includes("LICENSE"));
    assert.ok(files.includes("NOTICE.md"));
  });
});
