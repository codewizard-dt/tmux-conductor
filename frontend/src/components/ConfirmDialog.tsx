import { useEffect } from 'react'

interface ConfirmDialogProps {
  open: boolean
  title?: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel = 'Cancel', onConfirm, onCancel }: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handler)
    return () => { document.removeEventListener('keydown', handler) }
  }, [open, onCancel])

  if (!open) return null

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onCancel()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={handleOverlayClick}
    >
      <div className="flex w-[420px] flex-col rounded-card border border-line bg-white shadow-pop">
        <div className="px-5 py-4">
          {title && (
            <p className="mb-1.5 text-[13px] font-semibold tracking-tight text-ink">{title}</p>
          )}
          <p className="text-[12px] leading-relaxed text-muted">{message}</p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-[6px] border border-line bg-white px-3 py-1.5 text-[12px] font-medium text-muted hover:text-ink hover:border-ink/30 transition"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="cursor-pointer rounded-[6px] bg-accent-red px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-85 transition"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
