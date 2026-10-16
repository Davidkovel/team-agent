"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import NeoLogo from "./NeoLogo";

const links = [
  { href: "/work", label: "Work" },
  { href: "/#services", label: "Services" },
  { href: "/#contact", label: "Contact" },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-colors duration-300 backdrop-blur-md border-b ${
        scrolled
          ? "bg-bg/80 border-subtle"
          : "bg-bg/40 border-transparent"
      }`}
    >
      <nav className="max-w-6xl mx-auto flex items-center justify-between px-6 h-16">
        <Link href="/" className="flex items-center gap-2" aria-label="NeoDaemon home">
          <NeoLogo size="sm" animated />
          <span className="font-mono text-sm text-text-muted hidden sm:inline">
            NeoDaemon
          </span>
        </Link>

        <ul className="hidden md:flex items-center gap-8 font-mono text-sm">
          {links.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className="text-text-muted hover:text-accent transition-colors"
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>

        <button
          aria-label="Toggle menu"
          aria-expanded={open}
          className="md:hidden text-text-primary p-2"
          onClick={() => setOpen((v) => !v)}
        >
          <div className="w-5 h-[2px] bg-current mb-1" />
          <div className="w-5 h-[2px] bg-current mb-1" />
          <div className="w-5 h-[2px] bg-current" />
        </button>
      </nav>

      {open && (
        <div className="md:hidden border-t border-subtle bg-bg/95">
          <ul className="flex flex-col px-6 py-4 gap-4 font-mono text-sm">
            {links.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="block text-text-muted hover:text-accent"
                  onClick={() => setOpen(false)}
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  );
}
