// --- CLOUD BACKEND CONFIGURATION ---
// Production URL comes from frontend/config.js (Cloudflare → GCP Cloud Run).
const API_BASE_URL = (typeof window !== 'undefined' && window.H2O_API_BASE_URL)
    ? window.H2O_API_BASE_URL
    : 'http://localhost:5000/api';
let useBackend = false;

// Global helper to get Auth Headers for fetch requests
function getAuthHeaders() {
    const token = localStorage.getItem("h2o_pos_token");
    return {
        "Content-Type": "application/json",
        "Authorization": token ? `Bearer ${token}` : ""
    };
}

async function checkBackendConnection() {
    try {
        const res = await fetch(`${API_BASE_URL.replace('/api', '')}/health`);
        if (res.ok) {
            const data = await res.json();
            if (data.services && data.services.database === "connected") {
                useBackend = true;
                console.log("📡 Connected to H2O POS Cloud Backend! Running in Cloud Mode.");
                return true;
            }
        }
    } catch (e) {
        console.warn("⚠️ Backend server not reachable. Running in Offline Mock Mode.");
    }
    useBackend = false;
    return false;
}

async function syncDataFromBackend() {
    if (!useBackend) return;
    try {
        // 1. Sync Perfumes
        const prodRes = await fetch(`${API_BASE_URL}/products`);
        if (prodRes.ok) {
            const data = await prodRes.json();
            PERFUMES.length = 0;
            data.forEach(p => PERFUMES.push(p));
        }

        // 2. Sync Customers
        const custRes = await fetch(`${API_BASE_URL}/customers`);
        if (custRes.ok) {
            const data = await custRes.json();
            CUSTOMERS.length = 0;
            data.forEach(c => CUSTOMERS.push(c));
        }

        // 3. Sync Transactions & Reports if logged in
        const token = localStorage.getItem("h2o_pos_token");
        if (token) {
            const txRes = await fetch(`${API_BASE_URL}/transactions/today`, { headers: getAuthHeaders() });
            if (txRes.ok) {
                const data = await txRes.json();
                salesHistory.length = 0;
                data.forEach(t => {
                    salesHistory.push({
                        id: t.id,
                        invoiceNo: t.invoice_no,
                        date: t.date,
                        customerName: t.customer_name,
                        employeeName: t.employee_name,
                        employeeId: t.employee_id,
                        subtotal: parseFloat(t.subtotal),
                        cgst: parseFloat(t.cgst),
                        sgst: parseFloat(t.sgst),
                        total: parseFloat(t.total),
                        paymentMethod: t.payment_method,
                        paymentStatus: t.payment_status || "paid",
                        referenceId: t.reference_id,
                        items: t.items || []
                    });
                });
            }

            const repRes = await fetch(`${API_BASE_URL}/reports/summary`, { headers: getAuthHeaders() });
            if (repRes.ok) {
                const repData = await repRes.json();
                lastReportByEmployee = repData.byEmployee || [];
                const salesVal = document.getElementById("rep-total-sales");
                const taxVal = document.getElementById("rep-total-tax");
                const txVal = document.getElementById("rep-total-tx");
                const commVal = document.getElementById("rep-commission");
                if (salesVal) salesVal.textContent = `₹${parseFloat(repData.gross_sales).toLocaleString('en-IN')}`;
                if (taxVal) taxVal.textContent = `₹${parseFloat(repData.total_tax).toLocaleString('en-IN')}`;
                if (txVal) txVal.textContent = repData.tx_count;
                if (commVal) commVal.textContent = `₹${parseFloat(repData.commission).toLocaleString('en-IN')}`;
            }
        }
    } catch (e) {
        console.error("Error syncing data from backend:", e);
    }
}

// --- Mock Data: Perfumes & Variants ---
const PERFUMES = [
    {
        id: "p1",
        name: "Royal Oud Extreme",
        brand: "H2O Artisan",
        family: "Woody",
        gender: "Unisex",
        notes: ["Assam Oud", "Sandalwood", "Amber", "Incense"],
        image: "assets/images/oud.png",
        description: "A deep, rich oriental fragrance featuring premium Assam Oud blended with warm amber and smoky incense. Highly sought after in the Kerala market.",
        variants: [
            { id: "v1_1", size: "30ml", concentration: "Attar", price: 3499, sku: "AUR-ROD-ATT-30", barcode: "890123400011" },
            { id: "v1_2", size: "50ml", concentration: "EDP", price: 4999, sku: "AUR-ROD-EDP-50", barcode: "890123400012" },
            { id: "v1_3", size: "100ml", concentration: "EDP", price: 7999, sku: "AUR-ROD-EDP-100", barcode: "890123400013" }
        ],
        batches: [
            { id: "b1_1", batchNo: "B-OUD-26A", mfgDate: "2026-01-10", expDate: "2031-01-10", cost: 2200, qty: 18 }
        ]
    },
    {
        id: "p2",
        name: "Neroli & Bergamot Breeze",
        brand: "H2O Artisan",
        family: "Fresh",
        gender: "Unisex",
        notes: ["Neroli", "Bergamot", "Sea Salt", "White Musk"],
        image: "assets/images/citrus.png",
        description: "A crisp, invigorating fragrance inspired by coastal breezes. Opens with bright Italian bergamot and neroli, settling into a clean white musk.",
        variants: [
            { id: "v2_1", size: "50ml", concentration: "EDT", price: 2899, sku: "AUR-NBB-EDT-50", barcode: "890123400021" },
            { id: "v2_2", size: "100ml", concentration: "EDP", price: 4499, sku: "AUR-NBB-EDP-100", barcode: "890123400022" }
        ],
        batches: [
            { id: "b2_1", batchNo: "B-CIT-26B", mfgDate: "2026-02-15", expDate: "2029-02-15", cost: 1300, qty: 25 }
        ]
    },
    {
        id: "p3",
        name: "Jasmine & Velvet Rose",
        brand: "H2O Artisan",
        family: "Floral",
        gender: "Feminine",
        notes: ["Damask Rose", "Mogra Jasmine", "Patchouli", "Vanilla"],
        image: "assets/images/floral.png", // We'll fall back gracefully if missing, or use a placeholder styled div
        description: "An opulent floral bouquet combining rich Damask rose with local Mogra jasmine, sweetened with Madagascar vanilla and patchouli.",
        variants: [
            { id: "v3_1", size: "50ml", concentration: "EDP", price: 3299, sku: "AUR-JVR-EDP-50", barcode: "890123400031" },
            { id: "v3_2", size: "100ml", concentration: "EDP", price: 5299, sku: "AUR-JVR-EDP-100", barcode: "890123400032" }
        ],
        batches: [
            { id: "b3_1", batchNo: "B-FLO-26A", mfgDate: "2026-03-01", expDate: "2030-03-01", cost: 1500, qty: 12 }
        ]
    },
    {
        id: "p4",
        name: "Cardamom & Saffron Wood",
        brand: "Ajmal Blends",
        family: "Spicy",
        gender: "Masculine",
        notes: ["Kerala Cardamom", "Kashmiri Saffron", "Cedarwood", "Leather"],
        image: "assets/images/oud.png",
        description: "A warm, spicy composition celebrating local spices. Fresh green cardamom and precious saffron blend with robust cedarwood and soft leather.",
        variants: [
            { id: "v4_1", size: "50ml", concentration: "EDP", price: 3899, sku: "AJM-CSW-EDP-50", barcode: "890123400041" },
            { id: "v4_2", size: "100ml", concentration: "EDP", price: 5999, sku: "AJM-CSW-EDP-100", barcode: "890123400042" }
        ],
        batches: [
            { id: "b4_1", batchNo: "B-SPI-26C", mfgDate: "2026-04-12", expDate: "2031-04-12", cost: 1800, qty: 15 }
        ]
    }
];

// --- Mock Data: Customers & Profiles ---
const CUSTOMERS = [
    {
        id: "c1",
        name: "Anjali Menon",
        phone: "+91 98765 43210",
        email: "anjali.menon@email.com",
        loyaltyPoints: 340,
        scentProfile: {
            preferred: ["Jasmine", "Rose", "Vanilla"],
            disliked: ["Oud", "Leather"],
            skinType: "Dry",
            remarks: "Allergic to heavy oriental profiles. Prefers soft, sweet florals."
        }
    },
    {
        id: "c2",
        name: "Rahul Krishnan",
        phone: "+91 94470 11223",
        email: "rahul.k@email.com",
        loyaltyPoints: 890,
        scentProfile: {
            preferred: ["Oud", "Cardamom", "Cedarwood"],
            disliked: ["Jasmine"],
            skinType: "Oily",
            remarks: "Loves strong sillage and long-lasting spicy/woody scents."
        }
    },
    {
        id: "c3",
        name: "Dr. Jishnu Sen",
        phone: "+91 99612 88776",
        email: "jishnu.sen@email.com",
        loyaltyPoints: 1200,
        scentProfile: {
            preferred: ["Bergamot", "Neroli", "Sandalwood"],
            disliked: ["Vanilla"],
            skinType: "Normal",
            remarks: "Prefers fresh citrus for daytime/clinic, sandalwood for evenings."
        }
    }
];

// --- Simulated Database / State ---
let cart = [];
let authenticatedUser = null;
let lastReportByEmployee = [];
let openShift = null;
let _managerPinResolver = null;

function isManagerUser(user) {
    if (!user || !user.role) return false;
    const r = String(user.role).toLowerCase();
    return r === "manager" || r.includes("manager") || r.includes("owner");
}

function applyManagerTabLocks() {
    const managerOnlyTabs = [
        document.querySelector(".pos-menu-item[data-tab='pos-reports']"),
        document.querySelector(".pos-menu-item[data-tab='pos-owner']")
    ];
    const allow = isManagerUser(authenticatedUser);
    managerOnlyTabs.forEach((tabBtn) => {
        if (!tabBtn) return;
        if (allow) tabBtn.classList.remove("locked");
        else tabBtn.classList.add("locked");
    });
}

function promptManagerPin(reasonText) {
    return new Promise((resolve) => {
        if (isManagerUser(authenticatedUser)) {
            resolve({ skipped: true, managerPin: null });
            return;
        }
        const modal = document.getElementById("manager-pin-modal");
        const reasonEl = document.getElementById("manager-pin-reason");
        const input = document.getElementById("manager-pin-input");
        const err = document.getElementById("manager-pin-error");
        if (reasonEl) reasonEl.textContent = reasonText || "Enter a Manager PIN to continue.";
        if (err) err.style.display = "none";
        if (input) input.value = "";
        _managerPinResolver = resolve;
        if (modal) modal.style.display = "flex";
        if (input) setTimeout(() => input.focus(), 50);
    });
}

window.closeManagerPinModal = function() {
    const modal = document.getElementById("manager-pin-modal");
    if (modal) modal.style.display = "none";
    if (_managerPinResolver) {
        _managerPinResolver(null);
        _managerPinResolver = null;
    }
};

