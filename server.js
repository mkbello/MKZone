import express from "express";
import env from "dotenv";
import bodyParser from "body-parser";
import pg from "pg";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcrypt";
import methodOverride from "method-override";
import crypto from "crypto";
import nodemailer from "nodemailer";


env.config();
const app = express();
const port = process.env.PORT;

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

const PgSession = connectPg(session);

const transporter = nodemailer.createTransport({
    host: process.env.HOST,
    port: process.env.TRANSPORTER_PORT,
    secure: false,
    auth: {
        user: process.env.USER,
        pass: process.env.PASS
    },
    tls: { rejectUnauthorized: false }
});


app.set("view engine", "ejs");
app.use(methodOverride("_method"));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(
    session({
        store: new PgSession({ pool }),
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: 1000 * 60 * 60 * 24 * 7,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax"
        }
    })
);


app.use((req, res, next) => {
    res.locals.session = req.session;
    res.locals.user = req.session.user;
    next();
});


function requireAuth(req, res, next) {
    if (!req.session.user) return res.redirect("/login");
    next();
}

function isAdmin(req, res, next) {
    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== "admin") {
        return res.status(403).send("Access denied. Admins only.");
    }
    next();
}

app.get("/admin/dashboard", isAdmin, async (req, res) => {
    try {
        const { rows: userCount } = await pool.query("SELECT COUNT(*) FROM users");
        const { rows: postCount } = await pool.query("SELECT COUNT(*) FROM posts");
        const { rows: commentCount } = await pool.query("SELECT COUNT(*) FROM comments");
        const { rows: likeCount } = await pool.query("SELECT COUNT(*) FROM likes");

        res.render("admin/dashboard", {
            title: "Admin Dashboard",
            stats: {
                users: userCount[0].count,
                posts: postCount[0].count,
                comments: commentCount[0].count,
                likes: likeCount[0].count
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading admin dashboard");
    }
});

app.get("/admin/users", isAdmin, async (req, res) => {
    const { rows: users } = await pool.query(
        "SELECT id, username, email, role, created_at FROM users ORDER BY id"
    );
    res.render("admin/users", { title: "Manage Users", users });
});

app.get("/admin/posts", isAdmin, async (req, res) => {
    const { rows: posts } = await pool.query(`
        SELECT p.*, u.username,
               (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count
        FROM posts p 
        JOIN users u ON p.user_id = u.id
        ORDER BY p.created_at DESC
    `);

    res.render("admin/posts", { title: "Manage Posts", posts });
});

app.get("/admin/comments", isAdmin, async (req, res) => {
    const { rows: comments } = await pool.query(`
        SELECT c.*, u.username, p.title 
        FROM comments c
        JOIN users u ON c.user_id = u.id
        JOIN posts p ON c.post_id = p.id
        ORDER BY c.created_at DESC
    `);
    res.render("admin/comments", { title: "Manage Comments", comments });
});

app.post("/admin/users/:id/promote", isAdmin, async (req, res) => {
    const { id } = req.params;
    await pool.query("UPDATE users SET role='admin' WHERE id=$1", [id]);
    res.redirect("/admin/users");
});

app.post("/admin/users/:id/demote", isAdmin, async (req, res) => {
    const { id } = req.params;
    await pool.query("UPDATE users SET role='user' WHERE id=$1", [id]);
    res.redirect("/admin/users");
});

app.post("/admin/users/:id/delete", isAdmin, async (req, res) => {
    const { id } = req.params;
    await pool.query("DELETE FROM users WHERE id = $1", [id]);
    res.redirect("/admin/users");
});

app.post('/admin/comments/:id/delete', isAdmin, async (req, res) => {
    const { id } = req.params;
    await pool.query('DELETE FROM comments WHERE id=$1', [id]);
    res.redirect('/admin/comments');
});

app.post("/admin/posts/:id/delete", isAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        await pool.query("DELETE FROM posts WHERE id = $1", [id]);

        res.redirect("/admin/posts");
    } catch (err) {
        console.error(err);
        res.redirect("/admin/posts");
    }
});

app.get("/", (req, res) => {
    res.render("index", { title: "MKZone" });
});

app.get("/register", (req, res) => {

    res.render("register", {
        title: "MKZone/Register",
        error_email: null,
        error_username: null,
        successful: null
    });

});

app.get("/login", (req, res) => {
    res.render("login", {
        title: "MKZone/Login",
        error: null,
        incorrect_password: null,
        successMessage: null
    });
});

app.get("/blog", async (req, res) => {
    try {

        const { rows: posts } = await pool.query(
            `SELECT p.*, u.username,
            (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count 
       FROM posts p 
       JOIN users u ON p.user_id = u.id 
       ORDER BY p.created_at DESC`
        );

        res.render("blog", {
            posts,
            title: "MKZone/Blog"
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});

app.get("/publish", async (req, res) => {
    try {
        let posts = [];

        if (req.session.user) {
            const { rows } = await pool.query(
                `SELECT p.*, u.username,
                (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count
         FROM posts p
         JOIN users u ON p.user_id = u.id
         WHERE p.user_id = $1
         ORDER BY p.created_at DESC`,
                [req.session.user.id]
            );
            posts = rows;
        }

        const success = req.session.success || null;
        req.session.success = null;

        res.render("publish", {
            posts,
            title: "MKZone / Publish",
            user: req.session.user || null,
            success
        });
    } catch (err) {
        console.error("Error loading publish page:", err.message);
        res.status(500).send("Server error");
    }
});

app.get("/posts/:id", async (req, res) => {
    const { id } = req.params;
    const userId = req.session.user ? req.session.user.id : null;

    const { rows: postRows } = await pool.query(
        `SELECT p.*, u.username,
                (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count,
                EXISTS(
                    SELECT 1 FROM likes WHERE post_id = p.id AND user_id = $2
                ) AS user_liked
         FROM posts p
         JOIN users u ON p.user_id = u.id
         WHERE p.id = $1`,
        [id, userId]
    );

    const post = postRows[0];
    if (!post) return res.status(404).send("Post not found.");

    const { rows: comments } = await pool.query(
        `SELECT c.*, u.username
         FROM comments c
         JOIN users u ON c.user_id = u.id
         WHERE c.post_id = $1
         ORDER BY c.created_at DESC`,
        [id]
    );

    res.render("post", {
        post,
        comments,
        title: "MKZone/Post/Id"
    });
});

app.get("/posts/:id/edit", async (req, res) => {
    const { id } = req.params;
    const { rows } = await pool.query("SELECT * FROM posts WHERE id = $1", [id]);
    const post = rows[0];

    if (!req.session.user || req.session.user.id !== post.user_id) {
        return res.status(403).send("Not authorized to edit this post.");
    }

    res.render("edit_post", { post, title: "MKZone/Edit_post" });
});

app.get("/about", (req, res) => {
    res.render("about.ejs", { title: "MKZone/About" });
});

app.get("/faqs", (req, res) => {
    res.render("faqs.ejs", { title: "MKZone/FAQs" });
});

app.get("/contact", (req, res) => {
    res.render("contact.ejs", { title: "MKZone/Contact" });
});

app.get("/logout", requireAuth, (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Error destroying session:", err);
            return res.status(500).send("Error logging out");
        }
        res.clearCookie("connect.sid");
        res.redirect("/login");
    });
});

app.get("/account", requireAuth, (req, res) => {
    res.render("account.ejs", {
        title: "MKZone/Account", success: null,
        error: null
    });

});

app.get("/goodbye", (req, res) => {
    res.render("goodbye.ejs", { title: "MKZone/Goodbye" });
});

app.get("/forgot-password", (req, res) => {
    res.render("forgot-password.ejs", { successful_password_reset: null, error_email: null, successful: null, error: null, title: "MKZone/Forgot-Password" });
});

app.get("/reset-password/:token", async (req, res) => {
    const { token } = req.params;
    const { rows } = await pool.query(
        "SELECT * FROM users WHERE reset_token=$1 AND reset_token_expiry > NOW()",
        [token]
    );

    if (!rows.length) return res.render("forgot-password.ejs", { successful_password_reset: null, error_email: null, successful: null, error: "Expired Link, request a new password reset link below.", title: "MKZone/Forgot-Password" });
    res.render("reset-password", { title: "MKZone/Reset-Password", token });
});

app.post("/register", async (req, res) => {
    const { username, email, password } = req.body;
    if (!email || !password) return res.send("All fields required.");
    const hash = await bcrypt.hash(password, 10);
    try {
        const { rows } = await pool.query(
            "INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, email",
            [username, email, hash]
        );

        res.render("register", { successful: "✅ Registration successful! You can now ", error_email: null, error_username: null, title: "MKZone/Register" });

    } catch (error) {
        console.error(error);
        if (error.constraint === "users_username_key") {
            return res.render("register", { error_username: "Username already taken. Try another one.", error_email: null, successful: null, title: "MKZone/Register" });
        }
        if (error.constraint === "users_email_key") {
            return res.render("register", { error_email: "Email already exists", error_username: null, successful: null, title: "MKZone/Register" });
        }

    }
});

app.post("/login", async (req, res) => {
    const { email, loginPassword } = req.body;
    const { rows } = await pool.query(
        "SELECT id, username, email, password, role FROM users WHERE email = $1",
        [email]
    );
    const user = rows[0];

    if (!user) {
        return res.render("login", {
            incorrect_password: null,
            successMessage: null,
            error: "No account found with that email. Please",
            title: "MKZone/Login"
        });
    }

    const ok = await bcrypt.compare(loginPassword, user.password);
    if (!ok) {
        return res.render("login", {
            error: null,
            successMessage: null,
            incorrect_password: "Incorrect Password.",
            title: "MKZone/Login"
        });
    }


    req.session.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email
    };

    req.session.save(err => {
        if (err) {
            console.error("Session save error:", err);
            return res.status(500).send("Internal Server Error");
        }


        res.render("login", {
            title: "MKZone/Login",
            successMessage: "✅ You have successfully logged in.",
            error: null,
            incorrect_password: null
        });
    });
});

