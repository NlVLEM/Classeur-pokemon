/* Vision core, shared by the app (browser) and the weekly index build (Node).
   Finds the card in a frame, flattens it, and describes it so it can be compared with every card scan. */
(function(root){
  const RW = 100, RH = 140;             // flattened card size (63:88)
  const ART = [0.08, 0.11, 0.92, 0.52]; // illustration window, fractions of the card
  const W_ART = 0.55, W_FULL = 0.25, W_COL = 0.20;
  const C_SCALE = 480;                  // int8 quantisation of the compact descriptor

  function colorGrad(img){
    const w=img.width, h=img.height, d=img.data, n=w*h, GX=[0,1,2].map(()=>new Float32Array(n)), GY=[0,1,2].map(()=>new Float32Array(n)), W4=w*4;
    for(let k=0;k<3;k++){ const gx=GX[k], gy=GY[k];
      for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++){ const i=y*w+x, p=i*4+k;
        const a=d[p-W4-4], b=d[p-W4], c=d[p-W4+4], dd=d[p-4], f=d[p+4], kk=d[p+W4-4], l=d[p+W4], m=d[p+W4+4];
        gx[i]=(c+2*f+m)-(a+2*dd+kk); gy[i]=(kk+2*l+m)-(a+2*b+c); } }
    return {GX, GY, w, h};
  }
  function lineScore(G3,w,h,vertical,a,b,c,T0,T1){
    let s0=0,s1=0,s2=0,n=0; const lim=vertical?w-1:h-1;
    for(let t=T0;t<T1;t+=2){ const q=Math.round(a+b*(t-c)); if(q<1||q>=lim) continue; const i=vertical?t*w+q:q*w+t; s0+=G3[0][i]; s1+=G3[1][i]; s2+=G3[2][i]; n++; }
    return n?Math.sqrt(s0*s0+s1*s1+s2*s2)/n:0;
  }
  function sideLines(G3,w,h,vertical,pos,span,from,to,K){
    const slopes=[-0.12,-0.09,-0.06,-0.03,0,0.03,0.06,0.09,0.12], c=(from+to)/2;
    const lo=Math.max(2,Math.round(pos-span)), hi=Math.min((vertical?w:h)-3,Math.round(pos+span)), cand=[];
    const T0=Math.max(1,Math.round(from)), T1=Math.min(vertical?h-1:w-1,Math.round(to));
    for(const b of slopes) for(let a=lo;a<=hi;a++) cand.push({a,b,c,T0,T1,score:lineScore(G3,w,h,vertical,a,b,c,T0,T1)});
    cand.sort((x,y)=>y.score-x.score);
    const med=(cand[cand.length>>1]&&cand[cand.length>>1].score)||1e-6, out=[];
    for(const L of cand){ if(out.every(o=>Math.abs(o.a-L.a)>3)) out.push(L); if(out.length>=K) break; }
    out.forEach(o=>o.rel=o.score/med); return out;
  }
  function refine(G3,w,h,vertical,L){ let best=L; for(let da=-3;da<=3;da+=0.5) for(let db=-0.02;db<=0.021;db+=0.01){ const s=lineScore(G3,w,h,vertical,L.a+da,L.b+db,L.c,L.T0,L.T1); if(s>best.score) best=Object.assign({},L,{a:L.a+da,b:L.b+db,score:s}); } return best; }
  function cross(Vl,Hl){ const x=(Vl.a + Vl.b*(Hl.a - Hl.b*Hl.c - Vl.c))/(1 - Vl.b*Hl.b); return [x, Hl.a + Hl.b*(x - Hl.c)]; }
  const dist=(p,q)=>Math.hypot(p[0]-q[0],p[1]-q[1]);
  // restricted Hough on colour gradients, then the 4 edges that together look most like a card
  function locate(img, g, G){
    const {GX,GY,w,h}=G||colorGrad(img), K=7, sx=g.w*0.22, sy=g.h*0.16;
    const Ls=sideLines(GX,w,h,true,g.x,sx,g.y+g.h*0.1,g.y+g.h*0.9,K), Rs=sideLines(GX,w,h,true,g.x+g.w,sx,g.y+g.h*0.1,g.y+g.h*0.9,K);
    const Ts=sideLines(GY,w,h,false,g.y,sy,g.x+g.w*0.1,g.x+g.w*0.9,K), Bs=sideLines(GY,w,h,false,g.y+g.h,sy,g.x+g.w*0.1,g.x+g.w*0.9,K);
    if(!Ls.length||!Rs.length||!Ts.length||!Bs.length) return {found:false};
    const mL=Ls[0].score||1, mR=Rs[0].score||1, mT=Ts[0].score||1, mB=Bs[0].score||1, gA=g.w*g.h;
    let best=null;
    for(const L of Ls) for(const R of Rs){ if(R.a-L.a<g.w*0.6) continue;
      for(const T of Ts) for(const B of Bs){ if(B.a-T.a<g.h*0.6) continue;
        const q=[cross(L,T),cross(R,T),cross(R,B),cross(L,B)];
        const ww=(dist(q[0],q[1])+dist(q[3],q[2]))/2, hh=(dist(q[0],q[3])+dist(q[1],q[2]))/2, dev=Math.abs(ww/hh-0.716)/0.716;
        if(dev>0.1||ww<g.w*0.65||ww>g.w*1.35) continue;
        const edge=(L.score/mL+R.score/mR+T.score/mT+B.score/mB)/4, par=Math.abs(L.b-R.b)+Math.abs(T.b-B.b);
        const sc=edge-3*dev-par+1.2*Math.min(ww*hh/gA,1.3);
        if(!best||sc>best.sc) best={sc,L,R,T,B,rel:Math.min(L.rel,R.rel,T.rel,B.rel)};
      } }
    if(!best||best.rel<1.8) return {found:false};
    const L=refine(GX,w,h,true,best.L), R=refine(GX,w,h,true,best.R), T=refine(GY,w,h,false,best.T), B=refine(GY,w,h,false,best.B);
    return {found:true, quad:[cross(L,T),cross(R,T),cross(R,B),cross(L,B)], strength:best.rel};
  }
  // the strongest edge is often the inner frame: look a little further out for the real outer border
  function snapOut(G, quad){
    const {GX,GY,w,h}=G, q=quad, hh=dist(q[3],q[0]), lines=[];
    const sides=[{i:[0,3],v:true,out:-1},{i:[1,2],v:true,out:1},{i:[0,1],v:false,out:-1},{i:[3,2],v:false,out:1}];
    for(const S of sides){
      const p=q[S.i[0]], r=q[S.i[1]]; let a,b,c,T0,T1;
      if(S.v){ c=(p[1]+r[1])/2; b=(r[0]-p[0])/((r[1]-p[1])||1); a=(p[0]+r[0])/2; T0=Math.round(Math.min(p[1],r[1])+0.1*hh); T1=Math.round(Math.max(p[1],r[1])-0.1*hh); }
      else { c=(p[0]+r[0])/2; b=(r[1]-p[1])/((r[0]-p[0])||1); a=(p[1]+r[1])/2; T0=Math.round(Math.min(p[0],r[0])+0.07*hh); T1=Math.round(Math.max(p[0],r[0])-0.07*hh); }
      const G3=S.v?GX:GY, s0=lineScore(G3,w,h,S.v,a,b,c,T0,T1), maxD=Math.round(0.075*hh), sc=[];
      for(let dd=0;dd<=maxD+1;dd++) sc.push(lineScore(G3,w,h,S.v,a+S.out*dd,b,c,T0,T1));
      let bestD=0, bestS=-1; for(let dd=3;dd<=maxD;dd++) if(sc[dd]>=sc[dd-1]&&sc[dd]>=sc[dd+1]&&sc[dd]>=0.3*s0&&sc[dd]>bestS){ bestS=sc[dd]; bestD=dd; }
      lines.push({a:a+S.out*bestD,b,c});
    }
    const [L,R,T,B]=lines; return [cross(L,T),cross(R,T),cross(R,B),cross(L,B)];
  }
  function homography(quad, W, H){
    const src=[[0,0],[W,0],[W,H],[0,H]], A=[], bv=[];
    for(let i=0;i<4;i++){ const [u,v]=src[i], [x,y]=quad[i]; A.push([u,v,1,0,0,0,-u*x,-v*x]); bv.push(x); A.push([0,0,0,u,v,1,-u*y,-v*y]); bv.push(y); }
    for(let c=0;c<8;c++){ let p=c; for(let r=c+1;r<8;r++) if(Math.abs(A[r][c])>Math.abs(A[p][c])) p=r;
      [A[c],A[p]]=[A[p],A[c]]; [bv[c],bv[p]]=[bv[p],bv[c]];
      for(let r=0;r<8;r++){ if(r===c) continue; const f=A[r][c]/A[c][c]; for(let k=c;k<8;k++) A[r][k]-=f*A[c][k]; bv[r]-=f*bv[c]; } }
    const hv=bv.map((v,i)=>v/A[i][i]); return [hv[0],hv[1],hv[2],hv[3],hv[4],hv[5],hv[6],hv[7],1];
  }
  // flatten a quad of an RGBA image to RW x RH (2x supersampled bilinear, then box filter)
  function warp(img, quad){
    const S=2, W=RW*S, H=RH*S, Hm=homography(quad,W,H), w=img.width, h=img.height, d=img.data, big=new Float32Array(W*H*3);
    for(let v=0;v<H;v++) for(let u=0;u<W;u++){
      const uu=u+0.5, vv=v+0.5, z=Hm[6]*uu+Hm[7]*vv+1, x=(Hm[0]*uu+Hm[1]*vv+Hm[2])/z-0.5, y=(Hm[3]*uu+Hm[4]*vv+Hm[5])/z-0.5;
      const x0=Math.max(0,Math.min(w-2,Math.floor(x))), y0=Math.max(0,Math.min(h-2,Math.floor(y))), fx=Math.min(1,Math.max(0,x-x0)), fy=Math.min(1,Math.max(0,y-y0));
      const i00=(y0*w+x0)*4, i10=i00+4, i01=i00+w*4, i11=i01+4, o=(v*W+u)*3;
      for(let k=0;k<3;k++) big[o+k]=(d[i00+k]*(1-fx)+d[i10+k]*fx)*(1-fy)+(d[i01+k]*(1-fx)+d[i11+k]*fx)*fy;
    }
    const out=new Float32Array(RW*RH*3);
    for(let v=0;v<RH;v++) for(let u=0;u<RW;u++) for(let k=0;k<3;k++){ const a=((2*v)*W+2*u)*3+k; out[(v*RW+u)*3+k]=(big[a]+big[a+3]+big[a+W*3]+big[a+W*3+3])/4; }
    return out;
  }
  // a reference scan: the whole picture is the card (transparent corners count as white)
  function fromRGBA(img){
    const d=img.data; for(let i=0;i<d.length;i+=4){ const a=d[i+3]/255; if(a<1){ d[i]=d[i]*a+255*(1-a); d[i+1]=d[i+1]*a+255*(1-a); d[i+2]=d[i+2]*a+255*(1-a); d[i+3]=255; } }
    return warp(img, [[0,0],[img.width,0],[img.width,img.height],[0,img.height]]);
  }
  function rotate180(rgb){ const n=RW*RH, o=new Float32Array(n*3); for(let i=0;i<n;i++){ const j=n-1-i; o[i*3]=rgb[j*3]; o[i*3+1]=rgb[j*3+1]; o[i*3+2]=rgb[j*3+2]; } return o; }
  function cells(rgb,ch,x0,y0,x1,y1,ow,oh){
    const out=new Float32Array(ow*oh), X0=x0*RW, Y0=y0*RH, cw=(x1-x0)*RW/ow, chh=(y1-y0)*RH/oh;
    for(let j=0;j<oh;j++) for(let i=0;i<ow;i++){
      let s=0,n=0; const xa=Math.floor(X0+i*cw), xb=Math.max(xa+1,Math.floor(X0+(i+1)*cw)), ya=Math.floor(Y0+j*chh), yb=Math.max(ya+1,Math.floor(Y0+(j+1)*chh));
      for(let y=ya;y<yb&&y<RH;y++) for(let x=xa;x<xb&&x<RW;x++){ const p=(y*RW+x)*3; s+= ch<0 ? 0.299*rgb[p]+0.587*rgb[p+1]+0.114*rgb[p+2] : rgb[p+ch]; n++; }
      out[j*ow+i]=n?s/n:0;
    }
    return out;
  }
  function unit(v){ let m=0; for(const x of v) m+=x; m/=v.length; let s=0; for(let i=0;i<v.length;i++){ v[i]-=m; s+=v[i]*v[i]; } s=Math.sqrt(s)||1; for(let i=0;i<v.length;i++) v[i]/=s; return v; }
  function colour(rgb){
    const mr=cells(rgb,0,0,0,1,1,1,1)[0]||1, mg=cells(rgb,1,0,0,1,1,1,1)[0]||1, mb=cells(rgb,2,0,0,1,1,1,1)[0]||1;
    const col=new Float32Array(48), R=cells(rgb,0,...ART,4,4), G=cells(rgb,1,...ART,4,4), B=cells(rgb,2,...ART,4,4);
    for(let i=0;i<16;i++){ col[i]=R[i]/mr; col[16+i]=G[i]/mg; col[32+i]=B[i]/mb; }
    return unit(col);
  }
  // fine descriptor (for a set loaded on the device)
  function describe(rgb){ return {art:unit(cells(rgb,-1,...ART,32,20)), full:unit(cells(rgb,-1,0,0,1,1,20,28)), col:colour(rgb)}; }
  function dot(a,b){ let s=0; for(let i=0;i<a.length;i++) s+=a[i]*b[i]; return s; }
  function similarity(q,r){ return W_ART*dot(q.art,r.art)+W_FULL*dot(q.full,r.full)+W_COL*dot(q.col,r.col); }
  // compact descriptor (every card, shipped as an int8 index): the dot product of two of them is the weighted similarity
  const C_DIM = 24*15 + 12*17 + 48;
  function compact(rgb){
    const a=unit(cells(rgb,-1,...ART,24,15)), f=unit(cells(rgb,-1,0,0,1,1,12,17)), c=colour(rgb), out=new Float32Array(C_DIM);
    const wa=Math.sqrt(W_ART), wf=Math.sqrt(W_FULL), wc=Math.sqrt(W_COL); let o=0;
    for(const v of a) out[o++]=v*wa; for(const v of f) out[o++]=v*wf; for(const v of c) out[o++]=v*wc;
    return out;
  }
  function quantize(v){ const q=new Int8Array(v.length); for(let i=0;i<v.length;i++) q[i]=Math.max(-127,Math.min(127,Math.round(v[i]*C_SCALE))); return q; }
  // best K entries of an int8 index for a float query
  function searchIndex(q, bin, N, K){
    const D=C_DIM, top=[]; let min=-Infinity;
    for(let i=0,o=0;i<N;i++,o+=D){
      let s=0; for(let k=0;k<D;k++) s+=q[k]*bin[o+k];
      if(top.length<K || s>min){ top.push({i,s}); if(top.length>K){ top.sort((a,b)=>b.s-a.s); top.length=K; } min=top.length<K?-Infinity:Math.min(...top.map(t=>t.s)); }
    }
    return top.sort((a,b)=>b.s-a.s).map(t=>({i:t.i, s:t.s/C_SCALE}));
  }
  function rank(rgb, refs){ const q=describe(rgb), q2=describe(rotate180(rgb)); return refs.map(r=>({id:r.id, s:Math.max(similarity(q,r.d),similarity(q2,r.d))})).sort((a,b)=>b.s-a.s); }
  function rectQuad(g,s,dx,dy){ const w=g.w*s,h=g.h*s,x=g.x+g.w/2-w/2+dx*g.w,y=g.y+g.h/2-h/2+dy*g.h; return [[x,y],[x+w,y],[x+w,y+h],[x,y+h]]; }
  function hypotheses(img, g, many){
    const G=colorGrad(img), L=locate(img,g,G), hyps=[];
    if(L.found){ hyps.push({q:snapOut(G,L.quad),k:'bords'}); hyps.push({q:L.quad,k:'bords'}); }
    const guides = many || !L.found ? [[1,0,0],[0.94,0,0],[1.06,0,0],[1,-0.04,0],[1,0.04,0],[1,0,-0.03],[1,0,0.03]] : [[1,0,0]];
    for(const [s,dx,dy] of guides) hyps.push({q:rectQuad(g,s,dx,dy),k:'cadre'});
    return {hyps, edges:L.found, edgeQuad:L.found?hyps[0].q:null};
  }
  // within a loaded set: try several alignments, keep the most convincing match
  function identify(img, g, refs){
    const H=hypotheses(img,g,true); let best=null;
    for(const h of H.hyps){ const rgb=warp(img,h.q), r=rank(rgb,refs); if(!best||r[0].s>best.r[0].s) best=Object.assign({},h,{r,rgb}); }
    const r=best.r; return {id:r[0].id, s:r[0].s, margin:r[0].s-(r[1]?r[1].s:0), top:r.slice(0,3), quad:best.q, how:best.k, edges:H.edges, edgeQuad:H.edgeQuad, rgb:best.rgb};
  }
  // against every card: search the int8 index, keep the most convincing alignment
  function identifyGlobal(img, g, index, K){
    const H=hypotheses(img,g,false); let best=null;
    for(const h of H.hyps){ const rgb=warp(img,h.q), q=compact(rgb), t=searchIndex(q,index.bin,index.n,K||12); if(!best||t[0].s>best.t[0].s) best=Object.assign({},h,{t,rgb}); }
    return {top:best.t.map(x=>({id:index.ids[x.i], s:x.s})), quad:best.q, how:best.k, edges:H.edges, edgeQuad:H.edgeQuad, rgb:best.rgb};
  }
  function toImageData(rgb){ const d=new ImageData(RW,RH); for(let i=0;i<RW*RH;i++){ d.data[i*4]=rgb[i*3]; d.data[i*4+1]=rgb[i*3+1]; d.data[i*4+2]=rgb[i*3+2]; d.data[i*4+3]=255; } return d; }
  const api={RW, RH, C_DIM, C_SCALE, fromRGBA, warp, describe, compact, quantize, searchIndex, identify, identifyGlobal, toImageData, homography};
  root.Vision=api; if(typeof module!=='undefined' && module.exports) module.exports=api;
})(typeof self!=='undefined'?self:globalThis);
