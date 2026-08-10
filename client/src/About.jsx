import ThemeToggle from "./ThemeToggle";
import "./App.css";

function About() {
  return (
    <>
      <ThemeToggle />
      <div className="about-page">
        <div className="about-content">
          <h1>About Cram</h1>

          <section className="about-section">
            <h2>What Cram is</h2>
            <p>
              Cram is a simple flashcard study app that works on both phones and
              desktops. The idea is to make it easy to drill constantly —
              on a commute, or in bed instead of doomscrolling.
            </p>
          </section>

          <section className="about-section">
            <h2>Who made it</h2>
            <p>
              Built by a third-year software engineering student as a project to
              practise full stack development.
            </p>
          </section>

          <a className="about-back" href="/">
            Back to Cram
          </a>
        </div>
      </div>
    </>
  );
}

export default About;
