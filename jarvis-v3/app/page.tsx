"use client";
import {
  addDoc,
  collection,
  serverTimestamp
} from "firebase/firestore";
import { useState, useEffect, useRef, useCallback } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { loginWithGoogle } from "@/lib/auth";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

// ─── TYPES ────────────────────────────────────────────────────────────────────
type Tab       = "home"|"chat"|"tasks"|"files"|"customize";
type Priority  = "high"|"med"|"low";
type WidgetKey = "stats"|"clock"|"weather"|"shortcuts"|"music"|"news"|"quicknote";

interface Reminder { id:number;text:string;dt:string|null;done:boolean;priority:Priority;group:string; }
interface Shortcut { label:string;url:string;icon:string;color:string; }
interface ChatMsg  { role:"user"|"assistant";content:string;model?:string; }
interface StoredFile { id:number;name:string;size:number;type:string;data:string;uploaded:number; }
interface WidgetCfg  { key:WidgetKey;label:string;enabled:boolean;order:number; }

interface AIModelDef {
  id:string; label:string; provider:string; free:boolean;
  keyName:string; placeholder:string; link:string; note:string;
}

interface Settings {
  userName:string; accent:string; activeModel:string;
  music:"spotify"|"applemusic"|"youtubemusic"|"amazonmusic";
  widgets:WidgetCfg[];
  keys:Record<string,string>;
  quickNote:string;
}

// ─── AI MODELS ────────────────────────────────────────────────────────────────
const AI_MODELS: AIModelDef[] = [
  // FREE
  { id:"groq-llama3",    label:"Llama 3.3 70B",      provider:"Groq",       free:true,  keyName:"groq",       placeholder:"gsk_...",     link:"https://console.groq.com",              note:"Fastest free model" },
  { id:"groq-llama3-8b", label:"Llama 3 8B",          provider:"Groq",       free:true,  keyName:"groq",       placeholder:"gsk_...",     link:"https://console.groq.com",              note:"Ultra fast & free" },
  { id:"groq-mixtral",   label:"Mixtral 8x7B",        provider:"Groq",       free:true,  keyName:"groq",       placeholder:"gsk_...",     link:"https://console.groq.com",              note:"Free, strong reasoning" },
  { id:"groq-gemma2",    label:"Gemma 2 9B",          provider:"Groq",       free:true,  keyName:"groq",       placeholder:"gsk_...",     link:"https://console.groq.com",              note:"Free Google model" },
  { id:"gemini-flash",   label:"Gemini 1.5 Flash",    provider:"Google",     free:true,  keyName:"gemini",     placeholder:"AIza...",     link:"https://aistudio.google.com",           note:"Free, multimodal" },
  { id:"gemini-flash-8b",label:"Gemini Flash 8B",     provider:"Google",     free:true,  keyName:"gemini",     placeholder:"AIza...",     link:"https://aistudio.google.com",           note:"Fastest Gemini" },
  { id:"gemini-pro",     label:"Gemini 1.5 Pro",      provider:"Google",     free:true,  keyName:"gemini",     placeholder:"AIza...",     link:"https://aistudio.google.com",           note:"Free, most capable" },
  // PAID
  { id:"claude-sonnet",  label:"Claude Sonnet 3.5",   provider:"Anthropic",  free:false, keyName:"claude",     placeholder:"sk-ant-...",  link:"https://console.anthropic.com",         note:"Best for coding & analysis" },
  { id:"claude-haiku",   label:"Claude Haiku 3.5",    provider:"Anthropic",  free:false, keyName:"claude",     placeholder:"sk-ant-...",  link:"https://console.anthropic.com",         note:"Fast & affordable" },
  { id:"claude-opus",    label:"Claude Opus",         provider:"Anthropic",  free:false, keyName:"claude",     placeholder:"sk-ant-...",  link:"https://console.anthropic.com",         note:"Most powerful Claude" },
  { id:"gpt-4o",         label:"GPT-4o",              provider:"OpenAI",     free:false, keyName:"openai",     placeholder:"sk-...",      link:"https://platform.openai.com",           note:"Best OpenAI model" },
  { id:"gpt-4o-mini",    label:"GPT-4o Mini",         provider:"OpenAI",     free:false, keyName:"openai",     placeholder:"sk-...",      link:"https://platform.openai.com",           note:"Cheap & capable" },
  { id:"o1-mini",        label:"o1 Mini",             provider:"OpenAI",     free:false, keyName:"openai",     placeholder:"sk-...",      link:"https://platform.openai.com",           note:"Reasoning model" },
  { id:"grok-beta",      label:"Grok Beta",           provider:"xAI",        free:false, keyName:"grok",       placeholder:"xai-...",     link:"https://console.x.ai",                  note:"Elon's AI, real-time" },
  { id:"grok-2",         label:"Grok 2",              provider:"xAI",        free:false, keyName:"grok",       placeholder:"xai-...",     link:"https://console.x.ai",                  note:"More powerful Grok" },
  { id:"perplexity-sonar",label:"Sonar (Search)",     provider:"Perplexity", free:false, keyName:"perplexity", placeholder:"pplx-...",    link:"https://www.perplexity.ai/settings/api", note:"AI + live web search" },
  { id:"perplexity-sonar-pro",label:"Sonar Pro",      provider:"Perplexity", free:false, keyName:"perplexity", placeholder:"pplx-...",    link:"https://www.perplexity.ai/settings/api", note:"Deeper research" },
  { id:"mistral-large",  label:"Mistral Large",       provider:"Mistral",    free:false, keyName:"mistral",    placeholder:"...",         link:"https://console.mistral.ai",            note:"European AI powerhouse" },
  { id:"mistral-nemo",   label:"Mistral Nemo",        provider:"Mistral",    free:false, keyName:"mistral",    placeholder:"...",         link:"https://console.mistral.ai",            note:"Compact Mistral" },
  { id:"cohere-command", label:"Command R+",          provider:"Cohere",     free:false, keyName:"cohere",     placeholder:"...",         link:"https://dashboard.cohere.com",          note:"Best for documents" },
];

const PROVIDER_COLORS: Record<string,string> = {
  Groq:"#00ff88", Google:"#4285f4", Anthropic:"#cc785c",
  OpenAI:"#10a37f", xAI:"#ffffff", Perplexity:"#22c55e",
  Mistral:"#ff7000", Cohere:"#39d3c3",
};

// ─── MUSIC SERVICES ───────────────────────────────────────────────────────────
const MUSIC_SVCS = [
  {id:"spotify",     label:"Spotify",       url:"https://open.spotify.com",        color:"#1db954",emoji:"🎵"},
  {id:"applemusic",  label:"Apple Music",   url:"https://music.apple.com",         color:"#fc3c44",emoji:"🎶"},
  {id:"youtubemusic",label:"YouTube Music", url:"https://music.youtube.com",       color:"#ff0000",emoji:"▶"},
  {id:"amazonmusic", label:"Amazon Music",  url:"https://music.amazon.com",        color:"#00a8e1",emoji:"♪"},
];

// ─── ICONS ────────────────────────────────────────────────────────────────────
const ICONS: Record<string,string> = {
  github:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>`,
  youtube:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
  linkedin:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`,
  code:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  mail:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
  globe:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>`,
  star:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  terminal:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
  book:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>`,
  music:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  figma:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 5.5A3.5 3.5 0 018.5 2H12v7H8.5A3.5 3.5 0 015 5.5zM12 2h3.5a3.5 3.5 0 110 7H12V2zM12 12.5a3.5 3.5 0 117 0 3.5 3.5 0 01-7 0zM5 19.5A3.5 3.5 0 018.5 16H12v3.5a3.5 3.5 0 11-7 0zM5 12.5A3.5 3.5 0 018.5 9H12v7H8.5A3.5 3.5 0 015 12.5z"/></svg>`,
  notion:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933z"/></svg>`,
  leetcode:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.483 0a1.374 1.374 0 0 0-.961.438L7.116 6.226l-3.854 4.126a5.266 5.266 0 0 0-1.209 2.104 5.35 5.35 0 0 0-.125.513 5.527 5.527 0 0 0 .062 2.362 5.83 5.83 0 0 0 .349 1.017 5.938 5.938 0 0 0 1.271 1.818l4.277 4.193.039.038c2.248 2.165 5.852 2.133 8.063-.074l2.396-2.392c.54-.54.54-1.414.003-1.955a1.378 1.378 0 0 0-1.951-.003l-2.396 2.392a3.021 3.021 0 0 1-4.205.038l-.02-.019-4.276-4.193c-.652-.64-.972-1.469-.948-2.263a2.68 2.68 0 0 1 .066-.523 2.545 2.545 0 0 1 .619-1.164L9.13 8.114c1.058-1.134 3.204-1.27 4.43-.278l3.501 2.831c.593.48 1.461.387 1.94-.207a1.384 1.384 0 0 0-.207-1.943l-3.5-2.831c-.8-.647-1.766-1.045-2.774-1.202l2.015-2.158A1.384 1.384 0 0 0 13.483 0zm-2.866 12.815a1.38 1.38 0 0 0-1.38 1.382 1.38 1.38 0 0 0 1.38 1.382H20.79a1.38 1.38 0 0 0 1.38-1.382 1.38 1.38 0 0 0-1.38-1.382z"/></svg>`,
};
const ICON_NAMES = Object.keys(ICONS);
const ACCENT_COLORS = ["#00d4ff","#00ff88","#ff4444","#ff8800","#aa44ff","#ff44cc","#ffdd00","#00ffcc"];
const COLORS = ["#00d4ff","#00ff88","#ff4444","#ff8800","#ff44cc","#aa44ff","#ffdd00","#ffffff"];
const GROUPS = ["All","Work","Personal","Study","Health"];
const TIMEZONES = [{l:"Chennai",tz:"Asia/Kolkata"},{l:"New York",tz:"America/New_York"},{l:"London",tz:"Europe/London"},{l:"Tokyo",tz:"Asia/Tokyo"},{l:"Dubai",tz:"Asia/Dubai"}];

