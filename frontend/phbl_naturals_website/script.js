
const products = [
    { id: 1, name: "Aloe Vera Face Gel", category: "Skin Care", price: 249, oldPrice: 299, badge: "Bestseller", size: "100 g", image: "./assets/Charcoal_Face.png", desc: "A fresh, lightweight-feel daily skin care essential.", ingredients: "Aloe vera-inspired formula. Please refer to the product packaging for the verified ingredient list.", benefits: "A refreshing step in your daily skin care ritual.", usage: "Apply a small amount to clean skin as directed on the product label." },
    { id: 2, name: "Herbal Face Cleanser", category: "Skin Care", price: 299, oldPrice: 349, badge: "Daily essential", size: "100 ml", image: "./assets/face_body_hair.png", desc: "A simple first step for your daily cleansing routine.", ingredients: "See product packaging for the full ingredient list.", benefits: "Designed to fit into a regular cleansing routine.", usage: "Use as directed on the product label; avoid contact with eyes." },
    { id: 3, name: "Nourishing Face Cream", category: "Skin Care", price: 399, oldPrice: 449, badge: "", size: "50 g", image: "./assets/Aloe_Vera_Botanical.png", desc: "A comforting cream for your everyday care routine.", ingredients: "See product packaging for the full ingredient list.", benefits: "Helps make your daily skin care routine feel complete.", usage: "Apply to clean skin as directed on the product label." },
    { id: 4, name: "Vitamin C Face Serum", category: "Skin Care", price: 499, oldPrice: 599, badge: "Popular", size: "30 ml", image: "./assets/face_wash.png", desc: "A lightweight serum step for a considered skin ritual.", ingredients: "See product packaging for the full ingredient list and active concentration.", benefits: "An easy-to-layer addition to your skin care routine.", usage: "Patch test first and follow the product label directions." },
    { id: 5, name: "Rose Water Toner", category: "Skin Care", price: 199, oldPrice: 249, badge: "", size: "100 ml", image: "./assets/Natural_Skincare.png", desc: "A refreshing-feel addition to your daily skin ritual.", ingredients: "See product packaging for the full ingredient list.", benefits: "A simple, refreshing step after cleansing.", usage: "Apply as directed on the product label." },
    { id: 6, name: "Gentle Face Scrub", category: "Skin Care", price: 279, oldPrice: 329, badge: "", size: "100 g", image: "./assets/Neem_Charcoal.png", desc: "A weekly-care option for a little extra me-time.", ingredients: "See product packaging for the full ingredient list.", benefits: "Adds an occasional exfoliation step to your routine.", usage: "Use gently and only as directed on the product label." },
    { id: 7, name: "Herbal Hair Oil", category: "Hair Care", price: 349, oldPrice: 399, badge: "Bestseller", size: "200 ml", image: "./assets/face_body_hair.png", desc: "Make hair care a slow, soothing part of your week.", ingredients: "See product packaging for the full ingredient list.", benefits: "A nourishing-feel oiling step in your hair routine.", usage: "Apply as directed on the product label and wash if required." },
    { id: 8, name: "Herbal Hair Oil", category: "Hair Care", price: 349, oldPrice: 399, badge: "Bestseller", size: "200 ml", image: "./assets/Natural_botle2.png", desc: "Make hair care a slow, soothing part of your week.", ingredients: "See product packaging for the full ingredient list.", benefits: "A nourishing-feel oiling step in your hair routine.", usage: "Apply as directed on the product label and wash if required." },
    { id: 9, name: "Daily Care Shampoo", category: "Hair Care", price: 299, oldPrice: 349, badge: "", size: "200 ml", image: "./assets/Arnica_Rosemary_Shampoo.png", desc: "An everyday hair wash essential for your routine.", ingredients: "See product packaging for the full ingredient list.", benefits: "A practical staple for your wash-day routine.", usage: "Use as directed on the product label." },
    { id: 10, name: "Smooth & Shine Conditioner", category: "Hair Care", price: 329, oldPrice: 379, badge: "", size: "200 ml", image: "./assets/Botanical_Arnica_Hair.png", desc: "A soft-feel finishing step after shampooing.", ingredients: "See product packaging for the full ingredient list.", benefits: "Complements your regular hair wash routine.", usage: "Apply as directed on the product label; rinse thoroughly." },
    { id: 11, name: "Hair Repair Mask", category: "Hair Care", price: 449, oldPrice: 499, badge: "", size: "150 g", image: "./assets/Lemon_Ginger_Herbal.png", desc: "A dedicated care moment for your weekly hair routine.", ingredients: "See product packaging for the full ingredient list.", benefits: "An extra conditioning step when your routine calls for it.", usage: "Follow the timing and usage instructions on the product label." },
    { id: 12, name: "Body Lotion", category: "Body Care", price: 349, oldPrice: 399, badge: "Daily essential", size: "200 ml", image: "./assets/face_body_hair.png", desc: "An easy after-shower step for everyday body care.", ingredients: "See product packaging for the full ingredient list.", benefits: "Helps make moisturising a regular self-care habit.", usage: "Apply to clean skin as directed on the product label." },
    { id: 13, name: "Gentle Body Wash", category: "Body Care", price: 279, oldPrice: 329, badge: "", size: "200 ml", image: "./assets/Olive_Oil_Body_Care _Bottle1.png", desc: "A fresh-feel essential for your daily shower ritual.", ingredients: "See product packaging for the full ingredient list.", benefits: "A simple staple for your bathing routine.", usage: "Use as directed on the product label." },
    { id: 14, name: "Hand & Body Cream", category: "Body Care", price: 299, oldPrice: 349, badge: "", size: "100 g", image: "./assets/Yellow_Homeopathic.png", desc: "Keep a little moment of care close at hand.", ingredients: "See product packaging for the full ingredient list.", benefits: "A handy moisturising step for your daily routine.", usage: "Apply as directed on the product label." },
    { id: 15, name: "Foot Care Cream", category: "Body Care", price: 229, oldPrice: 279, badge: "", size: "75 g", image: "./assets/Puro_Olive_Body_Oil.png", desc: "A little extra attention for your end-of-day routine.", ingredients: "See product packaging for the full ingredient list.", benefits: "An easy way to include foot care in your self-care ritual.", usage: "Apply as directed on the product label." },
    { id: 16, name: "Everyday Care Gift Set", category: "Body Care", price: 899, oldPrice: 1099, badge: "Gift pick", size: "3-piece set", image: "./assets/samll_olive.png", desc: "A thoughtful collection for a feel-good care ritual.", ingredients: "Set contents and ingredients should be confirmed on the final retail packaging.", benefits: "A ready-to-gift option for everyday self-care.", usage: "Use each item according to its individual product label." }
];

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