app.post("/publish", requireAuth, async (req, res) => {
    const { title, img, content } = req.body;
    if (!title || !content) {
        req.session.success = "Title and content required.";
        return res.redirect("/publish");
    }

    try {
        await pool.query(
            "INSERT INTO posts (user_id, title, image_url, content) VALUES ($1, $2, $3, $4)",
            [req.session.user.id, title, img, content]
        );

        req.session.success = "✅ Your post has been successfully published. You can view it below, blog page or create another post.";
        res.redirect("/publish");
    } catch (err) {
        console.error(err);
        req.session.success = "Error publishing post.";
        res.redirect("/publish");
    }
});

app.put("/posts/:id", async (req, res) => {
    const { id } = req.params;
    const { title, content, img } = req.body;

    const { rows } = await pool.query("SELECT * FROM posts WHERE id = $1", [id]);
    const post = rows[0];


    if (!req.session.user || req.session.user.id !== post.user_id) {
        return res.status(403).send("Not authorized.");
    }

    const imageUrl = img;

    await pool.query(
        "UPDATE posts SET title = $1, content = $2, image_url = $3 WHERE id = $4",
        [title, content, imageUrl, id]
    );

    res.redirect(`/posts/${id}`);
});

app.post("/posts/:id/comments", requireAuth, async (req, res) => {
    const { id } = req.params;
    const { content } = req.body;
    const userId = req.session.user.id;

    if (!content || content.trim() === "") {
        return res.json({ success: false, message: "Comment cannot be empty" });
    }

    try {
        const { rows } = await pool.query(
            `INSERT INTO comments (content, user_id, post_id, created_at)
             VALUES ($1, $2, $3, NOW())
             RETURNING id, content, created_at`,
            [content.trim(), userId, id]
        );

        const newComment = rows[0];


        const { rows: userRows } = await pool.query(
            "SELECT username FROM users WHERE id=$1",
            [userId]
        );

        res.json({
            success: true,
            comment: {
                id: newComment.id,
                content: newComment.content,
                created_at: newComment.created_at,
                username: userRows[0].username,
                user_id: userId
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

app.post("/posts/:id/delete", requireAuth, async (req, res) => {
    const { id } = req.params;
    await pool.query("DELETE FROM posts WHERE id=$1 AND user_id=$2", [id, req.session.user.id]);
    res.redirect("/publish");
});

app.delete("/comments/:id", requireAuth, async (req, res) => {
    try {
        const { id } = req.params;


        const { rows } = await pool.query(
            "SELECT user_id FROM comments WHERE id=$1",
            [id]
        );

        if (rows.length === 0) {
            return res.json({ success: false, message: "Comment not found" });
        }

        const comment = rows[0];


        if (comment.user_id !== req.session.user.id) {
            return res.json({ success: false, message: "Not authorized" });
        }

        await pool.query("DELETE FROM comments WHERE id=$1", [id]);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

app.post("/delete-account", async (req, res) => {
    if (!req.session.user) {
        return res.redirect("/login");
    }

    try {
        const userId = req.session.user.id;

        await pool.query("DELETE FROM users WHERE id = $1", [userId]);

        req.session.destroy(err => {
            if (err) {
                console.error(err);
                return res.status(500).send("Error deleting account.");
            }
            res.clearCookie("connect.sid");
            res.redirect("/goodbye");
        });
    } catch (error) {
        console.error(error.message);
        res.redirect("/account");
    }
});

app.post("/forgot-password", async (req, res) => {
    const { email } = req.body;

    try {
        const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (!rows.length) return res.render("forgot-password.ejs", { successful_password_reset: null, error: null, title: "MKZone/Forget-Password", successful: null, error_email: "No account found with that email." });

        const user = rows[0];
        const token = crypto.randomBytes(32).toString("hex");

        await pool.query(
            "UPDATE users SET reset_token=$1, reset_token_expiry=NOW() + interval '1 hour' WHERE id=$2",
            [token, user.id]
        );

        const resetLink = `${process.env.BASE_URL}/reset-password/${token}`;


        await transporter.sendMail({
            from: `"MKZone Support" <${process.env.USER}>`,

            to: user.email,
            subject: "MKZone Password Reset Request",
            html: `
        <p>Hello ${user.username},</p>
        <p>You requested to reset your password.</p>
        <p>Click here to reset your password (valid for 1 hour):</p>
        <a href="${resetLink}">${resetLink}</a>
        <p>If you didn’t request this, ignore this email.</p>
      `
        });

        res.render("forgot-password.ejs", { successful_password_reset: null, error_email: null, error: null, title: "MKZone/Forget-Password", successful: "Password reset link has been sent to your email." });
    } catch (err) {
        console.error(err);
        res.redirect("/forgot-password");
    }
});

app.post("/reset-password/:token", async (req, res) => {
    const { token } = req.params;
    const { updatePassword } = req.body;

    try {
        const { rows } = await pool.query(
            "SELECT * FROM users WHERE reset_token=$1 AND reset_token_expiry > NOW()",
            [token]
        );

        if (!rows.length) return res.render("forgot-password.ejs", { successful_password_reset: null, error_email: null, successful: null, error: "Expired Link, request a new password reset link below.", title: "MKZone/Forgot-Password" });

        const hashedPassword = await bcrypt.hash(updatePassword, 10);

        await pool.query(
            "UPDATE users SET password=$1, reset_token=NULL, reset_token_expiry=NULL WHERE id=$2",
            [hashedPassword, rows[0].id]
        );

        res.render("forgot-password.ejs", { successful_password_reset: "✅ Password reset successful! You can now", error_email: null, successful: null, error: null, title: "MKZone/Forgot-Password" });
    } catch (err) {
        console.error(err);
        res.redirect("/forgot-password");
    }
});

app.post("/posts/:id/like", requireAuth, async (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;

    try {

        const { rowCount } = await pool.query(
            "SELECT 1 FROM likes WHERE user_id=$1 AND post_id=$2",
            [userId, id]
        );

        if (rowCount === 0) {
            await pool.query(
                "INSERT INTO likes (user_id, post_id) VALUES ($1, $2)",
                [userId, id]
            );
        }

        const { rows } = await pool.query(
            "SELECT COUNT(*) AS like_count FROM likes WHERE post_id=$1",
            [id]
        );

        res.json({ success: true, likeCount: rows[0].like_count });
    } catch (err) {
        console.error(err);
        res.json({ success: false });
    }
});

app.post("/posts/:id/unlike", requireAuth, async (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;

    try {
        await pool.query(
            "DELETE FROM likes WHERE user_id=$1 AND post_id=$2",
            [userId, id]
        );

        const { rows } = await pool.query(
            "SELECT COUNT(*) AS like_count FROM likes WHERE post_id=$1",
            [id]
        );

        res.json({ success: true, likeCount: rows[0].like_count });
    } catch (err) {
        console.error(err);
        res.json({ success: false });
    }
});

app.post("/account/update-info", requireAuth, async (req, res) => {
    try {
        const { username, email } = req.body;
        const userId = req.session.user.id;

        const { rows: usernameRows } = await pool.query(
            "SELECT id FROM users WHERE username = $1 AND id <> $2",
            [username, userId]
        );
        if (usernameRows.length > 0) {
            return res.render("account", {
                title: "MKZone/Account",
                success: null,
                error: "Username is already taken."
            });
        }


        const { rows: emailRows } = await pool.query(
            "SELECT id FROM users WHERE email = $1 AND id <> $2",
            [email, userId]
        );
        if (emailRows.length > 0) {
            return res.render("account", {
                title: "MKZone/Account",
                success: null,
                error: "Email is already in use."
            });
        }


        await pool.query(
            "UPDATE users SET username = $1, email = $2 WHERE id = $3",
            [username, email, userId]
        );


        req.session.user.username = username;
        req.session.user.email = email;

        res.render("account", {
            title: "MKZone/Account",
            success: "✅ Account info updated successfully",
            error: null
        });
    } catch (err) {
        console.error(err.message);
        res.redirect("/account");
    }
});

app.post("/account/update-password", requireAuth, async (req, res) => {
    try {
        const { password, newPassword } = req.body;

        const { rows } = await pool.query(
            "SELECT password FROM users WHERE id = $1",
            [req.session.user.id]
        );

        const valid = await bcrypt.compare(password, rows[0].password);
        if (!valid) {
            return res.render("account", {
                success: null,
                title: "MKZone/Account",
                error: "Current password is incorrect."
            });
        }

        const hashed = await bcrypt.hash(newPassword, 10);

        await pool.query(
            "UPDATE users SET password = $1 WHERE id = $2",
            [hashed, req.session.user.id]
        );

        return res.render("account", {
            success: "✅ Password updated successfully",
            title: "MKZone/Account",
            error: null
        });

    } catch (err) {
        console.error(err.message);
        return res.redirect("/account");
    }
});

app.post("/contact", async (req, res) => {
    const { name, email, subject, message } = req.body;

    try {

        let transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: process.env.ADMIN_EMAIL,
                pass: process.env.PASSWORD,
            },
        });


        let mailOptions = {
            from: `${name} ${email}`,
            to: process.env.ADMIN_EMAIL,
            subject: `New Contact Form Message: ${subject}`,
            text: `
        You received a new message from your blog website:

        Name: ${name}
        Email: ${email}
        Subject: ${subject}
        Message: ${message}
      `,
        };


        await transporter.sendMail(mailOptions);

        console.log("✅ Message sent successfully!");
        res.json({ success: true });
    } catch (error) {
        console.error("❌ Error sending email:", error);
        res.json({ success: false, error: "Failed to send message." });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
