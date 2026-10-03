"use client";

import Link from "next/link";

import { useRef, useState } from "react";
import type { SiteContent } from "../content/content";
import { Brand } from "./Brand";
import { Icon } from "./Icon";

export function Header({ brand, copy, appUrl }: { brand: SiteContent["brand"]; copy: SiteContent["navigation"]; appUrl?: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return <header className="site-header" onKeyDown={(event) => {
    if (event.key === "Escape" && open) { setOpen(false); button.current?.focus(); }
  }}>
    <div className="container header-inner">
      <Brand copy={brand} />
      <button ref={button} className="menu-toggle cq-button" aria-expanded={open} aria-controls="main-navigation" aria-label={open ? copy.closeMenu : copy.openMenu} onClick={() => setOpen(!open)}>
        <span className={`menu-lines ${open ? "is-open" : ""}`} aria-hidden="true"><span /><span /></span>
      </button>
      <nav id="main-navigation" className="main-navigation" data-open={open} aria-label={copy.label} onClick={() => setOpen(false)}>
        <Link href="/#focus">{copy.focus}</Link><Link href="/#founder">{copy.founder}</Link><Link href="/#questions">{copy.faq}</Link>
        {appUrl && <a href={appUrl}>{copy.application}</a>}
        <Link className="cq-button cq-primary header-cta" href="/#interview-form">{copy.cta}<Icon name="arrow" /></Link>
      </nav>
    </div>
  </header>;
}
