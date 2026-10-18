export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? "small" : ""}`}>
      <span className="brand-mark">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
      </span>
      {!small && (
        <span>
          blueprint<span className="brand-period">.</span>
        </span>
      )}
    </div>
  );
}
