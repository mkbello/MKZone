
function setupDeleteModal(modalId, formId, dataAttribute, urlPath) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    modal.addEventListener('show.bs.modal', event => {
        const button = event.relatedTarget;
        const itemId = button.getAttribute(dataAttribute);
        const form = modal.querySelector(formId);
        form.action = `/${urlPath}/${itemId}/delete`;
    });
}

setupDeleteModal('deleteUserModal', '#deleteUserForm', 'data-user-id', 'admin/users');
setupDeleteModal('deleteCommentModal', '#deleteCommentForm', 'data-comment-id', 'admin/comments');
setupDeleteModal('deletePostModal', '#deletePostForm', 'data-post-id', 'admin/posts');


document.querySelectorAll(".toggle-password").forEach(toggle => {
    toggle.addEventListener("click", () => {
        const input = document.getElementById(toggle.dataset.target);
        const isPassword = input.type === "password";
        input.type = isPassword ? "text" : "password";

        toggle.classList.toggle("fa-eye");
        toggle.classList.toggle("fa-eye-slash");
    });
});

document.getElementById("contactForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const formData = {
        name: document.getElementById("name").value,
        email: document.getElementById("email").value,
        subject: document.getElementById("subject").value,
        message: document.getElementById("message").value,
    };

    try {
        const res = await fetch("/contact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(formData),
        });

        const data = await res.json();
        if (data.success) {
            const modal = new bootstrap.Modal(document.getElementById("successModal"));
            modal.show();
            e.target.reset();
        } else {
            alert("❌ Failed to send message.");
        }
    } catch (error) {
        alert("❌ Error. Try again later.");
    }
});