window.submitManagerPin = function() {
    const input = document.getElementById("manager-pin-input");
    const pin = input ? input.value.trim() : "";
    const err = document.getElementById("manager-pin-error");
    if (!pin) {
        if (err) err.style.display = "block";
        return;
    }
    const modal = document.getElementById("manager-pin-modal");
    if (modal) modal.style.display = "none";
    if (_managerPinResolver) {
        _managerPinResolver({ skipped: false, managerPin: pin });
        _managerPinResolver = null;
    }
};

let salesHistory = [
    {
        id: "tx_1",
        invoiceNo: "H2O-2026-0012",
        date: "2026-06-29T14:35:00Z",
        customerName: "Rahul Krishnan",
        employeeName: "Siddharth (Cashier)",
        subtotal: 7999,
        cgst: 719.91,
        sgst: 719.91,
        total: 9438.82,
        paymentMethod: "Razorpay",
        items: [
            { name: "Royal Oud Extreme (100ml)", qty: 1, price: 7999 }
        ]
    },
    {
        id: "tx_2",
        invoiceNo: "H2O-2026-0013",
        date: "2026-06-30T10:15:00Z",
        customerName: "Walk-in Customer",
        employeeName: "Meera (Sales Associate)",
        subtotal: 2899,
        cgst: 260.91,
        sgst: 260.91,
        total: 3420.82,
        paymentMethod: "Cash",
        items: [
            { name: "Neroli & Bergamot Breeze (50ml)", qty: 1, price: 2899 }
        ]
    }
];

// Active tab and selected options for interactive elements
let scentFinderAnswers = {};
let activeCatalogFilter = "All";

document.addEventListener("DOMContentLoaded", () => {
    // Check backend connection and sync data in the background (non-blocking)
    checkBackendConnection().then(connected => {
        if (connected) {
            syncDataFromBackend().then(() => {
                renderCatalog();
                if (typeof renderPosCRM === "function") renderPosCRM();
                if (typeof renderCustomerDropdown === "function") renderCustomerDropdown();
            });
        }
    });

    // Header background change on scroll
    window.addEventListener("scroll", () => {
        const header = document.querySelector("header");
        if (window.scrollY > 50) {
            header.classList.add("scrolled");
        } else {
            header.classList.remove("scrolled");
        }
    });

    // Main View Switching (Landing Page vs POS Portal via Authentication)
    const btnPosPortal = document.getElementById("btn-pos-portal");
    const btnExitPos = document.getElementById("btn-exit-pos");
    const landingView = document.getElementById("landing-view");
    const posPortalView = document.getElementById("pos-portal-view");

    if (btnPosPortal) {
        btnPosPortal.addEventListener("click", (e) => {
            e.preventDefault();
            openLoginModal();
        });
    }

    if (btnExitPos) {
        btnExitPos.addEventListener("click", () => {
            posPortalView.style.display = "none";
            landingView.style.display = "block";
            authenticatedUser = null; // Clear session on exit
            localStorage.removeItem("h2o_pos_token"); // Clear JWT
            window.scrollTo(0, 0);
        });
    }

    // --- Staff Authentication & Session State ---
    const STAFF_ACCOUNTS = {
        siddharth: { id: 1, name: "Siddharth M.", role: "Cashier", pin: "1234" },
        meera: { id: 2, name: "Meera K.", role: "Sales Associate", pin: "5678" },
        jishnu: { id: 3, name: "Dr. Jishnu Sen", role: "Store Manager & Owner", pin: "9999" }
    };

    let currentEnteredPin = "";

    window.openLoginModal = function() {
        const modal = document.getElementById("pos-login-modal");
        if (modal) {
            modal.style.display = "flex";
            clearPin();
        }
    };

    window.closeLoginModal = function() {
        const modal = document.getElementById("pos-login-modal");
        if (modal) {
            modal.style.display = "none";
        }
    };

    window.pressPinKey = function(digit) {
        if (currentEnteredPin.length < 4) {
            currentEnteredPin += digit;
            updatePinDots();
            
            // Auto-submit on 4th digit
            if (currentEnteredPin.length === 4) {
                setTimeout(authenticateStaff, 200);
            }
        }
    };

    window.clearPin = function() {
        currentEnteredPin = "";
        updatePinDots();
        document.getElementById("login-error-message").style.display = "none";
    };

    window.backspacePin = function() {
        if (currentEnteredPin.length > 0) {
            currentEnteredPin = currentEnteredPin.slice(0, -1);
            updatePinDots();
        }
    };

    function updatePinDots() {
        const dots = document.querySelectorAll("#pin-dots-container .pin-dot");
        dots.forEach((dot, idx) => {
            if (idx < currentEnteredPin.length) {
                dot.classList.add("filled");
            } else {
                dot.classList.remove("filled");
            }
        });
    }

    async function authenticateStaff() {
        const select = document.getElementById("login-staff-select");
        const staffId = select.value;
        let success = false;
        
        if (useBackend) {
            try {
                const res = await fetch(`${API_BASE_URL}/auth/login`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username: staffId, pin: currentEnteredPin })
                });
                
                if (res.ok) {
                    const data = await res.json();
                    localStorage.setItem("h2o_pos_token", data.token);
                    authenticatedUser = data.user;
                    success = true;
                    // Sync sales history and reports for this user
                    await syncDataFromBackend();
                }
            } catch (e) {
                console.error("Backend login failed, attempting local fallback...", e);
            }
        }
        
        // Offline Local Fallback
        if (!success) {
            const staff = STAFF_ACCOUNTS[staffId];
            if (staff && currentEnteredPin === staff.pin) {
                authenticatedUser = staff;
                success = true;
            }
        }
        
        if (success) {
            // Success: Unlock animation
            const lockIcon = document.getElementById("login-lock-icon-fa");
            if (lockIcon) {
                lockIcon.className = "fas fa-lock-open";
                lockIcon.style.color = "#10b981";
            }
            
            setTimeout(() => {
                // Transition to POS
                closeLoginModal();
                document.getElementById("landing-view").style.display = "none";
                document.getElementById("pos-portal-view").style.display = "block";
                
                // Set active user session in POS
                updatePosUserSession();
                initPosTerminal();
                refreshShiftStatus();
                
                // Reset lock icon
                if (lockIcon) {
                    lockIcon.className = "fas fa-lock";
                    lockIcon.style.color = "";
                }
            }, 500);
        } else {
            // Fail: Shake and error
            const modalContent = document.querySelector(".login-modal-content");
            if (modalContent) {
                modalContent.classList.add("shake-animation");
                setTimeout(() => modalContent.classList.remove("shake-animation"), 400);
            }
            
            const errorMsg = document.getElementById("login-error-message");
            if (errorMsg) {
                errorMsg.style.display = "block";
            }
            
            // Reset PIN
            currentEnteredPin = "";
            updatePinDots();
        }
    }

    function updatePosUserSession() {
        const topbarUserContainer = document.getElementById("pos-topbar-user");
        if (topbarUserContainer && authenticatedUser) {
            topbarUserContainer.innerHTML = `
                <div><strong>${authenticatedUser.name}</strong> (${authenticatedUser.role})</div>
                <div style="font-size: 0.7rem; color: var(--text-muted);">Kochi Branch</div>
            `;
        }

        applyManagerTabLocks();
    }

    // Close modals on clicking the blurred background outside the content box
    document.querySelectorAll(".modal-overlay").forEach(overlay => {
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                overlay.style.display = "none";
            }
        });
    });

    // Check if we need to open the POS portal from a redirect
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('pos') === 'true') {
        window.history.replaceState({}, document.title, window.location.pathname);
        openLoginModal();
    }

    // Initialize Landing Page Modules
    initScentFinder();
    renderCatalog();
    initCatalogFilters();
    initMistCanvas();
});

// --- LANDING PAGE: Scent Finder Logic ---
function initScentFinder() {
    const steps = document.querySelectorAll(".scent-finder-step");
    const nextBtns = document.querySelectorAll(".next-step");
    const prevBtns = document.querySelectorAll(".prev-step");
    const optionCards = document.querySelectorAll(".option-card");

    optionCards.forEach(card => {
        card.addEventListener("click", () => {
            const question = card.dataset.question;
            const value = card.dataset.value;

            // Remove selected class from siblings
            card.parentElement.querySelectorAll(".option-card").forEach(c => c.classList.remove("selected"));
            card.classList.add("selected");

            scentFinderAnswers[question] = value;
        });
    });

    nextBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            const currentStep = parseInt(btn.dataset.step);
            
            // Validate selection
            const currentQuestion = steps[currentStep - 1].querySelector(".option-card")?.dataset.question;
            if (currentQuestion && !scentFinderAnswers[currentQuestion]) {
                alert("Please make a selection to proceed.");
                return;
            }

            if (currentStep === 3) {
                calculateScentMatch();
            } else {
                showStep(currentStep + 1);
            }
        });
    });

    prevBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            const currentStep = parseInt(btn.dataset.step);
            showStep(currentStep - 1);
        });
    });

    function showStep(stepNum) {
        steps.forEach((step, idx) => {
            if (idx === stepNum - 1) {
                step.classList.add("active");
            } else {
                step.classList.remove("active");
            }
        });
    }

    function calculateScentMatch() {
        const gender = scentFinderAnswers["gender"]; // masculine, feminine, unisex
        const vibe = scentFinderAnswers["vibe"];     // woody, fresh, floral, spicy
        const occasion = scentFinderAnswers["occasion"]; // daily, evening, active

        // Simple matching score
        let bestMatch = PERFUMES[0];
        let maxScore = -1;

        PERFUMES.forEach(perfume => {
            let score = 0;
            
            // Gender match
            if (perfume.gender.toLowerCase() === gender) score += 3;
            else if (perfume.gender === "Unisex") score += 2;

            // Fragrance Family match
            if (perfume.family.toLowerCase() === vibe) score += 5;

            // Occasion logic mapping
            if (occasion === "daily" && perfume.family === "Fresh") score += 2;
            if (occasion === "evening" && (perfume.family === "Woody" || perfume.family === "Spicy")) score += 3;
            if (occasion === "active" && perfume.family === "Fresh") score += 3;

            if (score > maxScore) {
                maxScore = score;
                bestMatch = perfume;
            }
        });

        // Render Result
        const resultStep = document.getElementById("step-result");
        const resultContainer = resultStep.querySelector(".result-container");

        resultContainer.innerHTML = `
            <div class="result-image">
                <img src="${bestMatch.image}" alt="${bestMatch.name}" onerror="this.src='https://images.unsplash.com/photo-1541643600914-78b084683601?w=500'">
            </div>
            <div class="result-info">
                <span class="badge">Perfect Match</span>
                <h4 class="font-serif" style="margin-top:0.5rem">${bestMatch.name}</h4>
                <div class="brand">${bestMatch.brand} (${bestMatch.variants[0].concentration})</div>
                <p style="font-size:0.9rem; color:var(--text-secondary); margin-bottom:1rem">${bestMatch.description}</p>
                <div class="result-notes">
                    ${bestMatch.notes.map(note => `<span class="result-note">${note}</span>`).join("")}
                </div>
                <div class="result-price">₹${bestMatch.variants[0].price.toLocaleString('en-IN')}</div>
                <div style="display:flex; gap:1rem">
                    <button class="btn btn-gold" onclick="scrollToCatalogAndHighlight('${bestMatch.id}')">View Details</button>
                    <button class="btn btn-outline" onclick="resetScentFinder()">Try Again</button>
                </div>
            </div>
        `;

        showStep(4);
    }
}

