// ---- Point to PythonAnywhere backend --------------
const API_BASE = "https://imeneee.pythonanywhere.com";

// Small helper to auto-prepend backend domain
function apiUrl(path) {
    if (path.startsWith("http")) return path;
    return `${API_BASE}${path}`;
}

// ---------- Small helpers ----------
function apiHeaders() {
    const token = sessionStorage.getItem("jwt");
    return token
        ? { "Content-Type": "application/json", "Authorization": `Bearer ${token}` }
        : { "Content-Type": "application/json" };
}

async function api(endpoint, opts = {}) {
    const url = apiUrl(endpoint);
    const options = { headers: apiHeaders(), ...opts };

    const res = await fetch(url, options);

    if (!res.ok) {
        if (res.status === 401) {
            alert("Session expired. Please log in again.");
            handleLogout(false);
            openLogin();
            throw new Error("Unauthorized");
        }
        const text = await res.text();
        throw new Error(text);
    }

    if (res.status === 204) return {};
    return res.json();
}

function qs(id) {
    return document.getElementById(id);
}

// -------------- DOM elements --------------
const elements = {
    pages: {
        home: qs("homePage"),
        library: qs("libraryPage"),
        category: qs("categoryPage"),
        subcategory: qs("subcategoryPage"),
        noteView: qs("notePage"),
        admin: qs("adminDashboard"),
        addNote: qs("addNotePage"),
        adminNotes: qs("adminNotesPage"),
    },
    subcategoriesGrid: qs("subcategoriesContainer"),
    notesContainer: qs("notesContainer"),
    notesListHeader: qs("notesListHeader") || qs("categoryTitle"),
    noteTitle: qs("noteTitle"),
    noteBody: qs("noteBody"),
    noteMeta: qs("noteMeta"),
    loginForm: qs("loginForm"),
    loginModal: qs("loginModal"),
    loginBtn: qs("loginBtn"),
    userBtn: document.querySelector(".user-btn"),
    userEmailDisplay: qs("userEmailDisplay"),
    addNoteForm: qs("noteForm"),
    noteFormTitle: qs("noteFormTitle"),
    noteFormCategory: qs("noteFormCategory"),
    noteFormSubcategory: qs("noteFormSubcategory"),
    noteFormContent: qs("noteFormContent"),
    noteFormSources: qs("noteFormSources"),
    noteFormTags: qs("noteFormTags"),
    publishedCount: qs("publishedCount"),
    draftsCount: qs("draftsCount"),
    deletedCount: qs("deletedCount"),
    totalViews: qs("totalViews"),
};

let currentUser = null;
let currentCategoryId = null;
let currentCategoryPath = "";
let categoriesTree = [];
let flatCategories = [];

// --------------------- AUTH ---------------------
async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value;
    const password = document.getElementById("loginPassword").value;

    try {
        const res = await fetch(apiUrl("/api/login"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
        });

        const data = await res.json();

        if (!data.token) {
            alert(data.message || "Login failed.");
            return;
        }

        sessionStorage.setItem("jwt", data.token);
        sessionStorage.setItem("user", JSON.stringify(data.user));
        currentUser = data.user;

        updateLoginUI();
        closeLogin();

        if (currentUser.role === "admin") showAdminDashboard();
    } catch (err) {
        alert("Login error: " + err.message);
    }
}

function updateLoginUI() {
    const user = sessionStorage.getItem("user");
    currentUser = user ? JSON.parse(user) : null;

    if (!currentUser) {
        if (elements.loginBtn) elements.loginBtn.style.display = "inline-block";
        if (elements.userBtn) elements.userBtn.style.display = "none";
        return;
    }

    if (elements.loginBtn) elements.loginBtn.style.display = "none";
    if (elements.userBtn) elements.userBtn.style.display = "block";
    if (elements.userEmailDisplay) elements.userEmailDisplay.textContent = currentUser.email;
}

function handleLogout(showAlert = true) {
    sessionStorage.removeItem("jwt");
    sessionStorage.removeItem("user");
    currentUser = null;
    updateLoginUI();
    showHome();
    if (showAlert) alert("Logged out.");
}

function openLogin() {
    if (elements.loginModal) elements.loginModal.style.display = "flex";
}
function closeLogin() {
    if (elements.loginModal) elements.loginModal.style.display = "none";
}

// ----------------- FETCH CATEGORIES -----------------
async function fetchCategoriesTree() {
    categoriesTree = await api("/api/categories/tree");

    flatCategories = [];
    function walk(nodes, parentPath = "") {
        for (const n of nodes) {
            const path = parentPath ? `${parentPath}::${n.name}` : n.name;
            flatCategories.push({
                id: n.id,
                name: n.name,
                parent_id: n.parent_id,
                path,
            });
            if (n.children && n.children.length) {
                walk(n.children, path);
            }
        }
    }
    walk(categoriesTree);

    return categoriesTree;
}

