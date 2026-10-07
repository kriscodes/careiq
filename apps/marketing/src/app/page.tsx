import { Icon, type IconName } from "../components/Icon";
import { InterviewForm } from "../components/InterviewForm";
import { content } from "../content/content";
import { siteConfig } from "../lib/site-config";

const workflowIcons: IconName[] = ["user-plus", "workflow", "mail", "calendar"];
const focusIcons: IconName[] = ["user-plus", "workflow", "calendar"];
const interviewIcons: IconName[] = ["clock", "users", "check"];

export default function Home() {
  return <main id="main-content">
    <section className="hero container" aria-labelledby="hero-heading">
      <div className="hero-copy"><p className="eyebrow"><span className="status-dot" />{content.hero.eyebrow}</p><h1 id="hero-heading">{content.hero.headline}</h1><p className="hero-description">{content.hero.description}</p><p className="hero-supporting">{content.hero.supporting}</p>
        <div className="hero-actions"><a className="cq-button cq-primary" href="#interview-form">{content.hero.primaryCta}<Icon name="arrow" /></a><a className="text-link" href="#focus">{content.hero.secondaryCta}<span aria-hidden="true">↓</span></a></div>
        <p className="stage-note">{content.hero.stageNote}</p>
      </div>
      <figure className="workflow cq-surface"><div className="workflow-header"><p className="eyebrow">{content.workflow.eyebrow}</p><h2>{content.workflow.heading}</h2><p>{content.workflow.description}</p></div><ol className="workflow-steps">{content.workflow.steps.map((step, index) => <li key={step.title}><span className="workflow-step-icon"><Icon name={workflowIcons[index]} /></span><div><span className="step-number">0{index + 1}</span><h3>{step.title}</h3><p>{step.description}</p></div></li>)}</ol><figcaption>{content.workflow.caption}</figcaption></figure>
    </section>
    <section id="focus" className="focus-section section" aria-labelledby="focus-heading"><div className="container"><div className="section-intro"><p className="eyebrow">{content.focus.eyebrow}</p><h2 id="focus-heading">{content.focus.heading}</h2><p>{content.focus.description}</p></div><div className="focus-cards">{content.focus.cards.map((card, index) => <article className="focus-card cq-surface" key={card.title}><div className="focus-card-top"><span className="card-icon"><Icon name={focusIcons[index]} /></span><span className="card-number">0{index + 1}</span></div><h3>{card.title}</h3><p>{card.description}</p><div className="focus-question">{card.question}</div></article>)}</div><p className="section-note">{content.focus.note}</p></div></section>
    <section id="founder" className="section founder-section container" aria-labelledby="founder-heading"><div className="founder-heading"><p className="eyebrow">{content.founder.eyebrow}</p><h2 id="founder-heading">{content.founder.heading}</h2><div className="founder-signature"><span className="founder-initials" aria-hidden="true">KS</span><div><strong>{content.founder.name}</strong><span>{content.founder.role}</span></div></div>{siteConfig.founderLinkedinUrl && <a className="text-link founder-link" href={siteConfig.founderLinkedinUrl}>{content.founder.linkedin}<Icon name="arrow" /></a>}</div><div className="founder-copy"><p className="founder-background">{content.founder.background}</p><p>{content.founder.description}</p><p>{content.founder.closing}</p></div></section>
    <section id="interview" className="section interview-section" aria-labelledby="interview-heading"><div className="container interview-grid"><div className="interview-copy"><p className="eyebrow">{content.interview.eyebrow}</p><h2 id="interview-heading">{content.interview.heading}</h2><p className="interview-description">{content.interview.description}</p><ul className="interview-details">{content.interview.details.map((detail, index) => <li key={detail.title}><span className="detail-icon"><Icon name={interviewIcons[index]} /></span><div><h3>{detail.title}</h3><p>{detail.description}</p></div></li>)}</ul><p className="interview-boundary">{content.interview.boundary}</p></div><InterviewForm copy={content.form} apiUrl={siteConfig.apiUrl} enabled={siteConfig.submissionEnabled} /></div></section>
    <section id="questions" className="section faq-section container" aria-labelledby="faq-heading"><div className="faq-intro"><p className="eyebrow">{content.faq.eyebrow}</p><h2 id="faq-heading">{content.faq.heading}</h2></div><div className="faq-list">{content.faq.items.map((item) => <details key={item.question}><summary>{item.question}<span className="faq-plus" aria-hidden="true" /></summary><p>{item.answer}</p></details>)}</div></section>
  </main>;
}
