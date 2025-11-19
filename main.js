// main.js — Backend-connected rewrite for nested categories + notes
// Assumes API endpoints exactly as in your app.py

// ---------- Small helpers ----------
function apiHeaders() {
    const token = sessionStorage.getItem('jwt');
    return token ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } : { 'Content-Type': 'application/json' };
}

async function api(url, opts = {}) {
    const options = { headers: apiHeaders(), ...opts };
    const res = await fetch(url, options);
    if (!res.ok) {
        if (res.status === 401) {
            alert('Session expired. Please login again.');
            handleLogout(false);
            openLogin();
            throw new Error('Unauthorized');
        }
        const txt = await res.text().catch(()=>null);
        throw new Error(txt || `HTTP ${res.status}`);
    }
    if (res.status === 204) return {};
    return res.json();
}

function qs(id){ return document.getElementById(id); }

// ---------- Elements (wrap existing DOM IDs in your index) ----------
const elements = {
    pages: {
        home: qs('homePage'),
        library: qs('libraryPage'),
        category: qs('categoryPage'),
        subcategory: qs('subcategoryPage'),
        noteView: qs('notePage'),
        admin: qs('adminDashboard'),
        addNote: qs('addNotePage'),
        adminNotes: qs('adminNotesPage'),
    },
    subcategoriesGrid: qs('subcategoriesContainer'),
    notesContainer: qs('notesContainer'),
    notesListHeader: qs('notesListHeader') || qs('categoryTitle'),
    noteTitle: qs('noteTitle'),
    noteBody: qs('noteBody'),
    noteMeta: qs('noteMeta'),
    loginForm: qs('loginForm'),
    loginModal: qs('loginModal'),
    loginBtn: qs('loginBtn'),
    userBtn: document.querySelector('.user-btn'),
    userEmailDisplay: qs('userEmailDisplay'),
    addNoteForm: qs('noteForm'),
    noteFormTitle: qs('noteFormTitle'),
    noteFormCategory: qs('noteFormCategory'),
    noteFormSubcategory: qs('noteFormSubcategory'),
    noteFormContent: qs('noteFormContent'),
    noteFormSources: qs('noteFormSources'),
    noteFormTags: qs('noteFormTags'),
    publishedCount: qs('publishedCount'),
    draftsCount: qs('draftsCount'),
    deletedCount: qs('deletedCount'),
    totalViews: qs('totalViews'),
};

let currentUser = null;
let currentCategoryId = null; // numeric id of currently-open category
let currentCategoryPath = '';  // friendly path string
let categoriesTree = [];       // cached tree from server
let flatCategories = [];       // flattened array {id, path, name, parent_id}

// ---------- Auth ----------
async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    try {
        const data = await fetch('/api/login', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ email, password })
        }).then(r => r.json());
        if (!data.token) return alert(data.message || 'Login failed');
        sessionStorage.setItem('jwt', data.token);
        sessionStorage.setItem('user', JSON.stringify(data.user));
        currentUser = data.user;
        updateLoginUI();
        closeLogin();
        if (currentUser.role === 'admin') showAdminDashboard();
    } catch (err) {
        console.error(err);
        alert('Login error: ' + err.message);
    }
}

function updateLoginUI(){
    const user = sessionStorage.getItem('user');
    currentUser = user ? JSON.parse(user) : null;
    if (!currentUser) {
        elements.loginBtn.style.display = 'inline-block';
        if (elements.userBtn) elements.userBtn.style.display = 'none';
    } else {
        if (elements.loginBtn) elements.loginBtn.style.display = 'none';
        if (elements.userBtn) elements.userBtn.style.display = 'block';
        if (elements.userEmailDisplay) elements.userEmailDisplay.textContent = currentUser.email;
        document.body.classList.add('admin-logged-in');
        // show admin controls (CSS handles showing elements)
    }
}

function openLogin(){ elements.loginModal.style.display = 'flex'; }
function closeLogin(){ elements.loginModal.style.display = 'none'; }
function handleLogout(showAlert=true){
    sessionStorage.removeItem('jwt');
    sessionStorage.removeItem('user');
    currentUser = null;
    updateLoginUI();
    showHome();
    if (showAlert) alert('Logged out.');
}

// ---------- Navigation helpers ----------
function hideAllPages(){
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
}
function switchView(name){
    hideAllPages();
    if (elements.pages[name]) elements.pages[name].classList.remove('hidden');
}
function showHome(){ switchView('home'); fetchAndRenderTopCategories(); }
function showLibrary(){ switchView('library'); fetchAndRenderTopCategories(); }
function showAdminDashboard(){ if(!currentUser) return alert('Admin only'); switchView('admin'); fetchAdminStats(); fetchTopNotes(); }
function showAddNotePage(){ switchView('addNote'); populateNoteCategorySelect(); }

