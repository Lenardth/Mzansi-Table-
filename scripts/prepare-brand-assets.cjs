const fs = require('node:fs/promises');
const path = require('node:path');
const { generateImageAsync } = require('@expo/image-utils');
const { PNG } = require('pngjs');
const root = path.resolve(__dirname, '..');
async function resize(name, size, padding = 0) {
 const { source } = await generateImageAsync({ projectRoot: root }, { src: path.join(root,'assets/brand/mzansi-table-master.png'), width:size, height:size, resizeMode:'contain', backgroundColor:'#104c33', removeTransparency:true, padding });
 await fs.writeFile(path.join(root,'assets/brand',name),source);
}
// A code-native, monochrome version of the dining-table motif for OS masks.
// Supersampling keeps the small white notification glyph smooth.
function monochrome(size, scale = 1) {
 const png = new PNG({width:size,height:size});
 const circle = (x,y,cx,cy,r) => (x-cx)**2+(y-cy)**2 <= r*r;
 const inside = (x,y) => {
  x = (x - 128) / scale + 128; y = (y - 128) / scale + 128;
  const plate = circle(x,y,128,136,57);
  const mCutout = y>=142 && y<=191 && ((x>=99 && x<=113) || (x>=143 && x<=157) || (x>=113 && x<=143 && y<166-Math.abs(x-128)));
  const heads = circle(x,y,128,43,13)||circle(x,y,47,178,13)||circle(x,y,209,178,13);
  const shoulders = (circle(x,y,128,84,29)&&y>=68&&y<=90)||(circle(x,y,69,205,26)&&x<=83&&y<=220)||(circle(x,y,187,205,26)&&x>=173&&y<=220);
  return (plate&&!mCutout)||heads||shoulders;
 };
 for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
  let coverage=0;
  for(let sy=0;sy<3;sy++) for(let sx=0;sx<3;sx++) if(inside((x+(sx+.5)/3)*256/size,(y+(sy+.5)/3)*256/size)) coverage++;
  const offset=(y*size+x)*4; png.data[offset]=png.data[offset+1]=png.data[offset+2]=255; png.data[offset+3]=Math.round(coverage/9*255);
 }
 return PNG.sync.write(png);
}
(async()=>{
 await resize('app-icon.png',1024);
 await resize('adaptive-foreground.png',1024,128);
 await resize('favicon.png',64);
 await resize('header-badge.png',192);
 await resize('splash-mark.png',512);
 await fs.writeFile(path.join(root,'assets/brand/notification-icon.png'),monochrome(96));
 await fs.writeFile(path.join(root,'assets/brand/adaptive-monochrome.png'),monochrome(1024, 0.62));
 console.log('Prepared Mzansi Table launcher, splash, favicon and notification assets.');
})();
