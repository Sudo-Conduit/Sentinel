// SimpleAnimation-Scene.jsx — one circle: grows in, moves across, shrinks away.
function Piece() {
  const { useComposition, animate, Easing } = window;
  const { T, CUES } = useComposition();
  const enter = animate({ from: 0, to: 1, start: CUES.Enter, end: CUES.Move, ease: Easing.easeOutBack })(T);
  const move = animate({ from: 100, to: 1180, start: CUES.Move, end: CUES.Exit, ease: Easing.easeInOutCubic })(T);
  const exitScale = animate({ from: 1, to: 0, start: CUES.Exit, end: CUES.Exit + 1.5, ease: Easing.easeInCubic })(T);
  const scale = T >= CUES.Exit ? exitScale : Math.min(enter, 1);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div style={{
        position: 'absolute', left: move, top: 300, width: 120, height: 120,
        borderRadius: '50%', background: '#3fb950',
        transform: `scale(${scale})`, opacity: enter
      }} />
    </div>
  );
}
window.Piece = Piece;