window.resetScentFinder = function() {
    scentFinderAnswers = {};
    document.querySelectorAll(".option-card").forEach(c => c.classList.remove("selected"));
    const steps = document.querySelectorAll(".scent-finder-step");
    steps.forEach((step, idx) => {
        if (idx === 0) step.classList.add("active");
        else step.classList.remove("active");
    });
};

window.scrollToCatalogAndHighlight = function(perfumeId) {
    const catalogSection = document.getElementById("collections");
    if (catalogSection) {
        catalogSection.scrollIntoView({ behavior: "smooth" });
        setTimeout(() => {
            const card = document.querySelector(`[data-perfume-id="${perfumeId}"]`);
            if (card) {
                card.style.borderColor = "var(--primary-gold)";
                card.style.boxShadow = "var(--shadow-gold-heavy)";
                setTimeout(() => {
                    card.style.borderColor = "";
                    card.style.boxShadow = "";
                }, 3000);
            }
        }, 800);
    }
};

// --- LANDING PAGE: Catalog Rendering & Filtering ---
function initCatalogFilters() {
    const filterBtns = document.querySelectorAll(".filter-btn");
    filterBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            filterBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            activeCatalogFilter = btn.dataset.filter;
            renderCatalog();
        });
    });
}

function renderCatalog() {
    const catalogGrid = document.querySelector(".catalog-grid");
    if (!catalogGrid) return;

    catalogGrid.innerHTML = "";

    let filtered = activeCatalogFilter === "All" 
        ? PERFUMES 
        : PERFUMES.filter(p => p.family === activeCatalogFilter);

    // Limit to 3 on the home page, show all on catalog.html
    const isCatalogPage = window.location.pathname.includes("catalog.html");
    if (!isCatalogPage) {
        filtered = filtered.slice(0, 3);
    }

    filtered.forEach(perfume => {
        // Find default variant (usually 50ml or first available)
        const defaultVar = perfume.variants[0];
        
        const card = document.createElement("div");
        card.className = "product-card";
        card.dataset.perfumeId = perfume.id;
        card.innerHTML = `
            <div class="product-card-image">
                <img src="${perfume.image}" alt="${perfume.name}" id="img-${perfume.id}" onerror="this.src='https://images.unsplash.com/photo-1541643600914-78b084683601?w=500'">
                <span class="product-card-badge badge">${perfume.family}</span>
            </div>
            <div class="product-card-content">
                <span class="product-card-brand">${perfume.brand}</span>
                <h3 class="product-card-title">${perfume.name}</h3>
                <p class="product-card-notes"><strong>Notes:</strong> ${perfume.notes.join(", ")}</p>
                
                <div class="product-card-sizes">
                    ${perfume.variants.map((v, i) => `
                        <button class="size-option ${i === 0 ? 'active' : ''}" 
                                onclick="changeCatalogVariant(this, '${perfume.id}', '${v.id}', ${v.price})">
                            ${v.size} - ${v.concentration}
                        </button>
                    `).join("")}
                </div>

                <div class="product-card-footer">
                    <div class="product-card-price" id="price-${perfume.id}">₹${defaultVar.price.toLocaleString('en-IN')}</div>
                    <button class="add-to-cart-btn" onclick="simulateLandingCartAdd('${perfume.id}', '${defaultVar.id}')" title="Simulate Adding to POS Cart">
                        <i class="fas fa-plus">+</i>
                    </button>
                </div>
            </div>
        `;
        catalogGrid.appendChild(card);
    });
}

window.changeCatalogVariant = function(btn, perfumeId, variantId, price) {
    // Update active button state
    const parent = btn.parentElement;
    parent.querySelectorAll(".size-option").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    // Update price label
    const priceLabel = document.getElementById(`price-${perfumeId}`);
    if (priceLabel) {
        priceLabel.textContent = `₹${price.toLocaleString('en-IN')}`;
    }

    // Update the Add to Cart button's onclick action to use the newly selected variant
    const card = document.querySelector(`[data-perfume-id="${perfumeId}"]`);
    const cartBtn = card.querySelector(".add-to-cart-btn");
    if (cartBtn) {
        cartBtn.setAttribute("onclick", `simulateLandingCartAdd('${perfumeId}', '${variantId}')`);
    }
};

window.simulateLandingCartAdd = function(perfumeId, variantId) {
    const perfume = PERFUMES.find(p => p.id === perfumeId);
    const variant = perfume.variants.find(v => v.id === variantId);

    // Alert user and offer to go to POS
    const goToPos = confirm(`[POS Simulation] "${perfume.name} (${variant.size})" added to the POS cart!\n\nWould you like to open the Staff POS Terminal to view the checkout process?`);
    
    // Add to cart state
    addToCartState(perfume, variant);

    if (goToPos) {
        const isCatalogPage = window.location.pathname.includes("catalog.html");
        if (isCatalogPage) {
            window.location.href = "index.html?pos=true";
        } else {
            document.getElementById("landing-view").style.display = "none";
            document.getElementById("pos-portal-view").style.display = "block";
            initPosTerminal();
        }
    }
};

function addToCartState(perfume, variant) {
    const existing = cart.find(item => item.variantId === variant.id);
    if (existing) {
        existing.qty += 1;
    } else {
        cart.push({
            perfumeId: perfume.id,
            variantId: variant.id,
            name: perfume.name,
            brand: perfume.brand,
            size: variant.size,
            concentration: variant.concentration,
            price: variant.price,
            sku: variant.sku,
            barcode: variant.barcode,
            gstRate: variant.gstRate,
            qty: 1
        });
    }
}

// --- STAFF POS TERMINAL: Core Logic ---
let activePosTab = "pos-billing";

function initPosTerminal() {
    applyManagerTabLocks();
    setupPosNavigation();
    renderPosProducts();
    renderPosCart();
    renderPosInventory();
    renderPosCRM();
    renderPosReports();
    renderCustomerDropdown(); // Populate dropdown dynamically from CRM state
}

function setupPosNavigation() {
    const menuItems = document.querySelectorAll(".pos-menu-item");
    menuItems.forEach(item => {
        item.addEventListener("click", (e) => {
            e.preventDefault();

            const tabId = item.dataset.tab;
            if (!tabId) return;

            // Manager-only tabs: trust role, not a stale CSS lock class
            const managerOnly = tabId === "pos-reports" || tabId === "pos-owner";
            if (managerOnly && !isManagerUser(authenticatedUser)) {
                alert(`Access Denied: ${authenticatedUser.name} is logged in as a ${authenticatedUser.role}.\n\nThis tab requires Manager or Owner privileges.`);
                return;
            }
            if (managerOnly) item.classList.remove("locked");
            else if (item.classList.contains("locked")) {
                alert(`Access Denied: ${authenticatedUser.name} is logged in as a ${authenticatedUser.role}.\n\nThis tab requires Manager or Owner privileges.`);
                return;
            }

            menuItems.forEach(i => i.classList.remove("active"));
            item.classList.add("active");

            document.querySelectorAll(".pos-tab-content").forEach(tab => {
                tab.classList.remove("active");
            });
            document.getElementById(tabId).classList.add("active");
            activePosTab = tabId;

            // Refresh specific tab contents if needed
            if (tabId === "pos-inventory") renderPosInventory();
            if (tabId === "pos-crm") renderPosCRM();
            if (tabId === "pos-reports") renderPosReports();
            if (tabId === "pos-owner") renderOwnerDashboard();

            const titleMap = {
                "pos-billing": "Checkout Terminal",
                "pos-inventory": "Inventory & Batches",
                "pos-crm": "CRM Scent Profiles",
                "pos-reports": "Daily Sales & GST",
                "pos-owner": "Owner Live"
            };
            const titleEl = document.getElementById("pos-active-tab-title");
            if (titleEl && titleMap[tabId]) titleEl.textContent = titleMap[tabId];
        });
    });

    // Customer Selection listener
    const customerSelect = document.getElementById("pos-customer-select-dropdown");
    if (customerSelect) {
        customerSelect.addEventListener("change", (e) => {
            const customerId = e.target.value;
            const profileDiv = document.getElementById("pos-selected-customer-profile");
            
            if (customerId === "walkin") {
                profileDiv.style.display = "none";
            } else {
                const customer = CUSTOMERS.find(c => c.id === customerId);
                if (customer) {
                    profileDiv.style.display = "block";
                    profileDiv.innerHTML = `
                        <div style="font-size:0.8rem; border: 1px solid var(--border-color); border-radius: 4px; padding: 0.75rem; background: rgba(197, 168, 128, 0.05)">
                            <div style="color:var(--primary-gold); font-weight:600; margin-bottom:0.25rem">Scent Profile: ${customer.name}</div>
                            <div><strong>Prefers:</strong> ${customer.scentProfile.preferred.join(", ")}</div>
                            <div><strong>Dislikes:</strong> ${customer.scentProfile.disliked.join(", ")}</div>
                            <div style="color:var(--text-secondary); margin-top:0.25rem; font-style:italic">"${customer.scentProfile.remarks}"</div>
                            <div style="margin-top:0.25rem; font-weight:500">Loyalty Balance: ${customer.loyaltyPoints} pts</div>
                        </div>
                    `;
                }
            }
        });
    }
}

// Render Products in POS Billing Grid
function renderPosProducts() {
    const grid = document.getElementById("pos-products-grid");
    const searchInput = document.getElementById("pos-product-search");
    if (!grid) return;

    const render = (query = "") => {
        grid.innerHTML = "";
        const normalizedQuery = query.toLowerCase();

        PERFUMES.forEach(perfume => {
            perfume.variants.forEach(variant => {
                const matchesSearch = perfume.name.toLowerCase().includes(normalizedQuery) ||
                                      perfume.brand.toLowerCase().includes(normalizedQuery) ||
                                      variant.sku.toLowerCase().includes(normalizedQuery) ||
                                      variant.barcode.includes(normalizedQuery);

                if (query && !matchesSearch) return;

                const prodCard = document.createElement("div");
                prodCard.className = "pos-prod-card";
                prodCard.innerHTML = `
                    <div class="pos-prod-image">
                        <img src="${perfume.image}" alt="${perfume.name}" onerror="this.src='https://images.unsplash.com/photo-1541643600914-78b084683601?w=500'">
                    </div>
                    <div class="pos-prod-brand">${perfume.brand}</div>
                    <div class="pos-prod-name">${perfume.name}</div>
                    <div style="font-size:0.75rem; color:var(--text-secondary); margin-bottom:0.5rem">${variant.size} - ${variant.concentration}</div>
                    <div style="font-weight:700; color:var(--primary-gold)">₹${variant.price.toLocaleString('en-IN')}</div>
                `;
                prodCard.addEventListener("click", () => {
                    addToCartState(perfume, variant);
                    renderPosCart();
                });
                grid.appendChild(prodCard);
            });
        });
    };

    if (searchInput) {
        searchInput.addEventListener("input", (e) => render(e.target.value));
        // HID barcode scanners type into the focused field and send Enter
        searchInput.addEventListener("keydown", (e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const code = (searchInput.value || "").trim();
            if (!code) return;
            if (tryAddByBarcodeOrSku(code)) {
                searchInput.value = "";
                render("");
                renderPosCart();
            } else {
                render(code);
            }
        });
    }
    render();
}

