export function PageFooter({ message, version }: { message: string; version: string }) {
  return (
    <div className="home-footer">
      <span>{message}</span>
      <span className="app-version">iou · {version}</span>
    </div>
  )
}
