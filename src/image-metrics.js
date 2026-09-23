// RGB errors + luminance SSIM over non-overlapping 8x8 windows, in 8-bit sRGB.
// Source-view diagnostics only; these metrics cannot establish correct 3D geometry.
export function imageMetrics(a,b,width,height){
  if(a.length!==b.length||a.length!==width*height*4||width<1||height<1)throw new Error('Image dimensions differ');
  let absolute=0,squares=0,maxError=0,ssim=0,windows=0;
  for(let i=0;i<a.length;i+=4)for(let c=0;c<3;c++){const d=Math.abs(a[i+c]-b[i+c]);absolute+=d;squares+=d*d;maxError=Math.max(maxError,d);}
  const luma=(image,i)=>.2126*image[i]+.7152*image[i+1]+.0722*image[i+2];
  for(let y=0;y<height;y+=8)for(let x=0;x<width;x+=8){
    let n=0,sa=0,sb=0,saa=0,sbb=0,sab=0;
    for(let dy=y;dy<Math.min(y+8,height);dy++)for(let dx=x;dx<Math.min(x+8,width);dx++){
      const i=(dy*width+dx)*4,u=luma(a,i),v=luma(b,i);n++;sa+=u;sb+=v;saa+=u*u;sbb+=v*v;sab+=u*v;
    }
    const ma=sa/n,mb=sb/n,va=Math.max(0,saa/n-ma*ma),vb=Math.max(0,sbb/n-mb*mb),cov=sab/n-ma*mb;
    ssim+=((2*ma*mb+6.5025)*(2*cov+58.5225))/((ma*ma+mb*mb+6.5025)*(va+vb+58.5225));windows++;
  }
  const n=width*height*3,mse=squares/n;
  return {mae:absolute/n,mse,psnr:mse===0?null:10*Math.log10(255*255/mse),exactPixelMatch:mse===0,ssim:ssim/windows,maxChannelError:maxError};
}
