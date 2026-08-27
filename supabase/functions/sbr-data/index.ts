// Production source for the deployed sbr-data Edge Function.
// The deployed function validates the Supabase access token explicitly,
// authorizes through public.sbr_profiles, and reads only SBR_DATA_PRIVATE.
// Keep this file synchronized with the production deployment.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!, SUPABASE_ANON_KEY=Deno.env.get("SUPABASE_ANON_KEY")!, SUPABASE_SERVICE_ROLE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, BUCKET="SBR_DATA_PRIVATE";
const corsHeaders={"Access-Control-Allow-Origin":"https://comercial.suministrosinternacionales.com","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...corsHeaders,"Content-Type":"application/json","Cache-Control":"no-store"}});
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{status:204,headers:corsHeaders});
 if(req.method!=="POST")return json({error:"SBR_METHOD_NOT_ALLOWED"},405);
 try{
  const h=req.headers.get("Authorization"); if(!h?.startsWith("Bearer "))return json({error:"SBR_AUTH_INVALID"},401);
  const token=h.slice(7);
  const userClient=createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:userError}=await userClient.auth.getUser(token);
  if(userError||!user)return json({error:"SBR_AUTH_INVALID"},401);
  const admin=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:perfil,error:perfilError}=await admin.from("sbr_profiles").select("id,nombre,rol,proveedor,activo").eq("id",user.id).maybeSingle();
  if(perfilError)return json({error:"SBR_PROFILE_ERROR"},500);
  if(!perfil)return json({error:"SBR_PROFILE_NOT_FOUND"},403);
  if(perfil.activo!==true)return json({error:"SBR_PROFILE_INACTIVE"},403);
  const esProveedor=String(perfil.rol||"").trim().toLowerCase()==="proveedor";
  if(esProveedor&&!perfil.proveedor)return json({error:"SBR_PROVIDER_NOT_ASSIGNED"},403);
  const body=await req.json().catch(()=>({}));
  const {data:manifestBlob,error:manifestError}=await admin.storage.from(BUCKET).download("proveedores.json");
  if(manifestError||!manifestBlob)return json({error:"SBR_MANIFEST_STORAGE_ERROR"},500);
  const manifest=JSON.parse(await manifestBlob.text());
  if(!manifest||!Array.isArray(manifest.proveedores))return json({error:"SBR_MANIFEST_INVALID"},500);
  if(body.action==="manifest"){
   if(esProveedor){const p=manifest.proveedores.find((x:any)=>String(x.nombre_display||"").trim().toUpperCase()===String(perfil.proveedor||"").trim().toUpperCase());if(!p)return json({error:"SBR_PROVIDER_NOT_IN_MANIFEST"},404);return json({generado_en:manifest.generado_en,fecha_operativa_mas_reciente:p.fecha_mas_reciente,proveedores:[p],origen:"supabase_storage_private",rol:perfil.rol});}
   return json({...manifest,origen:"supabase_storage_private",rol:perfil.rol});
  }
  if(body.action==="provider"){
   let providerId=String(body.provider_id||"").trim().toLowerCase();
   if(esProveedor){const p=manifest.proveedores.find((x:any)=>String(x.nombre_display||"").trim().toUpperCase()===String(perfil.proveedor||"").trim().toUpperCase());if(!p)return json({error:"SBR_PROVIDER_NOT_AUTHORIZED"},403);providerId=String(p.id||"").trim().toLowerCase();}
   if(!providerId||!/^[a-z0-9-]+$/.test(providerId))return json({error:"SBR_PROVIDER_INVALID"},400);
   const provider=manifest.proveedores.find((p:any)=>String(p.id||"").toLowerCase()===providerId);if(!provider)return json({error:"SBR_PROVIDER_NOT_FOUND"},404);
   const {data:providerBlob,error:providerError}=await admin.storage.from(BUCKET).download(providerId+".json");if(providerError||!providerBlob)return json({error:"SBR_PROVIDER_STORAGE_ERROR"},500);
   const payload=JSON.parse(await providerBlob.text());if(!payload?.snapshots||typeof payload.snapshots!=="object")return json({error:"SBR_DATA_INVALID"},500);
   if(esProveedor){const dates=Object.keys(payload.snapshots).sort(),latest=dates[dates.length-1];return json({...payload,snapshots:latest?{[latest]:payload.snapshots[latest]}:{},origen:"supabase_storage_private",rol:perfil.rol});}
   return json({...payload,origen:"supabase_storage_private",rol:perfil.rol});
  }
  return json({error:"SBR_ACTION_INVALID"},400);
 }catch(e){console.error("SBR_DATA_UNHANDLED",e);return json({error:e instanceof Error?e.message:"SBR_INTERNAL_ERROR"},500);}
});
