import { NextRequest, NextResponse } from "next/server";

const SYSTEM = `You are J.A.R.V.I.S — Just A Rather Very Intelligent System, Dravide's personal AI assistant.
Be sharp, concise, slightly witty. Occasionally address the user as 'sir'.
For presentations/slides: format with clear ## Slide N: Title headers, bullet points with -, speaker notes with 📝.
For documents: use proper markdown structure with headers, tables, code blocks.
Keep responses helpful and well-formatted.`;

export async function POST(req: NextRequest) {
  const { messages, model, apiKey } = await req.json();
  if (!apiKey) return NextResponse.json({ error: "No API key provided" }, { status: 400 });

  try {
    // Claude
    if (model === "claude-sonnet" || model === "claude-haiku" || model === "claude-opus") {
      const modelMap: Record<string,string> = {
        "claude-sonnet": "claude-3-5-sonnet-20241022",
        "claude-haiku":  "claude-3-5-haiku-20241022",
        "claude-opus":   "claude-opus-4-5",
      };
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01" },
        body: JSON.stringify({ model: modelMap[model], max_tokens: 4096, system: SYSTEM, messages }),
      });
      const d = await r.json();
      if (!r.ok) return NextResponse.json({ error: d.error?.message||"Claude error" }, { status: 400 });
      return NextResponse.json({ reply: d.content[0].text });
    }

    // OpenAI
    if (model === "gpt-4o" || model === "gpt-4o-mini" || model === "o1-mini") {
      const modelMap: Record<string,string> = { "gpt-4o":"gpt-4o","gpt-4o-mini":"gpt-4o-mini","o1-mini":"o1-mini" };
      const msgs = model === "o1-mini"
        ? messages
        : [{ role:"system", content:SYSTEM }, ...messages];
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type":"application/json","Authorization":`Bearer ${apiKey}` },
        body: JSON.stringify({ model: modelMap[model], max_tokens: 4096, messages: msgs }),
      });
      const d = await r.json();
      if (!r.ok) return NextResponse.json({ error: d.error?.message||"OpenAI error" }, { status: 400 });
      return NextResponse.json({ reply: d.choices[0].message.content });
    }

    // Groq — Llama, Mixtral, Gemma, Whisper-compatible
    if (["groq-llama3","groq-llama3-8b","groq-mixtral","groq-gemma2"].includes(model)) {
      const modelMap: Record<string,string> = {
        "groq-llama3":    "llama-3.3-70b-versatile",
        "groq-llama3-8b": "llama3-8b-8192",
        "groq-mixtral":   "mixtral-8x7b-32768",
        "groq-gemma2":    "gemma2-9b-it",
      };
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type":"application/json","Authorization":`Bearer ${apiKey}` },
        body: JSON.stringify({ model: modelMap[model], max_tokens: 4096, messages: [{ role:"system",content:SYSTEM },...messages] }),
      });
      const d = await r.json();
      if (!r.ok) return NextResponse.json({ error: d.error?.message||"Groq error" }, { status: 400 });
      return NextResponse.json({ reply: d.choices[0].message.content });
    }

    // Gemini
    if (["gemini-flash","gemini-pro","gemini-flash-8b"].includes(model)) {
      const modelMap: Record<string,string> = {
        "gemini-flash":    "gemini-1.5-flash",
        "gemini-pro":      "gemini-1.5-pro",
        "gemini-flash-8b": "gemini-1.5-flash-8b",
      };
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelMap[model]}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({
          systemInstruction: { parts:[{ text:SYSTEM }] },
          contents: messages.map((m: {role:string;content:string}) => ({ role:m.role==="assistant"?"model":"user", parts:[{ text:m.content }] })),
          generationConfig: { maxOutputTokens: 4096 },
        }),
      });
      const d = await r.json();
      if (!r.ok) return NextResponse.json({ error: d.error?.message||"Gemini error" }, { status: 400 });
      return NextResponse.json({ reply: d.candidates[0].content.parts[0].text });
    }

    // xAI Grok
    if (model === "grok-beta" || model === "grok-2") {
      const r = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type":"application/json","Authorization":`Bearer ${apiKey}` },
        body: JSON.stringify({ model: model==="grok-beta"?"grok-beta":"grok-2-1212", max_tokens:4096, messages:[{ role:"system",content:SYSTEM },...messages] }),
      });
      const d = await r.json();
      if (!r.ok) return NextResponse.json({ error: d.error?.message||"Grok error" }, { status: 400 });
      return NextResponse.json({ reply: d.choices[0].message.content });
    }

    // Perplexity (sonar models with web search)
    if (model === "perplexity-sonar" || model === "perplexity-sonar-pro") {
      const r = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { "Content-Type":"application/json","Authorization":`Bearer ${apiKey}` },
        body: JSON.stringify({ model: model==="perplexity-sonar"?"llama-3.1-sonar-small-128k-online":"llama-3.1-sonar-large-128k-online", max_tokens:4096, messages:[{ role:"system",content:SYSTEM },...messages] }),
      });
      const d = await r.json();
      if (!r.ok) return NextResponse.json({ error: d.error?.message||"Perplexity error" }, { status: 400 });
      return NextResponse.json({ reply: d.choices[0].message.content });
    }

    // Mistral / Le Chat
    if (model === "mistral-large" || model === "mistral-nemo") {
      const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type":"application/json","Authorization":`Bearer ${apiKey}` },
        body: JSON.stringify({ model: model==="mistral-large"?"mistral-large-latest":"open-mistral-nemo", max_tokens:4096, messages:[{ role:"system",content:SYSTEM },...messages] }),
      });
      const d = await r.json();
      if (!r.ok) return NextResponse.json({ error: d.error?.message||"Mistral error" }, { status: 400 });
      return NextResponse.json({ reply: d.choices[0].message.content });
    }

    // Cohere Command
    if (model === "cohere-command") {
      const r = await fetch("https://api.cohere.ai/v1/chat", {
        method: "POST",
        headers: { "Content-Type":"application/json","Authorization":`Bearer ${apiKey}` },
        body: JSON.stringify({ model:"command-r-plus", preamble:SYSTEM, chat_history:messages.slice(0,-1).map((m: {role:string;content:string})=>({ role:m.role==="user"?"USER":"CHATBOT", message:m.content })), message:messages[messages.length-1].content, max_tokens:4096 }),
      });
      const d = await r.json();
      if (!r.ok) return NextResponse.json({ error: d.message||"Cohere error" }, { status: 400 });
      return NextResponse.json({ reply: d.text });
    }

    return NextResponse.json({ error: `Unknown model: ${model}` }, { status: 400 });
  } catch(e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
