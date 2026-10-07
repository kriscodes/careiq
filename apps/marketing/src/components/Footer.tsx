import { content } from "../content/content";
import { siteConfig } from "../lib/site-config";
import { Brand } from "./Brand";

export function Footer() {
  return <footer className="site-footer"><div className="container">
    <div className="footer-top"><div><Brand copy={content.brand} /><p>{content.footer.description}</p></div><div className="footer-links"><a href="/privacy/">{content.footer.privacy}</a>{siteConfig.contactEmail && <a href={`mailto:${siteConfig.contactEmail}`}>{content.footer.contact}</a>}</div></div>
    <div className="footer-bottom"><span>© {new Date().getUTCFullYear()} {content.footer.copyright}</span><span>{content.footer.stage}</span></div>
  </div></footer>;
}
