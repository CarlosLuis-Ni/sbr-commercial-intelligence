const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "SBR_DATA_PRIVATE";
const ORIGIN = "https://comercial.suministrosinternacionales.com";
const cors = {"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Max-Age":"600","Vary":"Origin"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
async function getJson(url:string,headers:Record<string,string>){const r=await fetch(url,{headers});const raw=await r.text();let data:any=null;try{data=raw?JSON.parse(raw):null}catch{}return {r,data,raw};}
async function listReleaseDates(){const r=await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`,{method:"POST",headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({prefix:"releases/",limit:1000,sortBy:{column:"name",order:"desc"}})});const raw=await r.text();if(!r.ok)return [];let rows:any[]=[];try{rows=JSON.parse(raw)}catch{return []}return [...new Set(rows.map(x=>String(x.name||"").match(/^(\d{4}-\d{2}-\d{2})(?:\/|$)/)?.[1]).values())].filter(Boolean).sort().reverse();}
async function latestRelease(){const dates=await listReleaseDates();return dates[0]||null;}
async function downloadPrivate(path:string){const encoded=path.split("/").map(encodeURIComponent).join("/");const r=await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encoded}`,{headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`}});if(!r.ok){console.error("SBR_STORAGE_ERROR",path,r.status,await r.text());return null}return await r.text();}
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response(null,{status:200,headers:cors});
  if(req.method!=="POST") return json({error:"SBR_METHOD_NOT_ALLOWED"},405);
  try{
    const auth=req.headers.get("Authorization"); if(!auth?.startsWith("Bearer ")) return json({error:"SBR_AUTH_INVALID"},401);
    const token=auth.slice(7);
    const ur=await getJson(`${SUPABASE_URL}/auth/v1/user`,{apikey:ANON_KEY,Authorization:`Bearer ${token}`});
    if(!ur.r.ok||!ur.data?.id){console.error("SBR_AUTH_INVALID",ur.r.status,ur.raw);return json({error:"SBR_AUTH_INVALID"},401)}
    const uid=ur.data.id;
    const pu=new URL(`${SUPABASE_URL}/rest/v1/sbr_profiles`);pu.searchParams.set("select","id,nombre,rol,proveedor,activo");pu.searchParams.set("id",`eq.${uid}`);pu.searchParams.set("limit","1");
    const pr=await getJson(pu.toString(),{apikey:ANON_KEY,Authorization:`Bearer ${token}`});
    if(!pr.r.ok){console.error("SBR_PROFILE_ERROR",pr.r.status,pr.raw);return json({error:"SBR_PROFILE_ERROR"},500)}
    const perfil=Array.isArray(pr.data)?pr.data[0]:null;if(!perfil)return json({error:"SBR_PROFILE_NOT_FOUND"},403);if(perfil.activo!==true)return json({error:"SBR_PROFILE_INACTIVE"},403);
    const esProveedor=String(perfil.rol||"").trim().toLowerCase()==="proveedor";if(esProveedor&&!perfil.proveedor)return json({error:"SBR_PROVIDER_NOT_ASSIGNED"},403);
    let body:any={};try{body=await req.json()}catch{}
    const release=await latestRelease();if(!release)return json({error:"SBR_NO_RELEASE"},503);
    const mt=await downloadPrivate(`releases/${release}/proveedores.json`);if(mt===null)return json({error:"SBR_MANIFEST_STORAGE_ERROR"},500);
    let manifest:any;try{manifest=JSON.parse(mt)}catch(e){console.error("SBR_MANIFEST_JSON_ERROR",e);return json({error:"SBR_MANIFEST_JSON_INVALID"},500)}
    if(!manifest||!Array.isArray(manifest.proveedores))return json({error:"SBR_MANIFEST_INVALID"},500);
    if(body.action==="manifest"){
      if(esProveedor){const p=manifest.proveedores.find((x:any)=>String(x.nombre_display||"").trim().toUpperCase()===String(perfil.proveedor||"").trim().toUpperCase());if(!p)return json({error:"SBR_PROVIDER_NOT_IN_MANIFEST"},404);return json({generado_en:manifest.generado_en,fecha_operativa_mas_reciente:p.fecha_mas_reciente,proveedores:[p],origen:"supabase_storage_private",rol:perfil.rol})}
      return json({...manifest,origen:"supabase_storage_private",rol:perfil.rol});
    }
    if(body.action==="provider"){
      let providerId=String(body.provider_id||"").trim().toLowerCase();
      if(esProveedor){const p=manifest.proveedores.find((x:any)=>String(x.nombre_display||"").trim().toUpperCase()===String(perfil.proveedor||"").trim().toUpperCase());if(!p)return json({error:"SBR_PROVIDER_NOT_AUTHORIZED"},403);providerId=String(p.id||"").trim().toLowerCase();}
      if(!providerId||!/^[a-z0-9-]+$/.test(providerId))return json({error:"SBR_PROVIDER_INVALID"},400);
      const provider=manifest.proveedores.find((p:any)=>String(p.id||"").toLowerCase()===providerId);if(!provider)return json({error:"SBR_PROVIDER_NOT_FOUND"},404);
      const pt=await downloadPrivate(`releases/${release}/${providerId}.json`);if(pt===null)return json({error:"SBR_PROVIDER_STORAGE_ERROR"},500);
      let payload:any;try{payload=JSON.parse(pt)}catch(e){console.error("SBR_PROVIDER_JSON_ERROR",providerId,e);return json({error:"SBR_DATA_JSON_INVALID"},500)}
      if(!payload||typeof payload!=="object"||!payload.snapshots||typeof payload.snapshots!=="object")return json({error:"SBR_DATA_INVALID"},500);
      if(esProveedor){const dates=Object.keys(payload.snapshots).sort(),latest=dates[dates.length-1];return json({...payload,snapshots:latest?{[latest]:payload.snapshots[latest]}:{},origen:"supabase_storage_private",rol:perfil.rol})}
      return json({...payload,origen:"supabase_storage_private",rol:perfil.rol});
    }
    return json({error:"SBR_ACTION_INVALID"},400);
  }catch(e){console.error("SBR_DATA_UNHANDLED",e);return json({error:e instanceof Error?e.message:"SBR_INTERNAL_ERROR"},500)}
});