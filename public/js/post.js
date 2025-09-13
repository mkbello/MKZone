document.querySelectorAll(".like-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
        const postId = btn.dataset.postid;
        const liked = btn.dataset.liked === "true";
        const icon = btn.querySelector("i");

        const url = liked ? `/posts/${postId}/unlike` : `/posts/${postId}/like`;

        const res = await fetch(url, { method: "POST" });
        const data = await res.json();

        if (data.success) {
            document.getElementById(`like-count-${postId}`).textContent = data.likeCount;

            if (liked) {

                icon.classList.remove("fa-solid", "liked");
                icon.classList.add("fa-regular");
                btn.dataset.liked = "false";
            } else {

                icon.classList.remove("fa-regular");
                icon.classList.add("fa-solid", "liked");
                btn.dataset.liked = "true";
            }
        }
    });
});

document.querySelectorAll('.toggle-comments').forEach(button => {
    button.addEventListener('click', () => {
        const postId = button.getAttribute('data-id');
        const commentsBox = document.getElementById(`comments-${postId}`);

        commentsBox.classList.toggle('active');

        if (commentsBox.classList.contains('active')) {
            button.textContent = 'Hide Comments';
        } else {
            button.textContent = 'Show Comments';
        }
    });
});


document.addEventListener("DOMContentLoaded", () => {

    document.querySelectorAll(".comment-form").forEach(form => {
        form.addEventListener("submit", async (e) => {
            e.preventDefault();

            const postId = form.dataset.postId;
            const textarea = form.querySelector("textarea");
            const content = textarea.value.trim();
            if (!content) return;

            try {
                const res = await fetch(`/posts/${postId}/comments`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ content })
                });
                const data = await res.json();
                if (!data.success) return alert(data.message || "Failed to add comment");

                const ul = document.getElementById(`comment-list-${postId}`);
                const noMsg = document.getElementById(`no-comments-${postId}`);

                const li = document.createElement("li");
                li.className = "comment";
                li.dataset.id = data.comment.id;
                li.innerHTML = `
          <p class="comment-meta">
            <strong>${data.comment.username}</strong> •
            ${new Date(data.comment.created_at).toLocaleString("en-US", {
                    month: "short", day: "numeric", year: "numeric",
                    hour: "2-digit", minute: "2-digit"
                })}
          </p>
          <p class="comment-content">
            ${data.comment.content.charAt(0).toUpperCase() + data.comment.content.slice(1)}
          </p>
          <button class="comment-btn delete-comment" data-id="${data.comment.id}">Delete Comment</button>
        `;

                ul.prepend(li);

                noMsg.classList.add("d-none");

                textarea.value = "";
                flashMessage(form, "✅ Comment posted!", "text-success");
            } catch (err) {
                console.error(err);
                alert("Network error adding comment");
            }
        });
    });


    document.addEventListener("click", async (e) => {
        const btn = e.target.closest(".delete-comment");
        if (!btn) return;

        const li = btn.closest(".comment");
        const box = btn.closest(".comments-box");
        const ul = box.querySelector('ul[id^="comment-list-"]');
        const postId = ul.dataset.postId;

        try {
            const res = await fetch(`/comments/${btn.dataset.id}`, {
                method: "DELETE",
                credentials: "include"
            });
            const data = await res.json();


            if (data.success) {
                li.remove();

                if (ul.querySelectorAll(".comment").length === 0) {
                    const noMsg = document.getElementById(`no-comments-${postId}`);
                    noMsg.classList.remove("d-none");
                }
            }
        } catch (err) {
            console.error("Network error deleting comment:", err);
        }
    });


    function flashMessage(form, text, cls) {
        const msg = document.createElement("p");
        msg.className = `${cls} comment-success`;
        msg.style.marginTop = "8px";
        msg.style.fontWeight = "500";
        msg.textContent = text;
        form.insertAdjacentElement("beforebegin", msg);

        setTimeout(() => msg.remove(), 2500);
    }
});

