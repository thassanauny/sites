import { ShieldCheck } from 'lucide-react'

export function PageFooter({ message, version }: { message: string; version: string }) {
  return (
    <div className="home-footer">
      <span>
        <ShieldCheck size={16} />
        {message}
      </span>
      <span className="app-version">iou · {version}</span>
    </div>
  )
}
