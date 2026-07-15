import { useState } from "react";
import { supabase } from "./supabase";

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
      <div>
        <h1>Cram</h1>
        <p>Logged in as {user.email}</p>
        <button onClick={callApi}>Call /api/me</button>
        <button onClick={handleLogout}>Log out</button>
        <p>{message}</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Cram</h1>
      <input
        type="email"
        placeholder="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        type="password"
        placeholder="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button onClick={handleSignUp}>Sign up</button>
      <button onClick={handleLogin}>Log in</button>
      <p>{message}</p>
    </div>
  );
}

export default App;