"use client";
import Link from "next/link";
import { useSiteContent } from "../content/localized";
import { Icon } from "./Icon";
export function NotFoundContent() { const content=useSiteContent();return <main id="main-content" className="not-found container"><p className="eyebrow">{content.notFound.eyebrow}</p><h1>{content.notFound.heading}</h1><p>{content.notFound.description}</p><Link className="cq-button cq-primary" href="/">{content.notFound.cta}<Icon name="arrow"/></Link></main>; }
