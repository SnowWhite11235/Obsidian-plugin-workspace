/**
 * 模块基类 - 提供 currentDate 容器等通用能力
 */

import { App } from "obsidian";
import type LifePanelPlugin from "../main";

export abstract class BaseModule {
  constructor(
    public app: App,
    public plugin: LifePanelPlugin,
    public container: HTMLElement,
    public currentDate: string,
  ) {}

  abstract render(): void | Promise<void>;

  /** 重新渲染当前模块（数据更新后调用） */
  refresh() {
    this.container.empty();
    this.render();
  }
}
