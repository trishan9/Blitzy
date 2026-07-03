import { create } from "zustand";
import { persist } from "zustand/middleware";
import { debounce } from "lodash";
import { toast } from "sonner";
import { getCartQueryFn, updateCartMutationFn } from "@/lib/api";

export type CartItem = {
  productId: string;
  name: string;
  imageUrl: string;
  salePrice: number;
  originalPrice: number;
  discountPercent?: number;
  discountLabel?: string;
  unit: string;
  stockCount?: number;
  quantity: number;
};

type AddToCartItem = Omit<CartItem, "quantity">;

type CartStore = {
  isCartOpen: boolean;
  isCartLoading: boolean;
  items: CartItem[];
  subTotal: number | null;
  deliveryFee: number;
  freeDeliveryThreshold: number;
  tax: number;
  orderTotal: number;
  setIsCartOpen: (isOpen: boolean) => void;
  addToCart: (item: AddToCartItem, quantity?: number) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  removeFromCart: (productId: string) => void;
  checkStock: (targetQty:number, stockCount:number | undefined) => boolean;
  clearCart: () => void;
  resetCart: () => void;
  cartCount: () => number;
  cartTotal: () => number;
  fetchCart: () => Promise<void>;
};

const getItemTotal = (item: CartItem) => {
  return item.salePrice * item.quantity;
};

let pendingSnapshot: CartItem[] | null = null;

const syncToServer = debounce(
  async (_items: CartItem[], _rollback: () => void) => {
    const send = (list: CartItem[]) =>
      updateCartMutationFn(list.map((i) => ({ productId: i.productId, quantity: i.quantity })));

    const promise = send(_items).catch((err) => {
      const gone: string[] | undefined = err?.response?.data?.unavailableProductIds;
      if (!gone || gone.length === 0) throw err;

      const kept = _items.filter((i) => !gone.includes(i.productId));
      useCart.setState({ items: kept });
      pendingSnapshot = null;
      if (kept.length === 0) {
        useCart.setState({ subTotal: 0, deliveryFee: 0, tax: 0, orderTotal: 0 });
        return null;
      }
      return send(kept);
    });
    toast.promise(promise, {
      loading: "Saving cart...",
      success: (data) => {
        pendingSnapshot = null;
        if (data) {
          useCart.setState({
            subTotal: data.subtotal,
            deliveryFee: data.deliveryFee,
            freeDeliveryThreshold: data.freeDeliveryThreshold,
            tax: data.tax,
            orderTotal: data.orderTotal,
          });
        }
        return "Cart saved successfully!";
      },
      error: ({ response }) => {
        _rollback();
        pendingSnapshot = null;
        useCart.setState({
          subTotal: null,
          deliveryFee: 0,
          freeDeliveryThreshold: 0,
          tax: 0,
          orderTotal: 0,
        });
        return response?.data?.error || response?.data?.message ||
          "Could not save the cart. Your changes were reverted.";
      },
    });

  },
  500,
);

export const useCart = create<CartStore>()(
  persist(
    (set, get) => ({
      isCartOpen: false,
      isCartLoading: false,
      items: [],
      subTotal: null,
      deliveryFee: 0,
      freeDeliveryThreshold: 0,
      tax: 0,
      orderTotal: 0,

      setIsCartOpen: (isOpen) => {
        set({ isCartOpen: isOpen });
      },

      checkStock: (targetQty, stockCount) => {
        if (stockCount === undefined || stockCount === null) return true;
        if (targetQty > stockCount) {
          toast.error(`Only ${stockCount} units available in stock.`);
          return false;
        }
        return true;
      },


      addToCart: (item, quantity = 1) => {
        const existing = get().items.find((i) => i.productId === item.productId);
        const newTotalQty = (existing ? existing.quantity : 0) + quantity;

       if (!get().checkStock(newTotalQty, item.stockCount)) return;

        if (!pendingSnapshot) pendingSnapshot = [...get().items];

        set((state) => {
          const existing = state.items.find(
            (cartItem) => cartItem.productId === item.productId,
          );
          if (existing) {
            const updatedItems = state.items.map((cartItem) =>
              cartItem.productId === item.productId
                ? { ...cartItem, quantity: cartItem.quantity + quantity }
                : cartItem,
            );
            return {
              items: updatedItems,
              subTotal: null,
            };
          }
          const updatedItems = [...state.items, { ...item, quantity }];
          return {
            items: updatedItems,
            subTotal: null,
          };
        });

        syncToServer(get().items, () => set({ items: pendingSnapshot! }));
      },

      updateQuantity: (productId, quantity) => {
        const item = get().items.find((item) => item.productId === productId);
        if (!item) return;

        if (!get().checkStock(quantity, item.stockCount)) return;

        if (!pendingSnapshot) pendingSnapshot = [...get().items];

        if (quantity <= 0) {
          get().removeFromCart(productId);
          return;
        }

        set((state) => {
          const updatedItems = state.items.map((item) =>
            item.productId === productId ? { ...item, quantity } : item,
          );
          return {
            items: updatedItems,
            subTotal: null,
          };
        });
        syncToServer(get().items, () => set({ items: pendingSnapshot! }));
      },


      removeFromCart: (productId) => {
        if (!pendingSnapshot) pendingSnapshot = [...get().items];

        set((state) => {
          const updatedItems = state.items.filter(
            (item) => item.productId !== productId,
          );
          return {
            items: updatedItems,
            subTotal: null,
          };
        });
        syncToServer(get().items, () => set({ items: pendingSnapshot! }));
      },

      clearCart: () => {
        const snapshot = [...get().items];
        if (snapshot.length === 0) return;

        set({
          items: [],
          subTotal: null,
          deliveryFee: 0,
          freeDeliveryThreshold: 0,
          tax: 0,
          orderTotal: 0,
        });
        syncToServer([], () => set({ items: snapshot! }));
      },

      resetCart: () => {
        set({
          items: [],
          subTotal: null,
          deliveryFee: 0,
          freeDeliveryThreshold: 0,
          tax: 0,
          orderTotal: 0,
        });
      },

      cartCount: () => {
        return get().items.reduce((total, item) => total + item.quantity, 0);
      },

      cartTotal: () => {
        const subTotal = get().subTotal;
        if (subTotal !== null) return subTotal;

        return get().items.reduce(
          (total, item) => total + getItemTotal(item),
          0,
        );
      },

      fetchCart: async () => {
        set({ isCartLoading: true });
        try {
          const data = await getCartQueryFn();
          if (data?.cart) {
            const items = data.cart.items.map((item) => ({
              productId: item.productId._id,
              name: item.productId.name,
              imageUrl: item.productId.images[0] || "",
              salePrice: item.productId.salePrice,
              originalPrice: item.productId.originalPrice,
              discountPercent: item.productId.discountPercent,
              discountLabel: item.productId.discountLabel || undefined,
              unit: item.productId.unit,
              quantity: item.quantity,
            }));
            set({
              items,
              subTotal: data.subtotal,
              deliveryFee: data.deliveryFee,
              freeDeliveryThreshold: data.freeDeliveryThreshold,
              tax: data.tax,
              orderTotal: data.orderTotal,
              isCartLoading: false,
            });
          }
        } catch (error) {
          console.error("Failed to fetch user cart:", error);
          set({ isCartLoading: false });
        }
      },
    }),
    {
      name: "instant-cart",
      partialize: (state) => ({ items: state.items }),
    },
  ),
);
