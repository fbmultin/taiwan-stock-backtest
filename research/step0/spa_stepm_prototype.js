'use strict';
// 可種子化的亂數產生器(Math.random 無法固定種子,同一份資料會得到不同 p 值)
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

// d: 列優先 Float64Array,d[t*K+k] = 規則 k 在第 t 天相對基準的績效差(正=規則較好)
function cumsum(d,n,K){const C=new Float64Array((n+1)*K);for(let t=0;t<n;t++){const a=t*K,b=(t+1)*K;for(let k=0;k<K;k++)C[b+k]=C[a+k]+d[a+k];}return C;}

// 平穩自助法:區塊起點均勻、長度服從幾何分配(平均 L),環狀接尾。
// 用累積和讓每個區塊的加總只要 O(K),整體每次重抽樣是 O(n/L*K) 而非 O(n*K)
function bootMeans(C,n,K,B,L,seed){
  const rng=mulberry32(seed),out=new Float64Array(B*K),acc=new Float64Array(K),lq=Math.log(1-1/L);
  for(let b=0;b<B;b++){
    acc.fill(0);let filled=0;
    while(filled<n){
      const s=Math.floor(rng()*n);let len=1+Math.floor(Math.log(1-rng())/lq);
      if(len>n-filled)len=n-filled;
      const e=s+len,sb=s*K;
      if(e<=n){const eb=e*K;for(let k=0;k<K;k++)acc[k]+=C[eb+k]-C[sb+k];}
      else{const nb=n*K,wb=(e-n)*K;for(let k=0;k<K;k++)acc[k]+=C[nb+k]-C[sb+k]+C[wb+k];}
      filled+=len;
    }
    const ob=b*K;for(let k=0;k<K;k++)out[ob+k]=acc[k]/n;
  }
  return out;
}
// 對照用的笨方法(同樣的亂數序列,逐日加總),只用來驗證累積和版本沒寫錯
function bootMeansNaive(d,n,K,B,L,seed){
  const rng=mulberry32(seed),out=new Float64Array(B*K),acc=new Float64Array(K),lq=Math.log(1-1/L);
  for(let b=0;b<B;b++){
    acc.fill(0);let filled=0;
    while(filled<n){
      const s=Math.floor(rng()*n);let len=1+Math.floor(Math.log(1-rng())/lq);
      if(len>n-filled)len=n-filled;
      for(let j=0;j<len;j++){const t=(s+j)%n;for(let k=0;k<K;k++)acc[k]+=d[t*K+k];}
      filled+=len;
    }
    for(let k=0;k<K;k++)out[b*K+k]=acc[k]/n;
  }
  return out;
}
// 平穩自助法平均數的精確變異數(Politis-Romano 權重),僅供和 arch 對照
function analyticOmega2(d,n,K,L){
  const p=1/L,v=new Float64Array(K),m=new Float64Array(K);
  for(let t=0;t<n;t++)for(let k=0;k<K;k++)m[k]+=d[t*K+k]/n;
  const x=new Float64Array(n*K);for(let t=0;t<n;t++)for(let k=0;k<K;k++)x[t*K+k]=d[t*K+k]-m[k];
  for(let t=0;t<n;t++)for(let k=0;k<K;k++)v[k]+=x[t*K+k]*x[t*K+k]/n;
  for(let i=1;i<n;i++){
    const kap=(1-i/n)*Math.pow(1-p,i)+(i/n)*Math.pow(1-p,n-i);
    for(let t=0;t<n-i;t++){const a=t*K,b=(t+i)*K;for(let k=0;k<K;k++)v[k]+=2*kap*x[a+k]*x[b+k]/n;}
  }
  return v;
}
function quantile(arr,q){const s=Float64Array.from(arr).sort();return s[Math.min(s.length-1,Math.max(0,Math.ceil(q*s.length)-1))];}

function spaStepm(d,n,K,o={}){
  const B=o.B??1000,L=o.L??20,seed=o.seed??12345,alpha=o.alpha??0.05;
  const dbar=new Float64Array(K);for(let t=0;t<n;t++)for(let k=0;k<K;k++)dbar[k]+=d[t*K+k]/n;
  const M=bootMeans(cumsum(d,n,K),n,K,B,L,seed);
  let om2=o.omega2;
  if(!om2){om2=new Float64Array(K);for(let b=0;b<B;b++)for(let k=0;k<K;k++){const z=M[b*K+k]-dbar[k];om2[k]+=n*z*z/B;}}
  const sq=Math.sqrt(n),om=om2.map(Math.sqrt),tk=new Float64Array(K);let T=0;
  for(let k=0;k<K;k++){tk[k]=sq*dbar[k]/om[k];if(tk[k]>T)T=tk[k];}
  const A=Math.sqrt(2*Math.log(Math.log(n)));
  const mu={l:new Float64Array(K),c:new Float64Array(K),u:new Float64Array(K)};
  for(let k=0;k<K;k++){mu.u[k]=dbar[k];mu.l[k]=Math.max(dbar[k],0);mu.c[k]=tk[k]>=-A?dbar[k]:0;}
  const pv={};
  for(const v of ['l','c','u']){let cnt=0;
    for(let b=0;b<B;b++){let m=0;for(let k=0;k<K;k++){const z=sq*(M[b*K+k]-mu[v][k])/om[k];if(z>m)m=z;}if(m>T)cnt++;}
    pv[v]=cnt/B;}
  // StepM:每一步只在「尚未被拒絕」的集合上取最大值,重用同一批重抽樣
  const rem=new Set([...Array(K).keys()]),rej=[];
  while(rem.size){
    const mx=new Float64Array(B);
    for(let b=0;b<B;b++){let m=-Infinity;for(const k of rem){const z=sq*(M[b*K+k]-dbar[k])/om[k];if(z>m)m=z;}mx[b]=m;}
    const crit=quantile(mx,1-alpha),nw=[...rem].filter(k=>tk[k]>crit);
    if(!nw.length)break;nw.forEach(k=>{rej.push(k);rem.delete(k);});
  }
  return {T,tk:Array.from(tk),pvalues:pv,stepmRejected:rej.sort((a,b)=>a-b),omega2:Array.from(om2)};
}
module.exports={spaStepm,bootMeans,bootMeansNaive,cumsum,analyticOmega2,mulberry32};
