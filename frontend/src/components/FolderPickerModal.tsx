import { useEffect, useRef, useState } from 'react';
import { browseDirectory, type BrowseResult } from '../lib/api';

interface FolderPickerModalProps {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export default function FolderPickerModal({ initialPath, onSelect, onClose }: FolderPickerModalProps) {
  const [result, setResult] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputPath, setInputPath] = useState(initialPath ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  function navigate(dir: string) {
    setError(null);
    setLoading(true);
    browseDirectory(dir)
      .then((res) => {
        setResult(res);
        setInputPath(res.path);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Cannot read directory');
      })
      .finally(() => { setLoading(false); });
  }

  useEffect(() => {
    navigate(initialPath ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      navigate(inputPath);
    }
  }

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  const currentPath = result?.path ?? inputPath;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={handleOverlayClick}
    >
      <div className="flex w-[540px] max-h-[520px] flex-col rounded-[12px] border border-line bg-white shadow-[0_8px_32px_0_rgb(16_17_26/0.18)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Select Folder
          </span>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-[6px] border-0 bg-transparent px-1.5 py-0.5 text-[14px] leading-none text-muted hover:text-ink transition"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Path input */}
        <div className="border-b border-line px-4 py-2.5">
          <input
            ref={inputRef}
            type="text"
            value={inputPath}
            onChange={(e) => { setInputPath(e.target.value); }}
            onKeyDown={handleInputKeyDown}
            onBlur={() => {
              if (inputPath !== currentPath) navigate(inputPath);
            }}
            placeholder="/path/to/folder"
            className="w-full rounded-[6px] border border-line bg-canvas px-3 py-1.5 font-mono text-[12px] text-ink placeholder:text-muted-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/10 transition"
          />
        </div>

        {/* Directory listing */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
          {loading && (
            <p className="px-2 py-3 text-[12px] text-muted">Loading…</p>
          )}
          {!loading && error && (
            <p className="px-2 py-3 text-[12px] text-accent-red">{error}</p>
          )}
          {!loading && !error && result && (
            <ul className="flex flex-col gap-0.5">
              {result.parent !== null && (
                <li>
                  <button
                    type="button"
                    onClick={() => { navigate(result.parent!); }}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[12px] text-muted hover:bg-canvas hover:text-ink transition"
                  >
                    <span className="text-[13px] leading-none">↑</span>
                    <span className="font-mono">..</span>
                  </button>
                </li>
              )}
              {result.entries.length === 0 && (
                <li className="px-2.5 py-2 text-[12px] text-muted-2">No subdirectories</li>
              )}
              {result.entries.map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    onClick={() => { navigate(entry.path); }}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[12px] text-ink hover:bg-canvas transition"
                  >
                    <span className="text-[13px] leading-none text-muted">⌂</span>
                    <span className="font-mono">{entry.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line px-4 py-3">
          <span className="truncate font-mono text-[11px] text-muted max-w-[300px]" title={currentPath}>
            {currentPath || '—'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-[6px] border border-line bg-white px-3 py-1.5 text-[12px] font-medium text-muted hover:text-ink hover:border-ink/30 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!currentPath}
              onClick={() => { onSelect(currentPath); }}
              className="cursor-pointer rounded-[6px] bg-ink px-3 py-1.5 text-[12px] font-medium text-white hover:bg-ink/80 transition disabled:opacity-40 disabled:pointer-events-none"
            >
              Select this folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
