import type { AuthResponse, AuthUser, LoginType, RegisterType, CreateAddressInput, AddressResponse, GetAddressesResponse } from "@/types/auth.type";
import type { CreateOrderInput, CreateOrderResponse, GetOrdersResponse, GetOrderByIdResponse } from "@/types/order.type";
import API, { clearCsrfToken } from "./axios-client";
import type { CategoryResponseType } from "@/types/categories.type";
import type { DealsResponseType, ProductParams, ProductResponseType, ProductDetailResponseType, ReviewsResponseType } from "@/types/products.type";
import type { CartResponseType } from "@/types/cart.type";



const toAuthUser = (u: any): AuthUser => ({
    _id: u?.id ?? "",
    name: u?.name ?? "",
    email: u?.email ?? "",
    avatar: u?.image ?? null,
    isAdmin: u?.role === "ADMIN",
    createdAt: u?.createdAt,
    updatedAt: u?.updatedAt,
});

export const loginMutationFn = async (data: LoginType): Promise<AuthResponse> => {
    const response = await API.post("/auth/sign-in/email", data);
    clearCsrfToken();
    return { message: "Signed in successfully", user: toAuthUser(response.data?.user) };
}

export const registerMutationFn = async (data: RegisterType): Promise<AuthResponse> => {
    const response = await API.post("/auth/sign-up/email", {
        email: data.email,
        password: data.password,
        name: data.name,
    });
    clearCsrfToken();
    return { message: "Account created", user: toAuthUser(response.data?.user) };
}

export const logoutMutationFn = async (): Promise<{ message: string }> => {
    await API.post("/auth/sign-out");
    clearCsrfToken();
    return { message: "Signed out" };
};

export const getCurrentUser = async (): Promise<AuthResponse> => {
    const response = await API.get("/auth/get-session");
    if (!response.data?.user) throw new Error("Not authenticated");
    return { message: "Session", user: toAuthUser(response.data.user) };
}

export const getAllCategoriesQueryFn = async (): Promise<CategoryResponseType> => {
    const response = await API.get<CategoryResponseType>("/categories");
    return response.data;
};

export const getProductDealsQueryFn = async (limit: number = 6): Promise<DealsResponseType> => {
    const response = await API.get<DealsResponseType>("/products/deals", {
        params: { limit },
    });
    return response.data;
};

export const getProductsQueryFn = async (params?: ProductParams): Promise<ProductResponseType> => {
    const queryParams: Record<string, any> = {};
    if (params) {
        if (params.categoryId !== undefined) queryParams.categoryId = params.categoryId;
        if (params.hasDiscount !== undefined) queryParams.hasDiscount = params.hasDiscount;
        if (params.inStock !== undefined) queryParams.inStock = params.inStock;
        if (params.minPrice !== undefined) queryParams.minPrice = params.minPrice;
        if (params.maxPrice !== undefined) queryParams.maxPrice = params.maxPrice;
        if (params.sort !== undefined) queryParams.sort = params.sort;
        if (params.keyword !== undefined) queryParams.keyword = params.keyword;
        if (params.page !== undefined) queryParams.page = params.page;
        if (params.limit !== undefined) queryParams.limit = params.limit;
        if (params.skip !== undefined) queryParams.skip = params.skip;
    }
    const response = await API.get<ProductResponseType>("/products", {
        params: queryParams,
    });
    return response.data;
};

export const getProductBySlugQueryFn = async (slug: string): Promise<ProductDetailResponseType> => {
    const response = await API.get<ProductDetailResponseType>(`/products/${slug}`);
    return response.data;
};

export const getProductReviewsQueryFn = async (
    slug: string,
    params?: { page?: number; limit?: number }
): Promise<ReviewsResponseType> => {
    const response = await API.get<ReviewsResponseType>(`/products/${slug}/reviews`, {
        params,
    });
    return response.data;
};

export const getCartQueryFn = async (): Promise<CartResponseType> => {
    const response = await API.get<CartResponseType>("/cart");
    return response.data;
};

export const updateCartMutationFn = async (items: { productId: string; quantity: number }[]): Promise<CartResponseType> => {
    const response = await API.post<CartResponseType>("/cart", { items });
    return response.data;
};


export const getAddressesQueryFn = async (): Promise<GetAddressesResponse> => {
    const response = await API.get<GetAddressesResponse>("/addresses");
    return response.data;
};

export const createAddressMutationFn = async (data: CreateAddressInput): Promise<AddressResponse> => {
    const response = await API.post<AddressResponse>("/addresses", data);
    return response.data;
};

export const createOrderMutationFn = async (data: CreateOrderInput): Promise<CreateOrderResponse> => {
    const response = await API.post<CreateOrderResponse>("/orders/checkout", data);
    return response.data;
};

export const getOrdersQueryFn = async (): Promise<GetOrdersResponse> => {
    const response = await API.get<GetOrdersResponse>("/orders");
    return response.data;
};

