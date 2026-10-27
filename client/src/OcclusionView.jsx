// An image with boxes drawn over it. In study, every box is covered: the one
// being asked about is highlighted, and on the back it's uncovered while the
// rest stay hidden. Without a target (the deck list) all boxes show alike.
function OcclusionView({ src, boxes, target = null, reveal = false, numbered = false }) {
  return (
    <div className="occl">
      <img src={src} alt="" draggable="false" />
      {boxes.map((b, i) => {
        let state = "";
        if (b.id === target) state = reveal ? " occl-box-revealed" : " occl-box-target";
        return (
          <div
            key={b.id}
            className={"occl-box" + state}
            style={{
              left: `${b.x * 100}%`,
              top: `${b.y * 100}%`,
              width: `${b.w * 100}%`,
              height: `${b.h * 100}%`,
            }}
          >
            {b.id === target && !reveal ? "?" : numbered ? i + 1 : null}
          </div>
        );
      })}
    </div>
  );
}

export default OcclusionView;
