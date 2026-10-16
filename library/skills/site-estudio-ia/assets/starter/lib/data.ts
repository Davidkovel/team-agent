import type { Product, Service } from "@/types";

export const products: Product[] = [
  {
    name: "OpenClaw",
    tag: "AI Infrastructure",
    description:
      "Internal AI gateway. LLM chain with local inference + cloud fallback, Telegram bot interface, finance tracking, Notion integration. The backbone everything runs on.",
    status: "Live",
  },
  {
    name: "Autoclippers",
    tag: "Automation",
    description:
      "24/7 bots that monitor live streams and YouTube channels, detect highlights via AI, clip with ffmpeg, and distribute automatically. Content factory, zero manual effort.",
    status: "Live",
  },
  {
    name: "Two Trim",
    tag: "E-Commerce",
    description:
      "Shopify dropshipping store. Football jerseys, TikTok Shop pipeline. A lean revenue arm running on automation.",
    status: "Active",
  },
  {
    name: "Fortis",
    tag: "Mobile App",
    description:
      "AI personal trainer built in .NET MAUI. Goal setting, workout logging, form analysis via image input. Built for people serious about training.",
    status: "In Development",
  },
];

export const services: Service[] = [
  {
    title: "Mobile Apps",
    description:
      "Native and cross-platform apps. iOS, Android, .NET MAUI. Built to ship.",
  },
  {
    title: "SaaS Tools",
    description:
      "Full-stack web products. Auth, billing, dashboards, APIs — end to end.",
  },
  {
    title: "Funnels & Landing",
    description:
      "High-conversion funnels wired into analytics, CRM, and payment.",
  },
  {
    title: "Automation Systems",
    description:
      "Custom AI agents, scrapers, content pipelines, and internal tools.",
  },
  {
    title: "Shopify & E-Commerce",
    description:
      "Storefronts, dropship pipelines, TikTok Shop integrations, backend ops.",
  },
];

export const contactEmail = "hello@neodaemon.com";