const DEFAULT_WIDGETS: WidgetCfg[] = [
  {key:"stats",    label:"Task Stats",  enabled:true, order:0},
  {key:"clock",    label:"World Clock", enabled:true, order:1},
  {key:"weather",  label:"Weather",     enabled:true, order:2},
  {key:"shortcuts",label:"Quick Access",enabled:true, order:3},
  {key:"music",    label:"Music",       enabled:true, order:4},
  {key:"quicknote",label:"Quick Note",  enabled:true, order:5},
  {key:"news",     label:"News Feed",   enabled:false,order:6},
];

const DEFAULT_SHORTCUTS: Shortcut[] = [
  {label:"GitHub",  url:"https://github.com",      icon:"github",  color:"#00d4ff"},
  {label:"YouTube", url:"https://youtube.com",     icon:"youtube", color:"#ff4444"},
  {label:"LinkedIn",url:"https://linkedin.com",    icon:"linkedin",color:"#0099cc"},
  {label:"LeetCode",url:"https://leetcode.com",    icon:"leetcode",color:"#ff8800"},
  {label:"Gmail",   url:"https://mail.google.com", icon:"mail",    color:"#00ff88"},
];

const DEFAULT_SETTINGS: Settings = {
  userName:"Dravide", accent:"#00d4ff", activeModel:"groq-llama3",
  music:"spotify", widgets:DEFAULT_WIDGETS, keys:{}, quickNote:"",
};

