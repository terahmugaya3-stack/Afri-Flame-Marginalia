# Wiring your existing site to this backend

Your `index.html` currently keeps everything in a JS `state` object that resets
on refresh. Once this backend is deployed, replace those parts with real API
calls. Three changes:

## 1. Set your API base URL and store the login token

Add near the top of your `<script>`:

```js
const API_BASE = "https://api.yourdomain.com"; // your deployed backend URL

function getToken(){ return localStorage.getItem("authToken"); }
function setToken(t){ localStorage.setItem("authToken", t); }
function clearToken(){ localStorage.removeItem("authToken"); }
```

(`localStorage` is fine here — this file will be served from your own domain,
not the Claude.ai preview sandbox, so normal browser storage works as expected.)

## 2. Replace `doRegister` / `doLogin` / `logout` with real calls

```js
async function doRegister(e){
  e.preventDefault();
  const body = {
    name: document.getElementById("regName").value.trim(),
    email: document.getElementById("regEmail").value.trim(),
    password: document.getElementById("regPassword").value,
    role: document.getElementById("regRole").value
  };
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body)
  });
  const data = await res.json();
  if(!res.ok){ document.getElementById("registerError").textContent = data.error; document.getElementById("registerError").classList.remove("hidden"); return; }
  setToken(data.token);
  state.currentUser = data.user;
  closeModal(); updateAuthUI(); renderBooks(); toast(`Welcome, ${data.user.name.split(" ")[0]}.`);
}

async function doLogin(e){
  e.preventDefault();
  const body = {
    email: document.getElementById("loginEmail").value.trim(),
    password: document.getElementById("loginPassword").value
  };
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body)
  });
  const data = await res.json();
  if(!res.ok){ document.getElementById("loginError").textContent = data.error; document.getElementById("loginError").classList.remove("hidden"); return; }
  setToken(data.token);
  state.currentUser = data.user;
  closeModal(); updateAuthUI(); renderBooks(); toast(`Logged in as ${data.user.name}.`);
}

function logout(){
  clearToken();
  state.currentUser = null;
  updateAuthUI(); renderBooks(); toast("Logged out.");
}
```

## 3. Replace the fake `actOnBook` with a real checkout — offer both methods

```js
function actOnBook(id){
  const b = state.books.find(x=>x.id===id);
  closeModal();
  if(b.type !== "sale"){ toast(`"${b.title}" reserved.`); return; } // free books: no payment
  showPaymentMethodPicker(b);
}

function showPaymentMethodPicker(book){
  // Show two buttons in your existing modal system: "Pay by card" and "Pay by mobile money"
  // Card -> startCardCheckout(book.id)
  // Mobile money -> ask for phone number, then startMobileMoneyCheckout(book.id, phone, network)
}

async function startCardCheckout(bookId){
  const res = await fetch(`${API_BASE}/api/payments/card/checkout`, {
    method: "POST",
    headers: { "Content-Type":"application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ book_id: bookId })
  });
  const data = await res.json();
  if(!res.ok){ toast(data.error); return; }
  window.location.href = data.checkout_url; // Stripe-hosted card payment page
}

async function startMobileMoneyCheckout(bookId, phone, network){
  const res = await fetch(`${API_BASE}/api/payments/mobilemoney/checkout`, {
    method: "POST",
    headers: { "Content-Type":"application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ book_id: bookId, phone, network }) // network: "mpesa" | "airtel_money"
  });
  const data = await res.json();
  if(!res.ok){ toast(data.error); return; }
  toast(data.message); // "Check your phone to approve the payment."
  window.location.href = `checkout-confirm.html?order=${data.order_id}`; // polls status automatically
}
```

## 4. Load real books instead of the hardcoded demo list

```js
async function loadBooks(){
  const res = await fetch(`${API_BASE}/api/books`);
  state.books = await res.json();
  renderBooks();
}
// call loadBooks() instead of using the hardcoded state.books array
```

That's the whole wiring — the visual design (catalog cards, nav, modals) stays
exactly as it is; only the data source changes from in-memory to your API.
