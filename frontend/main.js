/* main.js - Backend-connected replacement for ClinicalRoots
   Supports:
   - JWT login
   - Categories tree (infinite nesting) via /api/categories/tree
   - Category CRUD via /api/category
   - Notes CRUD via /api/note
   - "Add Sub Note" modal to create subcategories (name + optional description + parent)
   - Render nested category cards and notes under each card
   - Admin-only edit/delete actions for categories & notes
   - Search, admin stats, and other UI glue
*/

/* --------------------------
   Utility & App State
   -------------------------- */
const state = {
    currentUser: null,
    currentPage: 'home',
    currentCategoryId: null,   // category id when drilling into category
    breadcrumb: [],            // array of {id, name}
    categoriesTree: [],        // latest fetched tree
    notesCache: {},           // optional per-category notes cache
};

function getJwtHeaders(contentType = "application/json") {
    const token = sessionStorage.getItem('jwt');
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (contentType) headers['Content-Type'] = contentType;
    return headers;
}

async function api(url, options = {}) {
    const headers = { ...(options.headers || {}), ...getJwtHeaders() };
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
        // session expired or unauthorized
        alert('Session expired or unauthorized. Please login again.');
        handleLogout(false);
        openLoginModal();
        throw new Error('Unauthorized');
    }
    if (res.status === 204) return {};
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || (`HTTP ${res.status}`));
    return json;
}

/* --------------------------
   DOM helpers (safe lookup)
   -------------------------- */
function $id(id) { return document.getElementById(id); }
function hideAllPages() {
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
}
function switchToPage(id) {
    hideAllPages();
    const el = $id(id);
    if (el) el.classList.remove('hidden');
    state.currentPage = id;
}

/* --------------------------
   Navigation / Page display
   -------------------------- */
function showHome() { switchToPage('homePage'); }
function showTools() { switchToPage('toolsPage'); }
function showIA() { switchToPage('iaPage'); }
function showAbout() { switchToPage('aboutPage'); }
function showLibrary() {
    switchToPage('libraryPage');
    // show top-level categories grid
    document.querySelectorAll('#categoryNotesList, #subcategoriesGrid').forEach(el => el.style.display = '');
    loadAndRenderCategories();
}

/* --------------------------
   Login / Logout
   -------------------------- */
function openLoginModal() {
    const modal = $id('loginModal');
    if (modal) modal.style.display = 'block';
}
function closeLoginModal() {
    const modal = $id('loginModal');
    if (modal) modal.style.display = 'none';
}
async function handleLogin(evt) {
    evt && evt.preventDefault();
    const email = $id('loginEmail').value;
    const password = $id('loginPassword').value;
    try {
        const data = await api('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }, // no JWT here
            body: JSON.stringify({ email, password })
        });
        if (!data.token) throw new Error(data.message || 'Login failed');
        sessionStorage.setItem('jwt', data.token);
        sessionStorage.setItem('user', JSON.stringify(data.user));
        state.currentUser = data.user;
        updateAuthUI();
        closeLoginModal();
        if (state.currentUser.role === 'admin') showAdminDashboard();
        else showHome();
    } catch (err) {
        alert('Login failed: ' + err.message);
        console.error(err);
    }
}

function handleLogout(showAlert = true) {
    sessionStorage.removeItem('jwt');
    sessionStorage.removeItem('user');
    state.currentUser = null;
    updateAuthUI();
    showHome();
    if (showAlert) alert('Logged out.');
}

function updateAuthUI() {
    const userStr = sessionStorage.getItem('user');
    state.currentUser = userStr ? JSON.parse(userStr) : null;
    // login button
    const loginBtn = $id('loginBtn');
    const userMenu = $id('userMenu');
    if (state.currentUser) {
        if (loginBtn) loginBtn.style.display = 'none';
        if (userMenu) userMenu.classList.remove('hidden');
        showAdminControls();
    } else {
        if (loginBtn) loginBtn.style.display = 'inline-block';
        if (userMenu) userMenu.classList.add('hidden');
        hideAdminControls();
    }
}

/* --------------------------
   Admin controls (show/hide)
   -------------------------- */
