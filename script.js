/* ============================================================
   SUPABASE CLIENT
   Fill in SUPABASE_URL / SUPABASE_ANON_KEY in index.html.
   The anon key is meant to be public — it's safe in this file.
   Real protection comes from the Row Level Security rules in
   database-schema.sql, not from hiding this key.
   ============================================================ */

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MATERIALS_BUCKET = "materials";


/* =========================
BACKGROUND SLIDESHOW
========================= */

const slides = document.querySelectorAll(".bg-slide");
let currentSlide = 0;

function changeBackground() {
    slides[currentSlide].classList.remove("active");
    currentSlide = (currentSlide + 1) % slides.length;
    slides[currentSlide].classList.add("active");
}

setInterval(changeBackground, 5000);


/* =========================
LOCAL UI STATE (navigation only — never login or materials data)
========================= */

let uiState = {
    selectedCourse: null,
    selectedYear: null,
    selectedCategory: null,
    materialsCache: [],
};


/* =========================
SCREEN NAVIGATION
========================= */

function showScreen(screenId) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.getElementById(screenId).classList.add("active");
}

function toggleAuthView(view) {
    document.getElementById("login-view").classList.toggle("hidden", view !== "login");
    document.getElementById("request-view").classList.toggle("hidden", view !== "request");
}

function showMessage(elId, message, type) {
    const el = document.getElementById(elId);
    el.textContent = message;
    el.className = `form-error ${type}`;
    el.classList.remove("hidden");
}


/* =========================
ON PAGE LOAD — restore an existing session, if any
========================= */

window.addEventListener("DOMContentLoaded", async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        await routeAfterLogin(session.user);
    }
});


/* =========================
LOGIN
========================= */

document.getElementById("login-form").addEventListener("submit", async function (event) {
    event.preventDefault();

    const email = document.getElementById("user-email").value.trim();
    const password = document.getElementById("user-password").value;
    const btn = document.getElementById("login-submit-btn");

    btn.disabled = true;
    btn.textContent = "Signing in...";

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

    btn.disabled = false;
    btn.textContent = "Login to Continue →";

    if (error) {
        showMessage("login-error", "Incorrect email or password.", "error");
        return;
    }

    await routeAfterLogin(data.user);
});

async function routeAfterLogin(user) {
    const { data: profile, error } = await supabaseClient
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

    console.log("PROFILE DEBUG:", profile, error);

    if (profile && profile.role === "admin") {
        document.getElementById("admin-email-display").textContent = user.email;
        showScreen("screen-admin");
        renderAdminDashboard();
    } else {
        document.getElementById("student-email-display").textContent = user.email;
        document.getElementById("student-avatar").textContent = user.email.charAt(0).toUpperCase();
        resetToCourses();
        showScreen("screen-student");
    }
}


/* =========================
REQUEST ACCESS (student self-signup request)
========================= */

document.getElementById("request-form").addEventListener("submit", async function (event) {
    event.preventDefault();

    const name = document.getElementById("request-name").value.trim();
    const email = document.getElementById("request-email").value.trim();
    const phone = document.getElementById("request-phone").value.trim();
    const btn = document.getElementById("request-submit-btn");
   
    btn.disabled = true;
    btn.textContent = "Submitting...";

    const { error } = await supabaseClient
        .from("access_requests")
        .insert({ name, email, phone });

    btn.disabled = false;
    btn.textContent = "Submit Request →";

    if (error) {
        const msg = error.code === "23505"
            ? "You've already requested access. Please wait for approval."
            : "Something went wrong. Please try again.";
        showMessage("request-status", msg, "error");
        return;
    }

    document.getElementById("request-form").reset();
    showMessage("request-status", "Request submitted! You'll receive an email once approved.", "success");
});


/* =========================
LOGOUT
========================= */

async function logout() {
    await supabaseClient.auth.signOut();
    document.getElementById("login-form").reset();
    showScreen("screen-home");
}


/* =========================
STUDENT NAVIGATION
========================= */

function resetToCourses() {
    uiState.selectedCourse = null;
    uiState.selectedYear = null;
    uiState.selectedCategory = null;

    document.getElementById("courses-section").classList.remove("hidden");
    document.getElementById("years-section").classList.add("hidden");
    document.getElementById("categories-section").classList.add("hidden");
    document.getElementById("materials-section").classList.add("hidden");

    updateBreadcrumbs();
}

