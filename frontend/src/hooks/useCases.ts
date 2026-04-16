import { useState, useEffect, useCallback } from "react";
import { CaseRecord, CasesResponse, StatsResponse, VillageStat, Urgency } from "../types";

const API_BASE = "/api";

export function useCases() {
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [villageStats, setVillageStats] = useState<VillageStat[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [urgencyFilter, setUrgencyFilter] = useState<Urgency | "ALL">("ALL");
  const [regionFilter, setRegionFilter] = useState<string>("GLOBAL");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchCases = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (urgencyFilter !== "ALL") params.set("urgency", urgencyFilter);
      if (regionFilter && regionFilter !== "GLOBAL") params.set("region", regionFilter);
      if (searchQuery) params.set("search", searchQuery);
      params.set("page", String(page));
      params.set("limit", "50");

      const res = await fetch(`${API_BASE}/cases?${params}`);
      const data: CasesResponse = await res.json();
      setCases(data.cases);
      setTotalPages(data.totalPages);
      setTotal(data.total);
    } catch (error) {
      console.error("Failed to fetch cases:", error);
    } finally {
      setLoading(false);
    }
  }, [urgencyFilter, regionFilter, searchQuery, page]);

  const fetchStats = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (regionFilter && regionFilter !== "GLOBAL") params.set("region", regionFilter);
      const [statsRes, villageRes] = await Promise.all([
        fetch(`${API_BASE}/cases/stats?${params}`),
        fetch(`${API_BASE}/cases/village-stats?${params}`)
      ]);
      
      const statsData: StatsResponse = await statsRes.json();
      const villageData: VillageStat[] = await villageRes.json();
      
      setStats(statsData);
      setVillageStats(villageData);
    } catch (error) {
      console.error("Failed to fetch stats:", error);
    }
  }, [regionFilter]);

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    const eventSource = new EventSource(`${API_BASE}/cases/stream`);
    
    eventSource.onmessage = (event) => {
      fetchCases();
      fetchStats();
    };

    return () => eventSource.close();
  }, [fetchCases, fetchStats]);

  return {
    cases,
    villageStats,
    stats,
    loading,
    urgencyFilter,
    setUrgencyFilter,
    regionFilter,
    setRegionFilter,
    searchQuery,
    setSearchQuery,
    page,
    setPage,
    totalPages,
    total,
    refetch: () => { fetchCases(); fetchStats(); },
  };
}
