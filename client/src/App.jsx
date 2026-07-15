import { useState } from "react";
import { supabase } from "./supabase";
import "./App.css";

function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState(null);
  const [message, setMessage] = useState("");

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

  async function callApi() {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session.access_token;

    const res = await fetch("http://localhost:3001/api/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    setMessage(JSON.stringify(json));
  }

  if (user) {
    return (
      <div className="auth-page">
        <div className="auth-header">
          <h1>Cram</h1>
          <span className="auth-tagline">Logged in as {user.email}</span>
        </div>
        <div className="auth-card">
          <div className="auth-actions">
            <button className="auth-button auth-button-secondary" onClick={callApi}>
              Call /api/me
            </button>
            <button className="auth-button auth-button-primary" onClick={handleLogout}>
              Log out
            </button>
          </div>
          <p className="auth-message">{message}</p>
        </div>
      </div>
    );
  }

  return (
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
        <p className="auth-message">{message}</p>
      </div>
    </div>
  );
}

export default App;