let activeCategory = "All";
let searchTerm = "";
let cart = JSON.parse(localStorage.getItem("phblCart") || "{}");
let currentSlide = 0;
let slideTimer;

const money = n => "₹" + Number(n).toLocaleString("en-IN");

function renderProducts() {
    let list = products.filter(p =>
        (activeCategory === "All" || p.category === activeCategory) &&
        (`${p.name} ${p.category} ${p.desc}`
            .toLowerCase()
            .includes(searchTerm.toLowerCase()))
    );

    const sort = $("#sortSelect").value;

    if (sort === "low") list.sort((a, b) => a.price - b.price);
    if (sort === "high") list.sort((a, b) => b.price - a.price);
    if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));

    $("#productGrid").innerHTML = list.map(p => `
        <article class="product-card">
            <div class="product-image-wrap">
                <img
                    class="product-image"
                    src="${p.image}"
                    alt="${p.name}"
                    loading="lazy"
                    onerror="this.onerror=null;this.src='./assets/Natural_Skincare_Collection.png'"
                >
                ${p.badge ? `<span class="product-badge">${p.badge}</span>` : ""}
                <button class="quick-add" data-add="${p.id}">
                    ＋ Quick add
                </button>
            </div>

            <div class="product-info">
                <div class="product-category">${p.category} · ${p.size}</div>
                <h3 class="product-name">
                    <a href="#product-${p.id}" data-detail="${p.id}">${p.name}</a>
                </h3>
                <p class="product-description">${p.desc}</p>
                <div class="product-price">
                    ${money(p.price)}
                    <span class="old-price">${money(p.oldPrice)}</span>
                </div>
            </div>
        </article>
    `).join("");

    $("#noResults").hidden = list.length > 0;
}