function selectCourse(course) {
    uiState.selectedCourse = course;
    document.getElementById("courses-section").classList.add("hidden");
    document.getElementById("years-section").classList.remove("hidden");
    updateBreadcrumbs();
}

function selectYear(year) {
    uiState.selectedYear = year;
    document.getElementById("years-section").classList.add("hidden");
    document.getElementById("categories-section").classList.remove("hidden");
    updateBreadcrumbs();
}

function selectCategory(category) {
    uiState.selectedCategory = category;
    document.getElementById("categories-section").classList.add("hidden");
    document.getElementById("materials-section").classList.remove("hidden");
    updateBreadcrumbs();
    renderStudentMaterials();
}

function updateBreadcrumbs() {
    const breadcrumbs = document.getElementById("breadcrumbs");
    let content = `<span class="breadcrumb-link" onclick="resetToCourses()">Programs</span>`;

    if (uiState.selectedCourse) {
        content += `<span>›</span><span class="breadcrumb-link" onclick="selectCourse('${escapeHtml(uiState.selectedCourse)}')">${escapeHtml(uiState.selectedCourse)}</span>`;
    }
    if (uiState.selectedYear) {
        content += `<span>›</span><span class="breadcrumb-link">${escapeHtml(uiState.selectedYear)}</span>`;
    }
    if (uiState.selectedCategory) {
        content += `<span>›</span><span>${escapeHtml(uiState.selectedCategory)}</span>`;
    }

    breadcrumbs.innerHTML = content;
}


/* =========================
STUDENT MATERIALS (fetched from Supabase, shared by everyone)
========================= */

async function renderStudentMaterials() {
    const container = document.getElementById("materials-container");
    const title = document.getElementById("materials-title");

    title.textContent = `${uiState.selectedCourse} • ${uiState.selectedYear} • ${uiState.selectedCategory}`;
    container.innerHTML = `<div class="material-item"><div class="material-info"><h3>Loading...</h3></div></div>`;

    const { data: materials, error } = await supabaseClient
        .from("materials")
        .select("*")
        .eq("course", uiState.selectedCourse)
        .eq("year", uiState.selectedYear)
        .eq("category", uiState.selectedCategory)
        .order("uploaded_at", { ascending: false });

    if (error || !materials || materials.length === 0) {
        container.innerHTML = `
            <div class="material-item">
                <div class="material-info">
                    <div class="file-icon">📂</div>
                    <div>
                        <h3>No materials available yet</h3>
                        <p>The administrator has not uploaded materials for this section.</p>
                    </div>
                </div>
            </div>`;
        return;
    }

    const withLinks = await Promise.all(materials.map(async (m) => {
        const { data: signed } = await supabaseClient
            .storage
            .from(MATERIALS_BUCKET)
            .createSignedUrl(m.file_path, 60 * 10);
        return { ...m, signedUrl: signed ? signed.signedUrl : "#" };
    }));

    container.innerHTML = withLinks.map(m => `
        <div class="material-item">
            <div class="material-info">
                <div class="file-icon">📄</div>
                <div>
                    <h3>${escapeHtml(m.title)}</h3>
                    <p>${escapeHtml(m.course)} • ${escapeHtml(m.year)} • ${escapeHtml(m.category)}</p>
                </div>
            </div>
            <a href="${m.signedUrl}" target="_blank" class="view-btn">View Material 👁️</a>
        </div>
    `).join("");
}


/* =========================
ADMIN: UPLOAD MATERIAL
========================= */

document.getElementById("upload-form").addEventListener("submit", async function (event) {
    event.preventDefault();

    const title = document.getElementById("material-title").value;
    const course = document.getElementById("material-course").value;
    const year = document.getElementById("material-year").value;
    const category = document.getElementById("material-category").value;
    const file = document.getElementById("material-file").files[0];
    const btn = document.getElementById("upload-submit-btn");

    if (!file) {
        alert("Please select a document first.");
        return;
    }

    btn.disabled = true;
    btn.textContent = "Uploading...";

    const filePath = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;

    const { error: uploadError } = await supabaseClient
        .storage
        .from(MATERIALS_BUCKET)
        .upload(filePath, file);

    if (uploadError) {
        btn.disabled = false;
        btn.textContent = "Upload Material 📤";
        alert("Upload failed: " + uploadError.message);
        return;
    }

    const { error: insertError } = await supabaseClient
        .from("materials")
        .insert({ title, course, year, category, file_path: filePath });

    btn.disabled = false;
    btn.textContent = "Upload Material 📤";

    if (insertError) {
        alert("Saved the file but failed to record it: " + insertError.message);
        return;
    }

    document.getElementById("upload-form").reset();
    renderAdminDashboard();
    alert("Material uploaded successfully! 📚");
});


