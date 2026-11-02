import postgres from "postgres";
import { checkoutClickDay } from "@/lib/checkout-clicks";
import { LANDING_EVENTS,type LandingPayload } from "@/lib/landing-analytics-events";
declare global {
  var __vchrgdSimpleStatsSql: ReturnType<typeof postgres> | undefined;
  var __vchrgdSimpleStatsReady: Promise<void> | undefined;
}
function sqlClient(){
  if(!globalThis.__vchrgdSimpleStatsSql){
    if(process.env.APP_DATA_STORE!=="supabase")throw Error("Statistics require persistent storage.");
    const url=process.env.SUPABASE_DB_URL||process.env.DATABASE_URL||process.env.POSTGRES_URL;if(!url)throw Error("Statistics unavailable.");
    globalThis.__vchrgdSimpleStatsSql=postgres(url,{max:2,prepare:false,idle_timeout:20,connect_timeout:10,connection:{statement_timeout:8000}});
  }return globalThis.__vchrgdSimpleStatsSql;
}
const namespace=()=>process.env.APP_DATA_NAMESPACE?.trim()||"production";
async function ready(){
  if(!globalThis.__vchrgdSimpleStatsReady){const sql=sqlClient();globalThis.__vchrgdSimpleStatsReady=(async()=>{
    await sql`create table if not exists public.landing_page_statistics (namespace text not null,day date not null,event text not null,total bigint not null,primary key(namespace,day,event))`;
    await sql`create table if not exists public.landing_statistics_dedupe (namespace text not null,day date not null,key_id uuid not null,event text not null,primary key(namespace,day,key_id,event))`;
    await sql`alter table public.landing_page_statistics enable row level security`;
    await sql`alter table public.landing_statistics_dedupe enable row level security`;
  })().catch(e=>{globalThis.__vchrgdSimpleStatsReady=undefined;throw e;});}await globalThis.__vchrgdSimpleStatsReady;
}
export async function recordLandingEvent(p:LandingPayload){
  await ready();const sql=sqlClient();
  // Daily totals only. Short-lived random delivery keys cannot join visits or devices.
  const events=p.event==="page_view"?["page_view"]:p.event==="page_engaged"?["page_view","page_engaged"]:["page_view","page_engaged",p.event];
  const entries=events.map(event=>({event,key:event==="page_view"||event==="page_engaged"?p.pageId:p.eventId}));
  const day=checkoutClickDay();
  await sql`with added as (
    insert into public.landing_statistics_dedupe(namespace,day,key_id,event)
    select ${namespace()},${day}::date,e.key,e.event from jsonb_to_recordset(${sql.json(entries)}::jsonb) as e(event text,key uuid)
    on conflict do nothing returning event
  ) insert into public.landing_page_statistics(namespace,day,event,total)
    select ${namespace()},${day}::date,event,count(*) from added group by event order by event
    on conflict(namespace,day,event) do update set total=landing_page_statistics.total+excluded.total`;
}
export async function cleanUpLandingAnalytics(){
  await ready();const sql=sqlClient();
  await sql`delete from public.landing_page_statistics where namespace=${namespace()} and day<current_date-89`;
  await sql`delete from public.landing_statistics_dedupe where namespace=${namespace()} and day<current_date-1`;
  await sql`delete from public.landing_analytics_events where namespace=${namespace()} and day<current_date-89`;
}
export async function getLandingAnalytics(days:7|30=7,now=new Date()){
  await ready();const to=checkoutClickDay(now),start=new Date(`${to}T12:00:00Z`);start.setUTCDate(start.getUTCDate()-days+1);const from=start.toISOString().slice(0,10);
  const rows=await sqlClient()<{day:string;event:string;total:string}[]>`select day::text,event,total::text from public.landing_page_statistics where namespace=${namespace()} and day between ${from}::date and ${to}::date order by day desc`;
  const totals=new Map<string,number>(),daily=new Map<string,{day:string;views:number;engaged:number}>();
  for(const r of rows){const n=Number(r.total);totals.set(r.event,(totals.get(r.event)||0)+n);const d=daily.get(r.day)||{day:r.day,views:0,engaged:0};if(r.event==="page_view")d.views+=n;if(r.event==="page_engaged")d.engaged+=n;daily.set(r.day,d);}
  return{days,from,to,views:totals.get("page_view")||0,engaged:totals.get("page_engaged")||0,daily:[...daily.values()],events:Object.entries(LANDING_EVENTS).filter(([event])=>!event.startsWith("page_")).map(([event,label])=>({event,label,count:totals.get(event)||0}))};
}
export type LandingAnalyticsSummary=Awaited<ReturnType<typeof getLandingAnalytics>>;
