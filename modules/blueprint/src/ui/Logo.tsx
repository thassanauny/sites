export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? "small" : ""}`}>
      <span className="brand-mark">
        <i />
        <i />
        <i />
        <i />
      </span>
      {!small && (
        <span>
          blueprint<span className="brand-period">.</span>
        </span>
      )}
    </div>
  );
}
