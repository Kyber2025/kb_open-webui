/** Local preview fixtures only; never called by a production build. */
export function commerceDemo(path:string, url:URL, json:(data:unknown,status?:number)=>void) {
  if(path==='/api/v1/subscriptions/admin/reseller-invites'){
    json([{id:'demo-invite',name:'示例代理',enabled:true,short_code:'preview-only',customers:10,
      registration_url:'https://proxy.kividas.com/i/preview-only',created_at:Math.floor(Date.now()/1000)}]);return true;
  }
  if(!path.startsWith('/api/v1/commerce/'))return false;
  const now=Math.floor(Date.now()/1000);
  const prices=[{tier_id:'pro',name:'Max',duration_days:30,retail_price:'120',default_price:'80',override_price:null,price:'80',remaining:3},
    {tier_id:'ultra',name:'Ultra',duration_days:30,retail_price:'360',default_price:'260',override_price:null,price:'260',remaining:4}];
  const buyer={id:'demo-admin',name:'Alex',email:'preview@example.test'};
  const items=[
    {id:'kvs-preview_56',source:'subscription',tier_id:'pro',tier_name:'Max',quantity:1,duration_days:30,amount:'120',chain_id:'56',status:'PAID',fulfilled:true,created_at:now-7200,buyer,
      payment:{paidAmount:'120',paidAt:new Date().toISOString(),fromAddress:'0xPreviewSender',confirmations:12},collections:{items:[],shared:false}},
    {id:'kvr-preview_728126428',source:'reseller',tier_id:'ultra',tier_name:'Ultra',quantity:2,duration_days:30,amount:'520',chain_id:'728126428',status:'PAID_REQUIRES_ADMIN',fulfilled:false,created_at:now-3600,buyer,
      payment:{paidAmount:'520',paidAt:new Date().toISOString(),fromAddress:'TPreviewSender',confirmations:20},collections:{items:[],shared:true}},
    {id:'manual:preview-batch',source:'manual',tier_id:'pro',tier_name:'Max',quantity:1,duration_days:30,amount:null,status:'ISSUED',fulfilled:true,created_at:now-1800,actor:buyer,batch_id:'preview-batch',note:'本地预览示例'}];
  if(path==='/api/v1/commerce/admin/resellers')json({defaults:prices,items:[{user_id:buyer.id,invite_id:'demo-invite',name:'示例代理',user_name:buyer.name,email:buyer.email,enabled:true,invite_enabled:true,short_code:'preview-only',customers:10,created_at:now,prices}]});
  else if(path==='/api/v1/commerce/reseller/me')json({is_reseller:true,enabled:true,name:'示例代理',prices,chains:[{id:'56',name:'BSC'},{id:'728126428',name:'TRON'},{id:'1',name:'Ethereum'}]});
  else if(path.endsWith('/transactions')||path.endsWith('/purchases')){
    const source=url.searchParams.get('source')||(path.includes('/reseller/')?'reseller':'');
    const filtered=items.filter(i=>!source||i.source===source);json({items:filtered,total:filtered.length,page:1,page_size:20,synced_at:now});
  }else json({success:true,synced_at:now});
  return true;
}
