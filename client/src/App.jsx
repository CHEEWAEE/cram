import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import ThemeToggle from "./ThemeToggle";
import InstallPrompt from "./InstallPrompt";
import Decks from "./Decks";
import "./App.css";

function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [user, setUser] = useState(null);
  const [message, setMessage] = useState("");
  const [view, setView] = useState("login"); // "login" | "recovery"

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

  async function handleSignUp() {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return setMessage(error.message);
    setMessage("Signed up! Check your email to confirm, then log in.");
  }

  async function handleLogin() {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) return setMessage(error.message);
    setUser(data.user);
    setMessage("");
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setUser(null);
  }

  async function handleForgotPassword() {
    if (!email) return setMessage("Enter your email above first.");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) return setMessage(error.message);
    setMessage("Check your email for a password reset link.");
  }

  async function handleResetPassword() {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (error) return setMessage(error.message);
    await supabase.auth.signOut();
    setUser(null);
    setNewPassword("");
    setView("login");
    setMessage("Password updated. Log in with your new password.");
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

  return (
    <>
    <ThemeToggle />
    <InstallPrompt />
    <div className="auth-page">
      <div className="auth-header">
        <h1>Cram</h1>
        <span className="auth-tagline">Flashcards that let you actually cram.</span>
      </div>
      <div className="auth-card">
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
          <button className="auth-button auth-button-secondary" onClick={handleSignUp}>
            Sign up
          </button>
          <button className="auth-button auth-button-primary" onClick={handleLogin}>
            Log in
          </button>
        </div>
        <button className="auth-link" onClick={handleForgotPassword}>
          Forgot password?
        </button>
        <p className="auth-message">{message}</p>
      </div>
    </div>
    </>
  );
}

export default App;