// ---------- Open category by name or ID (used by homepage Medical/Surgical/Specialty buttons) ----------
async function showCategory(nameOrId) {
    await fetchCategoriesTree();  // ensure tree is loaded

    function search(nodes, target) {
        target = String(target).toLowerCase();
        for (const n of nodes) {
            if (n.name.toLowerCase() === target) return n;
            if (n.children && n.children.length) {
                const found = search(n.children, target);
                if (found) return found;
            }
        }
        return null;
    }

    // If argument is ID (number)
    if (!isNaN(Number(nameOrId))) {
        return openCategoryById(Number(nameOrId));
    }

    // If argument is name
    const match = search(categoriesTree, nameOrId);
    if (!match) {
        console.warn("Category not found:", nameOrId);
        return;
    }

    openCategoryById(match.id);
}


// ---------- Category fetch + render ----------
async function fetchCategoriesTree(){
    const tree = await api('/api/categories/tree');
    categoriesTree = tree;
    flatCategories = [];
    function walk(nodes, parentPath = '') {
        nodes.forEach(n=>{
            const path = parentPath ? `${parentPath}::${n.name}` : n.name;
            flatCategories.push({ id: n.id, name: n.name, parent_id: n.parent_id, path });
            if (n.children && n.children.length) walk(n.children, path);
        });
    }
    walk(categoriesTree);
    return tree;
}

async function fetchAndRenderTopCategories(){
    await fetchCategoriesTree();
    const grid = document.getElementById('subcategoriesGrid') || document.querySelector('.categories');
    if (!grid) return;
    // Clear then render top-level categories (parent_id IS NULL)
    grid.innerHTML = '';
    const tops = flatCategories.filter(c=>!c.parent_id);
    tops.forEach(c=>{
        const div = document.createElement('div');
        div.className = 'subcategory-card category-card';
        div.style.cursor = 'pointer';
        div.onclick = () => openCategoryById(c.id);
        div.innerHTML = `<h4>${c.name}</h4><p>${c.path}</p>`;
        grid.appendChild(div);
    });
}

async function openCategoryById(catId){
    // Render both: subcategories (direct children) and notes in this category
    currentCategoryId = catId;
    const catRow = flatCategories.find(c=>c.id===catId);
    currentCategoryPath = catRow ? catRow.path : '';
    // update header
    const header = document.getElementById('categoryTitle');
    if (header) header.textContent = catRow ? catRow.name : 'Category';
    const description = document.getElementById('categoryDescription');
    if (description) description.textContent = catRow ? catRow.path : '';

    // show category page
    switchView('category');

    // fetch children categories (direct)
    const children = flatCategories.filter(c => c.parent_id === catId);

    // render subcategories section
    const subcontainer = qs('subcategoriesContainer');
    subcontainer.innerHTML = '';

    // Subcategories header + add button (only admins)
    const subHeader = document.createElement('div');
    subHeader.style.display = 'flex';
    subHeader.style.justifyContent = 'space-between';
    subHeader.style.alignItems = 'center';
    subHeader.style.marginBottom = '1rem';
    subHeader.innerHTML = `<h3>Subcategories</h3>`;
    if (currentUser?.role === 'admin') {
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary';
        btn.textContent = '+ Add Subcategory';
        btn.onclick = () => promptAddSubcategory(catId);
        subHeader.appendChild(btn);
    }
    subcontainer.appendChild(subHeader);

    if (children.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML = `<p>No subcategories</p>`;
        subcontainer.appendChild(empty);
    } else {
        children.forEach(ch=>{
            const card = document.createElement('div');
            card.className = 'subcategory-card';
            card.onclick = () => openCategoryById(ch.id);
            card.innerHTML = `<h4>${ch.name}</h4><p style="color:var(--text-light)">${ch.path}</p>`;
            // admin inline controls
            if (currentUser?.role === 'admin') {
                const controls = document.createElement('div');
                controls.className = 'admin-controls';
                controls.style.position = 'absolute';
                controls.style.right = '10px';
                controls.style.top = '10px';
                controls.innerHTML = `
                    <button class="admin-btn edit" title="Edit" onclick="event.stopPropagation(); editCategoryClient(${ch.id})"><i class="fas fa-pen"></i></button>
                    <button class="admin-btn delete" title="Delete" onclick="event.stopPropagation(); deleteCategoryClient(${ch.id})"><i class="fas fa-trash-alt"></i></button>
                `;
                card.appendChild(controls);
            }
            subcontainer.appendChild(card);
        });
    }

    // Now render notes in this category (notesContainer)
    const notes = await api(`/api/notes?category=${catId}`);
    const notesContainer = qs('notesContainer');
    notesContainer.innerHTML = '';

    // Notes header + add note button
    const notesHeader = document.createElement('div');
    notesHeader.style.display = 'flex';
    notesHeader.style.justifyContent = 'space-between';
    notesHeader.style.alignItems = 'center';
    notesHeader.style.marginBottom = '1rem';
    notesHeader.innerHTML = `<h3>Notes</h3>`;
    if (currentUser?.role === 'admin') {
        const btnNote = document.createElement('button');
        btnNote.className = 'btn btn-primary';
        btnNote.textContent = '+ Add Note';
        btnNote.onclick = () => openAddNoteForCategory(catId);
        notesHeader.appendChild(btnNote);
    }
    notesContainer.appendChild(notesHeader);

    if (!notes || notes.length === 0) {
        notesContainer.innerHTML += `<div class="empty-state"><p>No notes yet in this category.</p></div>`;
    } else {
        notes.forEach(n=>{
            const noteCard = document.createElement('div');
            noteCard.className = 'note-item';
            noteCard.onclick = () => showNoteView(n.id);
            noteCard.innerHTML = `<div class="note-info"><h4>${n.title}</h4><div class="note-meta">${n.category}</div></div><div class="note-views">${n.views} views</div>`;
            // admin actions
            if (currentUser?.role === 'admin') {
                const adminDiv = document.createElement('div');
                adminDiv.style.position = 'absolute';
                adminDiv.style.right = '10px';
                adminDiv.style.top = '10px';
                adminDiv.innerHTML = `
                    <button class="btn btn-primary" onclick="event.stopPropagation(); openEditNote(${n.id})">Edit</button>
                    <button class="btn btn-danger" onclick="event.stopPropagation(); deleteNoteClient(${n.id})">Delete</button>
                `;
                noteCard.appendChild(adminDiv);
            }
            notesContainer.appendChild(noteCard);
        });
    }
}

