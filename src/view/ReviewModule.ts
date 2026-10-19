/**
 * 每日复盘模块 - 3 问文本区
 */

import { App, Notice } from "obsidian";
import type LifePanelPlugin from "../main";
import { BaseModule } from "./BaseModule";
import { today } from "../core/DateUtils";

export class ReviewModule extends BaseModule {
  async render() {
    const c = this.container;
    c.empty();
    c.addClass("lp-review");

    // 每日复盘固定为当天，不随日历选择变化
    const date = today();

    const questions = this.plugin.settings.reviewQuestions;
    const answers = await this.plugin.store.getReview(date);

    for (const q of questions) {
      const qContainer = c.createDiv({ cls: "lp-review-question" });
      qContainer.createEl("label", {
        text: q,
        cls: "lp-review-label",
      });
      const textarea = qContainer.createEl("textarea", {
        cls: "lp-review-input",
        placeholder: "在这里写下你的思考...",
      });
      textarea.rows = 3;
      textarea.value = answers[q] || "";
      textarea.addEventListener("blur", async () => {
        const currentAnswers = await this.plugin.store.getReview(date);
        currentAnswers[q] = textarea.value;
        await this.plugin.store.saveReview(date, currentAnswers);
      });
    }
  }
}
