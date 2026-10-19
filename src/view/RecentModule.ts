/**
 * 最近打开/修改模块 - 双 tab，点击打开
 */

import { App, TFile } from "obsidian";
import type LifePanelPlugin from "../main";
import { BaseModule } from "./BaseModule";
import { relativeTime } from "../core/DateUtils";

export class RecentModule extends BaseModule {
  private currentTab: "open" | "modified" = "open";

  async render() {
    const c = this.container;
    c.empty();
    c.addClass("lp-recent");

    // Tab 切换
    const tabs = c.createDiv({ cls: "lp-recent-tabs" });
    const openTab = tabs.createEl("button", {
      text: "最近打开",
      cls: `lp-recent-tab ${this.currentTab === "open" ? "active" : ""}`,
    });
    const modifiedTab = tabs.createEl("button", {
      text: "最近修改",
      cls: `lp-recent-tab ${this.currentTab === "modified" ? "active" : ""}`,
    });

    openTab.addEventListener("click", () => {
      this.currentTab = "open";
      this.render();
    });
    modifiedTab.addEventListener("click", () => {
      this.currentTab = "modified";
      this.render();
    });

    // 内容列表
    const list = c.createDiv({ cls: "lp-recent-list" });
    const files = await this.getFiles();

    if (files.length === 0) {
      list.createDiv({ cls: "lp-empty-state", text: "暂无文件" });
      return;
    }

    for (const f of files) {
      const item = list.createDiv({ cls: "lp-recent-item" });
      item.createEl("span", { text: "📄", cls: "lp-recent-icon" });
      item.createEl("span", { text: f.name, cls: "lp-recent-name" });
      item.createEl("span", {
        text: relativeTime(f.time),
        cls: "lp-recent-time",
      });
      item.addEventListener("click", () => {
        this.app.workspace.openLinkText(f.path, "", false);
      });
    }
  }

  private async getFiles(): Promise<Array<{ name: string; path: string; time: number }>> {
    if (this.currentTab === "open") {
      // 从 workspace 获取最近打开的文件
      const openFiles: Array<{ name: string; path: string; time: number }> = [];
      const lastOpenFiles = (this.app.workspace as any).getLastOpenFiles?.() || [];
      for (const path of lastOpenFiles) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          openFiles.push({
            name: file.basename,
            path: file.path,
            time: file.stat.mtime,
          });
        }
      }
      return openFiles;
    } else {
      // 最近修改的文件（按 mtime 排序）
      const allFiles = this.app.vault.getMarkdownFiles();
      return allFiles
        .map((f) => ({
          name: f.basename,
          path: f.path,
          time: f.stat.mtime,
        }))
        .sort((a, b) => b.time - a.time)
        .slice(0, 15);
    }
  }
}
