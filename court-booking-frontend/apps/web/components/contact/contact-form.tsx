"use client";

import { useState, type FormEvent } from "react";
import { mailtoLink, whatsappLink } from "@/lib/site-config";

const TOPICS = ["Main player hoon, madad chahiye", "Main venue list karna chahta hoon", "Payment ya refund ka masla", "Kuch aur"] as const;

type Channel = "whatsapp" | "email";
type Errors = Partial<Record<"name" | "phone" | "message", string>>;

const LABEL = "text-[14px] font-bold";
const FIELD =
  "khelo-input w-full rounded-[14px] border-[1.5px] border-khelo-border bg-khelo-surface px-[18px] py-4 text-base text-khelo-ink placeholder:text-khelo-muted-3";

/**
 * The contact form. There is no backend: nothing is stored or sent from here. "Bhejo" validates, then opens a prefilled
 * WhatsApp chat (primary) or a prefilled email draft, built from the support contact passed in by the server page.
 * `whatsapp` / `email` are plain props because client code cannot read the runtime env values.
 */
export function ContactForm({ whatsapp, email }: { whatsapp?: string; email?: string }) {
  const [errors, setErrors] = useState<Errors>({});
  const [opened, setOpened] = useState<Channel | null>(null);

  const config = { supportWhatsapp: whatsapp, supportEmail: email };
  const primary: Channel = whatsapp ? "whatsapp" : "email";
  const hasBoth = Boolean(whatsapp && email);

  function send(form: HTMLFormElement, channel: Channel) {
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const phone = String(data.get("phone") ?? "").trim();
    const topic = String(data.get("topic") ?? "").trim();
    const message = String(data.get("message") ?? "").trim();

    const next: Errors = {};
    if (!name) next.name = "Apna naam likhein.";
    if (phone && phone.replace(/[^0-9]/g, "").length < 10) next.phone = "Sahi phone number likhein, jaise 03XX XXXXXXX.";
    if (!message) next.message = "Apna sawal ya message likhein.";
    setErrors(next);
    setOpened(null);
    if (Object.keys(next).length > 0) {
      const first = (["name", "phone", "message"] as const).find((k) => next[k]);
      if (first) form.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }

    const text = [`Naam: ${name}`, phone ? `Phone: ${phone}` : null, `Mauzu: ${topic}`, "", message].filter((l) => l !== null).join("\n");
    if (channel === "whatsapp") {
      const href = whatsappLink(config, text);
      if (href) window.open(href, "_blank", "noopener,noreferrer");
    } else {
      const href = mailtoLink(config, `Khelo: ${topic}`, text);
      if (href) window.location.href = href;
    }
    setOpened(channel);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    send(e.currentTarget, primary);
  }

  const err = (key: keyof Errors) => (errors[key] ? `c-${key}-err` : undefined);

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="flex min-w-0 flex-[1_1_480px] flex-col gap-[18px] rounded-[32px] bg-khelo-surface p-6 shadow-[0_30px_60px_rgba(12,31,29,0.12)] sm:p-10"
    >
      <h2 className="font-khelo-display text-[30px] font-extrabold tracking-[-0.8px]">Message bhejein</h2>

      <div className="flex flex-col gap-2">
        <label htmlFor="c-name" className={LABEL}>
          Naam
        </label>
        <input id="c-name" name="name" className={FIELD} type="text" placeholder="Aapka naam" autoComplete="name" required aria-invalid={Boolean(errors.name)} aria-describedby={err("name")} />
        {errors.name ? (
          <p id="c-name-err" className="text-[13px] font-semibold text-khelo-orange-label">
            {errors.name}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="c-phone" className={LABEL}>
          Phone number
        </label>
        <input id="c-phone" name="phone" className={FIELD} type="tel" placeholder="03XX XXXXXXX" autoComplete="tel" aria-invalid={Boolean(errors.phone)} aria-describedby={err("phone")} />
        {errors.phone ? (
          <p id="c-phone-err" className="text-[13px] font-semibold text-khelo-orange-label">
            {errors.phone}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="c-topic" className={LABEL}>
          Mauzu
        </label>
        <select id="c-topic" name="topic" className={FIELD} defaultValue={TOPICS[0]}>
          {TOPICS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="c-message" className={LABEL}>
          Message
        </label>
        <textarea id="c-message" name="message" className={`${FIELD} resize-y`} rows={5} placeholder="Apna sawal likhein" required aria-invalid={Boolean(errors.message)} aria-describedby={err("message")} />
        {errors.message ? (
          <p id="c-message-err" className="text-[13px] font-semibold text-khelo-orange-label">
            {errors.message}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          className="khelo-btn min-h-11 cursor-pointer rounded-[14px] bg-khelo-orange px-7 py-[18px] text-[17px] font-extrabold text-khelo-ink"
        >
          Bhejo
        </button>
        {hasBoth ? (
          <button
            type="button"
            onClick={(e) => {
              const form = e.currentTarget.form;
              if (form) send(form, "email");
            }}
            className="khelo-btn min-h-11 cursor-pointer rounded-[14px] border-2 border-khelo-ink px-7 py-[18px] text-[17px] font-bold text-khelo-ink"
          >
            Email se bhejo
          </button>
        ) : null}
      </div>

      <p className="text-[13px] leading-[1.5] text-khelo-muted-2">
        {primary === "whatsapp" ? "Bhejo dabane par WhatsApp mein aapka message tayyar khulega." : "Bhejo dabane par aapke email app mein message tayyar khulega."} Yahan kuch save
        nahi hota.
      </p>

      <div aria-live="polite" role="status" className="text-[14px] font-semibold text-khelo-teal empty:hidden">
        {Object.keys(errors).length > 0 ? "Pehle upar di gayi ghaltiyan theek karein." : opened ? (opened === "whatsapp" ? "WhatsApp khul gaya hai. Wahan se message bhej dein." : "Aapka email app khul gaya hai. Wahan se message bhej dein.") : null}
      </div>
    </form>
  );
}