function showAdminControls() {
    document.querySelectorAll('.admin-controls').forEach(el => {
        el.style.display = 'flex';
        el.style.opacity = '1';
    });
}
function hideAdminControls() {
    document.querySelectorAll('.admin-controls').forEach(el => {
        el.style.display = 'none';
        el.style.opacity = '0';
    });
}

/* --------------------------
   Categories (tree) loading & rendering
   -------------------------- */

async function loadCategoriesTree() {
    try {
        const tree = await api('/api/categories/tree');
        state.categoriesTree = tree || [];
        return state.categoriesTree;
    } catch (err) {
        console.error('Failed to load category tree:', err);
        state.categoriesTree = [];
        return [];
    }
}

// find node by id
function findNodeById(nodes, id) {
    if (!nodes) return null;
    for (const n of nodes) {
        if (n.id === id) return n;
        if (n.children && n.children.length) {
            const found = findNodeById(n.children, id);
            if (found) return found;
        }
    }
    return null;
}

// Flatten tree to label paths for parent select: returns [{id, path}]
function flattenTreeWithPaths(nodes) {
    const out = [];
    function walk(node, prefix = '') {
        const path = prefix ? `${prefix}::${node.name}` : node.name;
        out.push({ id: node.id, path });
        if (node.children && node.children.length) {
            node.children.forEach(c => walk(c, path));
        }
    }
    nodes.forEach(root => walk(root, ''));
    return out;
}