// ---------- Add / Edit Category (client actions using API) ----------
async function promptAddSubcategory(parentId) {
    if (!currentUser) return alert('Admin only');
    const name = prompt('Name for new subcategory:');
    if (!name || !name.trim()) return;
    try {
        const res = await api('/api/category', {
            method: 'POST',
            body: JSON.stringify({ name: name.trim(), parent_id: parentId })
        });
        await fetchCategoriesTree();
        openCategoryById(parentId);
        alert('Subcategory added');
    } catch (err) {
        console.error(err);
        alert('Error adding subcategory: ' + err.message);
    }
}

async function editCategoryClient(catId){
    if (!currentUser) return alert('Admin only');
    const newName = prompt('New category name:');
    if (!newName) return;
    try {
        await api(`/api/category/${catId}`, { method: 'PUT', body: JSON.stringify({ name: newName }) });
        await fetchCategoriesTree();
        // attempt to open parent of edited category (or the category itself)
        const cat = flatCategories.find(c=>c.id===catId);
        if (cat && cat.parent_id) openCategoryById(cat.parent_id);
        else fetchAndRenderTopCategories();
        alert('Category updated');
    } catch (err) {
        console.error(err);
        alert('Update error: ' + err.message);
    }
}

async function deleteCategoryClient(catId){
    if (!currentUser) return alert('Admin only');
    if (!confirm('Delete this category and all its descendants?')) return;
    try {
        await api(`/api/category/${catId}`, { method: 'DELETE' });
        await fetchCategoriesTree();
        fetchAndRenderTopCategories();
        alert('Category deleted');
    } catch (err) {
        console.error(err);
        alert('Delete error: ' + err.message);
    }
}

// ---------- Notes CRUD client ----------
function openAddNoteForCategory(catId){
    // preselect the category in add note UI
    showAddNotePage();
    populateNoteCategorySelect().then(()=>{
        elements.noteFormCategory.value = String(catId);
        elements.noteFormCategory.dispatchEvent(new Event('change'));
    });
    elements.noteFormTitle.value = '';
    elements.noteFormContent.innerHTML = '';
    elements.noteFormSources.value = '';
    elements.noteFormTags.value = '';
    editingNoteId = null;
}

let editingNoteId = null;

