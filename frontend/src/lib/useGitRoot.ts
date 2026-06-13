import { useState, useEffect } from 'react';
import { API_BASE } from './api';

interface GitRootResult {
  loading: boolean;
  isRepo: boolean;
  isInsideRepo: boolean;
  gitRoot: string | null;
}

export function useGitRoot(workdir: string): GitRootResult {
  const [result, setResult] = useState<GitRootResult>({
    loading: false,
    isRepo: false,
    isInsideRepo: false,
    gitRoot: null,
  });


  useEffect(() => {
    if (!workdir.startsWith('/') || workdir.length < 2) {
      const t = setTimeout(() => {
        setResult({ loading: false, isRepo: false, isInsideRepo: false, gitRoot: null });
      }, 0);
      return () => { clearTimeout(t) };
    }

    const timer = setTimeout(() => {
      setResult((r) => ({ ...r, loading: true }));
      void fetch(`${API_BASE}/git-root?path=${encodeURIComponent(workdir)}`)
        .then((res) => res.json())
        .then((data: { isRepo: boolean; isInsideRepo: boolean; gitRoot: string | null }) => {
          setResult({ loading: false, ...data });
        })
        .catch(() => {
          setResult({ loading: false, isRepo: false, isInsideRepo: false, gitRoot: null });
        });
    }, 500);

    return () => { clearTimeout(timer); };
  }, [workdir]);

  return result;
}
