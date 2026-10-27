import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import ThemeToggle from "./ThemeToggle";
import InstallPrompt from "./InstallPrompt";
import Decks from "./Decks";
import { clearCache, PENDING_SHARE_KEY } from "./api";
import "./App.css";

// The little stack of cards beside the login form. The top card flips on a loop
// in CSS; the two behind it are just paper.
function DemoStack() {
  return (
    <div className="demo-stack" aria-hidden="true">
      <div className="demo-card demo-card-back2" />
      <div className="demo-card demo-card-back1" />
      <div className="demo-card demo-card-top">
        <div className="demo-face demo-face-front">
          <span className="study-card-label">Question</span>
          <span className="demo-text">Half-life of caffeine?</span>
        </div>
        <div className="demo-face demo-face-back">
          <span className="study-card-label">Answer</span>
          <span className="demo-text">About 5 hours</span>
        </div>
      </div>
    </div>
  );
}

// Supabase's auth errors, in plain words. Matched loosely because the exact
// wording shifts between versions. When Supabase fails on its side (most often
// when it can't send an email) the message comes back as "{}" or nothing.
const AUTH_ERRORS = [
  [/invalid login credentials/i, "Wrong email or password."],
  [/email not confirmed/i, "Confirm your email first. The link is in your inbox."],
  [/rate limit/i, "Too many emails sent in the last hour. Try again a bit later."],
  [/already registered|already been registered/i, "That email already has an account. Log in instead."],
  [/password should be at least (\d+)/i, (m) => `Use a password of at least ${m[1]} characters.`],
  [/unable to validate email|invalid email/i, "That doesn't look like an email address."],
  [/failed to fetch|network/i, "Can't reach Cram. Check your connection and try again."],
];

function authErrorMessage(error) {
  const msg = error?.message;
  if (!msg || msg === "{}") {
    return "Something went wrong on our end. Try again in a minute.";
  }
  for (const [pattern, friendly] of AUTH_ERRORS) {
    const match = msg.match(pattern);
    if (match) return typeof friendly === "function" ? friendly(match) : friendly;
  }
  return msg;
}

// Where confirmation and reset links send people back to: the site they're on,
// not the Site URL set in the Supabase dashboard.
const authRedirect = () => ({ emailRedirectTo: window.location.origin });

function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [user, setUser] = useState(null);
  const [message, setMessage] = useState("");
  const [view, setView] = useState("login"); // "login" | "check-email" | "recovery"

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setUser(data.session.user);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "PASSWORD_RECOVERY") setView("recovery");
        else if (event === "SIGNED_IN" && session) setUser(session.user);
        else if (event === "SIGNED_OUT") setUser(null);
      }
    );
    return () => subscription.subscription.unsubscribe();
  }, []);

  // Supabase reads an empty email as a request for an anonymous account and
  // answers "Anonymous sign-ins are disabled", so catch blanks here first.
  function missingCredentials() {
    if (!email.trim() || !password) {
      setMessage("Enter your email and password.");
      return true;
    }
    return false;
  }

  async function handleSignUp() {
    if (missingCredentials()) return;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: authRedirect(),
    });
    if (error) return setMessage(authErrorMessage(error));
    // For an address that already has a confirmed account, Supabase sends no
    // email and returns a user with no identities rather than an error.
    if (data.user && data.user.identities?.length === 0) {
      return setMessage("That email already has an account. Log in instead.");
    }
    setMessage("");
    setView("check-email");
  }

  async function handleResend() {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: authRedirect(),
    });
    setMessage(error ? authErrorMessage(error) : "Sent another one. Check your inbox.");
  }

  async function handleLogin() {
    if (missingCredentials()) return;
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) return setMessage(authErrorMessage(error));
    setUser(data.user);
    setMessage("");
  }

  async function handleLogout() {
    clearCache();
    await supabase.auth.signOut();
    setUser(null);
  }

  async function handleForgotPassword() {
    if (!email) return setMessage("Enter your email above first.");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) return setMessage(authErrorMessage(error));
    setMessage("Check your email for a password reset link.");
  }

  async function handleResetPassword() {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (error) return setMessage(authErrorMessage(error));
    await supabase.auth.signOut();
    setUser(null);
    setNewPassword("");
    setView("login");
    setMessage("Password updated. Log in with your new password.");
  }

  if (view === "check-email") {
    return (
      <>
      <ThemeToggle />
      <div className="auth-page">
        <div className="auth-card check-email">
          <div className="check-email-icon" aria-hidden="true">✉</div>
          <h2>Check your inbox</h2>
          <p className="check-email-text">
            Sent to <strong>{email}</strong>
          </p>
          <div className="auth-actions">
            <button className="auth-button auth-button-secondary" onClick={handleResend}>
              Resend email
            </button>
            <button
              className="auth-button auth-button-primary"
              onClick={() => {
                setMessage("");
                setView("login");
              }}
            >
              Back to log in
            </button>
          </div>
          <p className="auth-message">{message}</p>
        </div>
      </div>
      </>
    );
  }

  if (view === "recovery") {
    return (
      <>
      <ThemeToggle />
      <InstallPrompt />
      <div className="auth-page">
        <div className="auth-header">
          <h1>Cram</h1>
          <span className="auth-tagline">Choose a new password</span>
        </div>
        <div className="auth-card">
          <label className="auth-field">
            New password
            <input
              type="password"
              placeholder="••••••••"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <div className="auth-actions">
            <button
              className="auth-button auth-button-primary"
              onClick={handleResetPassword}
            >
              Update password
            </button>
          </div>
          <p className="auth-message">{message}</p>
        </div>
      </div>
      </>
    );
  }

  if (user) {
    return (
      <>
      <InstallPrompt />
      <div className="app-shell">
        <div className="app-topbar">
          <span className="app-brand">Cram</span>
          <div className="app-topbar-right">
            <span className="auth-tagline">{user.email}</span>
            <ThemeToggle inline />
            <button className="auth-button auth-button-secondary" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </div>
        <Decks />
      </div>
      </>
    );
  }

  const savingShare = !!localStorage.getItem(PENDING_SHARE_KEY);

  return (
    <>
    <ThemeToggle />
    <InstallPrompt />
    <div className="auth-page landing">
      <div className="landing-main">
        <div className="landing-hero">
          <h1 className="landing-title">Cram</h1>
          <DemoStack />
        </div>
        <form
          className="auth-card"
          onSubmit={(e) => {
            e.preventDefault();
            handleLogin();
          }}
        >
          {savingShare && (
            <p className="notice">Log in or sign up to save the shared deck.</p>
          )}
          <label className="auth-field">
            Email
            <input
              type="email"
              placeholder="you@school.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="auth-field">
            Password
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <div className="auth-actions">
            <button type="button" className="auth-button auth-button-secondary" onClick={handleSignUp}>
              Sign up
            </button>
            <button type="submit" className="auth-button auth-button-primary">
              Log in
            </button>
          </div>
          <button type="button" className="auth-link" onClick={handleForgotPassword}>
            Forgot password?
          </button>
          <p className="auth-message">{message}</p>
        </form>
      </div>
      <footer className="auth-footer">
        <a href="/about">About Cram</a>
      </footer>
    </div>
    </>
  );
}

export default App;