// Render top-level category cards (grid)
async function loadAndRenderCategories() {
    const grid = $id('subcategoriesGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const tree = await loadCategoriesTree();
    // Render roots as cards
    tree.forEach(root => {
        const div = document.createElement('div');
        div.className = 'category-card';
        div.style.cursor = 'pointer';
        div.onclick = () => {
            // drill into this category
            renderSubcategoryCardsForParent(root.id);
        };
        div.innerHTML = `
            <div class="category-icon"><i class="fas fa-folder-open"></i></div>
            <h3>${root.name}</h3>
            <p style="color:var(--text-light);">${root.description || ''}</p>
        `;
        grid.appendChild(div);
    });
}

/* --------------------------
   Render a parent's immediate children as cards (with notes below)
   -------------------------- */
async function renderSubcategoryCardsForParent(parentId = null) {
    // parentId null -> render top-level roots
    const container = $id('subcategoriesContainer');
    const notesContainer = $id('notesContainer'); // reuse notes container maybe
    if (!container) return;
    container.innerHTML = '';

    // update breadcrumb
    state.breadcrumb = [];
    if (parentId) {
        // produce breadcrumb by walking up via API: we can reconstruct from tree
        const tree = state.categoriesTree.length ? state.categoriesTree : await loadCategoriesTree();
        const node = findNodeById(tree, parseInt(parentId));
        if (node) {
            // build breadcrumb: walk up by searching parents (inefficient but fine small tree)
            const path = [];
            function locatePath(nodes, targetId, acc=[]) {
                for (const n of nodes) {
                    const next = acc.concat([{id: n.id, name: n.name}]);
                    if (n.id === targetId) return next;
                    if (n.children && n.children.length) {
                        const res = locatePath(n.children, targetId, next);
                        if (res) return res;
                    }
                }
                return null;
            }
            const p = locatePath(tree, parseInt(parentId), []);
            if (p) state.breadcrumb = p;
        }
    }

    // header: breadcrumb and back btn
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    const bc = state.breadcrumb.map(b => b.name).join(' > ') || 'Categories';
    header.innerHTML = `<h3 style="margin:0">${bc}</h3>`;
    const backBtn = document.createElement('button');
    backBtn.className = 'back-btn';
    backBtn.textContent = '← Back';
    backBtn.onclick = () => {
        if (state.breadcrumb.length <= 1) {
            // go to main grid
            showLibrary();
        } else {
            const parentOfParent = state.breadcrumb[state.breadcrumb.length - 2];
            renderSubcategoryCardsForParent(parentOfParent.id);
        }
    };
    header.appendChild(backBtn);
    container.appendChild(header);

    // admin Add Sub Note button
    if (state.currentUser?.role === 'admin') {
        const addBtn = document.createElement('button');
        addBtn.className = 'btn btn-primary';
        addBtn.style.margin = '12px 0';
        addBtn.textContent = '➕ Add Sub Note';
        addBtn.onclick = () => openAddSubNoteModal(parentId ? state.breadcrumb.map(b=>b.name).join('::') : null);
        container.appendChild(addBtn);
    }

    // get the node's children (or roots if parentId null)
    const tree = state.categoriesTree.length ? state.categoriesTree : await loadCategoriesTree();
    const children = parentId ? (findNodeById(tree, parseInt(parentId))?.children || []) : tree;

    if (!children || children.length === 0) {
        const empty = document.createElement('div');
        empty.innerHTML = `<p style="color:var(--text-light);">No subcategories found.</p>`;
        container.appendChild(empty);
        return;
    }

    // For each child: card with name + description + notes under it
    for (const child of children) {
        const card = document.createElement('div');
        card.className = 'subcategory-card';
        card.style.position = 'relative';
        card.onclick = () => renderSubcategoryCardsForParent(child.id);
        // admin controls
        const adminControls = state.currentUser?.role === 'admin' ? `
            <div style="position:absolute; top:8px; right:8px; display:flex; gap:6px;">
                <button class="admin-btn edit" title="Edit" onclick="event.stopPropagation(); openEditCategoryModal(${child.id})"><i class="fas fa-pen"></i></button>
                <button class="admin-btn delete" title="Delete" onclick="event.stopPropagation(); deleteCategory(${child.id})"><i class="fas fa-trash-alt"></i></button>
            </div>` : '';
        card.innerHTML = `
            ${adminControls}
            <h3 style="margin-bottom:4px;">${child.name}</h3>
            ${child.description ? `<div style="color:var(--text-light); margin-bottom:8px;">${child.description}</div>` : ''}
            <div id="notes-under-${child.id}" style="min-height:24px; margin-top:8px;"><em>Loading notes...</em></div>
        `;
        container.appendChild(card);

        // load notes under this child
        (async (cid) => {
            try {
                const notesEl = $id(`notes-under-${cid}`);
                notesEl.innerHTML = `<em>Loading notes...</em>`;
                // backend expects category id or path; our api supports id
                const notes = await api(`/api/notes?category=${cid}`);
                notesEl.innerHTML = '';
                if (!notes || notes.length === 0) {
                    notesEl.innerHTML = `<p style="color:var(--text-light); margin:0">No notes</p>`;
                } else {
                    notes.forEach(n => {
                        const noteRow = document.createElement('div');
                        noteRow.className = 'note-item';
                        noteRow.style.margin = '6px 0';
                        noteRow.onclick = (ev) => { ev.stopPropagation(); showNoteView(n.id); };
                        noteRow.innerHTML = `<strong>${n.title}</strong> <span style="color:var(--text-light); margin-left:8px;">${n.views||0} views</span>`;
                        notesEl.appendChild(noteRow);
                    });
                }
            } catch (err) {
                const notesEl = $id(`notes-under-${cid}`);
                if (notesEl) notesEl.innerHTML = `<p style="color:var(--danger)">Failed to load notes</p>`;
                console.error(err);
            }
        })(child.id);
    }
}

/* --------------------------
   Add Sub Note modal (create category)
   -------------------------- */
async function openAddSubNoteModal(preselectPath = null) {
    // ensure categories tree is loaded
    await loadCategoriesTree();
    // populate parent select
    const select = $id('subNoteParentSelect');
    if (!select) return;
    select.innerHTML = '<option value="">(Top level)</option>';
    const flat = flattenTreeWithPaths(state.categoriesTree);
    flat.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = item.path;
        select.appendChild(opt);
    });
    // try to preselect if provided path
    if (preselectPath) {
        for (let i=0;i<select.options.length;i++){
            if (select.options[i].textContent === preselectPath) {
                select.selectedIndex = i;
                break;
            }
        }
    }
    $id('addSubNoteHeader').textContent = preselectPath ? `Add Sub Note under ${preselectPath}` : 'Add Sub Note';
    $id('addSubNoteForm').onsubmit = handleCreateCategorySubmit; // new submit handler
    $id('addSubNoteModal').style.display = 'block';
}

function closeAddSubNoteModal() {
    const modal = $id('addSubNoteModal');
    if (modal) modal.style.display = 'none';
}