function tryAddByBarcodeOrSku(code) {
    const needle = String(code).trim().toLowerCase();
    for (const perfume of PERFUMES) {
        for (const variant of (perfume.variants || [])) {
            const barcode = String(variant.barcode || "").toLowerCase();
            const sku = String(variant.sku || "").toLowerCase();
            if (barcode === needle || sku === needle) {
                addToCartState(perfume, variant);
                showScanToast(variant.barcode || variant.sku, perfume.name, variant.size);
                return true;
            }
        }
    }
    return false;
}

function showScanToast(code, name, size) {
    const toast = document.createElement("div");
    toast.style.cssText = "position:fixed;bottom:2rem;right:2rem;background:var(--accent-emerald);color:white;padding:1rem 2rem;border-radius:4px;border:1px solid var(--primary-gold);z-index:3000;";
    toast.innerHTML = `🔊 <strong>BEEP!</strong> Scanned: ${code}<br><small>${name} (${size}) added.</small>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}

// Simulate Handheld Barcode Scanner
window.simulateBarcodeScan = function() {
    // Pick a random barcode from our variants
    const allVariants = [];
    PERFUMES.forEach(p => {
        p.variants.forEach(v => {
            allVariants.push({ perfume: p, variant: v });
        });
    });

    const random = allVariants[Math.floor(Math.random() * allVariants.length)];
    addToCartState(random.perfume, random.variant);
    renderPosCart();
    showScanToast(random.variant.barcode, random.perfume.name, random.variant.size);
};

// Render POS Cart Column
function renderPosCart() {
    const list = document.getElementById("pos-cart-list");
    const subtotalEl = document.getElementById("pos-subtotal");
    const cgstEl = document.getElementById("pos-cgst");
    const sgstEl = document.getElementById("pos-sgst");
    const totalEl = document.getElementById("pos-total");

    if (!list) return;

    list.innerHTML = "";

    if (cart.length === 0) {
        list.innerHTML = `<div style="text-align:center; color:var(--text-muted); margin-top:4rem">
            <i class="fas fa-shopping-cart" style="font-size:2rem; margin-bottom:1rem; display:block"></i>
            Cart is empty.<br>Scan a barcode or click a product.
        </div>`;
        subtotalEl.textContent = "₹0.00";
        cgstEl.textContent = "₹0.00";
        sgstEl.textContent = "₹0.00";
        totalEl.textContent = "₹0.00";
        return;
    }

    let subtotal = 0;
    let totalCgst = 0;
    let totalSgst = 0;

    cart.forEach(item => {
        const itemSubtotal = item.price * item.qty;
        subtotal += itemSubtotal;

        // Dynamic local GST split (Standard 18% total: 9% CGST + 9% SGST)
        const cgstRate = 0.09; 
        const sgstRate = 0.09;
        const itemCgst = itemSubtotal * cgstRate;
        const itemSgst = itemSubtotal * sgstRate;

        totalCgst += itemCgst;
        totalSgst += itemSgst;

        const cartItemDiv = document.createElement("div");
        cartItemDiv.className = "pos-cart-item";
        cartItemDiv.innerHTML = `
            <div class="pos-cart-item-info">
                <h5>${item.name}</h5>
                <span>${item.size} | ${item.concentration} | GST 18%</span>
                <button type="button" onclick="overrideCartPrice('${item.variantId}')" style="background:none;border:none;color:var(--primary-gold);font-size:0.65rem;cursor:pointer;padding:0;margin-top:0.2rem;">Edit price</button>
            </div>
            <div class="pos-cart-item-qty">
                <button class="qty-btn" onclick="updatePosCartQty('${item.variantId}', -1)">-</button>
                <span>${item.qty}</span>
                <button class="qty-btn" onclick="updatePosCartQty('${item.variantId}', 1)">+</button>
            </div>
            <div class="pos-cart-item-price">₹${(itemSubtotal).toLocaleString('en-IN')}</div>
        `;
        list.appendChild(cartItemDiv);
    });

    const finalTotal = subtotal + totalCgst + totalSgst;

    subtotalEl.textContent = `₹${subtotal.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    cgstEl.textContent = `₹${totalCgst.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    sgstEl.textContent = `₹${totalSgst.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    totalEl.textContent = `₹${finalTotal.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    if (typeof updateSplitRemainder === "function") updateSplitRemainder();
    if (typeof updateRedeemHint === "function") updateRedeemHint();
}

window.updatePosCartQty = function(variantId, change) {
    const idx = cart.findIndex(item => item.variantId === variantId);
    if (idx !== -1) {
        cart[idx].qty += change;
        if (cart[idx].qty <= 0) {
            cart.splice(idx, 1);
        }
        renderPosCart();
    }
};

window.clearPosCart = function() {
    if (confirm("Are you sure you want to clear the current transaction?")) {
        cart = [];
        renderPosCart();
    }
};

window.overrideCartPrice = async function(variantId) {
    const item = cart.find(i => i.variantId === variantId);
    if (!item) return;
    const raw = prompt(`New unit price for ${item.name} (current ₹${item.price}):`, String(item.price));
    if (raw == null) return;
    const newPrice = parseFloat(raw);
    if (Number.isNaN(newPrice) || newPrice <= 0) {
        alert("Enter a valid price.");
        return;
    }
    const approval = await promptManagerPin(`Approve cart price override for ${item.name}`);
    if (!approval) return;

    if (useBackend && !approval.skipped) {
        try {
            const res = await fetch(`${API_BASE_URL}/overrides/price`, {
                method: "POST",
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    variantId,
                    oldPrice: item.price,
                    newPrice,
                    managerPin: approval.managerPin
                })
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                alert(data.error || "Manager approval failed");
                return;
            }
        } catch (e) {
            alert("Could not verify manager PIN with server.");
            return;
        }
    }

    item.price = newPrice;
    renderPosCart();
};

// --- PAYMENT: Cash + Razorpay (Card / UPI) + optional split tender ---
function getCartTotals() {
    let subtotal = 0;
    cart.forEach(i => { subtotal += i.price * i.qty; });
    const cgst = subtotal * 0.09;
    const sgst = subtotal * 0.09;
    const gross = Math.round((subtotal + cgst + sgst) * 100) / 100;
    const redeemPoints = getRedeemPointsInput();
    const discount = Math.min(redeemPoints, Math.floor(gross / 100) * 100);
    const total = Math.round((gross - discount) * 100) / 100;
    return {
        subtotal: Math.round(subtotal * 100) / 100,
        cgst: Math.round(cgst * 100) / 100,
        sgst: Math.round(sgst * 100) / 100,
        gross,
        redeemPoints: discount,
        discount,
        total
    };
}

function getRedeemPointsInput() {
    const el = document.getElementById("pos-redeem-points");
    let pts = parseInt(el && el.value ? el.value : "0", 10);
    if (Number.isNaN(pts) || pts < 0) pts = 0;
    return pts;
}

window.onPosCustomerChange = function() {
    const select = document.getElementById("pos-customer-select-dropdown");
    const redeemBox = document.getElementById("pos-loyalty-redeem");
    const hint = document.getElementById("pos-redeem-hint");
    const input = document.getElementById("pos-redeem-points");
    if (!select || !redeemBox) return;
    if (select.value === "walkin") {
        redeemBox.style.display = "none";
        if (input) input.value = "0";
        return;
    }
    const customer = CUSTOMERS.find(c => c.id === select.value);
    redeemBox.style.display = "block";
    if (hint && customer) {
        const tier = customer.loyaltyTier || loyaltyTierClient(customer.loyaltyPoints);
        hint.textContent = `${tier} · ${customer.loyaltyPoints} pts avail`;
    }
    updateRedeemHint();
};

window.updateRedeemHint = function() {
    const hint = document.getElementById("pos-redeem-hint");
    const select = document.getElementById("pos-customer-select-dropdown");
    if (!hint || !select || select.value === "walkin") return;
    const customer = CUSTOMERS.find(c => c.id === select.value);
    if (!customer) return;
    const totals = getCartTotals();
    const tier = customer.loyaltyTier || loyaltyTierClient(customer.loyaltyPoints);
    hint.textContent = `${tier} · ${customer.loyaltyPoints} pts · −₹${totals.discount}`;
};

function getCustomerCheckoutContext() {
    const customerSelect = document.getElementById("pos-customer-select-dropdown");
    const customerVal = customerSelect ? customerSelect.value : "walkin";
    let customerName = "Walk-in Customer";
    let phoneNum = "";
    if (customerVal !== "walkin") {
        const customer = CUSTOMERS.find(c => c.id === customerVal);
        if (customer) {
            customerName = customer.name;
            phoneNum = customer.phone;
        }
    }
    return { customerSelect, customerVal, customerName, phoneNum };
}

window.updateSplitRemainder = function() {
    const totals = getCartTotals();
    const cashInput = document.getElementById("pos-cash-amount");
    const remEl = document.getElementById("pos-digital-remainder");
    if (!remEl) return;
    let cash = parseFloat(cashInput && cashInput.value ? cashInput.value : "0");
    if (Number.isNaN(cash) || cash < 0) cash = 0;
    if (cash > totals.total) cash = totals.total;
    const digital = Math.round((totals.total - cash) * 100) / 100;
    remEl.textContent = `₹${digital.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

window.processCashPayment = function() {
    if (cart.length === 0) {
        alert("Please add items to the cart before checking out.");
        return;
    }
    if (confirm("Proceed with CASH payment for the full total?")) {
        completeCashTransaction();
    }
};

window.processRazorpayPayment = async function() {
    if (cart.length === 0) {
        alert("Please add items to the cart before checking out.");
        return;
    }
    if (typeof Razorpay === "undefined") {
        alert("Razorpay Checkout failed to load. Check your network and refresh.");
        return;
    }

    const totals = getCartTotals();
    const cashInput = document.getElementById("pos-cash-amount");
    let cashAmount = parseFloat(cashInput && cashInput.value ? cashInput.value : "0");
    if (Number.isNaN(cashAmount) || cashAmount < 0) cashAmount = 0;
    cashAmount = Math.round(cashAmount * 100) / 100;
    if (cashAmount > totals.total) {
        alert("Cash amount cannot exceed the cart total.");
        return;
    }
    const digitalAmount = Math.round((totals.total - cashAmount) * 100) / 100;
    if (digitalAmount <= 0) {
        alert("Digital amount is ₹0. Use Cash Pay for a full-cash sale.");
        return;
    }

    if (!useBackend) {
        alert("Razorpay requires the cloud API. Start the backend or set config.js to the live API.");
        return;
    }

    const { customerVal, customerName, phoneNum, customerSelect } = getCustomerCheckoutContext();
    const invoiceNo = "H2O-" + new Date().getFullYear() + "-" + Math.floor(1000 + Math.random() * 9000);
    const employeeName = authenticatedUser ? authenticatedUser.name : "Siddharth (Cashier)";
    const items = cart.map(item => ({
        variantId: item.variantId,
        name: `${item.name} (${item.size})`,
        qty: item.qty,
        price: item.price
    }));

    try {
        const createRes = await fetch(`${API_BASE_URL}/payments/create-order`, {
            method: "POST",
            headers: getAuthHeaders(),
                body: JSON.stringify({
                    invoiceNo,
                    customerId: customerVal,
                    customerName,
                    employeeName,
                    subtotal: totals.subtotal,
                    cgst: totals.cgst,
                    sgst: totals.sgst,
                    total: totals.total,
                    cashAmount,
                    digitalAmount,
                    redeemPoints: totals.redeemPoints,
                    items
                })
            });
        const createData = await createRes.json().catch(() => ({}));
        if (!createRes.ok) {
            alert(createData.error || "Failed to create Razorpay order");
            return;
        }

        const rzp = new Razorpay({
            key: createData.keyId,
            amount: createData.amount,
            currency: createData.currency || "INR",
            name: "H2O Perfumes",
            description: invoiceNo + (cashAmount > 0 ? ` (Cash ₹${cashAmount} + Card/UPI ₹${digitalAmount})` : "") + (totals.redeemPoints ? ` · Redeem ${totals.redeemPoints} pts` : ""),
            order_id: createData.orderId,
            prefill: {
                name: customerName !== "Walk-in Customer" ? customerName : "",
                contact: phoneNum || ""
            },
            theme: { color: "#c9a227" },
            handler: async function (response) {
                try {
                    const verifyRes = await fetch(`${API_BASE_URL}/payments/verify`, {
                        method: "POST",
                        headers: getAuthHeaders(),
                        body: JSON.stringify({
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature
                        })
                    });
                    const verifyData = await verifyRes.json().catch(() => ({}));
                    if (!verifyRes.ok) {
                        alert(verifyData.error || "Payment received but verification failed. Check Razorpay dashboard / webhook.");
                        return;
                    }
                    if (customerVal !== "walkin") {
                        const customer = CUSTOMERS.find(c => c.id === customerVal);
                        if (customer) customer.loyaltyPoints += Math.floor(totals.total / 10);
                    }
                    const methodLabel = cashAmount > 0 ? "Split: Cash+Razorpay" : "Razorpay";
                    alert(`🎉 Payment verified!\n\nInvoice: ${invoiceNo}\nTotal: ₹${totals.total.toLocaleString("en-IN")}\nPayment: ${methodLabel}\nRef: ${response.razorpay_payment_id}`);
                    await finishCheckoutUi({ customerSelect, phoneNum, customerName, invoiceNo, total: totals.total, txId: verifyData.transactionId });
                } catch (err) {
                    console.error(err);
                    alert("Verification request failed. If money was captured, webhook will finalize the sale.");
                }
            }
        });
        rzp.on("payment.failed", function (resp) {
            alert("Payment failed: " + ((resp.error && resp.error.description) || "Unknown error"));
        });
        rzp.open();
    } catch (err) {
        console.error(err);
        alert("Could not start Razorpay checkout.");
    }
};

async function completeCashTransaction() {
    const totals = getCartTotals();
    const { customerSelect, customerVal, customerName, phoneNum } = getCustomerCheckoutContext();
    const invoiceNo = "H2O-" + new Date().getFullYear() + "-" + Math.floor(1000 + Math.random() * 9000);
    const employeeName = authenticatedUser ? authenticatedUser.name : "Siddharth (Cashier)";
    const items = cart.map(item => ({
        variantId: item.variantId,
        name: `${item.name} (${item.size})`,
        qty: item.qty,
        price: item.price
    }));

    if (customerVal !== "walkin") {
        const customer = CUSTOMERS.find(c => c.id === customerVal);
        if (customer) customer.loyaltyPoints += Math.floor(totals.total / 10);
    }

    let checkoutSuccess = false;
    let txId = "tx_" + Date.now();

    if (useBackend) {
        try {
            const res = await fetch(`${API_BASE_URL}/transactions`, {
                method: "POST",
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    invoiceNo,
                    customerId: customerVal,
                    customerName,
                    employeeName,
                    subtotal: totals.subtotal,
                    cgst: totals.cgst,
                    sgst: totals.sgst,
                    total: totals.total,
                    paymentMethod: "Cash",
                    referenceId: "",
                    redeemPoints: totals.redeemPoints,
                    splits: [{ method: "cash", amount: totals.total, referenceId: "" }],
                    items
                })
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                checkoutSuccess = true;
                txId = data.transactionId || txId;
                alert(`🎉 [Cloud] Transaction Completed!\n\nInvoice: ${invoiceNo}\nTotal: ₹${totals.total.toLocaleString("en-IN")}\nPayment: Cash${totals.redeemPoints ? `\nRedeemed: ${totals.redeemPoints} pts` : ""}`);
            } else {
                alert(data.error || "Cash transaction failed on server");
            }
        } catch (e) {
            console.error("Backend transaction failed, falling back to local...", e);
        }
    }

    if (!checkoutSuccess) {
        salesHistory.push({
            id: txId,
            invoiceNo,
            date: new Date().toISOString(),
            customerName,
            employeeName,
            subtotal: totals.subtotal,
            cgst: totals.cgst,
            sgst: totals.sgst,
            total: totals.total,
            paymentMethod: "Cash",
            referenceId: "",
            items: items.map(({ name, qty, price }) => ({ name, qty, price }))
        });
        cart.forEach(item => {
            const perfume = PERFUMES.find(p => p.id === item.perfumeId);
            if (perfume && perfume.batches && perfume.batches[0]) {
                perfume.batches[0].qty = Math.max(0, perfume.batches[0].qty - item.qty);
            }
        });
        alert(`🎉 [Offline] Transaction Completed!\n\nInvoice: ${invoiceNo}\nTotal: ₹${totals.total.toLocaleString("en-IN")}\nPayment: Cash`);
    }

    await finishCheckoutUi({ customerSelect, phoneNum, customerName, invoiceNo, total: totals.total, txId });
}

async function finishCheckoutUi({ customerSelect, phoneNum, customerName, invoiceNo, total, txId }) {
    if (phoneNum && useBackend && customerSelect && customerSelect.value !== "walkin") {
        const sendSms = confirm(`Queue receipt SMS to ${customerName}?`);
        if (sendSms) {
            try {
                const body = `Hi ${customerName}, thanks for shopping at H2O. Invoice ${invoiceNo} for ₹${total.toLocaleString("en-IN")} is ready.`;
                const res = await fetch(`${API_BASE_URL}/crm/customers/${encodeURIComponent(customerSelect.value)}/offer-sms`, {
                    method: "POST",
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ body })
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok) alert(data.message || "Receipt SMS queued");
                else alert(data.error || "Could not queue receipt SMS");
            } catch (e) {
                console.error(e);
            }
        }
    }

    cart = [];
    const cashInput = document.getElementById("pos-cash-amount");
    if (cashInput) cashInput.value = "";
    const redeemInput = document.getElementById("pos-redeem-points");
    if (redeemInput) redeemInput.value = "0";
    updateSplitRemainder();
    if (customerSelect) customerSelect.value = "walkin";
    onPosCustomerChange();
    const profileDiv = document.getElementById("pos-selected-customer-profile");
    if (profileDiv) profileDiv.style.display = "none";

    if (useBackend) await syncDataFromBackend();

    renderPosCart();
    renderPosInventory();
    renderPosCRM();
    if (typeof renderPosReports === "function") renderPosReports();
    renderPosProducts();
}

// --- TAB 2: Inventory Management ---
function renderPosInventory() {
    const tableBody = document.getElementById("pos-inventory-table-body");
    if (!tableBody) return;

    tableBody.innerHTML = "";

    PERFUMES.forEach(perfume => {
        perfume.variants.forEach(variant => {
            const batch = perfume.batches[0] || { batchNo: "N/A", mfgDate: "N/A", expDate: "N/A", qty: 0 };
            
            // Highlight low stock or near expiry
            const isLowStock = batch.qty < 10;
            const stockStatus = isLowStock 
                ? `<span style="color:#ef4444; font-weight:600">⚠️ ${batch.qty} (Low)</span>` 
                : `<span style="color:#10b981">${batch.qty}</span>`;

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${perfume.name}</strong><br><small style="color:var(--text-muted)">${perfume.brand}</small></td>
                <td>${variant.size} (${variant.concentration})</td>
                <td><code>${variant.sku}</code></td>
                <td><code>${batch.batchNo}</code></td>
                <td><small>${batch.expDate}</small></td>
                <td>₹${variant.price.toLocaleString('en-IN')}</td>
                <td>${stockStatus}</td>
                <td>
                    <button class="btn btn-outline" style="padding:0.25rem 0.5rem; font-size:0.75rem" onclick="openRestockModal('${perfume.id}', '${variant.id}')">Add Stock</button>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    });
}

function loyaltyTierClient(points) {
    const p = Number(points) || 0;
    if (p >= 1500) return "Platinum";
    if (p >= 500) return "Gold";
    return "Silver";
}

// --- TAB 3: CRM / Customer Scent Profiles ---
function renderPosCRM() {
    const tableBody = document.getElementById("pos-crm-table-body");
    if (!tableBody) return;

    tableBody.innerHTML = "";

    CUSTOMERS.forEach(customer => {
        const rawPhone = customer.phone || "";
        const maskedPhone = rawPhone.length > 8
            ? rawPhone.substring(0, 7) + " ****" + rawPhone.substring(rawPhone.length - 2)
            : rawPhone;
        const tier = customer.loyaltyTier || loyaltyTierClient(customer.loyaltyPoints);
        const preferred = (customer.scentProfile && customer.scentProfile.preferred) || [];

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${customer.name}</strong></td>
            <td><code>${maskedPhone}</code></td>
            <td>${preferred.map(n => `<span class="result-note" style="font-size:0.75rem">${n}</span>`).join(" ")}</td>
            <td><span class="badge">${tier}</span></td>
            <td><span class="badge">${customer.loyaltyPoints} pts</span></td>
            <td>
                <button class="btn btn-outline" style="padding:0.25rem 0.5rem; font-size:0.75rem" onclick="queueCustomerOfferSms('${customer.id}')">Queue SMS</button>
            </td>
        `;
        tableBody.appendChild(tr);
    });

    loadUpcomingOccasions();
}

window.queueCustomerOfferSms = async function(customerId) {
    if (!useBackend) {
        alert("SMS queue requires the cloud API.");
        return;
    }
    try {
        const res = await fetch(`${API_BASE_URL}/crm/customers/${encodeURIComponent(customerId)}/offer-sms`, {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({})
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            alert(data.error || "Failed to queue SMS");
            return;
        }
        alert(data.message || "Offer SMS queued");
    } catch (e) {
        alert("SMS request failed");
    }
};

async function loadUpcomingOccasions() {
    const body = document.getElementById("pos-crm-occasions-body");
    if (!body) return;
    if (!useBackend || !localStorage.getItem("h2o_pos_token")) {
        body.innerHTML = `<tr><td colspan="5" style="color:var(--text-muted);">Login required for occasions.</td></tr>`;
        return;
    }
    try {
        const res = await fetch(`${API_BASE_URL}/crm/upcoming-occasions?days=7`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error("fail");
        const data = await res.json();
        body.innerHTML = "";
        if (!data.rows || !data.rows.length) {
            body.innerHTML = `<tr><td colspan="5" style="color:var(--text-muted);">No birthdays/anniversaries in the next 7 days.</td></tr>`;
            return;
        }
        data.rows.forEach(row => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${row.name}</td>
                <td>${(row.occasions || []).join(", ")}</td>
                <td>${row.birthday ? String(row.birthday).slice(0, 10) : "—"}</td>
                <td>${row.anniversary ? String(row.anniversary).slice(0, 10) : "—"}</td>
                <td>${row.loyaltyTier || loyaltyTierClient(row.loyaltyPoints)}</td>
            `;
            body.appendChild(tr);
        });
    } catch (e) {
        body.innerHTML = `<tr><td colspan="5" style="color:var(--text-muted);">Could not load occasions.</td></tr>`;
    }
}

window.runBirthdayOffers = async function() {
    if (!useBackend) {
        alert("Requires cloud API + Manager login (or CRON_SECRET).");
        return;
    }
    if (!confirm("Queue birthday/anniversary offer SMS for customers due in the next 7 days?")) return;
    try {
        const res = await fetch(`${API_BASE_URL}/crm/birthday-offers/run`, {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({ days: 7 })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            alert(data.error || "Failed to run offers");
            return;
        }
        const n = (data.queued || []).length;
        alert(`Queued ${n} offer SMS.${data.twilioConfigured ? "" : " Twilio not configured — messages logged to outbox."}`);
        loadUpcomingOccasions();
    } catch (e) {
        alert("Birthday offers request failed");
    }
};

// --- TAB 4: Reports & GST & Tally Sync ---
function renderPosReports() {
    const totalSalesEl = document.getElementById("rep-total-sales");
    const totalTaxEl = document.getElementById("rep-total-tax");
    const totalTxEl = document.getElementById("rep-total-tx");
    const commissionEl = document.getElementById("rep-commission");

    if (!totalSalesEl) return;

    const paidTx = salesHistory.filter(tx => (tx.paymentStatus || "paid") === "paid");
    let totalRevenue = 0;
    let totalTax = 0;
    const staffMap = {};

    paidTx.forEach(tx => {
        totalRevenue += tx.total;
        totalTax += (tx.cgst + tx.sgst);
        const key = tx.employeeId || tx.employeeName || "Unknown";
        if (!staffMap[key]) {
            staffMap[key] = { name: tx.employeeName || "Unknown", sales: 0, tx_count: 0 };
        }
        staffMap[key].sales += tx.subtotal;
        staffMap[key].tx_count += 1;
    });

    const commissionEarned = Object.values(staffMap).reduce((s, row) => s + row.sales * 0.05, 0);

    // Prefer cloud byEmployee when available
    const staffRows = (lastReportByEmployee && lastReportByEmployee.length)
        ? lastReportByEmployee
        : Object.values(staffMap).map(r => ({
            name: r.name,
            sales: r.sales,
            commission: r.sales * 0.05,
            tx_count: r.tx_count
        }));

    if (!(lastReportByEmployee && lastReportByEmployee.length)) {
        totalSalesEl.textContent = `₹${totalRevenue.toLocaleString('en-IN', {maximumFractionDigits:0})}`;
        totalTaxEl.textContent = `₹${totalTax.toLocaleString('en-IN', {maximumFractionDigits:0})}`;
        totalTxEl.textContent = paidTx.length;
        commissionEl.textContent = `₹${commissionEarned.toLocaleString('en-IN', {maximumFractionDigits:0})}`;
    }

    const staffBody = document.getElementById("pos-reports-staff-body");
    if (staffBody) {
        staffBody.innerHTML = "";
        if (!staffRows.length) {
            staffBody.innerHTML = `<tr><td colspan="4" style="color:var(--text-muted);">No sales yet today.</td></tr>`;
        } else {
            staffRows.forEach(row => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>${row.name}</td>
                    <td>${row.tx_count || row.txCount || 0}</td>
                    <td>₹${parseFloat(row.sales).toLocaleString('en-IN', {maximumFractionDigits:0})}</td>
                    <td>₹${parseFloat(row.commission).toLocaleString('en-IN', {maximumFractionDigits:0})}</td>
                `;
                staffBody.appendChild(tr);
            });
        }
    }

    const historyBody = document.getElementById("pos-reports-history-body");
    if (historyBody) {
        historyBody.innerHTML = "";
        salesHistory.forEach(tx => {
            const status = tx.paymentStatus || "paid";
            const canVoid = status === "paid";
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><small>${new Date(tx.date).toLocaleDateString()} ${new Date(tx.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</small></td>
                <td><strong>${tx.invoiceNo}</strong></td>
                <td>${tx.customerName}</td>
                <td>${tx.employeeName || "—"}</td>
                <td>${tx.paymentMethod}</td>
                <td>${status}</td>
                <td>₹${tx.total.toLocaleString('en-IN')}</td>
                <td>${canVoid ? `<button class="btn btn-outline" style="font-size:0.65rem;padding:0.25rem 0.5rem;" onclick="voidTransaction('${tx.id}')">Void</button>` : ""}</td>
            `;
            historyBody.appendChild(tr);
        });
    }

    loadTopPerformers();
    loadDeadStock();
}

window.loadTopPerformers = async function() {
    const body = document.getElementById("pos-reports-top-body");
    if (!body) return;
    if (!useBackend || !localStorage.getItem("h2o_pos_token")) {
        body.innerHTML = `<tr><td colspan="3" style="color:var(--text-muted);">Login required.</td></tr>`;
        return;
    }
    const days = parseInt(document.getElementById("rep-top-days")?.value || "30", 10) || 30;
    const groupBy = document.getElementById("rep-top-group")?.value || "brand";
    try {
        const res = await fetch(`${API_BASE_URL}/reports/top-performers?days=${days}&groupBy=${encodeURIComponent(groupBy)}`, {
            headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error("fail");
        const data = await res.json();
        body.innerHTML = "";
        if (!data.rows || !data.rows.length) {
            body.innerHTML = `<tr><td colspan="3" style="color:var(--text-muted);">No paid sales in this window.</td></tr>`;
            return;
        }
        data.rows.forEach(row => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${row.label}</td>
                <td>₹${parseFloat(row.revenue).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                <td>${row.units}</td>
            `;
            body.appendChild(tr);
        });
    } catch (e) {
        body.innerHTML = `<tr><td colspan="3" style="color:var(--text-muted);">Could not load top performers.</td></tr>`;
    }
};

function formatOwnerInr(n) {
    return "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function fillOwnerList(el, rows, mapFn, empty) {
    if (!el) return;
    if (!rows || !rows.length) {
        el.innerHTML = `<p style="color:var(--text-muted); font-size:0.85rem; margin:0;">${empty}</p>`;
        return;
    }
    el.innerHTML = rows.map(mapFn).join("");
}

window.renderOwnerDashboard = async function() {
    const errEl = document.getElementById("owner-dash-error");
    if (errEl) {
        errEl.style.display = "none";
        errEl.textContent = "";
    }
    if (!isManagerUser(authenticatedUser)) {
        if (errEl) {
            errEl.style.display = "block";
            errEl.textContent = "Manager / Owner login required.";
        }
        return;
    }
    if (!useBackend || !localStorage.getItem("h2o_pos_token")) {
        if (errEl) {
            errEl.style.display = "block";
            errEl.textContent = "Cloud API login required for Owner Live.";
        }
        return;
    }
    try {
        const res = await fetch(`${API_BASE_URL}/owner/dashboard`, { headers: getAuthHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to load owner dashboard");

        const s = data.summary || {};
        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };
        set("owner-kpi-sales", formatOwnerInr(s.gross_sales));
        set("owner-kpi-tax", formatOwnerInr(s.total_tax));
        set("owner-kpi-tx", String(s.tx_count || 0));
        set("owner-kpi-comm", formatOwnerInr(s.commission));
        const updated = document.getElementById("owner-dash-updated");
        if (updated) {
            updated.textContent = data.generatedAt
                ? `Updated ${new Date(data.generatedAt).toLocaleString("en-IN")}`
                : "";
        }

        const rowHtml = (left, right) =>
            `<div style="display:flex;justify-content:space-between;gap:0.75rem;padding:0.45rem 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:0.85rem;"><span>${left}</span><span>${right}</span></div>`;

        fillOwnerList(
            document.getElementById("owner-by-employee"),
            data.byEmployee,
            (r) => rowHtml(r.name, `${formatOwnerInr(r.sales)} · ${r.tx_count} tx · comm ${formatOwnerInr(r.commission)}`),
            "No paid sales yet today."
        );
        fillOwnerList(
            document.getElementById("owner-low-stock"),
            data.lowStock,
            (r) => rowHtml(`${r.perfume} <span style="color:var(--text-muted);font-size:0.75rem;">${r.size || ""} ${r.sku || ""}</span>`, String(r.qty)),
            "No low-stock SKUs."
        );
        fillOwnerList(
            document.getElementById("owner-dead-stock"),
            data.deadStock,
            (r) => rowHtml(`${r.perfume} <span style="color:var(--text-muted);font-size:0.75rem;">${r.size || ""}</span>`, `${r.qty} · ${r.batch_age_days || "?"}d`),
            "No dead stock flagged."
        );
    } catch (e) {
        if (errEl) {
            errEl.style.display = "block";
            errEl.textContent = e.message || "Could not load owner dashboard.";
        }
    }
};

window.loadDeadStock = async function() {
    const body = document.getElementById("pos-reports-dead-body");
    if (!body) return;
    if (!useBackend || !localStorage.getItem("h2o_pos_token")) {
        body.innerHTML = `<tr><td colspan="5" style="color:var(--text-muted);">Login required.</td></tr>`;
        return;
    }
    const days = parseInt(document.getElementById("rep-dead-days")?.value || "30", 10) || 30;
    try {
        const res = await fetch(`${API_BASE_URL}/reports/dead-stock?days=${days}`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error("fail");
        const data = await res.json();
        body.innerHTML = "";
        if (!data.rows || !data.rows.length) {
            body.innerHTML = `<tr><td colspan="5" style="color:var(--text-muted);">No dead stock for this window.</td></tr>`;
            return;
        }
        data.rows.forEach(row => {
            const tr = document.createElement("tr");
            const last = row.last_sale ? new Date(row.last_sale).toLocaleDateString() : "Never";
            tr.innerHTML = `
                <td>${row.perfume} (${row.size}) · ${row.brand}</td>
                <td><code>${row.sku}</code></td>
                <td>${row.qty}</td>
                <td>${row.batch_age_days ?? "—"}</td>
                <td>${last}</td>
            `;
            body.appendChild(tr);
        });
    } catch (e) {
        body.innerHTML = `<tr><td colspan="5" style="color:var(--text-muted);">Could not load dead stock.</td></tr>`;
    }
};

window.voidTransaction = async function(txId) {
    if (!txId) return;
    const reason = prompt("Reason for void / refund:");
    if (reason == null) return;
    const approval = await promptManagerPin("Manager PIN required to void this sale");
    if (!approval) return;

    if (!useBackend) {
        const tx = salesHistory.find(t => t.id === txId);
        if (tx) tx.paymentStatus = "voided";
        renderPosReports();
        alert("Sale voided locally (offline).");
        return;
    }

    try {
        const body = { reason };
        if (!approval.skipped) body.managerPin = approval.managerPin;
        const res = await fetch(`${API_BASE_URL}/transactions/${encodeURIComponent(txId)}/void`, {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            alert(data.error || "Void failed");
            return;
        }
        alert(data.message || "Transaction voided");
        await syncDataFromBackend();
        renderPosReports();
        renderPosInventory();
    } catch (e) {
        console.error(e);
        alert("Void request failed");
    }
};

async function refreshShiftStatus() {
    const label = document.getElementById("shift-clock-label");
    const status = document.getElementById("shift-status-text");
    if (!useBackend || !localStorage.getItem("h2o_pos_token")) {
        openShift = null;
        if (label) label.textContent = "Clock In";
        if (status) status.textContent = "";
        return;
    }
    try {
        const res = await fetch(`${API_BASE_URL}/shifts/me`, { headers: getAuthHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        openShift = data.openShift || null;
        if (label) label.textContent = openShift ? "Clock Out" : "Clock In";
        if (status) {
            const hrs = Number(data.hoursToday || 0).toFixed(2);
            status.textContent = openShift
                ? `On shift · ${hrs}h today`
                : (hrs > 0 ? `${hrs}h today` : "");
        }
    } catch (e) {
        console.error(e);
    }
}

window.toggleShiftClock = async function() {
    if (!useBackend) {
        alert("Shift clock requires the cloud API.");
        return;
    }
    if (!localStorage.getItem("h2o_pos_token")) {
        alert("Log in first.");
        return;
    }
    try {
        const endpoint = openShift ? "/shifts/clock-out" : "/shifts/clock-in";
        const res = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({})
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            alert(data.error || "Shift update failed");
            return;
        }
        await refreshShiftStatus();
    } catch (e) {
        alert("Shift request failed");
    }
};

// --- Tally ERP XML Export Engine (REQ-06 / Independent Ledger) ---
window.exportToTally = async function() {
    const xmlContainer = document.getElementById("tally-xml-content");
    const statusEl = document.getElementById("tally-export-status");
    const modal = document.getElementById("tally-export-modal");
    if (modal) modal.style.display = "flex";
    if (statusEl) statusEl.textContent = "Generating…";

    const today = new Date().toISOString().slice(0, 10);

    if (useBackend && localStorage.getItem("h2o_pos_token")) {
        try {
            const res = await fetch(
                `${API_BASE_URL}/integrations/tally/export?from=${encodeURIComponent(today)}&to=${encodeURIComponent(today)}`,
                { method: "POST", headers: getAuthHeaders(), body: JSON.stringify({ from: today, to: today, pushRemote: true }) }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "Tally export failed");
            if (xmlContainer) xmlContainer.textContent = data.xml || "";
            if (statusEl) {
                const pushNote = data.tallyConfigured
                    ? (data.status === "pushed" ? "Pushed to TALLY_HTTP_URL." : `Push status: ${data.status}.`)
                    : "XML only (set TALLY_HTTP_URL on API to auto-push).";
                statusEl.textContent = `${data.voucherCount || 0} vouchers · ${pushNote}`;
            }
            return;
        } catch (e) {
            console.warn("Server Tally export failed, falling back to local XML", e);
            if (statusEl) statusEl.textContent = `Server export failed (${e.message}). Showing local XML.`;
        }
    }

    let tallyXml = `<?xml version="1.0"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>\n`;

    salesHistory.filter(tx => (tx.paymentStatus || "paid") === "paid").forEach(tx => {
        const cleanDate = String(tx.date).split("T")[0].replace(/-/g, "");
        tallyXml += `        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="AccountingVoucher">
            <DATE>${cleanDate}</DATE>
            <VOUCHERNUMBER>${tx.invoiceNo}</VOUCHERNUMBER>
            <PARTYLEDGERNAME>${tx.customerName === "Walk-in Customer" ? "Cash" : tx.customerName}</PARTYLEDGERNAME>
            <EFFECTIVEDATE>${cleanDate}</EFFECTIVEDATE>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Sales Account</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${(Number(tx.subtotal) || 0).toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>CGST @ 9%</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${(Number(tx.cgst) || 0).toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>SGST @ 9%</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${(Number(tx.sgst) || 0).toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${tx.paymentMethod === "Cash" ? "Cash-in-Hand" : "Razorpay Bank A/c"}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>-${(Number(tx.total) || 0).toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>\n`;
    });

    tallyXml += `      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

    if (xmlContainer) xmlContainer.textContent = tallyXml;
    if (statusEl && !useBackend) statusEl.textContent = "Offline mock — local XML only.";
};

window.closeTallyModal = function() {
    document.getElementById("tally-export-modal").style.display = "none";
};

// --- INTERACTIVE FRAGRANCE MIST BACKGROUND ANIMATION ---
function initMistCanvas() {
    const canvas = document.getElementById("mist-canvas");
    const hero = document.getElementById("hero-section");
    if (!canvas || !hero) return;

    const ctx = canvas.getContext("2d");
    let width = (canvas.width = hero.clientWidth);
    let height = (canvas.height = hero.clientHeight);

    let particles = [];
    const maxParticles = 120;

    // Adjust canvas size on window resize
    window.addEventListener("resize", () => {
        width = canvas.width = hero.clientWidth;
        height = canvas.height = hero.clientHeight;
    });

    class MistParticle {
        constructor(x, y, isSpray = false) {
            this.x = x;
            this.y = y;
            // Spray particles shoot out faster, ambient particles drift slowly
            if (isSpray) {
                const angle = Math.random() * Math.PI * 2;
                const speed = Math.random() * 2.5 + 0.5;
                this.vx = Math.cos(angle) * speed;
                this.vy = Math.sin(angle) * speed - 0.3; // slight upward bias
                this.radius = Math.random() * 8 + 4;
                this.alpha = Math.random() * 0.4 + 0.25;
                this.fadeSpeed = Math.random() * 0.006 + 0.006;
            } else {
                this.vx = (Math.random() - 0.5) * 0.4;
                this.vy = -Math.random() * 0.3 - 0.1; // float upwards
                this.radius = Math.random() * 25 + 15; // large ambient clouds
                this.alpha = Math.random() * 0.12 + 0.04;
                this.fadeSpeed = Math.random() * 0.001 + 0.0008;
            }
            this.wobblePhase = Math.random() * 100;
            this.wobbleSpeed = Math.random() * 0.02 + 0.01;
        }

        update() {
            this.x += this.vx;
            this.y += this.vy;

            // Apply friction to spray
            this.vx *= 0.95;
            this.vy *= 0.95;

            // Float upwards (buoyancy)
            this.vy -= 0.003;

            // Drifting wobble
            this.x += Math.sin(this.wobblePhase) * 0.15;
            this.wobblePhase += this.wobbleSpeed;

            this.alpha -= this.fadeSpeed;
        }

        draw() {
            ctx.save();
            // Create a soft radial gradient for a realistic misty look
            let grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius);
            // Elegant warm gold color palette representing perfume mist
            grad.addColorStop(0, `rgba(197, 168, 128, ${this.alpha})`);
            grad.addColorStop(0.4, `rgba(197, 168, 128, ${this.alpha * 0.3})`);
            grad.addColorStop(1, `rgba(197, 168, 128, 0)`);

            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    // Capture mouse movement to emit spray particles
    let lastMouseX = null;
    let lastMouseY = null;

    hero.addEventListener("mousemove", (e) => {
        const rect = hero.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Only spawn if mouse is moving
        if (lastMouseX !== null && (Math.abs(mouseX - lastMouseX) > 2 || Math.abs(mouseY - lastMouseY) > 2)) {
            // Spawn 3 spray particles on mouse move
            if (particles.length < maxParticles) {
                for (let i = 0; i < 3; i++) {
                    particles.push(new MistParticle(mouseX, mouseY, true));
                }
            }
        }
        lastMouseX = mouseX;
        lastMouseY = mouseY;
    });

    hero.addEventListener("mouseleave", () => {
        lastMouseX = null;
        lastMouseY = null;
    });

    // Animation Loop
    function loop() {
        ctx.clearRect(0, 0, width, height);

        // 1. Ambient scent wafting from the bottom
        if (Math.random() < 0.08 && particles.length < maxParticles) {
            // Spawn at random x positions along the bottom
            particles.push(new MistParticle(Math.random() * width, height - 10, false));
        }

        // 2. Update and Draw particles
        particles.forEach((p, idx) => {
            p.update();
            p.draw();

            // Remove faded particles
            if (p.alpha <= 0 || p.x < -50 || p.x > width + 50 || p.y < -50) {
                particles.splice(idx, 1);
            }
        });

        requestAnimationFrame(loop);
    }

    loop();
}

window.downloadTallyXml = function() {
    const text = document.getElementById("tally-xml-content").textContent;
    const blob = new Blob([text], { type: "text/xml" });
    const anchor = document.createElement("a");
    anchor.download = "H2O_Tally_Import.xml";
    anchor.href = window.URL.createObjectURL(blob);
    anchor.dataset.downloadurl = ["text/xml", anchor.download, anchor.href].join(":");
    anchor.click();
    window.URL.revokeObjectURL(anchor.href);
};

// --- CRM: ADD NEW CUSTOMER LOGIC ---
window.openAddCustomerModal = function() {
    const modal = document.getElementById("add-customer-modal");
    if (modal) {
        modal.style.display = "flex";
        
        // Reset fields
        document.getElementById("cust-new-name").value = "";
        document.getElementById("cust-new-phone").value = "";
        document.getElementById("cust-new-email").value = "";
        document.getElementById("cust-new-pref").value = "";
        document.getElementById("cust-new-dislike").value = "";
        document.getElementById("cust-new-remarks").value = "";
        document.getElementById("cust-new-skintype").value = "Normal";
    }
};

window.closeAddCustomerModal = function() {
    const modal = document.getElementById("add-customer-modal");
    if (modal) {
        modal.style.display = "none";
    }
};

window.saveNewCustomer = async function() {
    const name = document.getElementById("cust-new-name").value.trim();
    const phone = document.getElementById("cust-new-phone").value.trim();
    const email = document.getElementById("cust-new-email").value.trim();
    const prefStr = document.getElementById("cust-new-pref").value.trim();
    const dislikeStr = document.getElementById("cust-new-dislike").value.trim();
    const remarks = document.getElementById("cust-new-remarks").value.trim();
    const skinType = document.getElementById("cust-new-skintype").value;
    const birthday = document.getElementById("cust-new-birthday")?.value || null;
    const anniversary = document.getElementById("cust-new-anniversary")?.value || null;

    if (!name || !phone) {
        alert("Please enter both the Name and Phone Number.");
        return;
    }

    // Parse comma separated values
    const preferred = prefStr ? prefStr.split(",").map(n => n.trim()).filter(n => n) : [];
    const disliked = dislikeStr ? dislikeStr.split(",").map(n => n.trim()).filter(n => n) : [];

    const newCustomer = {
        id: "c_" + Date.now(),
        name: name,
        phone: phone,
        email: email || "N/A",
        loyaltyPoints: 0,
        loyaltyTier: "Silver",
        birthday,
        anniversary,
        scentProfile: {
            preferred: preferred,
            disliked: disliked,
            skinType: skinType,
            remarks: remarks || "No specific sensitivities."
        }
    };

    let savedOnCloud = false;
    if (useBackend) {
        try {
            const res = await fetch(`${API_BASE_URL}/customers`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name, phone, email,
                    preferred, disliked,
                    skinType, remarks,
                    birthday, anniversary
                })
            });
            if (res.ok) {
                savedOnCloud = true;
                alert(`👤 [Cloud] New Customer "${name}" registered successfully!`);
            }
        } catch (e) {
            console.error("Backend customer save failed, falling back to local...", e);
        }
    }

    if (!savedOnCloud) {
        CUSTOMERS.push(newCustomer);
        alert(`👤 [Offline] New Customer "${name}" registered successfully!`);
    }
    
    closeAddCustomerModal();
    
    // Refresh UI
    if (useBackend) {
        await syncDataFromBackend();
    }
    renderPosCRM();
    renderCustomerDropdown();
};

function renderCustomerDropdown() {
    const select = document.getElementById("pos-customer-select-dropdown");
    if (!select) return;
    
    const currentVal = select.value;
    
    select.innerHTML = `<option value="walkin">Walk-in Customer (No Profile)</option>`;
    CUSTOMERS.forEach(c => {
        select.innerHTML += `<option value="${c.id}">${c.name} (${c.phone})</option>`;
    });
    
    // Restore selection if it still exists
    if (CUSTOMERS.some(c => c.id === currentVal)) {
        select.value = currentVal;
    } else {
        select.value = "walkin";
    }
}

// --- INVENTORY: ADD PRODUCT & RESTOCK LOGIC ---
let activeRestockPerfumeId = null;
let activeRestockVariantId = null;

window.openAddInventoryModal = function() {
    const modal = document.getElementById("add-inventory-modal");
    if (modal) {
        modal.style.display = "flex";
        
        // Reset fields
        document.getElementById("inv-new-name").value = "";
        document.getElementById("inv-new-brand").value = "";
        document.getElementById("inv-new-size").value = "";
        document.getElementById("inv-new-price").value = "";
        document.getElementById("inv-new-cost").value = "";
        document.getElementById("inv-new-batch").value = "";
        document.getElementById("inv-new-qty").value = "";
        document.getElementById("inv-new-expiry").value = "";
        document.getElementById("inv-new-notes").value = "";
        document.getElementById("inv-new-family").value = "Woody";
        document.getElementById("inv-new-conc").value = "EDP";
    }
};

window.closeAddInventoryModal = function() {
    const modal = document.getElementById("add-inventory-modal");
    if (modal) {
        modal.style.display = "none";
    }
};

window.saveNewInventory = async function() {
    const name = document.getElementById("inv-new-name").value.trim();
    const brand = document.getElementById("inv-new-brand").value.trim();
    const size = document.getElementById("inv-new-size").value.trim();
    const family = document.getElementById("inv-new-family").value;
    const conc = document.getElementById("inv-new-conc").value;
    const price = parseFloat(document.getElementById("inv-new-price").value);
    const cost = parseFloat(document.getElementById("inv-new-cost").value);
    const batchNo = document.getElementById("inv-new-batch").value.trim();
    const qty = parseInt(document.getElementById("inv-new-qty").value);
    const expiry = document.getElementById("inv-new-expiry").value;
    const notesStr = document.getElementById("inv-new-notes").value.trim();

    if (!name || !brand || !size || isNaN(price) || isNaN(cost) || !batchNo || isNaN(qty) || !expiry) {
        alert("Please fill in all required fields (*) with valid numbers.");
        return;
    }

    const approval = await promptManagerPin("Manager PIN required to add inventory");
    if (!approval) return;

    const notes = notesStr ? notesStr.split(",").map(n => n.trim()).filter(n => n) : ["Fragrance Blends"];

    // Generate random barcode and SKU
    const barcode = "890" + Math.floor(100000000 + Math.random() * 900000000);
    const sku = (brand.substring(0, 3) + "-" + name.substring(0, 3) + "-" + conc + "-" + size.replace(/\D/g, "")).toUpperCase();

    const newVariant = {
        id: "v_" + Date.now(),
        size: size,
        concentration: conc,
        price: price,
        sku: sku,
        barcode: barcode
    };

    let savedOnCloud = false;
    if (useBackend) {
        try {
            const payload = {
                name, brand, family, size, concentration: conc,
                price, cost, batchNo, qty, expiry, notes: notesStr
            };
            if (!approval.skipped) payload.managerPin = approval.managerPin;
            const res = await fetch(`${API_BASE_URL}/products`, {
                method: "POST",
                headers: getAuthHeaders(),
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                savedOnCloud = true;
                alert(`📦 [Cloud] Product "${name} (${size})" registered and stocked successfully!`);
            } else {
                alert(data.error || "Failed to save product");
                return;
            }
        } catch (e) {
            console.error("Backend product save failed, falling back to local...", e);
        }
    }

    if (!savedOnCloud) {
        // Check if the product already exists locally
        let perfume = PERFUMES.find(p => p.name.toLowerCase() === name.toLowerCase() && p.brand.toLowerCase() === brand.toLowerCase());
        if (perfume) {
            perfume.variants.push(newVariant);
            perfume.batches.unshift({
                id: "b_" + Date.now(),
                batchNo: batchNo,
                mfgDate: new Date().toISOString().split("T")[0],
                expDate: expiry,
                cost: cost,
                qty: qty
            });
        } else {
            const newProduct = {
                id: "p_" + Date.now(),
                name: name,
                brand: brand,
                family: family,
                gender: "Unisex",
                notes: notes,
                image: "assets/images/oud.png",
                description: `${name} by ${brand}. A premium ${family} fragrance.`,
                variants: [newVariant],
                batches: [
                    {
                        id: "b_" + Date.now(),
                        batchNo: batchNo,
                        mfgDate: new Date().toISOString().split("T")[0],
                        expDate: expiry,
                        cost: cost,
                        qty: qty
                    }
                ]
            };
            PERFUMES.push(newProduct);
        }
        alert(`📦 [Offline] Product "${name} (${size})" registered and stocked successfully!`);
    }

    closeAddInventoryModal();

    // Refresh UI across the app
    if (useBackend) {
        await syncDataFromBackend();
    }
    renderPosInventory();
    renderPosProducts();
    if (typeof renderCatalog === "function") renderCatalog();
};

window.openRestockModal = function(perfumeId, variantId) {
    const perfume = PERFUMES.find(p => p.id === perfumeId);
    const variant = perfume.variants.find(v => v.id === variantId);
    if (!perfume || !variant) return;

    activeRestockPerfumeId = perfumeId;
    activeRestockVariantId = variantId;

    const modal = document.getElementById("restock-modal");
    const subtitle = document.getElementById("restock-modal-subtitle");
    
    if (modal && subtitle) {
        subtitle.innerHTML = `Add stock for <strong>${perfume.name} (${variant.size} - ${variant.concentration})</strong>.<br>Current stock: ${perfume.batches[0]?.qty || 0} units.`;
        
        // Populate default values from active batch if exists
        const activeBatch = perfume.batches[0] || { batchNo: "", expDate: "" };
        document.getElementById("restock-qty").value = "";
        document.getElementById("restock-batch").value = activeBatch.batchNo;
        document.getElementById("restock-expiry").value = activeBatch.expDate;
        
        modal.style.display = "flex";
    }
};

window.closeRestockModal = function() {
    document.getElementById("restock-modal").style.display = "none";
    activeRestockPerfumeId = null;
    activeRestockVariantId = null;
};

window.saveRestock = async function() {
    const qty = parseInt(document.getElementById("restock-qty").value);
    const batchNo = document.getElementById("restock-batch").value.trim();
    const expiry = document.getElementById("restock-expiry").value;

    if (isNaN(qty) || qty <= 0 || !batchNo || !expiry) {
        alert("Please enter a valid quantity, batch number, and expiry date.");
        return;
    }

    const approval = await promptManagerPin("Manager PIN required to restock inventory");
    if (!approval) return;

    let restockedOnCloud = false;
    if (useBackend) {
        try {
            const payload = {
                perfumeId: activeRestockPerfumeId,
                variantId: activeRestockVariantId,
                qty,
                batchNo,
                expiry
            };
            if (!approval.skipped) payload.managerPin = approval.managerPin;
            const res = await fetch(`${API_BASE_URL}/products/restock`, {
                method: "POST",
                headers: getAuthHeaders(),
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                restockedOnCloud = true;
                alert(`⚡ [Cloud] Stock updated successfully!`);
            } else {
                alert(data.error || "Restock failed");
                return;
            }
        } catch (e) {
            console.error("Backend restock failed, falling back to local...", e);
        }
    }

    if (!restockedOnCloud) {
        const perfume = PERFUMES.find(p => p.id === activeRestockPerfumeId);
        if (perfume) {
            const existingBatch = perfume.batches.find(b => b.batchNo === batchNo);
            if (existingBatch) {
                existingBatch.qty += qty;
                existingBatch.expDate = expiry;
            } else {
                perfume.batches.unshift({
                    id: "b_" + Date.now(),
                    batchNo: batchNo,
                    mfgDate: new Date().toISOString().split("T")[0],
                    expDate: expiry,
                    cost: perfume.batches[0]?.cost || 1500,
                    qty: qty
                });
            }
            alert(`⚡ [Offline] Stock updated successfully!`);
        }
    }

    closeRestockModal();
    
    if (useBackend) {
        await syncDataFromBackend();
    }
    renderPosInventory();
};