/* =========================
ADMIN DASHBOARD
========================= */

async function renderAdminDashboard() {
    await Promise.all([
        renderPendingRequests(),
        renderAdminMaterials(),
        renderApprovedStudentsCount(),
    ]);
}

async function renderApprovedStudentsCount() {
    const { count, error } = await supabaseClient
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("role", "student");

    document.getElementById("total-users").textContent = error ? "0" : count;
}


/* =========================
PENDING ACCESS REQUESTS
========================= */

async function renderPendingRequests() {
    const table = document.getElementById("requests-table");

    const { data: requests, error } = await supabaseClient
        .from("access_requests")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: true });

    document.getElementById("total-pending").textContent = (requests || []).length;

    if (error || !requests || requests.length === 0) {
        table.innerHTML = `<tr><td colspan="4">No pending requests.</td></tr>`;
        return;
    }

    
        table.innerHTML = requests.map(r => `
    <tr>
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.email)}</td>
        <td>${escapeHtml(r.phone || "—")}</td>
        <td>
            <input type="text" class="request-password-input"
                   id="pwd-${r.id}" placeholder="min 8 characters">
        </td>
        <td>
            <button class="approve-btn" onclick="approveRequest('${r.id}')">
                Approve & Send
            </button>
        </td>
    </tr>
`).join("");
    
}

async function approveRequest(requestId) {
    const input = document.getElementById(`pwd-${requestId}`);
    const password = input.value;

    if (!password || password.length < 8) {
        alert("Please set a password of at least 8 characters.");
        return;
    }

    const { data: { session } } = await supabaseClient.auth.getSession();

    const response = await fetch(`${SUPABASE_URL}/functions/v1/approve-request`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ requestId, password }),
    });

    const result = await response.json();

    if (!response.ok) {
        alert("Could not approve: " + (result.error || "Unknown error"));
        return;
    }

    if (result.emailWarning) {
        alert(result.emailWarning);
    } else {
        alert("Student approved and emailed their password ✅");
    }

    renderAdminDashboard();
}


/* =========================
ADMIN MATERIALS TABLE
========================= */

async function renderAdminMaterials() {
    const table = document.getElementById("admin-materials-table");

    const { data: materials, error } = await supabaseClient
        .from("materials")
        .select("*")
        .order("uploaded_at", { ascending: false });

    document.getElementById("total-materials").textContent = (materials || []).length;

    if (error || !materials || materials.length === 0) {
        table.innerHTML = `<tr><td colspan="6">No materials uploaded yet.</td></tr>`;
        return;
    }

    const withLinks = await Promise.all(materials.map(async (m) => {
        const { data: signed } = await supabaseClient
            .storage
            .from(MATERIALS_BUCKET)
            .createSignedUrl(m.file_path, 60 * 10);
        return { ...m, signedUrl: signed ? signed.signedUrl : "#" };
    }));

    table.innerHTML = withLinks.map(m => `
        <tr>
            <td>${escapeHtml(m.title)}</td>
            <td>${escapeHtml(m.course)}</td>
            <td>${escapeHtml(m.year)}</td>
            <td>${escapeHtml(m.category)}</td>
            <td><a href="${m.signedUrl}" target="_blank" class="small-view-btn">View 👁️</a></td>
            <td><button class="delete-btn" onclick="deleteMaterial('${m.id}', '${m.file_path}')">Delete</button></td>
        </tr>
    `).join("");
}

async function deleteMaterial(id, filePath) {
    if (!confirm("Are you sure you want to delete this material?")) return;

    await supabaseClient.storage.from(MATERIALS_BUCKET).remove([filePath]);
    await supabaseClient.from("materials").delete().eq("id", id);

    renderAdminDashboard();
}


/* =========================
HELPERS
========================= */

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}