/**
 * 每日灵感模块 - 顶部快速输入框，时间戳列表
 */

import { App } from "obsidian";
import type LifePanelPlugin from "../main";
import { BaseModule } from "./BaseModule";
import { bus } from "../core/EventBus";
import { nowHM } from "../core/DateUtils";

export class InspirationModule extends BaseModule {
  async render() {
    const c = this.container;
    c.empty();
    c.addClass("lp-inspiration");

    // 输入框
    const inputContainer = c.createDiv({ cls: "lp-insp-input-container" });
    const input = inputContainer.createEl("textarea", {
      placeholder: "💡 随手记录灵感、想法...",
      cls: "lp-insp-input",
    });
    input.rows = 2;
    const addBtn = inputContainer.createEl("button", {
      text: "记录",
      cls: "lp-insp-add-btn",
    });

    const addInspiration = async () => {
      const text = input.value.trim();
      if (!text) return;
      await this.plugin.store.addInspiration(this.currentDate, text, nowHM());
      input.value = "";
      this.render();
      bus.emit({ type: "data-updated", scope: "day", date: this.currentDate });
    };

    addBtn.addEventListener("click", addInspiration);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        addInspiration();
      }
    });

    // 灵感列表
    const inspirations = await this.plugin.store.getInspirations(this.currentDate);
    const list = c.createDiv({ cls: "lp-insp-list" });

    if (inspirations.length === 0) {
      list.createDiv({
        cls: "lp-empty-state",
        text: "今天还没有灵感记录 💡",
      });
    }

    // 倒序展示
    for (const insp of [...inspirations].reverse()) {
      const item = list.createDiv({ cls: "lp-insp-item" });
      item.createEl("span", {
        text: insp.time || "—",
        cls: "lp-insp-time",
      });
      item.createEl("span", {
        text: insp.text,
        cls: "lp-insp-text",
      });
    }
  }
}
