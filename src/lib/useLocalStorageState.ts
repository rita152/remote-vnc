import { useCallback, useEffect, useState } from "react";

export function useLocalStorageState<T>(
  key: string,
  initialValue: T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const raw = localStorage.getItem(key);
    if (!raw) return initialValue;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore persistence errors (e.g., storage disabled)
    }
  }, [key, value]);

  const set = useCallback((next: T) => {
    setValue(next);
  }, []);

  return [value, set];
}

