import { defineUserConfig } from "vuepress";
import type { DefaultThemeOptions } from "vuepress";

export default defineUserConfig<DefaultThemeOptions>({
  lang: "zh-CN",
  title: "Nodejs 技术栈",
  port: 9001,
  themeConfig: {
    navbar: [
      {
        text: "源码解读",
        children: ["/sourceCode/buffer.md"],
      },
      {
        text: "框架",
        children: [
          {
            text: "Koa",
            children: ["/Koa/index.md"],
          },
        ],
      },
    ],
  },
});
