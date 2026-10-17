"use client";
import { useState } from "react";
import Link from "next/link";
import { cleanBiz } from "@/lib/demo/personas";

export default function Hub() {
  const [biz, setBiz] = useState("");
  const name = cleanBiz(biz, "Skyline Realty");
  const b = encodeURIComponent(name);
  const items = [
    { href: `/demo/chat?biz=${b}`, title: "WhatsApp chatbot", body: "Customers chat and send voice notes. The AI answers by voice, shares property cards and collects their details.", tag: "Customer view" },
    { href: `/demo?v=realestate&biz=${b}`, title: "Voice call assistant", body: "A phone-style call where the AI picks up and talks, in English or Hindi.", tag: "Customer view" },
    { href: `/demo/dashboard?v=realestate&biz=${b}`, title: "Agent dashboard", body: "Every chat and call with summaries, captured leads, transcripts and stats.", tag: "Agent view" },
    { href: `/demo/agent?biz=${b}`, title: "Agent's daily report", body: "The WhatsApp messages the agent receives: instant hot-lead alerts and an evening summary.", tag: "Agent view" },
    { href: "/demo/setup", title: "Link builder", body: "Make a personalised link with your client's company name to send them.", tag: "For you" },
  ];
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1F5B4C] text-sm font-bold text-white">S</span><span className="font-semibold tracking-tight">STRIKE.AI</span></div>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">AI assistant for real estate agents</h1>
      <p className="mt-2 max-w-xl text-black/60">Try what a customer sees, then what the agent gets. Type a company name and every demo greets people with it.</p>
      <input value={biz} onChange={(e) => setBiz(e.target.value)} maxLength={40} placeholder="Skyline Realty" aria-label="Company name" className="mt-6 w-full max-w-sm rounded-xl border border-black/10 bg-white px-4 py-3 text-sm outline-none focus:border-[#1F5B4C]" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {items.map((i) => (
          <Link key={i.title} href={i.href} className="group rounded-2xl border border-black/10 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[#1F5B4C]">{i.tag}</span>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">{i.title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-black/55">{i.body}</p>
            <span className="mt-3 inline-block text-sm font-medium text-[#1F5B4C]">Open →</span>
          </Link>))}
      </div>
      <p className="mt-8 text-xs text-black/40">Demo with sample data. Properties and numbers shown are examples.</p>
    </main>
  );
}
