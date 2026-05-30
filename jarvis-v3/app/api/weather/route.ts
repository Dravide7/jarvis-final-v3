import { NextRequest, NextResponse } from "next/server";
export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams;
  const [lat,lon,key] = [p.get("lat"),p.get("lon"),p.get("key")];
  if (!lat||!lon||!key) return NextResponse.json({ error:"Missing params" },{status:400});
  const r = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${key}&units=metric`);
  const d = await r.json();
  if (!r.ok) return NextResponse.json({ error:d.message },{status:400});
  return NextResponse.json(d);
}