// Submit handler to create category
async function handleCreateCategorySubmit(e) {
    e && e.preventDefault();
    const name = $id('subNoteName').value.trim();
    if (!name) return alert('Name required');
    const description = $id('subNoteDescription').value.trim();
    const parentVal = $id('subNoteParentSelect').value;
    const parent_id = parentVal ? parseInt(parentVal) : null;
    try {
        const res = await api('/api/category', {
            method: 'POST',
            headers: getJwtHeaders(),
            body: JSON.stringify({ name, parent_id, description })
        });
        alert('Category created');
        closeAddSubNoteModal();
        // refresh categories tree & view
        await loadCategoriesTree();
        // If user was viewing a parent, re-render that parent's children; else go to library
        if (state.breadcrumb && state.breadcrumb.length) {
            const last = state.breadcrumb[state.breadcrumb.length - 1];
            renderSubcategoryCardsForParent(last.id);
        } else {
            loadAndRenderCategories();
        }
    } catch (err) {
        console.error('Create category failed', err);
        alert('Error creating category: ' + (err.message || err));
    }
}

/* --------------------------
   Edit / Delete Category
   -------------------------- */
async function openEditCategoryModal(catId) {
    try {
        const flat = await api('/api/categories/flat'); // admin only
        const cat = flat.find(c => c.id === catId);
        if (!cat) return alert('Category not found');
        // prefill modal
        await openAddSubNoteModal(); // this loads & shows modal and populates parent select
        // small delay for select population; then set fields & override submit
        setTimeout(() => {
            $id('subNoteName').value = cat.name || '';
            $id('subNoteDescription').value = cat.description || '';
            const sel = $id('subNoteParentSelect');
            for (let i=0;i<sel.options.length;i++){
                if (sel.options[i].value == (cat.parent_id || '')) { sel.selectedIndex = i; break; }
            }
            // override submit
            $id('addSubNoteForm').onsubmit = async function (ev) {
                ev && ev.preventDefault();
                const newName = $id('subNoteName').value.trim();
                const newDesc = $id('subNoteDescription').value.trim();
                const parentVal = $id('subNoteParentSelect').value || null;
                try {
                    const res = await api(`/api/category/${catId}`, {
                        method: 'PUT',
                        headers: getJwtHeaders(),
                        body: JSON.stringify({ name: newName, description: newDesc, parent_id: parentVal ? parseInt(parentVal) : null })
                    });
                    alert('Category updated');
                    closeAddSubNoteModal();
                    await loadCategoriesTree();
                    // refresh view
                    if (state.breadcrumb.length) {
                        const last = state.breadcrumb[state.breadcrumb.length - 1];
                        renderSubcategoryCardsForParent(last.id);
                    } else {
                        loadAndRenderCategories();
                    }
                } catch (err) {
                    console.error(err);
                    alert('Failed to update category: ' + err.message);
                }
            };
        }, 150);
    } catch (err) {
        console.error('openEditCategoryModal', err);
        alert('Failed to open edit modal: ' + err.message);
    }
}

async function deleteCategory(catId) {
    if (!confirm('Delete this category and all its children? This will unset category_id for notes under them.')) return;
    try {
        await api(`/api/category/${catId}`, { method: 'DELETE', headers: getJwtHeaders() });
        alert('Category deleted');
        await loadCategoriesTree();
        // refresh view
        if (state.breadcrumb.length) {
            const last = state.breadcrumb[state.breadcrumb.length - 1];
            // if deleted node was the current, go up to parent
            const isCurrent = (last.id === catId);
            if (isCurrent && state.breadcrumb.length > 1) {
                const parentOfParent = state.breadcrumb[state.breadcrumb.length - 2];
                renderSubcategoryCardsForParent(parentOfParent.id);
            } else {
                renderSubcategoryCardsForParent(state.breadcrumb.length ? state.breadcrumb[state.breadcrumb.length - 1].id : null);
            }
        } else {
            loadAndRenderCategories();
        }
    } catch (err) {
        console.error('deleteCategory', err);
        alert('Failed to delete category: ' + err.message);
    }
}

/* --------------------------
   Notes CRUD & View
   -------------------------- */

