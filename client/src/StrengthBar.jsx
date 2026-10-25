// A thin bar for a 0 to 1 strength score, used on decks and on single cards.
function StrengthBar({ value }) {
  const pct = Math.round((value ?? 0) * 100);
  const level = pct < 40 ? " strength-low" : pct < 70 ? " strength-mid" : "";
  return (
    <span className="strength-bar" title={`Strength ${pct}%`}>
      <span className={"strength-bar-fill" + level} style={{ width: `${pct}%` }} />
    </span>
  );
}

export default StrengthBar;
