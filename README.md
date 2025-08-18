
Fixes included:
1) Prevent navigating to payment when cart is empty (button disabled + no-op).
2) Payment page removes extra text and redirects back to cart if backend returns 400 (empty cart).
3) Profile shows two lines:
   - Your customer code: <code>
   - Number of previous purchases: <count>
