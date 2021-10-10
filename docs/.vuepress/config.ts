import { defineUserConfig } from "vuepress";
import type { DefaultThemeOptions } from "vuepress";

export default defineUserConfig<DefaultThemeOptions>({
  lang: "zh-CN",
  title: "Nodejs 技术栈",
  port: 9001,
  themeConfig: {
    contributors: true,
    lastUpdated: true,
    navbar: [
      {
        text: "源码解读",
        children: [
          {
            text: "Buffer",
            link: "/sourceCode/buffer/introduction.md",
          },
          {
            text: "Event",
            link: "/sourceCode/event/introduction.md",
          },
        ],
      },
      {
        text: "框架",
        children: [
          {
            text: "Koa",
            link: "/frame/koa/introduction.md",
          },
        ],
      },
    ],
    sidebar: {
      "/sourceCode/": [
        {
          text: "Buffer",
          children: [
            "/sourceCode/buffer/introduction.md",
            "/sourceCode/buffer/api.md",
            "/sourceCode/buffer/key.md",
            "/sourceCode/buffer/practice.md",
          ],
        },
        {
          text: "Event",
          children: [
            "/sourceCode/event/introduction.md",
            "/sourceCode/event/api.md",
            "/sourceCode/event/key.md",
            "/sourceCode/event/practice.md",
          ],
        },
      ],
      "/frame/": [
        {
          text: "Koa",
          children: [
            "/frame/koa/introduction.md",
            "/frame/koa/api.md",
            "/frame/koa/key.md",
            "/frame/koa/practice.md",
          ],
        },
      ],
    },
  },
});