// ----------------- RENDER TOP CATEGORIES -----------------
async function fetchAndRenderTopCategories() {
    await fetchCategoriesTree();

    const grid =
        document.getElementById("subcategoriesGrid") ||
        document.querySelector(".categories");
    if (!grid) return;

    grid.innerHTML = "";

    const tops = flatCategories.filter((c) => !c.parent_id);
    tops.forEach((c) => {
        const div = document.createElement("div");
        div.className = "subcategory-card category-card";
        div.style.cursor = "pointer";
        div.onclick = () => openCategoryById(c.id);
        div.innerHTML = `<h4>${c.name}</h4><p>${c.path}</p>`;
        grid.appendChild(div);
    });
}

// ----------------- OPTIONAL: OPEN CATEGORY BY NAME OR ID -----------------
async function showCategory(nameOrId) {
    // Helper if your HTML uses onclick="showCategory('Medical')" etc.
    if (!categoriesTree || categoriesTree.length === 0) {
        await fetchCategoriesTree();
    }

    // If it's a number, assume ID
    if (!isNaN(Number(nameOrId))) {
        return openCategoryById(Number(nameOrId));
    }

    const target = String(nameOrId).toLowerCase();
    function search(nodes) {
        for (const n of nodes) {
            if (n.name.toLowerCase() === target) return n;
            if (n.children && n.children.length) {
                const found = search(n.children);
                if (found) return found;
            }
        }
        return null;
    }

    const match = search(categoriesTree);
    if (match) {
        openCategoryById(match.id);
    } else {
        console.warn("Category not found:", nameOrId);
    }
}

// ----------------- OPEN CATEGORY -----------------
async function openCategoryById(catId) {
    currentCategoryId = catId;

    const cat = flatCategories.find((c) => c.id === catId);
    currentCategoryPath = cat ? cat.path : "";

    const header = document.getElementById("categoryTitle");
    if (header) header.textContent = cat ? cat.name : "Category";

    switchView("category");

    // Subcategories
    const children = flatCategories.filter((c) => c.parent_id === catId);

    const subcontainer = qs("subcategoriesContainer");
    if (subcontainer) {
        subcontainer.innerHTML = "";
        children.forEach((ch) => {
            const card = document.createElement("div");
            card.className = "subcategory-card";
            card.onclick = () => openCategoryById(ch.id);
            card.innerHTML = `<h4>${ch.name}</h4><p>${ch.path}</p>`;
            subcontainer.appendChild(card);
        });
    }

    // Notes for this category
    const notes = await api(`/api/notes?category=${catId}`);
    const notesContainer = qs("notesContainer");
    if (!notesContainer) return;

    notesContainer.innerHTML = "";

    notes.forEach((n) => {
        const card = document.createElement("div");
        card.className = "note-item";
        card.onclick = () => showNoteView(n.id);
        card.innerHTML = `<h4>${n.title}</h4><div>${n.views} views</div>`;
        notesContainer.appendChild(card);
    });
}

// ----------------- SHOW NOTE -----------------
async function showNoteView(noteId) {
    switchView("noteView");

    const note = await api(`/api/note/${noteId}`);

    elements.noteTitle.textContent = note.title;
    elements.noteBody.innerHTML = note.content;
    // Backend does NOT send category_path or category, so use currentCategoryPath
    elements.noteMeta.textContent = currentCategoryPath || "";
}

// ----------------- ADMIN -----------------
async function fetchAdminStats() {
    if (!currentUser) return;
    const stats = await api("/api/admin_stats");
    if (elements.publishedCount)
        elements.publishedCount.textContent = stats.total_notes;
    if (elements.totalViews)
        elements.totalViews.textContent = stats.total_views;
}

// There is NO /api/note_views in your backend now, so make this safe:
async function fetchTopNotes() {
    const list = qs("adminTopNotesList");
    if (list) {
        list.innerHTML =
            "<p>Top notes view is not available with current backend.</p>";
    }
}

// Show admin dashboard page
function showAdminDashboard() {
    if (!currentUser || currentUser.role !== "admin") {
        alert("Admin only");
        return;
    }
    switchView("admin");
    fetchAdminStats();
    fetchTopNotes();
}

// Optional: if you have a Library page
function showLibrary() {
    switchView("library");
    fetchAndRenderTopCategories();
}

// ----------------- UI -----------------
function hideAllPages() {
    document.querySelectorAll(".page").forEach((p) =>
        p.classList.add("hidden")
    );
}
function switchView(name) {
    hideAllPages();
    if (elements.pages[name]) {
        elements.pages[name].classList.remove("hidden");
    }
}
function showHome() {
    switchView("home");
    fetchAndRenderTopCategories();
}

// ----------------- BOOT -----------------
document.addEventListener("DOMContentLoaded", () => {
    updateLoginUI();
    if (elements.loginForm)
        elements.loginForm.addEventListener("submit", handleLogin);
    fetchAndRenderTopCategories();
});