export const retryEsewaPaymentMutationFn = async (orderId: string): Promise<void> => {
    const { data } = await API.post<{ formUrl: string; fields: Record<string, string> }>(
        "/payments/esewa/initiate", { orderId }
    );
    const form = document.createElement("form");
    form.method = "POST";
    form.action = data.formUrl;
    for (const [name, value] of Object.entries(data.fields)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = String(value);
        form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
};

export const getOrderByIdQueryFn = async (orderId: string): Promise<GetOrderByIdResponse> => {
    const response = await API.get<GetOrderByIdResponse>(`/orders/${orderId}`);
    return response.data;
};

export const getReviewableOrderItemsQueryFn = async (): Promise<any> => {
    const response = await API.get("/reviews/reviewable");
    return response.data;
};

export const getUserReviewsQueryFn = async (): Promise<any> => {
    const response = await API.get("/reviews");
    return response.data;
};

export const createReviewMutationFn = async (data: {
    orderId: string;
    orderItemId: string;
    rating: number;
    comment: string;
}): Promise<any> => {
    const response = await API.post("/reviews", data);
    return response.data;
};


export const getAdminAnalyticsQueryFn = async (): Promise<any> => {
    const response = await API.get("/admin/analytics");
    return response.data;
};

export const getAdminOrdersQueryFn = async ({
  page,
  limit,
  status,
  keyword,
}: {
  page: number;
  limit: number;
  status?: string;
  keyword?: string;
}): Promise<any> => {
    const response = await API.get("/admin/orders", {
        params: { page, limit, ...(status ? { status } : {}), ...(keyword ? { keyword } : {}) },
    });
    return response.data;
};

export const updateOrderStatusMutationFn = async ({
    orderId,
    status,
    note,
}: {
    orderId: string;
    status: string;
    note?: string;
}): Promise<any> => {
    const response = await API.put(`/admin/orders/${orderId}/status`, { status, note });
    return response.data;
};

export const getAdminProductsQueryFn = async ({
  page,
  limit,
}: {
  page: number;
  limit: number;
}): Promise<any> => {
    const response = await API.get("/admin/products", {
        params: { page, limit },
    });
    return response.data;
};


export const createProductMutationFn = async (data: {
    categoryId: string;
    name: string;
    description?: string;
    images: string[];
    originalPrice: number;
    discountPercent?: number;
    discountLabel?: string | null;
    unit: string;
    stockCount?: number;
    isActive?: boolean;
}): Promise<any> => {
    const response = await API.post("/admin/products", data);
    return response.data;
};

export const uploadProductImagesMutationFn = async (files: File[]): Promise<{ images: string[] }> => {
    const formData = new FormData();
    files.forEach((file) => formData.append("images", file));
    const response = await API.post("/uploads/images", formData, {
        headers: {
            "Content-Type": "multipart/form-data"
        },
    });
    return response.data;
};

export const generateProductAiMutationFn = async (data: {
    action: "rephrase-title" | "generate-desc";
    title: string;
    unit?: string;
    description?: string;
}): Promise<{ result: string }> => {
    const response = await API.post("/admin/ai/generate", data);
    return response.data;
};







export type AdminCategory = {
  _id: string; name: string; slug: string; imageUrl: string;
  description: string; isActive: boolean; productCount: number; createdAt: string;
};

export const getAdminCategoriesQueryFn = async (): Promise<{ categories: AdminCategory[] }> => {
  const res = await API.get("/admin/categories");
  return res.data;
};

export const createCategoryMutationFn = async (data: {
  name: string; description?: string; imageUrl?: string; isActive?: boolean;
}) => (await API.post("/admin/categories", data)).data;

export const updateCategoryMutationFn = async ({ id, ...data }: {
  id: string; name?: string; description?: string; imageUrl?: string; isActive?: boolean;
}) => (await API.put(`/admin/categories/${id}`, data)).data;

export const deleteCategoryMutationFn = async (id: string) =>
  (await API.delete(`/admin/categories/${id}`)).data;

export type AdminUser = {
  _id: string; name: string; email: string; role: "USER" | "ADMIN";
  emailVerified: boolean; banned: boolean; orderCount: number; createdAt: string;
};

export const getAdminUsersQueryFn = async (params?: { page?: number; limit?: number; keyword?: string }):
  Promise<{ users: AdminUser[]; pagination: { total: number; page: number; limit: number; totalPages: number } }> => {
  const res = await API.get("/admin/users", { params });
  return res.data;
};

export const banUserMutationFn = async ({ id, banned, reason }: { id: string; banned: boolean; reason?: string }) =>
  (await API.put(`/admin/users/${id}/ban`, { banned, ...(reason ? { reason } : {}) })).data;

export const deleteProductMutationFn = async (id: string) =>
  (await API.delete(`/admin/products/${id}`)).data;

export const updateProductMutationFn = async ({ id, ...data }: Record<string, unknown> & { id: string }) =>
  (await API.put(`/admin/products/${id}`, data)).data;
