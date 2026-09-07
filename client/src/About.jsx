import ThemeToggle from "./ThemeToggle";
import "./App.css";

function About() {
  return (
    <>
      <ThemeToggle />
      <div className="about-page">
        <div className="about-content">
          <h1>About Cram</h1>

          <p>
            Cram is a flashcard website that also installs as an app on your
            phone. Make a deck at your laptop, drill it anywhere.
          </p>

          <p>
            I'm a uni student, and I noticed the times I actually wanted to
            review flashcards were never the times I was sat at a desk. It was
            on the train, in the ten minutes before a tutorial, lying in bed. So
            I built something that works in those gaps.
          </p>

          <p>
            Cram is a single-page React app talking to an Express API, with
            Postgres underneath.
          </p>

          <a className="about-back" href="/">
            Back to Cram
          </a>
        </div>
      </div>
    </>
  );
}

export default About;