// ─── UTILS ────────────────────────────────────────────────────────────────────
function ld<T>(k:string,fb:T):T {
  if(typeof window==="undefined")return fb;
  try{const v=localStorage.getItem("j3_"+k);return v?JSON.parse(v):fb;}catch{return fb;}
}
function sv(k:string,v:unknown){try{localStorage.setItem("j3_"+k,JSON.stringify(v));}catch{}}
function fmtDt(iso:string){return new Date(iso).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});}
function fmtSize(b:number){return b>1024*1024?`${(b/1024/1024).toFixed(1)}MB`:b>1024?`${(b/1024).toFixed(0)}KB`:`${b}B`;}
function getTZ(tz:string){return new Date().toLocaleTimeString("en-US",{timeZone:tz,hour:"2-digit",minute:"2-digit",hour12:true});}
function speak(t:string){
  if(typeof window==="undefined")return;
  window.speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(t);
  u.rate=0.94;u.pitch=0.82;u.volume=1;
  const v=window.speechSynthesis.getVoices();
  const pref=v.find(x=>x.name.includes("Google UK English Male"))||v.find(x=>x.lang==="en-GB")||v[0];
  if(pref)u.voice=pref;
  window.speechSynthesis.speak(u);
}
function getFileIcon(type:string):string {
  if(type.includes("pdf"))return "📄";
  if(type.includes("image"))return "🖼";
  if(type.includes("video"))return "🎬";
  if(type.includes("audio"))return "🎵";
  if(type.includes("text")||type.includes("document"))return "📝";
  if(type.includes("zip")||type.includes("rar"))return "📦";
  if(type.includes("spreadsheet")||type.includes("excel"))return "📊";
  if(type.includes("presentation"))return "📑";
  return "📁";
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [tab,         setTab]         = useState<Tab>("home");
  const [settings,    setSettings]    = useState<Settings>(DEFAULT_SETTINGS);
  const [shortcuts,   setShortcuts]   = useState<Shortcut[]>([]);
  const [reminders,   setReminders]   = useState<Reminder[]>([]);
  const [files,       setFiles]       = useState<StoredFile[]>([]);
  const [chatMsgs,    setChatMsgs]    = useState<ChatMsg[]>([]);
  const [chatInput,   setChatInput]   = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [now,         setNow]         = useState(new Date());
  const [weather,     setWeather]     = useState<{temp:number;desc:string;city:string;icon:string}|null>(null);
  const [filter,      setFilter]      = useState("All");
  const [showDone,    setShowDone]    = useState(false);
  const [listening,   setListening]   = useState(false);
  const [voiceBar,    setVoiceBar]    = useState("");
  const [scModal,     setScModal]     = useState(false);
  const [scEdit,      setScEdit]      = useState({label:"",url:"",icon:"globe",color:"#00d4ff"});
  const [rText,       setRText]       = useState("");
  const [rDt,         setRDt]         = useState("");
  const [rPrio,       setRPrio]       = useState<Priority>("med");
  const [rGroup,      setRGroup]      = useState("Personal");
  const [custTab,     setCustTab]     = useState<"widgets"|"theme"|"models"|"keys">("widgets");
  const [searchModel, setSearchModel] = useState("");
  const [fileSearch,  setFileSearch]  = useState("");
  const [aiOutput,    setAiOutput]    = useState("");
  const [showAiOut,   setShowAiOut]   = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileRef    = useRef<HTMLInputElement>(null);
  const saveChat = async (
  role: string,
  content: string
) => {
  if (!auth.currentUser) return;

  await addDoc(collection(db, "chats"), {
    uid: auth.currentUser.uid,
    role,
    content,
    createdAt: serverTimestamp(),
  });
};
  useEffect(() => {
  const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
    setUser(currentUser);
  });

  return () => unsubscribe();
}, []);

  // Init
  useEffect(()=>{
    setShortcuts(ld("shortcuts",DEFAULT_SHORTCUTS));
    setReminders(ld("reminders",[]));
    setFiles(ld("files",[]));
    setChatMsgs(ld("chatMsgs",[]));
    const s=ld<Settings>("settings",DEFAULT_SETTINGS);
    if(!s.widgets?.length)s.widgets=DEFAULT_WIDGETS;
    if(!s.keys)s.keys={};
    setSettings(s);
  },[]);

  useEffect(()=>{chatEndRef.current?.scrollIntoView({behavior:"smooth"});},[chatMsgs]);
  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(t);},[]);

  // Weather
  const fetchWeather=useCallback(()=>{
    if(!settings.keys.weather)return;
    navigator.geolocation?.getCurrentPosition(async pos=>{
      try{
        const r=await fetch(`/api/weather?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&key=${settings.keys.weather}`);
        const d=await r.json();
        if(d.main)setWeather({temp:Math.round(d.main.temp),desc:d.weather[0].description,city:d.name,icon:d.weather[0].icon});
      }catch{}
    });
  },[settings.keys.weather]);
  useEffect(()=>{fetchWeather();},[fetchWeather]);

  const saveSettings =(s:Settings) =>{setSettings(s); sv("settings",s);};
  const saveShortcuts=(s:Shortcut[])=>{setShortcuts(s);sv("shortcuts",s);};
  const saveReminders=(r:Reminder[])=>{setReminders(r);sv("reminders",r);};
  const saveFiles    =(f:StoredFile[])=>{setFiles(f);  sv("files",f);};
  const saveChatMsgs =(m:ChatMsg[])  =>{setChatMsgs(m);sv("chatMsgs",m);};

  const accent = settings.accent||"#00d4ff";
  const h=now.getHours();
  const greet=h<12?"MORNING":h<17?"AFTERNOON":"EVENING";
  const DAYS=["SUN","MON","TUE","WED","THU","FRI","SAT"];
  const MONS=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const active  = reminders.filter(r=>!r.done).length;
  const overdue = reminders.filter(r=>!r.done&&r.dt&&new Date(r.dt)<now).length;
  const done    = reminders.filter(r=>r.done).length;
  const wEnabled=(k:WidgetKey)=>settings.widgets.find(w=>w.key===k)?.enabled!==false;
  const sortedWidgets=[...settings.widgets].sort((a,b)=>a.order-b.order);
  const activeModel=AI_MODELS.find(m=>m.id===settings.activeModel)||AI_MODELS[0];
  const currentMusic=MUSIC_SVCS.find(m=>m.id===settings.music)||MUSIC_SVCS[0];

  // ── VOICE ──────────────────────────────────────────────────────────────────
  function startVoice(){
    const SR=(window as unknown as Record<string,unknown>).SpeechRecognition||(window as unknown as Record<string,unknown>).webkitSpeechRecognition;
    if(!SR){setVoiceBar("Voice not supported in this browser");return;}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r=new (SR as new()=>any)();
    r.continuous=false;r.interimResults=false;r.lang="en-US";
    r.onstart=()=>{setListening(true);setVoiceBar("🎤 LISTENING...");};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onresult=(e:any)=>{const t=e.results[0][0].transcript;setVoiceBar(`"${t}"`);handleVoice(t);};
    r.onerror=()=>{setListening(false);setVoiceBar("Error — try again");};
    r.onend=()=>{setListening(false);setTimeout(()=>setVoiceBar(""),4000);};
    r.start();
  }
  function handleVoice(text:string){
    const t=text.toLowerCase();
    for(const sc of shortcuts){if(t.includes(sc.label.toLowerCase())){window.open(sc.url,"_blank");speak(`Opening ${sc.label}`);return;}}
    if(t.includes("add reminder")){const m=text.replace(/add reminder/i,"").trim();if(m){saveReminders([{id:Date.now(),text:m,dt:null,done:false,priority:"med",group:"Personal"},...reminders]);speak(`Reminder added: ${m}`);return;}}
    if(t.includes("what time")){speak(`The time is ${now.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`);return;}
    if(t.includes("weather")){weather?speak(`${weather.temp} degrees in ${weather.city}, ${weather.desc}`):speak("No weather data. Add your API key in settings.");return;}
    if(t.includes("open music")){window.open(currentMusic.url,"_blank");speak(`Opening ${currentMusic.label}`);return;}
    setTab("chat");sendChat(text);
  }
  const saveChatToFirestore = async (
  role: string,
  content: string
) => {
  if (!auth.currentUser) return;

  await addDoc(collection(db, "chats"), {
    uid: auth.currentUser.uid,
    role,
    content,
    model: settings.activeModel,
    createdAt: serverTimestamp(),
  });
};

  // ── AI CHAT ────────────────────────────────────────────────────────────────
  async function sendChat(inputOverride?:string){
    const text=(inputOverride||chatInput).trim();if(!text)return;
    const apiKey=settings.keys[activeModel.keyName]||"";
    if(!apiKey){speak("Please add an API key in Customize → API Keys");setTab("customize");setCustTab("keys");return;}
    const userMsg:ChatMsg={role:"user",content:text,model:settings.activeModel};
    await saveChatToFirestore("user", text);
    const newMsgs=[...chatMsgs,userMsg];
    saveChatMsgs(newMsgs);setChatInput("");setChatLoading(true);
    try{
      const r=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:newMsgs.map(m=>({role:m.role,content:m.content})),model:settings.activeModel,apiKey})});
      const d=await r.json();
      if(d.error){const e:ChatMsg={role:"assistant",content:`⚠ ${d.error}`,model:settings.activeModel};saveChatMsgs([...newMsgs,e]);return;}
      const bot:ChatMsg={role:"assistant",content:d.reply,model:settings.activeModel};
      await saveChatToFirestore("assistant", d.reply);
      saveChatMsgs([...newMsgs,bot]);
      speak(d.reply.slice(0,160));
    }catch(e){saveChatMsgs([...newMsgs,{role:"assistant",content:`Network error: ${e}`,model:settings.activeModel}]);}
    finally{setChatLoading(false);}
  }

  // ── QUICK AI (for presentations, docs, etc.) ───────────────────────────────
  async function quickAI(prompt:string,title:string){
    const apiKey=settings.keys[activeModel.keyName]||"";
    if(!apiKey){alert("Add API key first in Customize → API Keys");return;}
    setShowAiOut(true);setAiOutput(`⏳ Generating ${title}...`);
    try{
      const r=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:[{role:"user",content:prompt}],model:settings.activeModel,apiKey})});
      const d=await r.json();
      setAiOutput(d.error?`⚠ ${d.error}`:d.reply);
    }catch(e){setAiOutput(`Error: ${e}`);}
  }

  // ── REMINDERS ──────────────────────────────────────────────────────────────
  function addReminder(){
    if(!rText.trim())return;
    saveReminders([{id:Date.now(),text:rText.trim(),dt:rDt||null,done:false,priority:rPrio,group:rGroup},...reminders]);
    setRText("");setRDt("");
  }
  const filtRem=reminders
    .filter(r=>filter==="All"||r.group===filter)
    .filter(r=>showDone||!r.done)
    .sort((a,b)=>{
      if(a.done!==b.done)return a.done?1:-1;
      const pd:Record<Priority,number>={high:0,med:1,low:2};
      if(pd[a.priority]!==pd[b.priority])return pd[a.priority]-pd[b.priority];
      if(a.dt&&b.dt)return new Date(a.dt).getTime()-new Date(b.dt).getTime();
      return a.dt?-1:b.dt?1:0;
    });

  // ── FILES ──────────────────────────────────────────────────────────────────
  function handleFileUpload(e:React.ChangeEvent<HTMLInputElement>){
    const fs=Array.from(e.target.files||[]);
    fs.forEach(file=>{
      const reader=new FileReader();
      reader.onload=ev=>{
        const newFile:StoredFile={id:Date.now()+Math.random(),name:file.name,size:file.size,type:file.type,data:ev.target?.result as string,uploaded:Date.now()};
        setFiles(prev=>{const updated=[newFile,...prev];sv("files",updated);return updated;});
      };
      reader.readAsDataURL(file);
    });
    if(fileRef.current)fileRef.current.value="";
  }
  function deleteFile(id:number){if(confirm("Delete file?"))saveFiles(files.filter(f=>f.id!==id));}
  function downloadFile(f:StoredFile){const a=document.createElement("a");a.href=f.data;a.download=f.name;a.click();}
  const filtFiles=files.filter(f=>f.name.toLowerCase().includes(fileSearch.toLowerCase()));

  // ── WIDGET TOGGLE & REORDER ────────────────────────────────────────────────
  function toggleWidget(key:WidgetKey){
    const updated=settings.widgets.map(w=>w.key===key?{...w,enabled:!w.enabled}:w);
    saveSettings({...settings,widgets:updated});
  }
  function moveWidget(key:WidgetKey,dir:-1|1){
    const ws=[...settings.widgets].sort((a,b)=>a.order-b.order);
    const idx=ws.findIndex(w=>w.key===key);
    const ni=idx+dir;if(ni<0||ni>=ws.length)return;
    const reordered=ws.map((w,i)=>{if(i===idx)return{...w,order:ws[ni].order};if(i===ni)return{...w,order:ws[idx].order};return w;});
    saveSettings({...settings,widgets:reordered});
  }

  // ── STYLES HELPERS ─────────────────────────────────────────────────────────
  const P=(extra?:React.CSSProperties):React.CSSProperties=>({background:"rgba(0,14,30,0.85)",border:`1px solid ${accent}28`,borderRadius:"14px",backdropFilter:"blur(18px)",WebkitBackdropFilter:"blur(18px)",position:"relative",overflow:"hidden",padding:"18px",...extra});
  const filteredModels=AI_MODELS.filter(m=>m.label.toLowerCase().includes(searchModel.toLowerCase())||m.provider.toLowerCase().includes(searchModel.toLowerCase()));
  const providers=[...new Set(AI_MODELS.map(m=>m.provider))];

  const NAV=[{id:"home" as Tab,icon:"⌂",label:"HOME"},{id:"chat" as Tab,icon:"◈",label:"AI"},{id:"tasks" as Tab,icon:"☑",label:"TASKS"},{id:"files" as Tab,icon:"📁",label:"FILES"},{id:"customize" as Tab,icon:"⚙",label:"SETUP"}];

  return (
    <div style={{position:"relative",zIndex:1,minHeight:"100vh",paddingBottom:"68px"}}>
    <button
  onClick={async () => {
    try {
      const user = await loginWithGoogle();
      await setDoc(doc(db, "users", user.uid), {
          uid: user.uid,
          name: user.displayName,
          email: user.email,
          photo: user.photoURL,
          lastLogin: Date.now(),
        });
      console.log("Logged in:", user);
      alert(`Welcome ${user.displayName}`);
    } catch (error) {
      console.error(error);
    }
  }}
>
  Login with Google
</button>

      {/* ── TOP BAR ── */}
      <div style={{borderBottom:`1px solid ${accent}22`,background:"rgba(0,0,0,0.96)",backdropFilter:"blur(16px)",padding:"9px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:50}}>
        <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
          <div className="font-orb flicker" style={{fontSize:"15px",fontWeight:700,color:accent,textShadow:`0 0 12px ${accent}, 0 0 24px ${accent}66`}}>J.A.R.V.I.S</div>
          <div style={{display:"flex",alignItems:"center",gap:"5px",fontSize:"9px",color:`${accent}55`,fontFamily:"'Share Tech Mono'"}}>
            <span style={{width:"5px",height:"5px",borderRadius:"50%",background:"#00ff88",display:"inline-block",boxShadow:"0 0 5px #00ff88",animation:"pulse 2s infinite"}}/>
            {greet} PROTOCOL
          </div>
        </div>
        <div className="font-orb" style={{fontSize:"13px",color:"#00ffff",letterSpacing:"0.1em",textShadow:"0 0 8px #00ffff66"}} suppressHydrationWarning>
          {now.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
          <button onClick={startVoice} disabled={listening} title="Voice command"
            style={{width:"30px",height:"30px",borderRadius:"7px",border:`1px solid ${listening?"#00ff88":accent+"44"}`,background:listening?"rgba(0,255,136,0.12)":"transparent",color:listening?"#00ff88":accent,cursor:"pointer",fontSize:"13px",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.2s"}}>
            🎤
          </button>
          <div style={{fontSize:"9px",color:`${accent}55`,textAlign:"right",fontFamily:"'Share Tech Mono'"}}>
            <div>{DAYS[now.getDay()]} {now.getDate()} {MONS[now.getMonth()]} {now.getFullYear()}</div>
            <div style={{color:`${accent}33`}}>{settings.userName.toUpperCase()} // ONLINE</div>
          </div>
        </div>
      </div>

      {voiceBar&&<div style={{background:"rgba(0,255,136,0.06)",borderBottom:"1px solid rgba(0,255,136,0.15)",padding:"5px 16px",fontSize:"11px",color:"#00ff88",textAlign:"center"}}>{voiceBar}</div>}

      <div style={{maxWidth:"1100px",margin:"0 auto",padding:"14px 13px 10px"}}>

        {/* ══════════ HOME ══════════ */}
        {tab==="home"&&(
          <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
            {sortedWidgets.filter(w=>w.enabled).map(w=>{
              if(w.key==="stats") return (
                <div key="stats" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"10px"}}>
                  {[{l:"ACTIVE",v:active,c:accent},{l:"OVERDUE",v:overdue,c:overdue>0?"#ff4444":accent},{l:"DONE",v:done,c:"#00ff88"}].map(s=>(
                    <div key={s.l} style={P({padding:"12px",textAlign:"center"})}>
                      <div className="c-tl"/><div className="c-tr"/><div className="c-bl"/><div className="c-br"/>
                      <div className="font-orb" style={{fontSize:"26px",fontWeight:700,color:s.c,textShadow:`0 0 14px ${s.c}88`}}>{s.v}</div>
                      <div style={{fontSize:"9px",color:`${accent}66`,letterSpacing:"0.1em",marginTop:"3px"}}>{s.l}</div>
                    </div>
                  ))}
                </div>
              );
              if(w.key==="clock"||w.key==="weather") return null; // rendered together below
              if(w.key==="shortcuts") return (
                <div key="shortcuts" style={P()}>
                  <div className="c-tl"/><div className="c-tr"/><div className="c-bl"/><div className="c-br"/>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"12px"}}>
                    <div className="sec-label" style={{marginBottom:0}}>QUICK ACCESS</div>
                    <button className="jbtn" style={{fontSize:"9px",padding:"4px 10px"}} onClick={()=>setScModal(true)}>+ ADD</button>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(76px,1fr))",gap:"8px"}}>
                    {shortcuts.map((s,i)=>(
                      <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="sc-card">
                        <button className="sc-del" onClick={e=>{e.preventDefault();e.stopPropagation();if(confirm(`Remove ${s.label}?`))saveShortcuts(shortcuts.filter((_,j)=>j!==i));}}
                          style={{position:"absolute",top:"3px",right:"3px",width:"16px",height:"16px",borderRadius:"50%",background:"rgba(255,68,68,0.2)",border:"1px solid rgba(255,68,68,0.3)",color:"#ff6666",fontSize:"9px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",opacity:0,transition:"opacity 0.2s"}}>✕</button>
                        <div style={{width:"24px",height:"24px",color:s.color,filter:`drop-shadow(0 0 4px ${s.color}88)`}} dangerouslySetInnerHTML={{__html:ICONS[s.icon]||ICONS.globe}}/>
                        <span style={{fontSize:"9px",color:`${accent}cc`,textAlign:"center",lineHeight:1.2,fontFamily:"'Share Tech Mono'"}}>{s.label}</span>
                      </a>
                    ))}
                  </div>
                </div>
              );
              if(w.key==="music") return (
                <div key="music" style={P()}>
                  <div className="c-tl"/><div className="c-tr"/><div className="c-bl"/><div className="c-br"/>
                  <div className="sec-label">MUSIC</div>
                  <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
                    {MUSIC_SVCS.map(m=>(
                      <a key={m.id} href={m.url} target="_blank" rel="noopener noreferrer"
                        style={{display:"flex",alignItems:"center",gap:"8px",padding:"9px 14px",background:settings.music===m.id?`${m.color}14`:"rgba(0,10,24,0.6)",border:`1px solid ${settings.music===m.id?m.color+"55":`${accent}14`}`,borderRadius:"8px",textDecoration:"none",color:settings.music===m.id?m.color:`${accent}77`,fontSize:"11px",transition:"all 0.2s",fontFamily:"'Share Tech Mono'"}}>
                        <span>{m.emoji}</span>{m.label}
                        {settings.music===m.id&&<span style={{fontSize:"8px",fontFamily:"'Orbitron'"}}>✓</span>}
                      </a>
                    ))}
                  </div>
                </div>
              );
              if(w.key==="quicknote") return (
                <div key="quicknote" style={P()}>
                  <div className="c-tl"/><div className="c-tr"/><div className="c-bl"/><div className="c-br"/>
                  <div className="sec-label">QUICK NOTE</div>
                  <textarea className="ji" placeholder="Type a quick note…" value={settings.quickNote}
                    onChange={e=>saveSettings({...settings,quickNote:e.target.value})}
                    style={{minHeight:"90px",resize:"vertical",lineHeight:1.5}}/>
                </div>
              );
              if(w.key==="news") return (
                <div key="news" style={P()}>
                  <div className="c-tl"/><div className="c-tr"/><div className="c-bl"/><div className="c-br"/>
                  <div className="sec-label">NEWS FEED</div>
                  <div style={{fontSize:"10px",color:`${accent}44`,textAlign:"center",padding:"16px 0"}}>
                    📰 Requires GNews API key — add at gnews.io<br/>
                    <button onClick={()=>{setTab("customize");setCustTab("keys");}} style={{marginTop:"8px",fontSize:"9px",color:accent,background:"none",border:`1px solid ${accent}33`,borderRadius:"5px",padding:"3px 10px",cursor:"pointer"}}>ADD KEY →</button>
                  </div>
                </div>
              );
              return null;
            })}
            {/* Clock + Weather side by side */}
            {(wEnabled("clock")||wEnabled("weather"))&&(
              <div style={{display:"grid",gridTemplateColumns:wEnabled("clock")&&wEnabled("weather")?"1fr 1fr":"1fr",gap:"12px"}}>
                {wEnabled("clock")&&(
                  <div style={P()}>
                    <div className="c-tl"/><div className="c-tr"/><div className="c-bl"/><div className="c-br"/>
                    <div className="sec-label">WORLD CLOCK</div>
                    {TIMEZONES.map(tz=>(
                      <div key={tz.tz} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 8px",background:"rgba(0,8,20,0.6)",borderRadius:"6px",border:`1px solid ${accent}14`,marginBottom:"4px"}}>
                        <span style={{fontSize:"10px",color:`${accent}77`}}>{tz.l}</span>
                        <span className="font-orb" style={{fontSize:"11px",color:"#00ffff",letterSpacing:"0.04em"}}>{getTZ(tz.tz)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {wEnabled("weather")&&(
                  <div style={P()}>
                    <div className="c-tl"/><div className="c-tr"/><div className="c-bl"/><div className="c-br"/>
                    <div className="sec-label">WEATHER</div>
                    {weather?(
                      <>
                        <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                          <img src={`https://openweathermap.org/img/wn/${weather.icon}@2x.png`} alt="" style={{width:"44px",filter:`drop-shadow(0 0 6px ${accent}88)`}}/>
                          <div>
                            <div className="font-orb" style={{fontSize:"26px",color:"#00ffff",textShadow:"0 0 10px #00ffff66"}}>{weather.temp}°C</div>
                            <div style={{fontSize:"10px",color:`${accent}88`,textTransform:"capitalize"}}>{weather.desc}</div>
                          </div>
                        </div>
                        <div style={{fontSize:"9px",color:`${accent}44`,borderTop:`1px solid ${accent}14`,paddingTop:"8px",marginTop:"8px"}}>📍 {weather.city}</div>
                      </>
                    ):(
                      <div style={{textAlign:"center",padding:"12px 0"}}>
                        <div style={{fontSize:"20px",marginBottom:"6px"}}>🌡</div>
                        <div style={{fontSize:"10px",color:`${accent}44`,marginBottom:"8px"}}>Add OpenWeatherMap key</div>
                        <button onClick={()=>{setTab("customize");setCustTab("keys");}} className="jbtn" style={{fontSize:"8px",padding:"4px 10px"}}>ADD KEY</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══════════ AI CHAT ══════════ */}
        {tab==="chat"&&(
          <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
            {/* Quick actions */}
            <div style={P({padding:"14px"})}>
              <div className="c-tl"/><div className="c-tr"/>
              <div style={{display:"flex",gap:"6px",flexWrap:"wrap",alignItems:"center"}}>
                <span style={{fontSize:"9px",color:`${accent}66`,fontFamily:"'Orbitron'",letterSpacing:"0.08em",marginRight:"4px"}}>QUICK:</span>
                {[
                  {label:"📊 Make Presentation",prompt:"Create a professional presentation outline with 8 slides on the topic: Artificial Intelligence in Software Development. Format with ## Slide N: Title, bullet points, and 📝 Speaker notes."},
                  {label:"📝 Write Resume",      prompt:"Write a strong professional resume summary and key skills section for a software engineer with expertise in full-stack development, DSA, and system design."},
                  {label:"📋 Study Plan",        prompt:"Create a structured 7-day study plan for mastering Data Structures and Algorithms for technical interviews. Include daily topics, resources, and practice problems."},
                  {label:"🔍 Research Topic",    prompt:"Give me a comprehensive research summary on: "},
                  {label:"💡 Code Review",       prompt:"Review this code for bugs, performance, and best practices:\n\n"},
                ].map(q=>(
                  <button key={q.label} onClick={()=>{setChatInput(q.prompt);}} className="jbtn" style={{fontSize:"9px",padding:"5px 10px",borderColor:`${accent}44`,color:`${accent}cc`}}>
                    {q.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Chat panel */}
            <div style={P()}>
              <div className="c-tl"/><div className="c-tr"/><div className="c-bl"/><div className="c-br"/>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"12px",flexWrap:"wrap",gap:"8px"}}>
                <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                  <div className="sec-label" style={{marginBottom:0}}>AI CORE</div>
                  <div style={{fontSize:"9px",padding:"3px 8px",borderRadius:"4px",background:`${PROVIDER_COLORS[activeModel.provider]||accent}18`,border:`1px solid ${PROVIDER_COLORS[activeModel.provider]||accent}44`,color:PROVIDER_COLORS[activeModel.provider]||accent,fontFamily:"'Share Tech Mono'"}}>
                    {activeModel.label}
                    {activeModel.free&&<span style={{color:"#00ff88",marginLeft:"4px"}}>★</span>}
                  </div>
                </div>
                <div style={{display:"flex",gap:"5px"}}>
                  <button onClick={()=>{setTab("customize");setCustTab("models");}} className="jbtn" style={{fontSize:"8px",padding:"4px 8px"}}>SWITCH MODEL</button>
                  <button onClick={()=>{saveChatMsgs([]);}} className="jbtn danger" style={{fontSize:"8px",padding:"4px 8px"}}>CLEAR</button>
                </div>
              </div>
              <div style={{height:"380px",overflowY:"auto",display:"flex",flexDirection:"column",gap:"8px",marginBottom:"10px",padding:"2px"}}>
                {chatMsgs.length===0&&(
                  <div style={{textAlign:"center",padding:"50px 16px",color:`${accent}44`}}>
                    <div style={{fontSize:"40px",marginBottom:"10px",textShadow:`0 0 20px ${accent}66`}}>◈</div>
                    <div className="font-orb" style={{fontSize:"11px",letterSpacing:"0.1em",color:`${accent}88`}}>J.A.R.V.I.S ONLINE</div>
                    <div style={{fontSize:"10px",marginTop:"6px"}}>How can I assist you, sir?</div>
                    <div style={{fontSize:"9px",marginTop:"14px",color:`${accent}33`,lineHeight:1.7}}>
                      Try: "Make a presentation on AI"<br/>
                      Or: "Explain binary search with code"<br/>
                      ★ Free models: Groq (Llama 3) + Gemini
                    </div>
                  </div>
                )}
                {chatMsgs.map((m,i)=>(
                  <div key={i} className="slide-in" style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
                    <div className={m.role==="user"?"chat-user":"chat-ai"} style={{maxWidth:"84%",padding:"9px 13px",fontSize:"12px",color:m.role==="user"?"#00ffff":"#d8eeff",lineHeight:1.55,fontFamily:"'Share Tech Mono'",whiteSpace:"pre-wrap"}}>
                      {m.role==="assistant"&&(
                        <div className="font-orb" style={{fontSize:"8px",color:`${accent}55`,marginBottom:"4px",letterSpacing:"0.06em"}}>
                          J.A.R.V.I.S · {AI_MODELS.find(a=>a.id===m.model)?.label||activeModel.label}
                        </div>
                      )}
                      {m.content}
                    </div>
                  </div>
                ))}
                {chatLoading&&(
                  <div style={{display:"flex",justifyContent:"flex-start"}}>
                    <div className="chat-ai" style={{padding:"9px 13px",color:`${accent}77`,fontSize:"11px",display:"flex",alignItems:"center",gap:"6px"}}>
                      <span className="spin" style={{display:"inline-block"}}>◌</span> PROCESSING...
                    </div>
                  </div>
                )}
                <div ref={chatEndRef}/>
              </div>
              <div style={{display:"flex",gap:"7px"}}>
                <input className="ji" placeholder="Enter directive… (Enter to send)" value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendChat();}}} style={{flex:1}}/>
                <button onClick={startVoice} disabled={listening} style={{padding:"9px 11px",background:listening?"rgba(0,255,136,0.1)":"transparent",border:`1px solid ${listening?"#00ff88":accent+"44"}`,borderRadius:"8px",color:listening?"#00ff88":accent,cursor:"pointer",fontSize:"13px",transition:"all 0.2s"}}>🎤</button>
                <button className="jbtn prim" onClick={()=>sendChat()} disabled={chatLoading}>SEND</button>
              </div>
            </div>

            {/* AI Output panel for generated content */}
            {showAiOut&&(
              <div style={P()}>
                <div className="c-tl"/><div className="c-tr"/><div className="c-bl"/><div className="c-br"/>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"}}>
                  <div className="sec-label" style={{marginBottom:0}}>GENERATED OUTPUT</div>
                  <div style={{display:"flex",gap:"5px"}}>
                    <button className="jbtn" style={{fontSize:"8px",padding:"4px 8px"}} onClick={()=>{navigator.clipboard.writeText(aiOutput);}}>COPY</button>
                    <button className="jbtn danger" style={{fontSize:"8px",padding:"4px 8px"}} onClick={()=>setShowAiOut(false)}>CLOSE</button>
                  </div>
                </div>
                <pre style={{fontSize:"11px",color:"#c8eeff",whiteSpace:"pre-wrap",lineHeight:1.6,maxHeight:"320px",overflowY:"auto",fontFamily:"'Share Tech Mono'"}}>{aiOutput}</pre>
              </div>
            )}

            {/* Quick AI tools */}
            <div style={P({padding:"14px"})}>
              <div className="c-tl"/><div className="c-tr"/>
              <div className="sec-label">AI TOOLS</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:"8px"}}>
                {[
                  {icon:"📊",label:"Presentation Maker",fn:()=>quickAI("Create a detailed professional presentation with 8 slides on 'AI in Modern Software Development'. Use ## Slide N: Title format, bullet points, and 📝 Speaker notes for each slide.","Presentation")},
                  {icon:"📄",label:"Resume Writer",     fn:()=>quickAI("Write a complete professional resume for a software engineering student with skills in JavaScript, Python, React, Node.js, DSA, and system design. Include summary, skills, projects, and education sections.","Resume")},
                  {icon:"📚",label:"Study Plan",        fn:()=>quickAI("Create a comprehensive 30-day study plan for cracking technical interviews at top tech companies. Include DSA, system design, behavioral prep with daily schedule.","Study Plan")},
                  {icon:"🐛",label:"Debug Helper",      fn:()=>{setChatInput("Help me debug this code:\n\n");setTab("chat");}},
                  {icon:"📝",label:"Summarizer",        fn:()=>{setChatInput("Summarize this in bullet points:\n\n");setTab("chat");}},
                  {icon:"🌐",label:"Translate",         fn:()=>{setChatInput("Translate to English:\n\n");setTab("chat");}},
                  {icon:"📧",label:"Email Writer",      fn:()=>{setChatInput("Write a professional email for:\n\n");setTab("chat");}},
                  {icon:"💡",label:"Explain Concept",   fn:()=>{setChatInput("Explain this concept simply:\n\n");setTab("chat");}},
                ].map(t=>(
                  <button key={t.label} onClick={t.fn}
                    style={{display:"flex",alignItems:"center",gap:"8px",padding:"10px 12px",background:"rgba(0,10,24,0.6)",border:`1px solid ${accent}18`,borderRadius:"8px",color:`${accent}cc`,cursor:"pointer",fontSize:"11px",fontFamily:"'Share Tech Mono'",transition:"all 0.15s",textAlign:"left"}}
                    onMouseOver={e=>{(e.currentTarget as HTMLElement).style.borderColor=`${accent}55`;(e.currentTarget as HTMLElement).style.background="rgba(0,20,40,0.8)";}}
                    onMouseOut={e=>{(e.currentTarget as HTMLElement).style.borderColor=`${accent}18`;(e.currentTarget as HTMLElement).style.background="rgba(0,10,24,0.6)";}}>
                    <span style={{fontSize:"18px"}}>{t.icon}</span>{t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ══════════ TASKS ══════════ */}
        {tab==="tasks"&&(
          <div style={P()}>
            <div className="c-tl"/><div className="c-tr"/><div className="c-bl"/><div className="c-br"/>
            <div className="sec-label">TASK PROTOCOL</div>
            <div style={{display:"flex",flexDirection:"column",gap:"7px",marginBottom:"12px",background:"rgba(0,8,20,0.7)",border:`1px solid ${accent}18`,borderRadius:"10px",padding:"12px"}}>
              <input className="ji" placeholder="+ New directive…" value={rText} onChange={e=>setRText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addReminder()}/>
              <div style={{display:"flex",gap:"7px",flexWrap:"wrap"}}>
                <input className="ji" type="datetime-local" value={rDt} onChange={e=>setRDt(e.target.value)} style={{flex:"1",minWidth:"160px"}}/>
                <select className="ji" value={rPrio} onChange={e=>setRPrio(e.target.value as Priority)} style={{flex:"none",width:"auto"}}>
                  <option value="high">⬥ HIGH</option><option value="med">⬦ MED</option><option value="low">○ LOW</option>
                </select>
                <select className="ji" value={rGroup} onChange={e=>setRGroup(e.target.value)} style={{flex:"none",width:"auto"}}>
                  {GROUPS.filter(g=>g!=="All").map(g=><option key={g}>{g}</option>)}
                </select>
                <button className="jbtn prim" onClick={addReminder}>ADD</button>
              </div>
            </div>
            <div style={{display:"flex",gap:"5px",marginBottom:"10px",flexWrap:"wrap",alignItems:"center"}}>
              {GROUPS.map(g=>(
                <button key={g} onClick={()=>setFilter(g)} className="font-orb"
                  style={{fontSize:"8px",padding:"4px 10px",borderRadius:"6px",border:`1px solid ${filter===g?accent:`${accent}1a`}`,background:filter===g?`${accent}14`:"transparent",color:filter===g?accent:`${accent}44`,cursor:"pointer",letterSpacing:"0.06em",transition:"all 0.15s"}}>
                  {g}
                </button>
              ))}
              <button onClick={()=>setShowDone(!showDone)} style={{marginLeft:"auto",fontSize:"9px",padding:"4px 9px",borderRadius:"6px",border:`1px solid ${accent}1a`,background:"transparent",color:`${accent}44`,cursor:"pointer",fontFamily:"'Share Tech Mono'"}}>
                {showDone?"HIDE DONE":"SHOW DONE"}
              </button>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:"5px",maxHeight:"400px",overflowY:"auto"}}>
              {filtRem.length===0?(
                <div style={{textAlign:"center",padding:"28px",color:`${accent}33`,fontSize:"11px"}}>
                  <div style={{fontSize:"22px",marginBottom:"6px"}}>◈</div>NO ACTIVE DIRECTIVES
                </div>
              ):filtRem.map(r=>{
                const od=r.dt&&!r.done&&new Date(r.dt)<now;
                return(
                  <div key={r.id} className="slide-in" style={{display:"flex",alignItems:"flex-start",gap:"10px",padding:"9px 11px",background:r.done?"rgba(0,255,136,0.03)":od?"rgba(255,68,68,0.04)":"rgba(0,8,20,0.6)",border:`1px solid ${r.done?"rgba(0,255,136,0.12)":od?"rgba(255,68,68,0.22)":`${accent}14`}`,borderRadius:"9px",transition:"all 0.15s"}}>
                    <div className={`ios-check ${r.done?"done":""}`} onClick={()=>saveReminders(reminders.map(x=>x.id===r.id?{...x,done:!x.done}:x))}>
                      {r.done&&<svg viewBox="0 0 24 24" style={{width:"12px",height:"12px",stroke:"#020810",fill:"none",strokeWidth:3}}><polyline points="20 6 9 17 4 12"/></svg>}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:"6px",flexWrap:"wrap"}}>
                        <span style={{fontSize:"12px",color:r.done?"rgba(0,255,136,0.4)":"#d8eeff",textDecoration:r.done?"line-through":"none",fontFamily:"'Share Tech Mono'"}}>{r.text}</span>
                        <span className={`badge badge-${r.priority}`}>{r.priority.toUpperCase()}</span>
                        {od&&<span className="badge badge-over">OVERDUE</span>}
                      </div>
                      <div style={{display:"flex",gap:"8px",marginTop:"3px"}}>
                        {r.dt&&<span style={{fontSize:"9px",color:od?"#ff6666":`${accent}44`}}>⏱ {fmtDt(r.dt)}</span>}
                        <span style={{fontSize:"9px",color:`${accent}33`}}>{r.group}</span>
                      </div>
                    </div>
                    <button onClick={()=>saveReminders(reminders.filter(x=>x.id!==r.id))} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(255,68,68,0.3)",fontSize:"14px",padding:"0",lineHeight:1,transition:"color 0.15s"}} onMouseOver={e=>(e.currentTarget.style.color="#ff4444")} onMouseOut={e=>(e.currentTarget.style.color="rgba(255,68,68,0.3)")}>✕</button>
                  </div>
                );
              })}
            </div>
            {done>0&&<button onClick={()=>saveReminders(reminders.filter(r=>!r.done))} className="jbtn danger" style={{marginTop:"10px",fontSize:"9px",padding:"5px 12px"}}>PURGE {done} DONE</button>}
          </div>
        )}

        {/* ══════════ FILES ══════════ */}
        {tab==="files"&&(
          <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
            <div style={P({padding:"14px"})}>
              <div className="c-tl"/><div className="c-tr"/>
              <div style={{display:"flex",gap:"10px",alignItems:"center",flexWrap:"wrap"}}>
                <button className="jbtn prim" onClick={()=>fileRef.current?.click()}>⬆ UPLOAD FILES</button>
                <input ref={fileRef} type="file" multiple style={{display:"none"}} onChange={handleFileUpload}/>
                <input className="ji" placeholder="Search files…" value={fileSearch} onChange={e=>setFileSearch(e.target.value)} style={{flex:1,minWidth:"160px"}}/>
                <div style={{fontSize:"10px",color:`${accent}44`,fontFamily:"'Share Tech Mono'"}}>{files.length} files · {fmtSize(files.reduce((a,f)=>a+f.size,0))} total</div>
              </div>
            </div>
            <div style={P()}>
              <div className="c-tl"/><div className="c-tr"/><div className="c-bl"/><div className="c-br"/>
              <div className="sec-label">STORED FILES</div>
              {filtFiles.length===0?(
                <div style={{textAlign:"center",padding:"32px",color:`${accent}33`}}>
                  <div style={{fontSize:"28px",marginBottom:"8px"}}>📁</div>
                  <div style={{fontSize:"11px"}}>No files stored yet</div>
                  <div style={{fontSize:"9px",marginTop:"4px",color:`${accent}22`}}>Files are stored in your browser's localStorage</div>
                </div>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:"6px",maxHeight:"440px",overflowY:"auto"}}>
                  {filtFiles.map(f=>(
                    <div key={f.id} className="file-item slide-in">
                      <span style={{fontSize:"22px",flexShrink:0}}>{getFileIcon(f.type)}</span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:"12px",color:"#d8eeff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontFamily:"'Share Tech Mono'"}}>{f.name}</div>
                        <div style={{fontSize:"9px",color:`${accent}44`,marginTop:"2px"}}>{fmtSize(f.size)} · {new Date(f.uploaded).toLocaleDateString()}</div>
                      </div>
                      <div style={{display:"flex",gap:"5px"}}>
                        {f.type.includes("pdf")&&(
                          <button className="jbtn" style={{fontSize:"8px",padding:"4px 8px"}} onClick={()=>window.open(f.data,"_blank")}>VIEW</button>
                        )}
                        {(f.type.includes("image"))&&(
                          <button className="jbtn" style={{fontSize:"8px",padding:"4px 8px"}} onClick={()=>window.open(f.data,"_blank")}>VIEW</button>
                        )}
                        <button className="jbtn" style={{fontSize:"8px",padding:"4px 8px"}} onClick={()=>downloadFile(f)}>DL</button>
                        <button className="jbtn danger" style={{fontSize:"8px",padding:"4px 8px"}} onClick={()=>deleteFile(f.id)}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════ CUSTOMIZE ══════════ */}
        {tab==="customize"&&(
          <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
            {/* Sub-nav */}
            <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
              {([
                {id:"widgets"  as const,label:"📦 WIDGETS"},
                {id:"theme"    as const,label:"🎨 THEME"},
                {id:"models"   as const,label:"🤖 AI MODELS"},
                {id:"keys"     as const,label:"🔑 API KEYS"},
              ]).map(ct=>(
                <button key={ct.id} onClick={()=>setCustTab(ct.id)} className="font-orb"
                  style={{fontSize:"9px",padding:"7px 14px",borderRadius:"7px",border:`1px solid ${custTab===ct.id?accent:`${accent}1a`}`,background:custTab===ct.id?`${accent}14`:"transparent",color:custTab===ct.id?accent:`${accent}44`,cursor:"pointer",letterSpacing:"0.06em",transition:"all 0.15s"}}>
                  {ct.label}
                </button>
              ))}
            </div>

            {/* WIDGETS */}
            {custTab==="widgets"&&(
              <div style={P()}>
                <div className="c-tl"/><div className="c-tr"/><div className="c-bl"/><div className="c-br"/>
                <div className="sec-label">WIDGET MANAGER</div>
                <div style={{fontSize:"10px",color:`${accent}44`,marginBottom:"12px"}}>Toggle widgets on/off and reorder them on your home screen.</div>
                <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                  {sortedWidgets.map((w,i)=>(
                    <div key={w.key} style={{display:"flex",alignItems:"center",gap:"10px",padding:"10px 12px",background:"rgba(0,8,20,0.6)",border:`1px solid ${w.enabled?accent+"22":`${accent}0e`}`,borderRadius:"9px",transition:"all 0.15s"}}>
                      <div style={{display:"flex",flexDirection:"column",gap:"2px"}}>
                        <button onClick={()=>moveWidget(w.key,-1)} disabled={i===0} style={{background:"none",border:"none",color:i===0?`${accent}22`:`${accent}66`,cursor:i===0?"default":"pointer",fontSize:"11px",lineHeight:1,padding:"1px"}}>▲</button>
                        <button onClick={()=>moveWidget(w.key,1)} disabled={i===sortedWidgets.length-1} style={{background:"none",border:"none",color:i===sortedWidgets.length-1?`${accent}22`:`${accent}66`,cursor:i===sortedWidgets.length-1?"default":"pointer",fontSize:"11px",lineHeight:1,padding:"1px"}}>▼</button>
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:"12px",color:w.enabled?"#d8eeff":`${accent}44`,fontFamily:"'Share Tech Mono'"}}>{w.label}</div>
                        <div style={{fontSize:"9px",color:`${accent}33`}}>{w.key}</div>
                      </div>
                      <div className={`tog ${w.enabled?"on":""}`} onClick={()=>toggleWidget(w.key)}/>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* THEME */}
            {custTab==="theme"&&(
              <div style={P()}>
                <div className="c-tl"/><div className="c-tr"/><div className="c-bl"/><div className="c-br"/>
                <div className="sec-label">APPEARANCE</div>
                <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
                  <div>
                    <div className="font-orb" style={{fontSize:"9px",color:`${accent}77`,marginBottom:"8px",letterSpacing:"0.08em"}}>YOUR NAME</div>
                    <input className="ji" value={settings.userName} onChange={e=>saveSettings({...settings,userName:e.target.value})} placeholder="Your name"/>
                  </div>
                  <div>
                    <div className="font-orb" style={{fontSize:"9px",color:`${accent}77`,marginBottom:"8px",letterSpacing:"0.08em"}}>ACCENT COLOR</div>
                    <div style={{display:"flex",gap:"8px",flexWrap:"wrap",alignItems:"center"}}>
                      {ACCENT_COLORS.map(c=>(
                        <button key={c} onClick={()=>saveSettings({...settings,accent:c})}
                          style={{width:"30px",height:"30px",borderRadius:"50%",border:`2px solid ${settings.accent===c?"#fff":"transparent"}`,background:c,cursor:"pointer",boxShadow:settings.accent===c?`0 0 10px ${c}`:"none",transition:"all 0.18s"}}/>
                      ))}
                      <input type="color" value={settings.accent} onChange={e=>saveSettings({...settings,accent:e.target.value})}
                        style={{width:"30px",height:"30px",borderRadius:"50%",border:"2px solid rgba(255,255,255,0.2)",cursor:"pointer",padding:0,background:"transparent"}}/>
                    </div>
                  </div>
                  <div>
                    <div className="font-orb" style={{fontSize:"9px",color:`${accent}77`,marginBottom:"8px",letterSpacing:"0.08em"}}>DEFAULT MUSIC SERVICE</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"7px"}}>
                      {MUSIC_SVCS.map(m=>(
                        <div key={m.id} onClick={()=>saveSettings({...settings,music:m.id as Settings["music"]})}
                          style={{display:"flex",alignItems:"center",gap:"8px",padding:"9px 12px",background:settings.music===m.id?`${m.color}12`:"rgba(0,8,20,0.6)",border:`1px solid ${settings.music===m.id?m.color+"44":`${accent}12`}`,borderRadius:"8px",cursor:"pointer",transition:"all 0.15s"}}>
                          <span style={{fontSize:"16px"}}>{m.emoji}</span>
                          <span style={{fontSize:"11px",color:settings.music===m.id?m.color:"#c8eeff",fontFamily:"'Share Tech Mono'"}}>{m.label}</span>
                          {settings.music===m.id&&<span style={{marginLeft:"auto",fontSize:"8px",color:m.color,fontFamily:"'Orbitron'"}}>✓</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* AI MODELS */}
            {custTab==="models"&&(
              <div style={P()}>
                <div className="c-tl"/><div className="c-tr"/><div className="c-bl"/><div className="c-br"/>
                <div className="sec-label">AI MODEL SELECTOR</div>
                <input className="ji" placeholder="Search models or providers…" value={searchModel} onChange={e=>setSearchModel(e.target.value)} style={{marginBottom:"12px"}}/>
                {providers.map(prov=>{
                  const ms=filteredModels.filter(m=>m.provider===prov);
                  if(!ms.length)return null;
                  return(
                    <div key={prov} style={{marginBottom:"14px"}}>
                      <div style={{fontSize:"10px",color:PROVIDER_COLORS[prov]||accent,fontFamily:"'Orbitron'",letterSpacing:"0.1em",marginBottom:"6px",display:"flex",alignItems:"center",gap:"6px"}}>
                        <span style={{width:"6px",height:"6px",borderRadius:"50%",background:PROVIDER_COLORS[prov]||accent,display:"inline-block"}}/>
                        {prov.toUpperCase()}
                      </div>
                      <div style={{display:"flex",flexDirection:"column",gap:"5px"}}>
                        {ms.map(m=>(
                          <div key={m.id} onClick={()=>saveSettings({...settings,activeModel:m.id})}
                            style={{display:"flex",alignItems:"center",gap:"10px",padding:"9px 12px",background:settings.activeModel===m.id?`${accent}0e`:"rgba(0,8,20,0.5)",border:`1px solid ${settings.activeModel===m.id?accent:`${accent}12`}`,borderRadius:"8px",cursor:"pointer",transition:"all 0.15s"}}>
                            <div style={{width:"16px",height:"16px",borderRadius:"50%",border:`1.5px solid ${settings.activeModel===m.id?accent:`${accent}33`}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                              {settings.activeModel===m.id&&<div style={{width:"7px",height:"7px",borderRadius:"50%",background:accent}}/>}
                            </div>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{display:"flex",alignItems:"center",gap:"6px",flexWrap:"wrap"}}>
                                <span style={{fontSize:"12px",color:"#d8eeff",fontFamily:"'Share Tech Mono'"}}>{m.label}</span>
                                {m.free&&<span className="badge badge-free">★ FREE</span>}
                              </div>
                              <div style={{fontSize:"9px",color:`${accent}44`,marginTop:"1px"}}>{m.note}</div>
                            </div>
                            <a href={m.link} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{fontSize:"9px",color:`${accent}44`,textDecoration:"none",flexShrink:0}}>GET KEY →</a>
                            {settings.activeModel===m.id&&<span className="font-orb" style={{fontSize:"8px",color:accent,flexShrink:0}}>ACTIVE</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* API KEYS */}
            {custTab==="keys"&&(
              <div style={P()}>
                <div className="c-tl"/><div className="c-tr"/><div className="c-bl"/><div className="c-br"/>
                <div className="sec-label">API KEY VAULT</div>
                <div style={{display:"flex",flexDirection:"column",gap:"13px"}}>
                  {[
                    {key:"groq",       label:"GROQ",        ph:"gsk_...",    link:"https://console.groq.com",               note:"★ FREE · Llama 3, Mixtral, Gemma"},
                    {key:"gemini",     label:"GEMINI",      ph:"AIza...",    link:"https://aistudio.google.com",            note:"★ FREE · Gemini Flash & Pro"},
                    {key:"claude",     label:"CLAUDE",      ph:"sk-ant-...", link:"https://console.anthropic.com",          note:"Paid · Sonnet, Haiku, Opus"},
                    {key:"openai",     label:"OPENAI",      ph:"sk-...",     link:"https://platform.openai.com",            note:"Paid · GPT-4o, o1"},
                    {key:"grok",       label:"GROK (xAI)",  ph:"xai-...",   link:"https://console.x.ai",                   note:"Paid · Real-time AI"},
                    {key:"perplexity", label:"PERPLEXITY",  ph:"pplx-...",   link:"https://www.perplexity.ai/settings/api", note:"Paid · Web search AI"},
                    {key:"mistral",    label:"MISTRAL",     ph:"...",        link:"https://console.mistral.ai",             note:"Paid · Mistral Large"},
                    {key:"cohere",     label:"COHERE",      ph:"...",        link:"https://dashboard.cohere.com",           note:"Paid · Command R+"},
                    {key:"weather",    label:"WEATHER",     ph:"API key...", link:"https://openweathermap.org/api",         note:"★ FREE · OpenWeatherMap"},
                  ].map(f=>(
                    <div key={f.key}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"4px"}}>
                        <div className="font-orb" style={{fontSize:"9px",color:`${accent}77`,letterSpacing:"0.08em"}}>{f.label}</div>
                        <a href={f.link} target="_blank" rel="noopener noreferrer" style={{fontSize:"9px",color:`${accent}44`,textDecoration:"none"}}>{f.note} →</a>
                      </div>
                      <div style={{position:"relative"}}>
                        <input className="ji" type="password" placeholder={f.ph}
                          value={settings.keys[f.key]||""}
                          onChange={e=>saveSettings({...settings,keys:{...settings.keys,[f.key]:e.target.value}})}/>
                        {settings.keys[f.key]&&<span style={{position:"absolute",right:"10px",top:"50%",transform:"translateY(-50%)",fontSize:"9px",color:"#00ff88"}}>✓</span>}
                      </div>
                    </div>
                  ))}
                  <div style={{fontSize:"10px",color:`${accent}33`,background:`${accent}05`,border:`1px solid ${accent}12`,borderRadius:"8px",padding:"10px",lineHeight:1.6}}>
                    🔒 Keys are stored ONLY in your browser localStorage. They are never sent to any server except directly to the respective AI provider when you send a message.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── BOTTOM NAV ── */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,background:"rgba(0,0,0,0.97)",backdropFilter:"blur(16px)",borderTop:`1px solid ${accent}18`,display:"flex",zIndex:50,paddingBottom:"env(safe-area-inset-bottom)"}}>
        {NAV.map(n=>(
          <button key={n.id} onClick={()=>setTab(n.id)}
            style={{flex:1,padding:"10px 2px 8px",background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:"2px",transition:"all 0.2s",borderTop:`2px solid ${tab===n.id?accent:"transparent"}`}}>
            <span style={{fontSize:"15px",lineHeight:1}}>{n.icon}</span>
            <span className="font-orb" style={{fontSize:"7px",letterSpacing:"0.05em",color:tab===n.id?accent:`${accent}33`,transition:"color 0.2s"}}>{n.label}</span>
          </button>
        ))}
      </div>

      {/* ── ADD SHORTCUT MODAL ── */}
      {scModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",backdropFilter:"blur(8px)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}} onClick={e=>e.target===e.currentTarget&&setScModal(false)}>
          <div style={{...P(),width:"100%",maxWidth:"360px",padding:"22px"}}>
            <div className="c-tl"/><div className="c-tr"/><div className="c-bl"/><div className="c-br"/>
            <div className="font-orb" style={{fontSize:"11px",color:accent,marginBottom:"14px",letterSpacing:"0.1em"}}>ADD SHORTCUT</div>
            <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
              <input className="ji" placeholder="Label" value={scEdit.label} onChange={e=>setScEdit({...scEdit,label:e.target.value})}/>
              <input className="ji" placeholder="URL (https://…)" value={scEdit.url} onChange={e=>setScEdit({...scEdit,url:e.target.value})} onKeyDown={e=>e.key==="Enter"&&(()=>{if(!scEdit.label.trim()||!scEdit.url.trim())return;const url=/^https?:\/\//i.test(scEdit.url)?scEdit.url:"https://"+scEdit.url;saveShortcuts([...shortcuts,{label:scEdit.label,url,icon:scEdit.icon,color:scEdit.color}]);setScModal(false);setScEdit({label:"",url:"",icon:"globe",color:"#00d4ff"});})()}/>
              <div>
                <div className="font-orb" style={{fontSize:"8px",color:`${accent}66`,marginBottom:"5px"}}>ICON</div>
                <div style={{display:"flex",gap:"5px",flexWrap:"wrap"}}>
                  {ICON_NAMES.map(ic=>(
                    <button key={ic} onClick={()=>setScEdit({...scEdit,icon:ic})} style={{width:"30px",height:"30px",borderRadius:"6px",border:`1px solid ${scEdit.icon===ic?accent:`${accent}1a`}`,background:scEdit.icon===ic?`${accent}14`:"transparent",color:scEdit.icon===ic?accent:`${accent}44`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.12s"}}>
                      <div style={{width:"13px",height:"13px"}} dangerouslySetInnerHTML={{__html:ICONS[ic]}}/>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="font-orb" style={{fontSize:"8px",color:`${accent}66`,marginBottom:"5px"}}>COLOR</div>
                <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                  {COLORS.map(c=><button key={c} onClick={()=>setScEdit({...scEdit,color:c})} style={{width:"22px",height:"22px",borderRadius:"50%",border:`2px solid ${scEdit.color===c?"#fff":"transparent"}`,background:c,cursor:"pointer",boxShadow:scEdit.color===c?`0 0 6px ${c}`:"none"}}/>)}
                </div>
              </div>
              <div style={{display:"flex",gap:"7px",marginTop:"4px"}}>
                <button className="jbtn" style={{flex:1}} onClick={()=>setScModal(false)}>CANCEL</button>
                <button className="jbtn prim" style={{flex:1}} onClick={()=>{
                  if(!scEdit.label.trim()||!scEdit.url.trim())return;
                  const url=/^https?:\/\//i.test(scEdit.url)?scEdit.url:"https://"+scEdit.url;
                  saveShortcuts([...shortcuts,{label:scEdit.label,url,icon:scEdit.icon,color:scEdit.color}]);
                  setScModal(false);setScEdit({label:"",url:"",icon:"globe",color:"#00d4ff"});
                }}>ADD</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
