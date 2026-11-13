
require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const session = require("express-session");
const bcrypt = require("bcrypt");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

// ======================================
// MIDDLEWARE
// ======================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ======================================
// SESSION CONFIGURATION
// ======================================

app.use(session({
    secret: process.env.SESSION_SECRET || "school_system_local_secret",
    resave: false,
    saveUninitialized: false,

    cookie: {
        httpOnly: true,
        secure: false, // Use true with HTTPS in production
        sameSite: "lax",
        maxAge: 1000 * 60 * 60
    }
}));

// ======================================
// MYSQL DATABASE CONNECTION
// ======================================

const db = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "school_db1",

    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ======================================
// HOME / LOGIN PAGE
// ======================================

app.get("/", (req, res) => {
    if (req.session.studentId) {
        return res.redirect("/dashboard");
    }

    res.sendFile(path.join(PUBLIC_DIR, "login.html"));
});

app.get("/login", (req, res) => {
    res.redirect("/");
});

// ======================================
// REGISTRATION PAGE
// ======================================

app.get("/register", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "register.html"));
});

// ======================================
// STUDENT REGISTRATION
// ======================================

app.post("/register", async (req, res) => {
    try {
        const { username, password } = req.body;

        if (
            typeof username !== "string" ||
            typeof password !== "string" ||
            !username.trim() ||
            !password
        ) {
            return res.status(400).json({
                message: "Please fill in all fields."
            });
        }

        const cleanUsername = username.trim();

        if (
            cleanUsername.length > 100 ||
            password.length < 8 ||
            Buffer.byteLength(password, "utf8") > 72
        ) {
            return res.status(400).json({
                message: "Username must be at most 100 characters. Password must be at least 8 characters and no more than 72 bytes."
            });
        }

        // Check whether username already exists
        const [existing] = await db.execute(
            "SELECT id FROM students WHERE username = ?",
            [cleanUsername]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                message: "This username is already registered."
            });
        }

        // Securely hash the password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Save student
        await db.execute(
            "INSERT INTO students (username, password) VALUES (?, ?)",
            [cleanUsername, hashedPassword]
        );

        return res.status(201).json({
            message: "Registration successful! You can now log in."
        });

    } catch (error) {
        console.error("Registration error:", error);

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                message: "This username is already registered."
            });
        }

        return res.status(500).json({
            message: "Registration failed. Please try again."
        });
    }
});

// ======================================
// STUDENT LOGIN
// ======================================

app.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        if (
            typeof username !== "string" ||
            typeof password !== "string" ||
            !username.trim() ||
            !password
        ) {
            return res.status(400).json({
                message: "Enter your username and password."
            });
        }

        // Find student in database
        const [students] = await db.execute(
            "SELECT id, username, password FROM students WHERE username = ?",
            [username.trim()]
        );

        if (students.length === 0) {
            return res.status(401).json({
                message: "You are not registered. Please register first."
            });
        }

        const student = students[0];

        // Compare entered password with stored password hash
        const passwordMatch = await bcrypt.compare(
            password,
            student.password
        );

        if (!passwordMatch) {
            return res.status(401).json({
                message: "Incorrect username or password."
            });
        }

        // Create a new session after successful login
        req.session.regenerate((error) => {
            if (error) {
                console.error("Session error:", error);

                return res.status(500).json({
                    message: "Could not create login session."
                });
            }

            req.session.studentId = student.id;
            req.session.username = student.username;

            // Save session before responding
            req.session.save((saveError) => {
                if (saveError) {
                    console.error("Session save error:", saveError);

                    return res.status(500).json({
                        message: "Could not save login session."
                    });
                }

                return res.json({
                    message: "Login successful!",
                    username: student.username,
                    redirect: "/dashboard"
                });
            });
        });

    } catch (error) {
        console.error("Login error:", error);

        return res.status(500).json({
            message: "Login failed. Please try again."
        });
    }
});

// ======================================
// PROTECT DASHBOARD PAGE
// ======================================

app.get("/dashboard", (req, res) => {
    if (!req.session.studentId) {
        return res.redirect("/");
    }

    res.sendFile(path.join(PUBLIC_DIR, "dashboard.html"));
});

// Also protect direct dashboard.html access
app.get("/dashboard.html", (req, res) => {
    if (!req.session.studentId) {
        return res.redirect("/");
    }

    res.sendFile(path.join(PUBLIC_DIR, "dashboard.html"));
});

// ======================================
// DASHBOARD DATA
// ======================================

app.get("/dashboard-data", (req, res) => {
    if (!req.session.studentId) {
        return res.status(401).json({
            message: "Please log in first."
        });
    }

    return res.json({
        message: "Login successful!",
        username: req.session.username
    });
});

// ======================================
// STUDENT LOGOUT
// ======================================

app.post("/logout", (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            console.error("Logout error:", error);

            return res.status(500).json({
                message: "Logout failed."
            });
        }

        res.clearCookie("connect.sid");

        return res.json({
            message: "Logout successful!",
            redirect: "/"
        });
    });
});

// ======================================
// SERVE OTHER PUBLIC FILES
// ======================================

// Keep this AFTER protected dashboard routes.
app.use(express.static(PUBLIC_DIR));

// ======================================
// START SERVER
// ======================================

async function startServer() {
    try {
        const connection = await db.getConnection();

        console.log("MySQL connected successfully!");

        connection.release();

        app.listen(PORT, () => {
            console.log("--------------------------------");
            console.log("          SCHOOL SYSTEM");
            console.log("--------------------------------");
            console.log(`Server running at http://localhost:${PORT}`);
            console.log(`Registration: http://localhost:${PORT}/register`);
            console.log(`Login: http://localhost:${PORT}/`);
        });

    } catch (error) {
        console.error("MySQL connection failed:", error.message);
        console.error("Check your database and .env settings.");

        process.exit(1);
    }
}

startServer();