async function openNoteCrudModal(noteId = null) {
    // Use the existing add/edit note page/modal UI if present
    const modal = $id('noteCrudModal') || null;
    // We provided earlier a note CRUD modal in your other main.js; if you don't have it, fallback to addNote page
    if (modal) {
        modal.style.display = 'flex';
    } else {
        // use add note page
        showAddNote();
    }

    // populate category select with flattened tree path (so admin can choose category)
    try {
        const tree = await loadCategoriesTree();
        const flat = flattenTreeWithPaths(tree);
        // create options as "id|path" value or simply id and display path text
        const sel = $id('noteCategorySelect');
        if (sel) {
            sel.innerHTML = '<option value="">Select category</option>' + flat.map(f => `<option value="${f.id}">${f.path}</option>`).join('');
        }
    } catch (err) {
        console.error('openNoteCrudModal populate categories', err);
    }

    if (!noteId) {
        // new note
        if ($id('noteCrudHeader')) $id('noteCrudHeader').textContent = 'Add Note';
        if ($id('noteCrudSubmitBtn')) $id('noteCrudSubmitBtn').textContent = 'Create';
        if ($id('noteTitleInput')) $id('noteTitleInput').value = '';
        if ($id('noteContentTextarea')) $id('noteContentTextarea').value = '';
        // save handler will call POST /api/note
        return;
    }

    // edit existing
    try {
        const note = await api(`/api/note/${noteId}`);
        if ($id('noteCrudHeader')) $id('noteCrudHeader').textContent = 'Edit Note';
        if ($id('noteCrudSubmitBtn')) $id('noteCrudSubmitBtn').textContent = 'Update';
        if ($id('noteTitleInput')) $id('noteTitleInput').value = note.title || '';
        if ($id('noteContentTextarea')) $id('noteContentTextarea').value = note.content || '';
        // set select to category id if present
        if ($id('noteCategorySelect') && note.category_id) {
            $id('noteCategorySelect').value = note.category_id;
        }
        // store editing id
        state.editingNoteId = noteId;
    } catch (err) {
        console.error('openNoteCrudModal', err);
        alert('Failed to load note: ' + err.message);
    }
}

async function handleNoteCrudSubmit(e) {
    e && e.preventDefault();
    const title = $id('noteTitleInput') ? $id('noteTitleInput').value.trim() : '';
    const content = $id('noteContentTextarea') ? $id('noteContentTextarea').value.trim() : '';
    const categorySelected = $id('noteCategorySelect') ? $id('noteCategorySelect').value : null;
    if (!title || !content) return alert('Title and content required');
    const payload = {
        title,
        content,
        category: categorySelected ? parseInt(categorySelected) : null
    };
    try {
        if (state.editingNoteId) {
            await api(`/api/note/${state.editingNoteId}`, {
                method: 'PUT',
                headers: getJwtHeaders(),
                body: JSON.stringify(payload)
            });
            alert('Note updated');
            state.editingNoteId = null;
        } else {
            await api('/api/note', { method: 'POST', headers: getJwtHeaders(), body: JSON.stringify(payload) });
            alert('Note created');
        }
        // close modal or go back
        if ($id('noteCrudModal')) $id('noteCrudModal').style.display = 'none';
        // refresh current view
        if (state.currentPage === 'libraryPage') loadAndRenderCategories();
        else if (state.currentPage === 'categoryPage' || state.currentPage === 'subcategoryPage') {
            const last = state.breadcrumb[state.breadcrumb.length - 1];
            renderSubcategoryCardsForParent(last ? last.id : null);
        } else {
            showLibrary();
        }
    } catch (err) {
        console.error('Note save failed', err);
        alert('Failed to save note: ' + err.message);
    }
}

async function deleteNoteById(noteId) {
    if (!confirm('Delete this note?')) return;
    try {
        await api(`/api/note/${noteId}`, { method: 'DELETE', headers: getJwtHeaders() });
        alert('Note deleted');
        // refresh
        if (state.currentPage === 'libraryPage') loadAndRenderCategories();
        else {
            const last = state.breadcrumb[state.breadcrumb.length - 1];
            renderSubcategoryCardsForParent(last ? last.id : null);
        }
    } catch (err) {
        console.error('deleteNoteById', err);
        alert('Failed to delete note: ' + err.message);
    }
}

