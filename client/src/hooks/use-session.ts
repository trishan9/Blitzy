import { useQuery } from "@tanstack/react-query";
import API from "@/lib/axios-client";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role?: "USER" | "ADMIN";
  emailVerified?: boolean;
};

export const useSession = () => {
  const query = useQuery({
    queryKey: ["session"],
    queryFn: async (): Promise<SessionUser | null> => {
      try {
        const res = await API.get("/auth/get-session");
        return res.data?.user ?? null;
      } catch {
        return null;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  return {
    user: query.data ?? null,
    isLoading: query.isLoading,
    isAdmin: query.data?.role === "ADMIN",
    refetch: query.refetch,
  };
};
