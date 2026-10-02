import { useEffect, useState, useCallback } from 'react';

export function useDashboardData() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/dashboard');
      if (!response.ok) throw new Error(`Dashboard request failed: ${response.status}`);
      const payload = await response.json();
      setData(payload);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err.message || 'Unable to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch('/api/dashboard');
        if (!response.ok) throw new Error(`Dashboard request failed: ${response.status}`);
        const payload = await response.json();
        if (active) {
          setData(payload);
          setLastRefresh(new Date());
          setLoading(false);
        }
      } catch (err) {
        if (active) {
          setError(err.message || 'Unable to load dashboard data');
          setLoading(false);
        }
      }
    }

    load();
    return () => { active = false; };
  }, []);

  return { data, loading, error, refresh, lastRefresh };
}