async function populateNoteCategorySelect(){
    // ensure categories are fetched
    await fetchCategoriesTree();
    // populate select with full path labels
    const select = elements.noteFormCategory;
    select.innerHTML = `<option value="">Select category</option>`;
    flatCategories.forEach(c=>{
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.path;
        select.appendChild(opt);
    });
    // when category changes populate subcategory select with its direct children
    select.onchange = function(){
        const selId = Number(this.value);
        const children = flatCategories.filter(fc => fc.parent_id === selId);
        const sub = elements.noteFormSubcategory;
        sub.innerHTML = `<option value="">(optional) Select child category</option>`;
        children.forEach(ch=>{
            const o = document.createElement('option');
            o.value = ch.id;
            o.textContent = ch.path;
            sub.appendChild(o);
        });
    };
}

async function handleNoteFormSubmit(e){
    e.preventDefault();
    if (!currentUser) return alert('Admin only');
    const title = elements.noteFormTitle.value.trim();
    const catId = elements.noteFormSubcategory.value ? Number(elements.noteFormSubcategory.value) : (elements.noteFormCategory.value ? Number(elements.noteFormCategory.value) : null);
    const content = elements.noteFormContent.innerHTML;
    if (!title || !catId || !content) return alert('Title, category and content required');
    const payload = { title, content, category: String(catId) }; // send id as string or number
    try {
        if (!editingNoteId) {
            await api('/api/note', { method: 'POST', body: JSON.stringify(payload) });
            alert('Note created');
        } else {
            await api(`/api/note/${editingNoteId}`, { method: 'PUT', body: JSON.stringify(payload) });
            alert('Note updated');
        }
        // refresh view
        if (currentCategoryId) openCategoryById(currentCategoryId);
        else fetchAndRenderTopCategories();
        showAdminDashboard();
    } catch (err) {
        console.error(err);
        alert('Save error: ' + err.message);
    }
}

async function openEditNote(noteId){
    if (!currentUser) return alert('Admin only');
    editingNoteId = noteId;
    const note = await api(`/api/note/${noteId}`);
    showAddNotePage();
    await populateNoteCategorySelect();
    elements.noteFormTitle.value = note.title;
    // try to set category selects (category_id is numeric)
    if (note.category_id) {
        elements.noteFormCategory.value = String(note.category_id);
        elements.noteFormCategory.dispatchEvent(new Event('change'));
    }
    elements.noteFormContent.innerHTML = note.content;
}

async function deleteNoteClient(noteId){
    if (!currentUser) return alert('Admin only');
    if (!confirm('Delete this note?')) return;
    try {
        await api(`/api/note/${noteId}`, { method: 'DELETE' });
        alert('Deleted');
        if (currentCategoryId) openCategoryById(currentCategoryId);
        else fetchAndRenderTopCategories();
    } catch (err) {
        console.error(err);
        alert('Delete error: ' + err.message);
    }
}

async function showNoteView(noteId){
    switchView('noteView');
    elements.noteTitle.textContent = 'Loading...';
    try {
        const note = await api(`/api/note/${noteId}`);
        elements.noteTitle.textContent = note.title;
        elements.noteBody.innerHTML = note.content;
        elements.noteMeta.textContent = note.category_path || note.category || '';
    } catch (err) {
        console.error(err);
        elements.noteTitle.textContent = 'Error loading note';
    }
}

// ---------- Admin stats & top notes ----------
async function fetchAdminStats(){
    if (!currentUser) return;
    try {
        const stats = await api('/api/admin_stats');
        elements.publishedCount.textContent = stats.total_notes;
        elements.totalViews.textContent = stats.total_views;
        elements.adminLastUpdate = stats.last_update;
    } catch (err) {
        console.error(err);
    }
}

async function fetchTopNotes(){
    if (!currentUser) return;
    try {
        const top = await api('/api/note_views');
        const list = qs('adminTopNotesList');
        if (list) list.innerHTML = top.map(n=>`<p>${n.title} (${n.views})</p>`).join('');
    } catch (err) { console.error(err); }
}

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', function(){
    updateLoginUI();
    // wire login form
    if (elements.loginForm) elements.loginForm.addEventListener('submit', handleLogin);
    // wire add/edit note form
    if (elements.addNote && elements.addNote.querySelector('form')) {
        elements.addNote.querySelector('form').addEventListener('submit', handleNoteFormSubmit);
    } else if (elements.addNote && elements.addNote.querySelector('#noteForm')) {
        document.getElementById('noteForm').addEventListener('submit', handleNoteFormSubmit);
    }
    // initial home view
    fetchAndRenderTopCategories().catch(e=>console.error(e));
});
