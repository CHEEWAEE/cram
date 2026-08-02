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
              Cram is a flashcard study app. You make decks of cards, study
              them, and the app prioritises the cards you keep forgetting so you
              spend your time on what you don't know yet.
            </p>
          </section>

          <section className="about-section">
            <h2>Who made it</h2>
            <p>
              Cram is a personal portfolio project built by a software
              engineering student. It isn't a company or a commercial product.
            </p>
          </section>

          <section className="about-section">
            <h2>Cram is free</h2>
            <p>
              Cram is free to use. There is no paid tier, no subscriptions, and
              no payment processing of any kind. The app has no billing code and
              never charges users, their cards, or their mobile phone accounts.
              There is nothing to buy and no way to be charged.
            </p>
          </section>

          <section className="about-section">
            <h2>What data it stores</h2>
            <p>
              Accounts store only an email address and a password. Beyond that,
              Cram stores the decks and cards you create. It does not collect
              payment information, because it never takes payments.
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
