'use client';
import { useEffect } from 'react';

// Reloads the page every 30 minutes so a wall-mounted screen stays current,
// including rolling over to the next day and the next week on its own.
export default function AutoRefresh({ minutes = 30 }) {
  useEffect(() => {
    const id = setInterval(() => window.location.reload(), minutes * 60 * 1000);
    return () => clearInterval(id);
  }, [minutes]);
  return null;
}
