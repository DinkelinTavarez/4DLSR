"""Full-image comparisons against recorded inputs. Never a novel-view realism score."""
import math
import cv2
import numpy as np


def compare_images(reference, rendered, opacity):
    a=np.asarray(reference,np.float32);b=np.asarray(rendered,np.float32)
    if a.shape!=b.shape or a.ndim!=3 or a.shape[2]!=3 or opacity.shape!=a.shape[:2]:
        raise ValueError('Comparison images and opacity must have matching dimensions')
    if not all(np.isfinite(x).all() for x in [a,b,opacity]):raise ValueError('Non-finite comparison data')
    if min(a.min(),b.min())<0 or max(a.max(),b.max())>1.0001:raise ValueError('Expected RGB values in [0,1]')
    error=np.abs(a-b);mse=float(np.mean((a-b)**2));mae=float(error.mean());psnr=-10*math.log10(max(mse,1e-12))
    blur=lambda x:cv2.GaussianBlur(x,(11,11),1.5)
    ma,mb=blur(a),blur(b);va=np.maximum(0,blur(a*a)-ma*ma);vb=np.maximum(0,blur(b*b)-mb*mb);cov=blur(a*b)-ma*mb
    ssim=float(np.mean(((2*ma*mb+.01**2)*(2*cov+.03**2))/((ma*ma+mb*mb+.01**2)*(va+vb+.03**2))))
    edges=lambda x:cv2.Canny(cv2.cvtColor(np.uint8(np.clip(x*255,0,255)),cv2.COLOR_RGB2GRAY),60,120)>0
    ea,eb=edges(a),edges(b);kernel=np.ones((3,3),np.uint8)
    if not ea.any() and not eb.any():edge_f1=1.
    else:
        precision=float((eb&(cv2.dilate(ea.astype(np.uint8),kernel)>0)).sum()/max(1,eb.sum()))
        recall=float((ea&(cv2.dilate(eb.astype(np.uint8),kernel)>0)).sum()/max(1,ea.sum()))
        edge_f1=2*precision*recall/max(1e-12,precision+recall)
    coverage=float(np.mean(opacity>.5));bad=float(np.mean(np.max(error,axis=2)>.1))
    # Conservative engineering index: the weakest component limits the score.
    score=100*min(float(np.clip((psnr-10)/30,0,1)),max(0,ssim),coverage,1-bad,edge_f1)
    passed=psnr>=35 and ssim>=.97 and coverage>=.98 and bad<=.02 and edge_f1>=.95
    return dict(psnr=psnr,ssim=ssim,mae=mae,coverage=coverage,badPixelFraction=bad,edgeF1=edge_f1,sourceViewScore=round(score,2),sourceViewPass=bool(passed))


def summarize(frames):
    views=[v for frame in frames for v in frame['views']]
    if not views:raise ValueError('Cannot score a reconstruction without comparisons')
    scores=[v['sourceViewScore'] for v in views]
    return dict(sourceViewScore=min(scores),medianSourceViewScore=float(np.median(scores)),p10SourceViewScore=float(np.percentile(scores,10)),
                sourceViewPass=all(v['sourceViewPass'] for v in views),viewsCompared=len(views),framesCompared=len(frames),
                worstPSNR=min(v['psnr'] for v in views),worstSSIM=min(v['ssim'] for v in views),worstCoverage=min(v['coverage'] for v in views),
                realismScore=None,novelViewValidated=False,geometryValidated=False,temporalValidated=False,
                verdict='SOURCE CHECKS PASS; 3D REALISM UNVERIFIED' if all(v['sourceViewPass'] for v in views) else 'SOURCE FIDELITY TARGET NOT MET')
