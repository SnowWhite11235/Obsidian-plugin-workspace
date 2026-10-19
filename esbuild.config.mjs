import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const banner = `/*
=== obsidian-life-panel ===
生活管理面板：月日历、任务、打卡、灵感、复盘、番茄钟、统计 一站式
*/
`;

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  banner: { js: banner },
  footer: { js: "if (module.exports && module.exports.default) { module.exports = module.exports.default; }" },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: "inline",
  treeShaking: false,
  outfile: "main.js",
  minify: prod,
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
