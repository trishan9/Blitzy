import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { BASE_API_URL } from "./env";

interface CustomError extends AxiosError {
    errorCode?: string;
}
const options = {
    baseURL:BASE_API_URL,
    withCredentials: true,
    timeout: 10000,
};
const API = axios.create(options);

let csrfToken: string | null = null;

export const clearCsrfToken = () => {
  csrfToken = null;
};

const getCsrfToken = async (force = false): Promise<string> => {
  if (csrfToken && !force) return csrfToken;
  const res = await axios.get(`${BASE_API_URL}csrf-token`, {
    withCredentials: true,
    params: { t: Date.now() },
  });
  csrfToken = res.data?.csrfToken ?? "";
  return csrfToken as string;
};

const isUnsafe = (method?: string) =>
  !["GET", "HEAD", "OPTIONS"].includes((method ?? "get").toUpperCase());

API.interceptors.request.use(async (config) => {
  if (isUnsafe(config.method)) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>)["x-csrf-token"] = await getCsrfToken();
  }
  return config;
});

type RetriableConfig = InternalAxiosRequestConfig & { _csrfRetried?: boolean };

API.interceptors.response.use(
    (response) => {
        return response;
    },
    async (error: AxiosError) => {
        const status = error.response?.status;
        const config = error.config as RetriableConfig | undefined;

        if (status === 403 && config && isUnsafe(config.method) && !config._csrfRetried) {
            config._csrfRetried = true;
            try {
                const fresh = await getCsrfToken(true);
                config.headers = config.headers ?? {};
                (config.headers as Record<string, string>)["x-csrf-token"] = fresh;
                return await API.request(config);
            } catch {
            }
        }

        const data = error.response?.data as { errorCode?: string } | undefined;
        const customError: CustomError = {
            ...error,
            errorCode: data?.errorCode || "UNKNOWN_ERROR",
        };
        return Promise.reject(customError);
    }
);

export default API;