function setCategory(category) {
    activeCategory = category;
    $$(".filter-pill").forEach(b =>
        b.classList.toggle("active", b.dataset.filter === category)
    );
    renderProducts();
}

function saveCart() {
    localStorage.setItem("phblCart", JSON.stringify(cart));
    renderCart();
}

function addToCart(id) {
    cart[id] = (cart[id] || 0) + 1;
    saveCart();
    showToast(`${products.find(p => p.id === id).name} added to your cart`);
}

function changeQty(id, delta) {
    cart[id] = (cart[id] || 0) + delta;
    if (cart[id] <= 0) delete cart[id];
    saveCart();
}

function renderCart() {
    const entries = Object.entries(cart).filter(([id, q]) => q > 0);
    const count = entries.reduce((n, [id, q]) => n + q, 0);
    const total = entries.reduce((n, [id, q]) => {
        const product = products.find(p => p.id === +id);
        return n + (product ? product.price * q : 0);
    }, 0);

    $("#cartCount").textContent = count;
    $("#drawerCount").textContent = `(${count})`;
    $("#cartSubtotal").textContent = money(total);

    $("#cartItems").innerHTML = entries.map(([id, q]) => {
        const p = products.find(x => x.id === +id);
        if (!p) return "";

        return `
            <div class="cart-row">
                <img src="${p.image}" alt="${p.name}">
                <div>
                    <h4>${p.name}</h4>
                    <div class="row-price">${money(p.price)}</div>
                    <div class="qty-control">
                        <button data-qty="${id}" data-delta="-1" aria-label="Decrease quantity">−</button>
                        <span>${q}</span>
                        <button data-qty="${id}" data-delta="1" aria-label="Increase quantity">＋</button>
                    </div>
                </div>
                <button class="remove-item" data-remove="${id}">Remove</button>
            </div>
        `;
    }).join("");

    $("#cartEmpty").style.display = count ? "none" : "flex";
    $("#cartBottom").style.display = count ? "block" : "none";
}

function openCart() {
    $("#overlay").classList.add("open");
    $("#cartDrawer").classList.add("open");
    $("#cartDrawer").setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
}

function closeCart() {
    $("#overlay").classList.remove("open");
    $("#cartDrawer").classList.remove("open");
    $("#cartDrawer").setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
}

function showToast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => t.classList.remove("show"), 2300);
}

function openProduct(id) {
    const p = products.find(x => x.id === +id);
    if (!p) return;

    $("#dialogContent").innerHTML = `
        <div class="dialog-product">
            <img src="${p.image}" alt="${p.name}">
            <div class="dialog-copy">
                <p class="eyebrow">${p.category} · ${p.size}</p>
                <h2>${p.name}</h2>
                <p>${p.desc}</p>
                <div class="detail-price">
                    ${money(p.price)}
                    <span class="old-price">${money(p.oldPrice)}</span>
                </div>
                <h4>Ingredients</h4>
                <p>${p.ingredients}</p>
                <h4>Benefits</h4>
                <p>${p.benefits}</p>
                <h4>How to use</h4>
                <p>${p.usage}</p>
                <button class="btn btn-green" data-add="${p.id}">
                    Add to cart <span>↗</span>
                </button>
            </div>
        </div>
    `;

    $("#productDialog").showModal();
}