async function showNoteView(noteId) {
    try {
        const note = await api(`/api/note/${noteId}`);
        // show note view page (use your existing note page ids)
        if ($id('notePage')) {
            switchToPage('notePage');
            if ($id('noteTitle')) $id('noteTitle').textContent = note.title;
            if ($id('noteMeta')) $id('noteMeta').textContent = (note.category_path || '') + ` • ${note.views || 0} views`;
            if ($id('noteBody')) $id('noteBody').innerHTML = note.content || '';
            // show editor controls only if admin
            if ($id('noteEditor') ) $id('noteEditor').style.display = (state.currentUser?.role === 'admin') ? 'flex' : 'none';
            // back button
            if ($id('noteBackBtn')) $id('noteBackBtn').onclick = () => {
                // go to parent category view
                const last = state.breadcrumb[state.breadcrumb.length - 1];
                if (last) renderSubcategoryCardsForParent(last.id);
                else showLibrary();
            };
        }
    } catch (err) {
        console.error('showNoteView error', err);
        alert('Failed to load note: ' + err.message);
    }
}

/* --------------------------
   Admin dashboard stats & top notes
   -------------------------- */
async function loadAdminStats() {
    try {
        const stats = await api('/api/admin_stats');
        if ($id('publishedCount')) $id('publishedCount').textContent = stats.total_notes || 0;
        if ($id('totalViews')) $id('totalViews').textContent = stats.total_views || 0;
        if ($id('lastUpdate')) $id('lastUpdate').textContent = stats.last_update ? new Date(stats.last_update).toLocaleString() : 'N/A';
    } catch (err) {
        console.error('loadAdminStats', err);
    }
}
async function loadTopNotes() {
    try {
        const notes = await api('/api/note_views');
        if ($id('adminTopNotesList')) {
            $id('adminTopNotesList').innerHTML = notes.map(n => `<p>${n.title} (${n.views})</p>`).join('');
        }
    } catch (err) {
        console.error('loadTopNotes', err);
    }
}
function showAdminDashboard() {
    if (!state.currentUser) return alert('Login required');
    if (state.currentUser.role !== 'admin') return alert('Admin only');
    switchToPage('adminDashboard');
    loadAdminStats();
    loadTopNotes();
}

/* --------------------------
   Search
   -------------------------- */
let searchTypingTimeout = null;
async function handleSearchInput(q) {
    if (!q || q.length < 2) {
        if ($id('searchSuggestions')) $id('searchSuggestions').innerHTML = '';
        return;
    }
    try {
        const results = await api(`/api/notes?search=${encodeURIComponent(q)}`);
        if ($id('searchSuggestions')) {
            $id('searchSuggestions').innerHTML = '';
            results.slice(0,6).forEach(r => {
                const div = document.createElement('div');
                div.className = 'suggestion-item';
                div.textContent = r.title;
                div.onclick = () => showNoteView(r.id);
                $id('searchSuggestions').appendChild(div);
            });
        }
    } catch (err) {
        console.error('Search error', err);
    }
}

/* --------------------------
   Initialization
   -------------------------- */
document.addEventListener('DOMContentLoaded', () => {
    // wire up login form
    const loginForm = $id('loginForm');
    if (loginForm) loginForm.onsubmit = handleLogin;

    // wire up add-sub-note modal close button already in HTML (closeAddSubNoteModal)
    if ($id('addSubNoteModal')) {
        // make sure the form submission is handled (the handler is set when modal opens)
        // but we'll also set a fallback here if a developer forgets:
        const form = $id('addSubNoteForm');
        if (form) form.onsubmit = handleCreateCategorySubmit;
    }

    // wire up note CRUD modal form if present
    if ($id('noteCrudForm')) $id('noteCrudForm').onsubmit = handleNoteCrudSubmit;

    // search input
    if ($id('searchInput')) {
        $id('searchInput').oninput = (e) => {
            clearTimeout(searchTypingTimeout);
            const q = e.target.value;
            searchTypingTimeout = setTimeout(()=> handleSearchInput(q), 250);
        };
    }

    // initial auth UI
    updateAuthUI();

    // show home by default
    showHome();
});
