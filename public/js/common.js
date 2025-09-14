
async function getJSON(url, opts={}){
  const res = await fetch(url, Object.assign({credentials:'include', headers:{'Content-Type':'application/json'}}, opts));
  if(!res.ok){ throw new Error('Request failed: '+res.status); }
  return await res.json();
}
function el(tag, attrs={}, ...children){
  const e = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs||{})){
    if(k==='class') e.className = v;
    else if(k.startsWith('on') && typeof v==='function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children){
    if(c==null) continue;
    e.appendChild(typeof c==='string' ? document.createTextNode(c) : c);
  }
  return e;
}
async function buildTopBar({hasBack=false}){
  const header = document.querySelector('header');
  if(!header) return;
  let s = { authenticated:false, cartCount:0, user:{} };
  try{ const ses = await getJSON('/api/session'); if(ses && typeof ses==='object') s = ses; }catch(e){}
  const left = el('div',{class:'top-left'},
    hasBack ? el('a',{href:'/', 'class':'btn'}, '<< Back to main') : el('span')
  );
  let right;
  if(s.authenticated){ right = el('div',{},
      el('a',{href:'/profile.html','class':'btn'}, s.user.name || s.user.email),
      ' ',
      el('a',{href:'/cart.html','class':'btn'}, `Cart (${s.cartCount||0})`),
      ' ',
      el('button',{'class':'btn', id:'logoutTop', onclick: async ()=>{
        if (window.gtag) gtag('event','logout');
        if (window.amplitude && typeof amplitude.track === 'function') { amplitude.track('logout', {}); }
        await fetch('/api/logout',{method:'POST', credentials:'include'});
        window.location.href='/';
      }}, 'Log Out')
    );
  }else{
    right = el('div',{},
      el('a',{href:'/login.html','class':'btn'}, 'Log in/Create account'),
      ' ',
      el('a',{href:'/login.html','class':'btn'}, 'Cart (0)')
    );
  }
  header.innerHTML=''; header.appendChild(left); header.appendChild(right);
}
async function addToCart(productId){
  try{
    const res = await fetch('/api/cart/add', {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({product_id: productId})});
    if(res.status===401){ window.location.href = '/login.html'; return; }
    if(res.ok){

if (window.gtag) {
  gtag('event', 'add_to_cart', {
    items: [{ item_id: String(productId) }]  // GA4 expects an items[] array
  });
}
if (window.amplitude && typeof amplitude.track === 'function') {
  amplitude.track('add_to_cart', { product_id: productId });
}
      alert('Added to cart');
      const s = await getJSON('/api/session');
      const a = document.querySelector('a[href="/cart.html"]');
      if(a) a.textContent = `Cart (${s.cartCount})`;
    }else{
      const t = await res.text();
      alert('Failed to add to cart: ' + t);
    }
  }catch(e){
    alert('Backend not reachable. Please deploy to Render or run locally on http://localhost:3000/');
  }
}