function showSlide(index) {
    const slides = $$(".hero-slide");
    const dots = $$(".dot");

    if (!slides.length) return;

    currentSlide = (index + slides.length) % slides.length;

    slides.forEach((s, i) =>
        s.classList.toggle("active", i === currentSlide)
    );

    dots.forEach((d, i) =>
        d.classList.toggle("active", i === currentSlide)
    );

    const note = $(".hero-note span");
    if (note) note.textContent = `0${currentSlide + 1} / 03`;
}

function startSlider() {
    clearInterval(slideTimer);

    if ($$(".hero-slide").length > 1) {
        slideTimer = setInterval(() => showSlide(currentSlide + 1), 5500);
    }
}

$("#prevSlide")?.addEventListener("click", () => {
    showSlide(currentSlide - 1);
    startSlider();
});

$("#nextSlide")?.addEventListener("click", () => {
    showSlide(currentSlide + 1);
    startSlider();
});

$$(".dot").forEach((d, i) =>
    d.addEventListener("click", () => {
        showSlide(i);
        startSlider();
    })
);

startSlider();

$("#menuToggle")?.addEventListener("click", () =>
    $("#mainNav")?.classList.toggle("open")
);

$$(".main-nav a").forEach(a =>
    a.addEventListener("click", () => $("#mainNav")?.classList.remove("open"))
);

$("#searchToggle")?.addEventListener("click", () => {
    $("#searchPanel")?.classList.toggle("open");
    if ($("#searchPanel")?.classList.contains("open")) {
        $("#searchInput")?.focus();
    }
});

$("#searchClose")?.addEventListener("click", () => {
    $("#searchPanel")?.classList.remove("open");
    if ($("#searchInput")) $("#searchInput").value = "";
    searchTerm = "";
    renderProducts();
});

$("#searchInput")?.addEventListener("input", e => {
    searchTerm = e.target.value;
    renderProducts();
});

$("#filterPills")?.addEventListener("click", e => {
    const b = e.target.closest("[data-filter]");
    if (b) setCategory(b.dataset.filter);
});

$$(".collection-card").forEach(c =>
    c.addEventListener("click", () => setCategory(c.dataset.filter))
);

$("#clearFilters")?.addEventListener("click", () => setCategory("All"));
$("#sortSelect")?.addEventListener("change", renderProducts);

$("#productGrid")?.addEventListener("click", e => {
    const add = e.target.closest("[data-add]");
    const detail = e.target.closest("[data-detail]");

    if (add) {
        addToCart(+add.dataset.add);
    } else if (detail) {
        e.preventDefault();
        openProduct(+detail.dataset.detail);
    }
});

document.addEventListener("click", e => {
    const add = e.target.closest("[data-add]");

    if (
        add &&
        !$("#productGrid")?.contains(add) &&
        !$("#dialogContent")?.contains(add)
    ) {
        addToCart(+add.dataset.add);
    }
});

$("#cartOpen")?.addEventListener("click", openCart);
$("#cartClose")?.addEventListener("click", closeCart);
$("#overlay")?.addEventListener("click", closeCart);
$("#continueShopping")?.addEventListener("click", closeCart);

$("#cartItems")?.addEventListener("click", e => {
    const qty = e.target.closest("[data-qty]");
    const remove = e.target.closest("[data-remove]");

    if (qty) changeQty(+qty.dataset.qty, +qty.dataset.delta);

    if (remove) {
        delete cart[remove.dataset.remove];
        saveCart();
    }
});

$("#dialogClose")?.addEventListener("click", () => $("#productDialog")?.close());

$("#productDialog")?.addEventListener("click", e => {
    if (e.target === $("#productDialog")) $("#productDialog").close();
});

$("#checkoutBtn")?.addEventListener("click", () => $("#checkoutDialog")?.showModal());
$("#checkoutClose")?.addEventListener("click", () => $("#checkoutDialog")?.close());

$("#checkoutForm")?.addEventListener("submit", e => {
    e.preventDefault();
    $("#checkoutMessage").textContent =
        "Demo order details captured in this page only. No payment was taken and no real order was submitted.";
});

$("#newsletterForm")?.addEventListener("submit", e => {
    e.preventDefault();
    $("#newsletterMessage").textContent =
        "Thank you for your interest! Connect a newsletter service to store subscriptions.";
    $("#newsletterEmail").value = "";
});

if ($("#year")) $("#year").textContent = new Date().getFullYear();

renderProducts();
renderCart();



const loginOverlay = document.getElementById("loginOverlay");
const accountIcon = document.querySelector(".account-link");

const loginClose = document.getElementById("loginClose");
const loginTab = document.getElementById("loginTab");
const signupTab = document.getElementById("signupTab");
const switchAuth = document.getElementById("switchAuth");

const loginForm = document.getElementById("loginForm");
const fullNameField = document.getElementById("fullNameField");
const fullName = document.getElementById("fullName");

const loginHeading = document.getElementById("loginHeading");
const loginSubtitle = document.getElementById("loginSubtitle");
const loginSubmit = document.getElementById("loginSubmit");
const loginBottom = document.getElementById("loginBottom");
const forgotLink = document.getElementById("forgotLink");
const loginMessage = document.getElementById("loginMessage");

let currentAuthMode = "signin";

accountIcon?.addEventListener("click", function (event) {
    event.preventDefault();
    loginOverlay.classList.add("show");
    document.body.style.overflow = "hidden";
});

function closeLoginPopup() {
    loginOverlay.classList.remove("show");
    document.body.style.overflow = "";
}

loginClose.addEventListener("click", closeLoginPopup);

loginOverlay.addEventListener("click", function (event) {
    if (event.target === loginOverlay) closeLoginPopup();
});

document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeLoginPopup();
});

function changeAuthMode(mode) {
    currentAuthMode = mode;
    const isSignup = mode === "signup";

    loginTab.classList.toggle("active", !isSignup);
    signupTab.classList.toggle("active", isSignup);

    fullNameField.hidden = !isSignup;
    fullName.required = isSignup;

    loginHeading.textContent = isSignup ? "Create Account" : "Welcome Back!";
    loginSubtitle.textContent = isSignup
        ? "Join PHBL Naturals today"
        : "Sign in to your PHBL Naturals account";

    loginSubmit.textContent = isSignup ? "Create Account" : "Sign In";
    forgotLink.hidden = isSignup;

    loginBottom.innerHTML = isSignup
        ? 'Already have an account? <button type="button" id="switchAuth">Sign In</button>'
        : 'Don\'t have an account? <button type="button" id="switchAuth">Sign Up</button>';

    loginMessage.textContent = "";
}

loginTab.addEventListener("click", () => changeAuthMode("signin"));
signupTab.addEventListener("click", () => changeAuthMode("signup"));

loginBottom.addEventListener("click", function (event) {
    if (event.target.id === "switchAuth") {
        changeAuthMode(currentAuthMode === "signin" ? "signup" : "signin");
    }
});

loginForm.addEventListener("submit", function (event) {
    event.preventDefault();

    loginMessage.style.color = "#a13d32";
    loginMessage.textContent =
        "Authentication is not connected yet. Configure a login service to continue.";
});

document.getElementById("googleLogin").addEventListener("click", function () {
    loginMessage.style.color = "#a13d32";
    loginMessage.textContent =
        "Google sign-in needs Google OAuth or Firebase Authentication setup.";
});

document.getElementById("emailLogin").addEventListener("click", function () {
    document.getElementById("emailMobile").focus();
    loginMessage.style.color = "#426c3d";
    loginMessage.textContent = "Enter your email address in the form above.";
});

document.getElementById("mobileLogin").addEventListener("click", function () {
    document.getElementById("emailMobile").focus();
    loginMessage.style.color = "#426c3d";
    loginMessage.textContent =
        "Enter your mobile number above. OTP login needs an authentication service.";
});
